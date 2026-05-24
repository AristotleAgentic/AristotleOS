import {
  type AristotleSigner,
  type AsyncLedgerStore,
  type AuthorityEnvelope,
  type CanonicalActionInput,
  type ExecutionControlDecision,
  type ExecutionControlReasonCode,
  type GelRecord,
  type JsonValue,
  type LedgerStore,
  type WardManifest,
  type Warrant,
  evaluateExecutionControl,
  evaluateExecutionControlAsync,
  verifyWarrant
} from "./index.js";

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
}

export interface CredentialBrokerConfig {
  rules: CredentialRule[];
}

export class CredentialBroker {
  constructor(
    private readonly rules: CredentialRule[],
    private readonly env: Record<string, string | undefined> = process.env
  ) {}

  static fromConfig(config: CredentialBrokerConfig, env: Record<string, string | undefined> = process.env): CredentialBroker {
    return new CredentialBroker(config.rules ?? [], env);
  }

  private matches(rule: CredentialRule, action: CanonicalActionInput): boolean {
    if (rule.action_type && rule.action_type !== action.action_type) return false;
    if (rule.target_prefix && !action.target.startsWith(rule.target_prefix)) return false;
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
  /** Injected for testing; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export interface ProxyGovernedActionResult {
  decision: ExecutionControlDecision;
  reason_codes: ExecutionControlReasonCode[];
  canonical_action_hash: string;
  warrant?: Warrant;
  forwarded: boolean;
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
    warrantTtlSeconds: input.warrantTtlSeconds
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

  if (evaluation.decision !== "ALLOW" || !evaluation.warrant) {
    return { ...base, forwarded: false, injected_headers: [] };
  }

  // Defense in depth: never forward against an unverifiable Warrant.
  const verification = verifyWarrant(evaluation.warrant, evaluation.canonical_action_hash, input.now);
  if (!verification.ok) {
    return { ...base, forwarded: false, injected_headers: [], error: `warrant verification failed: ${verification.reason}` };
  }

  const destination = resolveDestination(input.action);
  if ("error" in destination) {
    return { ...base, forwarded: false, injected_headers: [], error: destination.error };
  }

  let injected: Record<string, string> = {};
  try {
    injected = input.broker ? input.broker.resolve(input.action) : {};
  } catch (error) {
    return { ...base, forwarded: false, injected_headers: [], error: error instanceof Error ? error.message : String(error) };
  }

  const declaredHeaders = (input.action.params.headers as Record<string, JsonValue> | undefined) ?? {};
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(declaredHeaders)) headers[key] = String(value);
  Object.assign(headers, injected);

  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(destination.url, {
      method: methodFor(input.action),
      headers,
      body: bodyFor(input.action)
    });
    const text = await response.text();
    return {
      ...base,
      forwarded: true,
      injected_headers: Object.keys(injected),
      response: { status: response.status, headers: Object.fromEntries(response.headers), body: text }
    };
  } catch (error) {
    return { ...base, forwarded: false, injected_headers: Object.keys(injected), error: error instanceof Error ? error.message : String(error) };
  }
}
