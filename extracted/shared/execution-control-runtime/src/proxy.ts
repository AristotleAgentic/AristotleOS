import {
  type AristotleSigner,
  type AsyncLedgerStore,
  type AuthorityEnvelope,
  type CanonicalActionInput,
  type ExecutionControlDecision,
  type AristotleTracer,
  type ExecutionControlReasonCode,
  type GelActor,
  type GelRecord,
  type JsonValue,
  type LedgerStore,
  type TraceContext,
  type WardManifest,
  type Warrant,
  type RuntimeRegister,
  type DegradationCondition,
  type BudgetGovernor,
  type ApprovalStore,
  getDefaultDevSigner,
  evaluateExecutionControl,
  evaluateExecutionControlAsync,
  verifyWarrant
} from "./index.js";
import { type CredentialRevocationList, credentialRevocationReason } from "./credential-revocation.js";
import { classifyEgressUrl } from "./egress-guard.js";
import { SqliteEffectStore, type EffectAttempt, type EffectState } from "./effects.js";
import { loadRevocationList } from "./revocation.js";

/**
 * Credential brokering + governed action proxy.
 *
 * The agent never holds downstream secrets. It asks the AristotleOS boundary to
 * perform a consequential action; only on ALLOW (with a verified Warrant) does
 * the broker inject the scoped credential and the proxy forward the call. The
 * raw secret is never returned to the caller and never written to the ledger.
 */

export interface CredentialRule {
  /** Match by exact Canonical Governed Action type (e.g. "http.post"). */
  action_type?: string;
  /** Match when the action target starts with this prefix (e.g. "https://api.stripe.com"). */
  target_prefix?: string;
  /** Header injected into the forwarded request. */
  header: string;
  /** Literal value (discouraged) or, preferably, an env var name to read. */
  value?: string;
  value_env?: string;
  /** Optional scheme prefix, e.g. "Bearer". */
  scheme?: string;
  /** Stable credential reference used for revocation checks and audit surfaces. */
  credential_ref?: string;
}

export interface CredentialBrokerConfig {
  rules: CredentialRule[];
}

export class CredentialBroker {
  constructor(
    private readonly rules: CredentialRule[],
    private readonly env: Record<string, string | undefined> = process.env,
    private readonly credentialRevocations?: CredentialRevocationList
  ) {}

  static fromConfig(config: CredentialBrokerConfig, env: Record<string, string | undefined> = process.env, credentialRevocations?: CredentialRevocationList): CredentialBroker {
    return new CredentialBroker(config.rules ?? [], env, credentialRevocations);
  }

  private matches(rule: CredentialRule, action: CanonicalActionInput): boolean {
    if (rule.action_type && rule.action_type !== action.action_type) return false;
    if (rule.target_prefix) {
      try {
        const prefix = new URL(rule.target_prefix), target = new URL(action.target);
        if (!["http:", "https:"].includes(prefix.protocol) || prefix.username || prefix.password || target.username || target.password) return false;
        if (prefix.origin !== target.origin) return false;
        const basePath = prefix.pathname.replace(/\/$/, "");
        if (target.pathname !== basePath && !target.pathname.startsWith(`${basePath}/`)) return false;
        if (prefix.search && prefix.search !== target.search) return false;
      } catch { return false; }
    }
    return true;
  }

  /** Header names (no values) that would be injected — safe to log/audit. */
  describe(action: CanonicalActionInput): string[] {
    return this.rules.filter((rule) => this.matches(rule, action)).map((rule) => rule.header);
  }

  /** Resolve the headers to inject for an approved action. Throws if a matched secret is missing. */
  resolve(action: CanonicalActionInput): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const rule of this.rules) {
      if (!this.matches(rule, action)) continue;
      if (rule.credential_ref && credentialRevocationReason(this.credentialRevocations, rule.credential_ref)) {
        throw new Error(`credential broker: credential "${rule.credential_ref}" is revoked`);
      }
      const raw = rule.value ?? (rule.value_env ? this.env[rule.value_env] : undefined);
      if (raw === undefined || raw === "") {
        throw new Error(`credential broker: missing secret for header "${rule.header}"${rule.value_env ? ` (env ${rule.value_env})` : ""}`);
      }
      headers[rule.header] = rule.scheme ? `${rule.scheme} ${raw}` : raw;
    }
    return headers;
  }
}

const METHOD_BY_TYPE: Record<string, string> = {
  "http.get": "GET",
  "http.post": "POST",
  "http.put": "PUT",
  "http.patch": "PATCH",
  "http.delete": "DELETE",
  "http.request": "GET"
};

function methodFor(action: CanonicalActionInput): string {
  const explicit = action.params.method;
  if (typeof explicit === "string") return explicit.toUpperCase();
  return METHOD_BY_TYPE[action.action_type] ?? "GET";
}

/**
 * The proxy only ever contacts the gate-authorized destination: `action.target`.
 * The Commit Gate's allowed_targets constraint is evaluated against `target`, so
 * forwarding to anything else (e.g. a divergent `params.url`) would be an
 * authorization bypass / SSRF vector. A `params.url` that disagrees with `target`
 * is rejected rather than silently followed.
 */
function resolveDestination(action: CanonicalActionInput): { url: string } | { error: string } {
  const declared = action.params.url;
  if (typeof declared === "string" && declared !== action.target) {
    return { error: "proxy destination mismatch: params.url must equal the authorized target" };
  }
  return { url: action.target };
}

function bodyFor(action: CanonicalActionInput): string | undefined {
  const body = action.params.body;
  if (body === undefined) return undefined;
  return typeof body === "string" ? body : JSON.stringify(body);
}

export interface ProxyGovernedActionInput {
  ward: WardManifest;
  authorityEnvelope: AuthorityEnvelope;
  action: CanonicalActionInput;
  ledgerPath: string;
  signer?: AristotleSigner;
  broker?: CredentialBroker;
  now?: string;
  killSwitchPath?: string;
  replayProtection?: boolean;
  revocationListPath?: string;
  ledger?: LedgerStore;
  asyncLedger?: AsyncLedgerStore;
  warrantTtlSeconds?: number;
  /** Authenticated operator attributed to the decision in the GEL. */
  actor?: GelActor;
  /** W3C trace context stamped into the GEL record. */
  trace_context?: TraceContext;
  /** Optional OpenTelemetry-shaped tracer. */
  tracer?: AristotleTracer;
  /** Injected for testing; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /**
   * When true, also refuse loopback / RFC1918 / unique-local / localhost targets.
   * The cloud-metadata / link-local range, the unspecified address, and non-http(s)
   * schemes are refused regardless of this flag.
   */
  blockPrivateEgress?: boolean;
  /** All competing dispatchers must share this store. Defaults to a durable
   * local sidecar at ledgerPath + '.effects.sqlite'. Not a distributed lock. */
  effectStore?: SqliteEffectStore;
  runtimeRegister?: RuntimeRegister;
  degradedConditions?: DegradationCondition[];
  budgetGovernor?: BudgetGovernor;
  approvalStore?: ApprovalStore;
}

export interface ProxyGovernedActionResult {
  decision: ExecutionControlDecision;
  reason_codes: ExecutionControlReasonCode[];
  canonical_action_hash: string;
  warrant?: Warrant;
  forwarded: boolean;
  /** Legacy forwarded describes response receipt, never business-effect certainty. */
  dispatch_status: "NOT_ATTEMPTED" | "ATTEMPTED_UNKNOWN" | "RESPONSE_RECEIVED";
  effect_state: EffectState;
  effect_attempt?: EffectAttempt;
  /** Header names injected by the broker — never the values. */
  injected_headers: string[];
  response?: { status: number; headers: Record<string, string>; body: string };
  gel_record: GelRecord;
  error?: string;
}

/**
 * Evaluate an action at the Commit Gate and forward the downstream HTTP call only
 * when ALLOW + a verified Warrant hold. Credentials are injected by the broker at
 * the moment of forwarding and never exposed to the caller.
 */
export async function proxyGovernedAction(input: ProxyGovernedActionInput): Promise<ProxyGovernedActionResult> {
  // Freeze the proposal across async ledger operations: caller mutation after
  // admission must not change what is sent to the destination.
  input = { ...input, action: structuredClone(input.action), ward: structuredClone(input.ward), authorityEnvelope: structuredClone(input.authorityEnvelope) };
  const evaluateParams = {
    ward: input.ward,
    authorityEnvelope: input.authorityEnvelope,
    action: input.action,
    ledgerPath: input.ledgerPath,
    signer: input.signer,
    now: input.now,
    killSwitchPath: input.killSwitchPath,
    replayProtection: input.replayProtection,
    revocationListPath: input.revocationListPath,
    warrantTtlSeconds: input.warrantTtlSeconds,
    actor: input.actor,
    trace_context: input.trace_context,
    tracer: input.tracer,
    runtimeRegister: input.runtimeRegister,
    degradedConditions: input.degradedConditions,
    budgetGovernor: input.budgetGovernor,
    approvalStore: input.approvalStore
  };
  const evaluation = input.asyncLedger
    ? await evaluateExecutionControlAsync({ ...evaluateParams, ledger: input.asyncLedger })
    : evaluateExecutionControl({ ...evaluateParams, ledger: input.ledger });

  const base = {
    decision: evaluation.decision,
    reason_codes: evaluation.reason_codes,
    canonical_action_hash: evaluation.canonical_action_hash,
    warrant: evaluation.warrant,
    gel_record: evaluation.gel_record
  };
  const notAttempted = { dispatch_status: "NOT_ATTEMPTED" as const, effect_state: "CONFIRMED_NO_EFFECT" as const };

  if (evaluation.decision !== "ALLOW" || !evaluation.warrant) {
    return { ...base, ...notAttempted, forwarded: false, injected_headers: [] };
  }

  // Defense in depth: never forward against an unverifiable Warrant.
  const verification = verifyWarrant(evaluation.warrant, evaluation.canonical_action_hash, input.now);
  if (!verification.ok) {
    return { ...base, ...notAttempted, forwarded: false, injected_headers: [], error: `warrant verification failed: ${verification.reason}` };
  }

  const destination = resolveDestination(input.action);
  if ("error" in destination) {
    return { ...base, ...notAttempted, forwarded: false, injected_headers: [], error: destination.error };
  }

  // SSRF guard: refuse cloud-metadata / link-local / unspecified / non-http(s) targets
  // (and private networks when opted in) before any credential is brokered or sent.
  const egress = classifyEgressUrl(destination.url, { blockPrivateNetworks: input.blockPrivateEgress === true });
  if (!egress.ok) {
    return { ...base, ...notAttempted, forwarded: false, injected_headers: [], error: `egress blocked: ${egress.reason}` };
  }

  let injected: Record<string, string> = {};
  try {
    injected = input.broker ? input.broker.resolve(input.action) : {};
  } catch (error) {
    return { ...base, ...notAttempted, forwarded: false, injected_headers: [], error: error instanceof Error ? error.message : String(error) };
  }

  let store: SqliteEffectStore | undefined;
  let attempt: EffectAttempt | undefined;
  try {
    const method = methodFor(input.action);
    if (input.action.action_type !== "http.request" && METHOD_BY_TYPE[input.action.action_type] && method !== METHOD_BY_TYPE[input.action.action_type]) throw new Error("proxy method differs from authorized action type");
    const headers = new Headers();
    const declaredHeaders = (input.action.params.headers as Record<string, JsonValue> | undefined) ?? {};
    for (const [key, value] of Object.entries(declaredHeaders)) {
      if (["host", "connection", "content-length", "transfer-encoding"].includes(key.toLowerCase())) throw new Error("proxy transport header override refused");
      headers.set(key, String(value));
    }
    for (const [key, value] of Object.entries(injected)) headers.set(key, value);
    const body = bodyFor(input.action);
    const signer = input.signer ?? getDefaultDevSigner();
    store = input.effectStore ?? new SqliteEffectStore(`${input.ledgerPath}.effects.sqlite`, signer);
    attempt = store.begin({ ward: input.ward, action: input.action, warrant: evaluation.warrant, admission: evaluation.gel_record,
      now: input.now, verify: { trustedKeyIds: [signer.key_id], revocations: input.revocationListPath ? loadRevocationList(input.revocationListPath) : undefined } });
    evaluation.warrant.consumed = true;
    const fetchImpl = input.fetchImpl ?? fetch;
    let response: ProxyGovernedActionResult["response"];
    let error: string | undefined;
    try {
      const received = await fetchImpl(destination.url, { method, headers, body, redirect: "manual" });
      response = { status: received.status, headers: Object.fromEntries(received.headers), body: await received.text() };
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    // A successful HTTP exchange is a transport receipt, not proof of effect.
    // Persist uncertainty after both success and failure; only a trusted observer
    // may move the attempt to a confirmed terminal state.
    try { attempt = store.markUnknown(attempt.attempt_id, input.now); }
    catch { error = "effect finalization unavailable; durable attempt remains in flight"; }
    return { ...base, forwarded: !!response, dispatch_status: response ? "RESPONSE_RECEIVED" : "ATTEMPTED_UNKNOWN",
      effect_state: "EFFECT_UNKNOWN", effect_attempt: attempt, injected_headers: Object.keys(injected),
      ...(response ? { response } : {}), ...(error ? { error } : {}) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ...base, ...notAttempted, forwarded: false, injected_headers: [],
      ...(attempt || message.includes("EFFECT_OPERATION_ALREADY_ATTEMPTED") ? { effect_state: "EFFECT_UNKNOWN" as const } : {}),
      ...(attempt ? { effect_attempt: attempt, dispatch_status: "ATTEMPTED_UNKNOWN" as const } : {}), error: message };
  } finally {
    if (store && store !== input.effectStore) store.close();
  }
}
