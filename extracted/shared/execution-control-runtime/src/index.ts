import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import {
  type AristotleSigner,
  type SignatureAlgorithm,
  getDefaultDevSigner,
  resolveWarrantSigner,
  verifyEd25519
} from "./signing.js";
import { type CredentialBroker, proxyGovernedAction } from "./proxy.js";
import { PLAYGROUND_HTML } from "./playground.js";
import { type RevocationKind, type RevocationList, addRevocation, loadRevocationList, revocationReason } from "./revocation.js";
import { assertValidAuthorityEnvelope, assertValidWardManifest } from "./validation.js";
import { type AuditEvent, deliverAuditEvent } from "./audit-sink.js";
import {
  type AuthConfig,
  type AuthMethod,
  type OperatorCredential,
  type OperatorRole,
  type OidcConfig,
  type Principal,
  authEnabled,
  presentedCredential,
  resolvePrincipal,
  roleSatisfies
} from "./auth.js";
import {
  type AristotleTracer,
  type TraceContext,
  normalizeTraceContext,
  parseTraceparent,
  traceSpan
} from "./trace.js";
import { RuntimeMetrics } from "./metrics.js";
import { type GovernanceDraft, compileGovernanceManifest, diffGovernanceManifests, explainPolicy } from "./builder.js";

export * from "./proxy.js";
export * from "./mcp.js";
export * from "./playground.js";
export * from "./revocation.js";
export * from "./credential-revocation.js";
export * from "./validation.js";
export * from "./sqlite-ledger.js";
export * from "./postgres-ledger.js";
export * from "./audit-sink.js";
export * from "./auth.js";
export * from "./trace.js";
export * from "./metrics.js";
export * from "./sandbox.js";
export * from "./shadow.js";
export * from "./builder.js";
export * from "./reconcile.js";
export * from "./ward-marshal.js";
export * from "./ward-marshal-adapters.js";
export * from "./marshal-behavior.js";
export * from "./marshal-collectors.js";
export * from "./credential-minter.js";
export * from "./attestation.js";
export * from "./crypto-posture.js";
export * from "./edge-containment.js";

export {
  type AristotleSigner,
  type KeyMaterialProvider,
  type SignatureAlgorithm,
  createEd25519Signer,
  createEphemeralDevSigner,
  createSignerFromKeyProvider,
  deriveKeyId,
  getDefaultDevSigner,
  loadWarrantSignerFromEnv,
  requireProductionSigner,
  resolveWarrantSigner,
  verifyEd25519
} from "./signing.js";

export type ExecutionControlDecision = "ALLOW" | "REFUSE" | "ESCALATE";

export type ExecutionControlReasonCode =
  | "WARD_NOT_FOUND"
  | "SUBJECT_NOT_IN_WARD"
  | "ENVELOPE_EXPIRED"
  | "ACTION_DENIED"
  | "ACTION_NOT_ALLOWED"
  | "CONSTRAINT_FAILED"
  | "PHYSICAL_INVARIANT_FAILED"
  | "RUNTIME_STATE_MISSING"
  | "POLICY_VERSION_MISMATCH"
  | "KILL_SWITCH_ENGAGED"
  | "REPLAY_DETECTED"
  | "AUTHORITY_REVOKED"
  | "ALLOWED";

export interface WardManifest {
  ward_id: string;
  name: string;
  sovereignty_context: string;
  authority_domain: string;
  policy_version: string;
  evidence_ledger_path?: string;
  permitted_subjects: string[];
  physical_bounds?: PhysicalBounds;
  metadata?: Record<string, JsonValue>;
}

export interface AuthorityEnvelope {
  envelope_id: string;
  ward_id: string;
  subject: string;
  allowed_actions: string[];
  denied_actions: string[];
  constraints: Record<string, JsonValue>;
  expires_at: string;
  issuer: string;
  signature?: string;
}

export interface CanonicalActionInput {
  action_id: string;
  ward_id: string;
  subject: string;
  action_type: string;
  target: string;
  params: Record<string, JsonValue>;
  requested_at: string;
  nonce?: string;
  request_id?: string;
  telemetry?: Record<string, JsonValue>;
}

export interface CanonicalAction {
  canonical_json: string;
  canonical_action_hash: string;
  action: CanonicalActionInput;
}

export interface RuntimeRegister {
  policy_version?: string;
  registers?: Record<string, JsonValue>;
  [key: string]: JsonValue | Record<string, JsonValue> | undefined;
}

export interface PhysicalBounds {
  max_altitude_m?: number;
  permitted_boundary_id?: string;
  battery_minimum_pct?: number;
}

export interface PhysicalInvariantResult {
  ok: boolean;
  reason_codes: ExecutionControlReasonCode[];
  detail: string;
}

export interface CommitGateInput {
  ward?: WardManifest | null;
  authorityEnvelope?: AuthorityEnvelope | null;
  action: CanonicalActionInput;
  runtimeRegister?: RuntimeRegister;
  now?: string;
}

export interface CommitGateDecision {
  decision: ExecutionControlDecision;
  reason_codes: ExecutionControlReasonCode[];
  canonical_action_hash: string;
  policy_version?: string;
  authority_envelope_id?: string;
  runtime_register_snapshot: RuntimeRegister;
  physical_invariant_result?: PhysicalInvariantResult;
}

export interface Warrant {
  warrant_id: string;
  ward_id: string;
  authority_envelope_id: string;
  canonical_action_hash: string;
  subject: string;
  action_type: string;
  decision: "ALLOW";
  issued_at: string;
  expires_at: string;
  single_use: true;
  consumed: boolean;
  /** Per-issuance random nonce, signed into the Warrant material; lets a verifier
   *  detect replay of the Warrant artifact itself (independent of action content). */
  nonce?: string;
  issuer: string;
  /** Base64 Ed25519 signature over the canonical Warrant material. */
  signature: string;
  signature_algorithm: SignatureAlgorithm;
  /** Content-addressed id of the signing key (e.g. ed25519:...). */
  signing_key_id: string;
  /** SPKI PEM of the signing public key, embedded for offline verification. */
  signing_public_key: string;
}

export interface WarrantVerification {
  ok: boolean;
  reason?:
    | "WARRANT_CONSUMED"
    | "WARRANT_EXPIRED"
    | "WARRANT_NOT_YET_VALID"
    | "WARRANT_LIFETIME_EXCEEDED"
    | "WARRANT_REPLAYED"
    | "ACTION_HASH_MISMATCH"
    | "DECISION_NOT_ALLOWED"
    | "SIGNATURE_MISMATCH"
    | "UNTRUSTED_SIGNING_KEY"
    | "REVOKED";
}

/** A seen-nonce set for detecting Warrant-artifact replay (e.g. a Set or a store). */
export interface NonceSeenSet {
  has(nonce: string): boolean;
}

export interface WarrantVerifyOptions {
  /** When set, the Warrant's signing key id must appear in this allowlist. */
  trustedKeyIds?: string[];
  /** When set, the Warrant is rejected if its key/envelope/id is revoked. */
  revocations?: RevocationList;
  /** Trusted-time hardening: reject a Warrant whose issued_at is more than this many
   *  ms in the future relative to `now` (defends against a forward-skewed issuer). Default 60000. */
  maxClockSkewMs?: number;
  /** Verifier-policy ceiling: reject a Warrant whose lifetime (expires_at − issued_at)
   *  exceeds this many ms, regardless of what the issuer signed. Unset = no ceiling. */
  maxLifetimeMs?: number;
  /** When provided, reject a Warrant whose nonce has already been seen (artifact replay). */
  seenNonces?: NonceSeenSet;
}

/** The authenticated operator/principal attributed to a ledger record. */
export interface GelActor {
  subject: string;
  role: OperatorRole;
  auth: AuthMethod;
  /** OIDC issuer (iss), when authenticated via OIDC. */
  issuer?: string;
  /** Static-token label or JWT `kid`. Never the token/secret itself. */
  key_id?: string;
}

export interface GelRecord {
  record_id: string;
  previous_hash: string;
  record_hash: string;
  timestamp: string;
  ward_id: string;
  subject: string;
  canonical_action_hash: string;
  decision: ExecutionControlDecision;
  reason_codes: ExecutionControlReasonCode[];
  authority_envelope_id?: string;
  warrant_id?: string;
  policy_version?: string;
  /** Caller/idempotency request id (from the action), surfaced for correlation. */
  request_id?: string;
  /** W3C distributed-trace context, when provided, so evidence joins your traces. */
  trace_context?: TraceContext;
  /** Authenticated operator/principal behind the request (RBAC attribution). Part of the signed hash material. */
  actor?: GelActor;
  runtime_register_snapshot: RuntimeRegister;
  physical_invariant_result?: PhysicalInvariantResult;
  /** Base64 Ed25519 signature over record_hash. Present when a signer is configured. */
  signature?: string;
  signature_algorithm?: SignatureAlgorithm;
  signing_key_id?: string;
  signing_public_key?: string;
}

/** Fields excluded from the hash-chain material (the hash + the signature over it). */
const GEL_NON_MATERIAL_FIELDS = [
  "record_hash",
  "signature",
  "signature_algorithm",
  "signing_key_id",
  "signing_public_key"
] as const;

export interface EvaluateExecutionControlInput extends CommitGateInput {
  ledgerPath: string;
  /** Signer for the issued Warrant. Defaults to a process-stable dev key. */
  signer?: AristotleSigner;
  /** When this file exists, the gate refuses every action (sovereign halt). */
  killSwitchPath?: string;
  /** When true, a previously-admitted identical action is refused as a replay. */
  replayProtection?: boolean;
  /** Path to a revocation list file; revoked keys/envelopes are refused at the gate. */
  revocationListPath?: string;
  /** Optional in-memory ledger index for O(1) append/replay on the server hot path. */
  ledger?: LedgerStore;
  /** Warrant lifetime in seconds (default 60). */
  warrantTtlSeconds?: number;
  /** Authenticated operator attributed to the decision in the GEL. */
  actor?: GelActor;
  /** W3C trace context stamped into the GEL record for correlation. */
  trace_context?: TraceContext;
  /** Optional OpenTelemetry-shaped tracer; emits spans around the decision phases. */
  tracer?: AristotleTracer;
}

export interface EvaluateExecutionControlResult {
  decision: ExecutionControlDecision;
  reason_codes: ExecutionControlReasonCode[];
  canonical_action_hash: string;
  warrant?: Warrant;
  gel_record: GelRecord;
  ledger_verification: { ok: boolean; count: number; failure?: string };
}

export interface EvidenceBundleSignature {
  algorithm: SignatureAlgorithm;
  key_id: string;
  /** SPKI PEM of the attesting key, embedded for offline verification. */
  public_key: string;
  /** Base64 Ed25519 signature over hashes.bundle_hash. */
  value: string;
}

export interface EvidenceBundle {
  bundle_version: "aristotle.execution-evidence.v1";
  exported_at: string;
  ward: WardManifest;
  authority_envelope?: AuthorityEnvelope;
  selected_record: GelRecord;
  ledger_chain: GelRecord[];
  warrant?: Warrant;
  hashes: {
    ward_manifest_hash: string;
    authority_envelope_hash?: string;
    selected_record_hash: string;
    ledger_tip_hash: string;
    bundle_hash: string;
  };
  /** Present when the bundle was exported with a configured signer. */
  bundle_signature?: EvidenceBundleSignature;
  verification: EvidenceBundleVerification;
}

export interface EvidenceBundleVerification {
  ok: boolean;
  failures: string[];
  ledger: { ok: boolean; count: number; failure?: string };
  warrant?: WarrantVerification;
  bundle_hash?: string;
  bundle_signature_ok?: boolean;
}

export interface ExportEvidenceBundleInput {
  ledgerPath: string;
  ward: WardManifest;
  authorityEnvelope?: AuthorityEnvelope;
  recordId?: string;
  warrant?: Warrant;
  exportedAt?: string;
  /** When provided, attaches a bundle-level Ed25519 attestation over bundle_hash. */
  signer?: AristotleSigner;
}

export interface VerifyEvidenceBundleOptions {
  /** When set, both the Warrant and bundle signatures must use a key id in this allowlist. */
  trustedKeyIds?: string[];
  /** When set, a bundle bound to a revoked key/envelope/warrant fails verification. */
  revocations?: RevocationList;
}

export interface ExecutionControlRuntimeServerOptions {
  ward: WardManifest;
  authorityEnvelope: AuthorityEnvelope;
  ledgerPath: string;
  now?: string;
  /** Signer for issued Warrants. Defaults to a process-stable dev key. */
  signer?: AristotleSigner;
  /** When set, enables the credential-brokering proxy route. */
  broker?: CredentialBroker;
  /** When true, serves the no-install playground UI at GET / and /playground. */
  servePlayground?: boolean;
  /** When this file exists, the boundary refuses every action (sovereign halt). */
  killSwitchPath?: string;
  /** When true, identical previously-admitted actions are refused as replays. Defaults to true. */
  replayProtection?: boolean;
  /** When set, /v1 routes require this bearer token / x-api-key (full-access / admin). */
  apiKey?: string;
  /** Role-scoped static bearer tokens (viewer/operator/admin) with operator identities. */
  operators?: OperatorCredential[];
  /** OIDC bearer-token verification; the token `sub` is attributed as the operator. */
  oidc?: OidcConfig;
  /** Path to a revocation list file; revoked keys/envelopes are refused at the gate. */
  revocationListPath?: string;
  /** Warrant lifetime in seconds (default 60). */
  warrantTtlSeconds?: number;
  /** When set, limits requests per subject per minute (429 when exceeded). */
  rateLimitPerMinute?: number;
  /** When "json", emit a structured decision log line per request to stderr. */
  logFormat?: "json";
  /** Pre-built ledger store (e.g. a SQLite-backed one). Defaults to a file store at ledgerPath. */
  ledger?: LedgerStore;
  /** Pre-built async ledger store (e.g. Postgres-backed) for the async evaluate path. */
  asyncLedger?: AsyncLedgerStore;
  /** When set, each decision's signed GEL record is forwarded to this URL (best-effort). */
  auditSink?: string;
  /** Optional OpenTelemetry-shaped tracer; emits spans around each decision. */
  tracer?: AristotleTracer;
}

export interface ExecutionControlRuntimeServer {
  server: Server;
}

export interface ExecutionControlClientOptions {
  endpoint?: string;
  action: CanonicalActionInput;
  runtimeRegister?: RuntimeRegister;
  now?: string;
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const GENESIS_HASH = "GENESIS";

export function stableNormalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => stableNormalize(item));
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonical action cannot contain non-finite numbers");
    return Number(value);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableNormalize(entry)])
    );
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stableNormalize(value));
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalizeAction(action: CanonicalActionInput): CanonicalAction {
  const canonical_json = stableStringify({
    action_id: action.action_id,
    action_type: action.action_type,
    nonce: action.nonce,
    params: action.params,
    request_id: action.request_id,
    requested_at: action.requested_at,
    subject: action.subject,
    target: action.target,
    telemetry: action.telemetry,
    ward_id: action.ward_id
  });
  return {
    action: JSON.parse(canonical_json) as CanonicalActionInput,
    canonical_json,
    canonical_action_hash: sha256(canonical_json)
  };
}

export function evaluatePhysicalInvariants(action: CanonicalActionInput, bounds?: PhysicalBounds): PhysicalInvariantResult {
  if (!bounds) return { ok: true, reason_codes: [], detail: "no physical bounds declared" };
  if (action.action_type === "drone.disable_geofence") {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "geofence disable is a hard physical interlock violation" };
  }
  const altitude = numericParam(action, "altitude_m");
  if (bounds.max_altitude_m !== undefined && altitude !== undefined && altitude > bounds.max_altitude_m) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `altitude_m ${altitude} exceeds max_altitude_m ${bounds.max_altitude_m}` };
  }
  const boundary = stringParam(action, "boundary_id");
  if (bounds.permitted_boundary_id && boundary && boundary !== bounds.permitted_boundary_id) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `boundary_id ${boundary} does not match ${bounds.permitted_boundary_id}` };
  }
  const battery = numericParam(action, "battery_pct");
  if (bounds.battery_minimum_pct !== undefined && battery !== undefined && battery < bounds.battery_minimum_pct) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `battery_pct ${battery} below minimum ${bounds.battery_minimum_pct}` };
  }
  return { ok: true, reason_codes: [], detail: "physical invariants satisfied" };
}

export function evaluateCommitGate(input: CommitGateInput): CommitGateDecision {
  const runtime_register_snapshot = stableNormalize(input.runtimeRegister ?? {}) as RuntimeRegister;
  const canonical = canonicalizeAction(input.action);
  const ward = input.ward;
  const envelope = input.authorityEnvelope;
  const nowMs = Date.parse(input.now ?? new Date().toISOString());

  if (!ward) return refuse("REFUSE", ["WARD_NOT_FOUND"], canonical, runtime_register_snapshot);
  if (!ward.permitted_subjects.includes(input.action.subject)) return refuse("REFUSE", ["SUBJECT_NOT_IN_WARD"], canonical, runtime_register_snapshot, ward);
  if (!envelope) return refuse("REFUSE", ["ACTION_NOT_ALLOWED"], canonical, runtime_register_snapshot, ward);
  if (envelope.ward_id !== ward.ward_id || envelope.subject !== input.action.subject) {
    return refuse("REFUSE", ["ACTION_NOT_ALLOWED"], canonical, runtime_register_snapshot, ward, envelope);
  }
  if (runtime_register_snapshot.policy_version && runtime_register_snapshot.policy_version !== ward.policy_version) {
    return refuse("ESCALATE", ["POLICY_VERSION_MISMATCH"], canonical, runtime_register_snapshot, ward, envelope);
  }
  if (Date.parse(envelope.expires_at) <= nowMs) {
    return refuse("REFUSE", ["ENVELOPE_EXPIRED"], canonical, runtime_register_snapshot, ward, envelope);
  }
  const missingRuntime = missingRuntimeRegisters(envelope, input.action, runtime_register_snapshot);
  if (missingRuntime.length) {
    return refuse("ESCALATE", ["RUNTIME_STATE_MISSING"], canonical, runtime_register_snapshot, ward, envelope);
  }
  if (envelope.denied_actions.includes(input.action.action_type)) {
    return refuse("REFUSE", ["ACTION_DENIED"], canonical, runtime_register_snapshot, ward, envelope);
  }
  if (!envelope.allowed_actions.includes(input.action.action_type)) {
    return refuse("REFUSE", ["ACTION_NOT_ALLOWED"], canonical, runtime_register_snapshot, ward, envelope);
  }
  if (!constraintsPass(envelope, input.action)) {
    return refuse("REFUSE", ["CONSTRAINT_FAILED"], canonical, runtime_register_snapshot, ward, envelope);
  }
  const physical = evaluatePhysicalInvariants(input.action, ward.physical_bounds);
  if (!physical.ok) {
    return {
      ...refuse("REFUSE", ["PHYSICAL_INVARIANT_FAILED"], canonical, runtime_register_snapshot, ward, envelope),
      physical_invariant_result: physical
    };
  }
  return {
    decision: "ALLOW",
    reason_codes: ["ALLOWED"],
    canonical_action_hash: canonical.canonical_action_hash,
    policy_version: ward.policy_version,
    authority_envelope_id: envelope.envelope_id,
    runtime_register_snapshot,
    physical_invariant_result: physical
  };
}

function refuse(
  decision: ExecutionControlDecision,
  reason_codes: ExecutionControlReasonCode[],
  canonical: CanonicalAction,
  runtime_register_snapshot: RuntimeRegister,
  ward?: WardManifest,
  envelope?: AuthorityEnvelope
): CommitGateDecision {
  return {
    decision,
    reason_codes,
    canonical_action_hash: canonical.canonical_action_hash,
    policy_version: ward?.policy_version,
    authority_envelope_id: envelope?.envelope_id,
    runtime_register_snapshot
  };
}

/** Canonical, deterministic message that an Ed25519 Warrant signature binds. */
function warrantMaterial(fields: {
  action_type: string;
  authority_envelope_id: string;
  canonical_action_hash: string;
  expires_at: string;
  issued_at: string;
  issuer: string;
  subject: string;
  ward_id: string;
  /** Optional: dropped from the canonical material when undefined, so Warrants minted
   *  before nonces existed still verify byte-identically. */
  nonce?: string;
}): string {
  return stableStringify({ ...fields, decision: "ALLOW", single_use: true });
}

export const DEFAULT_WARRANT_TTL_SECONDS = 60;

export function issueWarrant(
  decision: CommitGateDecision,
  action: CanonicalActionInput,
  envelope: AuthorityEnvelope,
  now = new Date().toISOString(),
  signer: AristotleSigner = getDefaultDevSigner(),
  ttlSeconds: number = DEFAULT_WARRANT_TTL_SECONDS
): Warrant | undefined {
  if (decision.decision !== "ALLOW") return undefined;
  const ttl = Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : DEFAULT_WARRANT_TTL_SECONDS;
  const expires_at = new Date(Date.parse(now) + ttl * 1000).toISOString();
  const nonce = randomUUID();
  const material = warrantMaterial({
    action_type: action.action_type,
    authority_envelope_id: envelope.envelope_id,
    canonical_action_hash: decision.canonical_action_hash,
    expires_at,
    issued_at: now,
    issuer: envelope.issuer,
    subject: action.subject,
    ward_id: action.ward_id,
    nonce
  });
  const signature = signer.sign(material);
  return {
    warrant_id: `wrn-${sha256(stableStringify({ material, signature, signing_key_id: signer.key_id })).slice(0, 24)}`,
    ward_id: action.ward_id,
    authority_envelope_id: envelope.envelope_id,
    canonical_action_hash: decision.canonical_action_hash,
    subject: action.subject,
    action_type: action.action_type,
    decision: "ALLOW",
    issued_at: now,
    expires_at,
    single_use: true,
    consumed: false,
    nonce,
    issuer: envelope.issuer,
    signature,
    signature_algorithm: signer.algorithm,
    signing_key_id: signer.key_id,
    signing_public_key: signer.public_key_pem
  };
}

export class AristotleWarrant {
  constructor(public readonly warrant: Warrant) {}

  verify(canonicalActionHash: string, now = new Date().toISOString(), options: WarrantVerifyOptions = {}): WarrantVerification {
    return verifyWarrant(this.warrant, canonicalActionHash, now, options);
  }

  consume(canonicalActionHash: string, now = new Date().toISOString(), options: WarrantVerifyOptions = {}): Warrant {
    const verification = this.verify(canonicalActionHash, now, options);
    if (!verification.ok) throw new Error(verification.reason ?? "WARRANT_VERIFICATION_FAILED");
    this.warrant.consumed = true;
    return this.warrant;
  }
}

export function verifyWarrant(warrant: Warrant, canonicalActionHash: string, now = new Date().toISOString(), options: WarrantVerifyOptions = {}): WarrantVerification {
  if (warrant.decision !== "ALLOW") return { ok: false, reason: "DECISION_NOT_ALLOWED" };
  if (warrant.consumed) return { ok: false, reason: "WARRANT_CONSUMED" };
  const nowMs = Date.parse(now);
  const issuedMs = Date.parse(warrant.issued_at);
  // Trusted-time hardening. expires_at/issued_at are signed, so they cannot be
  // tampered without the key — but a verifier with a skewed clock, or a forward-
  // skewed issuer, still needs guarding, and a verifier should enforce its own
  // lifetime ceiling regardless of what the issuer signed.
  if (Date.parse(warrant.expires_at) <= nowMs) return { ok: false, reason: "WARRANT_EXPIRED" };
  const skew = options.maxClockSkewMs ?? 60_000;
  if (Number.isFinite(issuedMs) && issuedMs - nowMs > skew) return { ok: false, reason: "WARRANT_NOT_YET_VALID" };
  if (options.maxLifetimeMs !== undefined && Number.isFinite(issuedMs) && Date.parse(warrant.expires_at) - issuedMs > options.maxLifetimeMs) {
    return { ok: false, reason: "WARRANT_LIFETIME_EXCEEDED" };
  }
  if (options.seenNonces && warrant.nonce && options.seenNonces.has(warrant.nonce)) return { ok: false, reason: "WARRANT_REPLAYED" };
  if (warrant.canonical_action_hash !== canonicalActionHash) return { ok: false, reason: "ACTION_HASH_MISMATCH" };
  if (options.trustedKeyIds && !options.trustedKeyIds.includes(warrant.signing_key_id)) {
    return { ok: false, reason: "UNTRUSTED_SIGNING_KEY" };
  }
  if (options.revocations && revocationReason(options.revocations, {
    signing_key_id: warrant.signing_key_id,
    authority_envelope_id: warrant.authority_envelope_id,
    warrant_id: warrant.warrant_id
  })) {
    return { ok: false, reason: "REVOKED" };
  }
  const material = warrantMaterial({
    action_type: warrant.action_type,
    authority_envelope_id: warrant.authority_envelope_id,
    canonical_action_hash: warrant.canonical_action_hash,
    expires_at: warrant.expires_at,
    issued_at: warrant.issued_at,
    issuer: warrant.issuer,
    subject: warrant.subject,
    ward_id: warrant.ward_id,
    nonce: warrant.nonce
  });
  if (warrant.signature_algorithm !== "ed25519" || !verifyEd25519(warrant.signing_public_key, material, warrant.signature)) {
    return { ok: false, reason: "SIGNATURE_MISMATCH" };
  }
  return { ok: true };
}

export function consumeWarrant(warrant: Warrant, canonicalActionHash: string, now = new Date().toISOString(), options: WarrantVerifyOptions = {}): Warrant {
  return new AristotleWarrant(warrant).consume(canonicalActionHash, now, options);
}

interface BuildGelRecordInput {
  previous_hash: string;
  ward: WardManifest;
  action: CanonicalActionInput;
  decision: CommitGateDecision;
  warrant?: Warrant;
  now?: string;
  signer?: AristotleSigner;
  /** Authenticated operator attributed to this record. */
  actor?: GelActor;
  /** W3C trace context to stamp into the record. */
  trace_context?: TraceContext;
}

/** Pure: build a (optionally signed) GEL record linked to a given previous hash. */
function buildGelRecord(input: BuildGelRecordInput): GelRecord {
  const { previous_hash } = input;
  const timestamp = input.now ?? new Date().toISOString();
  const base = {
    record_id: `gel-${sha256(stableStringify({ previous_hash, timestamp, action: input.decision.canonical_action_hash })).slice(0, 24)}`,
    previous_hash,
    timestamp,
    ward_id: input.ward.ward_id,
    subject: input.action.subject,
    canonical_action_hash: input.decision.canonical_action_hash,
    decision: input.decision.decision,
    reason_codes: input.decision.reason_codes,
    authority_envelope_id: input.decision.authority_envelope_id,
    warrant_id: input.warrant?.warrant_id,
    policy_version: input.decision.policy_version,
    request_id: input.action.request_id,
    trace_context: input.trace_context,
    actor: input.actor,
    runtime_register_snapshot: input.decision.runtime_register_snapshot,
    physical_invariant_result: input.decision.physical_invariant_result
  };
  // `actor` is undefined when no operator is attributed; stableStringify drops
  // undefined keys, so records without an actor hash identically to before
  // (backward-compatible with existing ledgers and evidence bundles).
  const record_hash = sha256(stableStringify(base));
  const signer = input.signer;
  return {
    ...base,
    record_hash,
    ...(signer
      ? {
          signature: signer.sign(record_hash),
          signature_algorithm: signer.algorithm,
          signing_key_id: signer.key_id,
          signing_public_key: signer.public_key_pem
        }
      : {})
  };
}

function writeGelRecord(ledgerPath: string, record: GelRecord): void {
  mkdirSync(path.dirname(path.resolve(ledgerPath)), { recursive: true });
  appendFileSync(ledgerPath, `${stableStringify(record)}\n`, "utf8");
}

export function appendGelRecord(input: {
  ledgerPath: string;
  ward: WardManifest;
  action: CanonicalActionInput;
  decision: CommitGateDecision;
  warrant?: Warrant;
  now?: string;
  signer?: AristotleSigner;
  actor?: GelActor;
  trace_context?: TraceContext;
}): GelRecord {
  const previous_hash = loadGelChain(input.ledgerPath).at(-1)?.record_hash ?? GENESIS_HASH;
  const record = buildGelRecord({ previous_hash, ...input });
  writeGelRecord(input.ledgerPath, record);
  return record;
}

/**
 * Pluggable persistence + index for the Governance Evidence Ledger. The hot-path
 * state (tip hash, count, admitted action hashes) is maintained incrementally so
 * append/replay checks are O(1). A durable backend (e.g. Postgres/SQLite) only has
 * to implement this contract; see FileLedgerBackend for the reference design.
 */
export interface LedgerBackend {
  tipHash: string;
  count: number;
  hasAdmitted(canonicalActionHash: string): boolean;
  verification(): { ok: boolean; count: number; failure?: string };
  persist(record: GelRecord): void;
  records(): GelRecord[];
  tail(limit: number): GelRecord[];
  /** Release any held resources (e.g. a database handle). Optional. */
  close?(): void;
}

/** Shared in-memory index used by every backend to keep the hot path O(1). */
class LedgerIndex {
  tip = GENESIS_HASH;
  count = 0;
  readonly admitted = new Set<string>();
  ok = true;
  failure?: string;

  seed(chain: GelRecord[]): void {
    const verification = verifyGelRecords(chain);
    this.ok = verification.ok;
    this.failure = verification.failure;
    this.count = chain.length;
    this.tip = chain.at(-1)?.record_hash ?? GENESIS_HASH;
    for (const record of chain) if (record.decision === "ALLOW") this.admitted.add(record.canonical_action_hash);
  }

  record(record: GelRecord): void {
    this.tip = record.record_hash;
    this.count += 1;
    if (record.decision === "ALLOW") this.admitted.add(record.canonical_action_hash);
  }

  verification(): { ok: boolean; count: number; failure?: string } {
    return this.ok ? { ok: true, count: this.count } : { ok: false, count: this.count, failure: this.failure };
  }
}

/** Default backend: append-only JSONL file, rebuilt into the index at startup. */
export class FileLedgerBackend implements LedgerBackend {
  private readonly index = new LedgerIndex();

  constructor(public readonly ledgerPath: string) {
    this.index.seed(loadGelChain(ledgerPath));
  }

  get tipHash(): string { return this.index.tip; }
  get count(): number { return this.index.count; }
  hasAdmitted(hash: string): boolean { return this.index.admitted.has(hash); }
  verification(): { ok: boolean; count: number; failure?: string } { return this.index.verification(); }
  records(): GelRecord[] { return loadGelChain(this.ledgerPath); }
  tail(limit: number): GelRecord[] { return this.records().slice(-limit); }

  persist(record: GelRecord): void {
    writeGelRecord(this.ledgerPath, record);
    this.index.record(record);
  }
}

/** Ephemeral backend: holds the chain in memory only (e.g. when shipping evidence elsewhere). */
export class InMemoryLedgerBackend implements LedgerBackend {
  private readonly index = new LedgerIndex();
  private readonly chain: GelRecord[];

  constructor(seed: GelRecord[] = []) {
    this.chain = [...seed];
    this.index.seed(this.chain);
  }

  get tipHash(): string { return this.index.tip; }
  get count(): number { return this.index.count; }
  hasAdmitted(hash: string): boolean { return this.index.admitted.has(hash); }
  verification(): { ok: boolean; count: number; failure?: string } { return this.index.verification(); }
  records(): GelRecord[] { return [...this.chain]; }
  tail(limit: number): GelRecord[] { return this.chain.slice(-limit); }

  persist(record: GelRecord): void {
    this.chain.push(record);
    this.index.record(record);
  }
}

/**
 * Stateful ledger facade over a pluggable backend. Builds the next (signed) record
 * linked to the backend's current tip and persists it. `new LedgerStore(path)`
 * keeps the JSONL-file behavior; pass a backend for other stores.
 */
export class LedgerStore {
  private readonly backend: LedgerBackend;

  constructor(source: string | LedgerBackend) {
    this.backend = typeof source === "string" ? new FileLedgerBackend(source) : source;
  }

  static file(ledgerPath: string): LedgerStore {
    return new LedgerStore(new FileLedgerBackend(ledgerPath));
  }

  static memory(seed: GelRecord[] = []): LedgerStore {
    return new LedgerStore(new InMemoryLedgerBackend(seed));
  }

  get count(): number { return this.backend.count; }
  get tipHash(): string { return this.backend.tipHash; }
  hasPriorAdmission(canonicalActionHash: string): boolean { return this.backend.hasAdmitted(canonicalActionHash); }
  verification(): { ok: boolean; count: number; failure?: string } { return this.backend.verification(); }
  records(): GelRecord[] { return this.backend.records(); }
  tail(limit: number): GelRecord[] { return this.backend.tail(limit); }

  append(input: Omit<BuildGelRecordInput, "previous_hash">): GelRecord {
    const record = buildGelRecord({ previous_hash: this.backend.tipHash, ...input });
    this.backend.persist(record);
    return record;
  }

  /** Release backend resources (e.g. a SQLite handle). Safe to call on any backend. */
  close(): void {
    this.backend.close?.();
  }
}

/**
 * Async ledger backend for durable, network-backed stores (e.g. Postgres). Reads
 * that gate decisions (tip, count, verification) are kept cheap, while replay
 * lookups and writes are async and hit the shared store — so replay state is
 * shared across boundary instances (the basis for horizontal availability).
 */
export interface AsyncLedgerBackend {
  tipHash: string;
  count: number;
  hasAdmitted(canonicalActionHash: string): Promise<boolean>;
  verification(): { ok: boolean; count: number; failure?: string };
  /**
   * Append the next record. The backend supplies the authoritative previous hash
   * to `build` (under a serializing lock for multi-writer backends), so the chain
   * stays correct even with concurrent appenders. Returns the persisted record.
   */
  appendChained(build: (previousHash: string) => GelRecord): Promise<GelRecord>;
  records(): Promise<GelRecord[]>;
  tail(limit: number): Promise<GelRecord[]>;
  close?(): Promise<void>;
}

/** Async facade over an AsyncLedgerBackend, mirroring LedgerStore for the async path. */
export class AsyncLedgerStore {
  constructor(private readonly backend: AsyncLedgerBackend) {}

  get count(): number { return this.backend.count; }
  get tipHash(): string { return this.backend.tipHash; }
  hasPriorAdmission(canonicalActionHash: string): Promise<boolean> { return this.backend.hasAdmitted(canonicalActionHash); }
  verification(): { ok: boolean; count: number; failure?: string } { return this.backend.verification(); }
  records(): Promise<GelRecord[]> { return this.backend.records(); }
  tail(limit: number): Promise<GelRecord[]> { return this.backend.tail(limit); }

  async append(input: Omit<BuildGelRecordInput, "previous_hash">): Promise<GelRecord> {
    return this.backend.appendChained((previousHash) => buildGelRecord({ previous_hash: previousHash, ...input }));
  }

  async close(): Promise<void> {
    await this.backend.close?.();
  }
}

/** Token-bucket rate limiter keyed by subject. capacity = burst, refillPerSec = sustained rate. */
export class SubjectRateLimiter {
  private readonly buckets = new Map<string, { tokens: number; updated: number }>();

  constructor(private readonly capacity: number, private readonly refillPerSec: number) {}

  static perMinute(perMinute: number, burst?: number): SubjectRateLimiter {
    return new SubjectRateLimiter(Math.max(1, burst ?? perMinute), perMinute / 60);
  }

  allow(subject: string, now = Date.now()): boolean {
    const bucket = this.buckets.get(subject) ?? { tokens: this.capacity, updated: now };
    const elapsedSec = Math.max(0, (now - bucket.updated) / 1000);
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsedSec * this.refillPerSec);
    bucket.updated = now;
    const ok = bucket.tokens >= 1;
    if (ok) bucket.tokens -= 1;
    this.buckets.set(subject, bucket);
    return ok;
  }
}

export function loadGelChain(ledgerPath: string): GelRecord[] {
  if (!existsSync(ledgerPath)) return [];
  const text = readFileSync(ledgerPath, "utf8").trim();
  if (!text) return [];
  return text.split(/\r?\n/).map((line) => JSON.parse(line) as GelRecord);
}

export function verifyGelChain(ledgerPath: string): { ok: boolean; count: number; failure?: string } {
  return verifyGelRecords(loadGelChain(ledgerPath));
}

export function verifyGelRecords(chain: GelRecord[]): { ok: boolean; count: number; failure?: string } {
  let previous = GENESIS_HASH;
  for (const [index, record] of chain.entries()) {
    if (record.previous_hash !== previous) return { ok: false, count: chain.length, failure: `record ${index} previous_hash mismatch` };
    const material = Object.fromEntries(
      Object.entries(record).filter(([key]) => !GEL_NON_MATERIAL_FIELDS.includes(key as (typeof GEL_NON_MATERIAL_FIELDS)[number]))
    );
    const expected = sha256(stableStringify(material));
    if (record.record_hash !== expected) return { ok: false, count: chain.length, failure: `record ${index} hash mismatch` };
    if (record.signature) {
      if (record.signature_algorithm !== "ed25519" || !record.signing_public_key || !verifyEd25519(record.signing_public_key, record.record_hash, record.signature)) {
        return { ok: false, count: chain.length, failure: `record ${index} signature invalid` };
      }
    }
    previous = record.record_hash;
  }
  return { ok: true, count: chain.length };
}

export function exportEvidenceBundle(input: ExportEvidenceBundleInput): EvidenceBundle {
  const ledger_chain = loadGelChain(input.ledgerPath);
  const selected_record = input.recordId
    ? ledger_chain.find((record) => record.record_id === input.recordId)
    : ledger_chain.at(-1);
  if (!selected_record) throw new Error(input.recordId ? `GEL record not found: ${input.recordId}` : "GEL ledger has no records to export");

  const partial = {
    bundle_version: "aristotle.execution-evidence.v1" as const,
    exported_at: input.exportedAt ?? new Date().toISOString(),
    ward: stableNormalize(input.ward) as WardManifest,
    authority_envelope: input.authorityEnvelope ? stableNormalize(input.authorityEnvelope) as AuthorityEnvelope : undefined,
    selected_record,
    ledger_chain,
    warrant: input.warrant
  };
  const hashes = {
    ward_manifest_hash: sha256(stableStringify(partial.ward)),
    authority_envelope_hash: partial.authority_envelope ? sha256(stableStringify(partial.authority_envelope)) : undefined,
    selected_record_hash: selected_record.record_hash,
    ledger_tip_hash: ledger_chain.at(-1)?.record_hash ?? GENESIS_HASH,
    bundle_hash: ""
  };
  hashes.bundle_hash = evidenceBundleHash({ ...partial, hashes } as EvidenceBundle);
  const bundle_signature: EvidenceBundleSignature | undefined = input.signer
    ? {
        algorithm: input.signer.algorithm,
        key_id: input.signer.key_id,
        public_key: input.signer.public_key_pem,
        value: input.signer.sign(hashes.bundle_hash)
      }
    : undefined;
  const draft: EvidenceBundle = { ...partial, hashes, bundle_signature, verification: emptyEvidenceVerification() };
  return { ...draft, verification: verifyEvidenceBundle(draft) };
}

export function loadEvidenceBundle(file: string): EvidenceBundle {
  return JSON.parse(readFileSync(file, "utf8")) as EvidenceBundle;
}

export function verifyEvidenceBundle(bundle: EvidenceBundle, options: VerifyEvidenceBundleOptions = {}): EvidenceBundleVerification {
  const failures: string[] = [];
  if (bundle.bundle_version !== "aristotle.execution-evidence.v1") failures.push("unsupported evidence bundle version");

  const ledger = verifyGelRecords(bundle.ledger_chain);
  if (!ledger.ok) failures.push(`ledger verification failed: ${ledger.failure}`);

  const selected = bundle.ledger_chain.find((record) => record.record_id === bundle.selected_record.record_id);
  if (!selected) failures.push("selected GEL record is not present in ledger chain");
  if (selected && stableStringify(selected) !== stableStringify(bundle.selected_record)) failures.push("selected GEL record does not match ledger chain material");
  if (bundle.selected_record.record_hash !== bundle.hashes.selected_record_hash) failures.push("selected record hash does not match bundle hash declaration");

  const expectedWardHash = sha256(stableStringify(bundle.ward));
  if (bundle.hashes.ward_manifest_hash !== expectedWardHash) failures.push("Ward Manifest hash mismatch");
  if (bundle.selected_record.ward_id !== bundle.ward.ward_id) failures.push("selected record Ward does not match bundled Ward Manifest");

  if (bundle.authority_envelope) {
    const expectedEnvelopeHash = sha256(stableStringify(bundle.authority_envelope));
    if (bundle.hashes.authority_envelope_hash !== expectedEnvelopeHash) failures.push("Authority Envelope hash mismatch");
    if (bundle.selected_record.authority_envelope_id && bundle.selected_record.authority_envelope_id !== bundle.authority_envelope.envelope_id) {
      failures.push("selected record Authority Envelope does not match bundled Authority Envelope");
    }
  }

  const ledgerTip = bundle.ledger_chain.at(-1)?.record_hash ?? GENESIS_HASH;
  if (bundle.hashes.ledger_tip_hash !== ledgerTip) failures.push("ledger tip hash mismatch");

  let warrant: WarrantVerification | undefined;
  if (bundle.warrant) {
    warrant = verifyWarrant(bundle.warrant, bundle.selected_record.canonical_action_hash, bundle.warrant.issued_at, { trustedKeyIds: options.trustedKeyIds, revocations: options.revocations });
    if (!warrant.ok) failures.push(`warrant verification failed: ${warrant.reason}`);
    if (bundle.selected_record.warrant_id && bundle.selected_record.warrant_id !== bundle.warrant.warrant_id) failures.push("selected record Warrant id does not match bundled Warrant");
  } else if (bundle.selected_record.warrant_id) {
    failures.push("selected record references a Warrant but no Warrant material is bundled");
  }

  const expectedBundleHash = evidenceBundleHash(bundle);
  if (bundle.hashes.bundle_hash && bundle.hashes.bundle_hash !== expectedBundleHash) failures.push("evidence bundle hash mismatch");

  let bundle_signature_ok: boolean | undefined;
  if (bundle.bundle_signature) {
    const sig = bundle.bundle_signature;
    if (options.trustedKeyIds && !options.trustedKeyIds.includes(sig.key_id)) {
      bundle_signature_ok = false;
      failures.push("bundle signature uses an untrusted signing key");
    } else if (sig.algorithm !== "ed25519" || !verifyEd25519(sig.public_key, bundle.hashes.bundle_hash, sig.value)) {
      bundle_signature_ok = false;
      failures.push("bundle signature verification failed");
    } else {
      bundle_signature_ok = true;
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    ledger,
    warrant,
    bundle_hash: expectedBundleHash,
    bundle_signature_ok
  };
}

function evidenceBundleHash(bundle: EvidenceBundle): string {
  return sha256(stableStringify({
    bundle_version: bundle.bundle_version,
    exported_at: bundle.exported_at,
    ward: bundle.ward,
    authority_envelope: bundle.authority_envelope,
    selected_record: bundle.selected_record,
    ledger_chain: bundle.ledger_chain,
    warrant: bundle.warrant,
    hashes: {
      ward_manifest_hash: bundle.hashes.ward_manifest_hash,
      authority_envelope_hash: bundle.hashes.authority_envelope_hash,
      selected_record_hash: bundle.hashes.selected_record_hash,
      ledger_tip_hash: bundle.hashes.ledger_tip_hash
    }
  }));
}

function emptyEvidenceVerification(): EvidenceBundleVerification {
  return { ok: false, failures: [], ledger: { ok: false, count: 0 } };
}

/** True when the same canonical action was already admitted (ALLOW) in this ledger. */
export function hasPriorAdmission(ledgerPath: string, canonicalActionHash: string): boolean {
  return loadGelChain(ledgerPath).some(
    (record) => record.canonical_action_hash === canonicalActionHash && record.decision === "ALLOW"
  );
}

/**
 * Shared, pure decision core for both the sync and async evaluate paths. Applies
 * sovereign halt, revocation, replay, and the Commit Gate, then issues a Warrant
 * on ALLOW. I/O (replay lookup, ledger append) is performed by the caller.
 */
function decideAndWarrant(
  input: Omit<EvaluateExecutionControlInput, "ledger">,
  signer: AristotleSigner,
  canonical: CanonicalAction,
  runtimeSnapshot: RuntimeRegister,
  replaySeen: boolean
): { decision: CommitGateDecision; warrant?: Warrant } {
  const ward = input.ward ?? undefined;
  const revocations = input.revocationListPath ? loadRevocationList(input.revocationListPath) : undefined;
  const revoked = revocations && revocationReason(revocations, {
    signing_key_id: signer.key_id,
    authority_envelope_id: input.authorityEnvelope?.envelope_id
  });
  let decision: CommitGateDecision;
  if (input.killSwitchPath && existsSync(input.killSwitchPath)) {
    decision = refuse("REFUSE", ["KILL_SWITCH_ENGAGED"], canonical, runtimeSnapshot, ward, input.authorityEnvelope ?? undefined);
  } else if (revoked) {
    decision = refuse("REFUSE", ["AUTHORITY_REVOKED"], canonical, runtimeSnapshot, ward, input.authorityEnvelope ?? undefined);
  } else if (replaySeen) {
    decision = refuse("REFUSE", ["REPLAY_DETECTED"], canonical, runtimeSnapshot, ward, input.authorityEnvelope ?? undefined);
  } else {
    decision = evaluateCommitGate(input);
  }
  const warrant = decision.decision === "ALLOW" && input.authorityEnvelope
    ? issueWarrant(decision, input.action, input.authorityEnvelope, input.now, signer, input.warrantTtlSeconds)
    : undefined;
  return { decision, warrant };
}

export function evaluateExecutionControl(input: EvaluateExecutionControlInput): EvaluateExecutionControlResult {
  if (!input.ward) throw new Error("ward manifest is required for GEL recording");
  const tracer = input.tracer;
  const traceAttrs = input.trace_context ? { "aristotle.trace_id": input.trace_context.trace_id } : undefined;
  return traceSpan(tracer, "aristotle.execution_control.evaluate", { ...traceAttrs, "aristotle.ward_id": input.ward.ward_id, "aristotle.action_type": input.action.action_type }, (span) => {
    const signer = input.signer ?? getDefaultDevSigner();
    const canonical = traceSpan(tracer, "aristotle.canonicalize", undefined, () => canonicalizeAction(input.action));
    const runtimeSnapshot = stableNormalize(input.runtimeRegister ?? {}) as RuntimeRegister;
    const replaySeen = input.replayProtection
      ? (input.ledger ? input.ledger.hasPriorAdmission(canonical.canonical_action_hash) : hasPriorAdmission(input.ledgerPath, canonical.canonical_action_hash))
      : false;
    const { decision, warrant } = traceSpan(tracer, "aristotle.commit_gate.decide", undefined, () => decideAndWarrant(input, signer, canonical, runtimeSnapshot, replaySeen));
    const gel_record = traceSpan(tracer, "aristotle.gel.append", undefined, () => (input.ledger
      ? input.ledger.append({ ward: input.ward!, action: input.action, decision, warrant, now: input.now, signer, actor: input.actor, trace_context: input.trace_context })
      : appendGelRecord({ ledgerPath: input.ledgerPath, ward: input.ward!, action: input.action, decision, warrant, now: input.now, signer, actor: input.actor, trace_context: input.trace_context })));
    span.setAttribute("aristotle.decision", decision.decision);
    return {
      decision: decision.decision,
      reason_codes: decision.reason_codes,
      canonical_action_hash: decision.canonical_action_hash,
      warrant,
      gel_record,
      ledger_verification: input.ledger ? input.ledger.verification() : verifyGelChain(input.ledgerPath)
    };
  });
}

/**
 * Async evaluate path for durable, network-backed ledgers (e.g. Postgres). Shares
 * the exact decision logic with the sync path; only the replay lookup and the
 * ledger append are awaited. Replay state lives in the backing store, so it is
 * shared across boundary instances.
 */
export interface EvaluateExecutionControlAsyncInput extends Omit<EvaluateExecutionControlInput, "ledger"> {
  ledger: AsyncLedgerStore;
}

export async function evaluateExecutionControlAsync(input: EvaluateExecutionControlAsyncInput): Promise<EvaluateExecutionControlResult> {
  if (!input.ward) throw new Error("ward manifest is required for GEL recording");
  const signer = input.signer ?? getDefaultDevSigner();
  const canonical = canonicalizeAction(input.action);
  const runtimeSnapshot = stableNormalize(input.runtimeRegister ?? {}) as RuntimeRegister;
  const replaySeen = input.replayProtection ? await input.ledger.hasPriorAdmission(canonical.canonical_action_hash) : false;
  const { decision, warrant } = decideAndWarrant(input, signer, canonical, runtimeSnapshot, replaySeen);
  const gel_record = await input.ledger.append({ ward: input.ward, action: input.action, decision, warrant, now: input.now, signer, actor: input.actor, trace_context: input.trace_context });
  return {
    decision: decision.decision,
    reason_codes: decision.reason_codes,
    canonical_action_hash: decision.canonical_action_hash,
    warrant,
    gel_record,
    ledger_verification: input.ledger.verification()
  };
}

export function loadWardManifest(file: string): WardManifest {
  const parsed = loadStructuredFile(file);
  assertValidWardManifest(parsed);
  return parsed as unknown as WardManifest;
}

export function loadAuthorityEnvelope(file: string): AuthorityEnvelope {
  const parsed = loadStructuredFile(file);
  assertValidAuthorityEnvelope(parsed);
  return parsed as unknown as AuthorityEnvelope;
}

export function loadCanonicalAction(file: string): CanonicalActionInput {
  return loadStructuredFile(file) as unknown as CanonicalActionInput;
}

export function loadStructuredFile(file: string): Record<string, JsonValue> {
  const text = readFileSync(file, "utf8");
  if (file.endsWith(".json")) return JSON.parse(text) as Record<string, JsonValue>;
  if (file.endsWith(".yaml") || file.endsWith(".yml")) return parseSimpleYaml(text);
  throw new Error(`unsupported structured file extension: ${file}`);
}

function parseSimpleYaml(text: string): Record<string, JsonValue> {
  const lines = text
    .split(/\r?\n/)
    .map((raw) => raw.replace(/\s+#.*$/, ""))
    .filter((raw) => raw.trim())
    .map((raw) => ({ indent: raw.match(/^ */)?.[0].length ?? 0, content: raw.trim() }));

  const parseBlock = (index: number, indent: number): [JsonValue, number] => {
    if (index >= lines.length) return [{}, index];
    if (lines[index].content.startsWith("- ")) {
      const items: JsonValue[] = [];
      while (index < lines.length && lines[index].indent === indent && lines[index].content.startsWith("- ")) {
        items.push(parseScalar(lines[index].content.slice(2).trim()));
        index++;
      }
      return [items, index];
    }

    const object: Record<string, JsonValue> = {};
    while (index < lines.length && lines[index].indent === indent && !lines[index].content.startsWith("- ")) {
      const line = lines[index].content;
      const separator = line.indexOf(":");
      if (separator < 0) throw new Error(`unsupported YAML line: ${line}`);
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      index++;
      if (value) {
        object[key] = parseScalar(value);
      } else if (index < lines.length && lines[index].indent > indent) {
        [object[key], index] = parseBlock(index, lines[index].indent);
      } else {
        object[key] = {};
      }
    }
    return [object, index];
  };

  const [result] = parseBlock(0, lines[0]?.indent ?? 0);
  if (!result || Array.isArray(result) || typeof result !== "object") throw new Error("YAML root must be an object");
  return result as Record<string, JsonValue>;
}

function parseScalar(value: string): JsonValue {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => parseScalar(item));
  }
  return value.replace(/^["']|["']$/g, "");
}

export function missingRuntimeRegisters(envelope: AuthorityEnvelope, action: CanonicalActionInput, runtimeRegister: RuntimeRegister): string[] {
  const required = envelope.constraints.required_runtime_registers;
  if (!Array.isArray(required)) return [];
  const combined = { ...runtimeRegister, telemetry: action.telemetry ?? {}, registers: runtimeRegister.registers ?? {} };
  return required.filter((item) => typeof item === "string" && getPath(combined, item) === undefined) as string[];
}

function getPath(source: unknown, dottedPath: string): unknown {
  return dottedPath.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[part];
  }, source);
}

function constraintsPass(envelope: AuthorityEnvelope, action: CanonicalActionInput): boolean {
  const maxAmount = numericConstraint(envelope, "max_amount");
  const amount = numericParam(action, "amount");
  if (maxAmount !== undefined && amount !== undefined && amount > maxAmount) return false;

  const allowedTargets = envelope.constraints.allowed_targets;
  if (Array.isArray(allowedTargets) && !allowedTargets.includes(action.target)) return false;
  return true;
}

function numericConstraint(envelope: AuthorityEnvelope, key: string): number | undefined {
  const value = envelope.constraints[key];
  return typeof value === "number" ? value : undefined;
}

function numericParam(action: CanonicalActionInput, key: string): number | undefined {
  const value = action.params[key];
  return typeof value === "number" ? value : undefined;
}

function stringParam(action: CanonicalActionInput, key: string): string | undefined {
  const value = action.params[key];
  return typeof value === "string" ? value : undefined;
}

export function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function submitGovernedAction(options: ExecutionControlClientOptions): Promise<EvaluateExecutionControlResult> {
  const endpoint = options.endpoint ?? "http://127.0.0.1:8181/v1/execution-control/evaluate";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: options.action,
      runtime_register: options.runtimeRegister,
      now: options.now
    })
  });
  const result = await response.json() as EvaluateExecutionControlResult | { error: string; message?: string };
  if (!response.ok && response.status !== 202 && response.status !== 409) {
    throw new Error("message" in result ? result.message : "execution-control runtime request failed");
  }
  return result as EvaluateExecutionControlResult;
}

export function requireAllowedWarrant(result: EvaluateExecutionControlResult): Warrant {
  if (result.decision !== "ALLOW" || !result.warrant) {
    throw new Error(`execution refused by AristotleOS: ${result.decision} ${result.reason_codes.join(",")}`);
  }
  const verification = verifyWarrant(result.warrant, result.canonical_action_hash, result.warrant.issued_at);
  if (!verification.ok) throw new Error(`warrant verification failed: ${verification.reason}`);
  return result.warrant;
}

export function executionControlOpenApiSpec() {
  return {
    openapi: "3.0.3",
    info: {
      title: "AristotleOS Ward/Warrant Execution-Control Path",
      version: "0.1.1",
      description: "AristotleOS-native execution-control boundary: Canonical Governed Action -> Commit Gate -> Warrant -> GEL."
    },
    // When any operator auth method is configured, /v1 routes require a credential
    // (viewer < operator < admin). Open routes override this with `security: []`.
    security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
    paths: {
      "/health": {
        get: {
          summary: "Runtime health and active governance context",
          security: [],
          responses: { "200": { description: "Runtime is healthy" } }
        }
      },
      "/v1/execution-control/evaluate": {
        post: {
          summary: "Evaluate a proposed governed action before execution",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    { $ref: "#/components/schemas/CanonicalGovernedAction" },
                    { $ref: "#/components/schemas/EvaluateRequest" }
                  ]
                }
              }
            }
          },
          responses: {
            "200": { description: "ALLOW with Warrant" },
            "202": { description: "ESCALATE for missing state or policy ambiguity" },
            "409": { description: "REFUSE before execution" }
          }
        }
      },
      "/v1/execution-control/proxy": {
        post: {
          summary: "Evaluate a governed action and forward it downstream only on ALLOW (credentials brokered server-side)",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/EvaluateRequest" } } }
          },
          responses: {
            "200": { description: "ALLOW and forwarded; downstream response included" },
            "202": { description: "ESCALATE; not forwarded" },
            "409": { description: "REFUSE; not forwarded" },
            "502": { description: "ALLOW but downstream forwarding failed" }
          }
        }
      },
      "/v1/execution-control/audit/tail": {
        get: {
          summary: "Return recent Governance Evidence Ledger records",
          responses: { "200": { description: "Recent GEL records" } }
        }
      },
      "/v1/execution-control/metrics": {
        get: {
          summary: "Decision counts, reason-code histogram, ledger size and integrity",
          responses: { "200": { description: "Runtime metrics" } }
        }
      },
      "/v1/execution-control/audit/verify": {
        get: {
          summary: "Verify GEL hash-chain integrity",
          responses: { "200": { description: "Ledger verification result" } }
        }
      },
      "/v1/execution-control/admin/kill": {
        post: {
          summary: "Engage/disengage the sovereign-halt kill switch (admin role; requires auth configured)",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { engaged: { type: "boolean" }, reason: { type: "string" } }, required: ["engaged"] } } } },
          responses: { "200": { description: "Kill-switch state updated" }, "401": { description: "Unauthenticated" }, "403": { description: "Requires admin role / auth not configured" }, "409": { description: "Kill switch path not configured" } }
        }
      },
      "/v1/execution-control/admin/revoke": {
        post: {
          summary: "Add a revocation (key/envelope/warrant) to the revocation list (admin role; requires auth configured)",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { kind: { type: "string", enum: ["key", "envelope", "warrant"] }, id: { type: "string" }, reason: { type: "string" } }, required: ["kind", "id"] } } } },
          responses: { "200": { description: "Revocation recorded" }, "400": { description: "Invalid revocation" }, "401": { description: "Unauthenticated" }, "403": { description: "Requires admin role / auth not configured" }, "409": { description: "Revocation list not configured" } }
        }
      },
      "/openapi.json": {
        get: {
          summary: "OpenAPI contract for the Ward/Warrant execution-control runtime",
          security: [],
          responses: { "200": { description: "OpenAPI 3 specification" } }
        }
      }
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", description: "Operator credential: a role-scoped static token, the admin API key, or an OIDC JWT. When any auth method is configured, /v1 routes require it (viewer < operator < admin)." },
        apiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key", description: "Alternative header for the same operator credential." }
      },
      schemas: {
        EvaluateRequest: {
          type: "object",
          required: ["action"],
          properties: {
            action: { $ref: "#/components/schemas/CanonicalGovernedAction" },
            runtime_register: { type: "object", additionalProperties: true },
            now: { type: "string", format: "date-time" }
          }
        },
        CanonicalGovernedAction: {
          type: "object",
          required: ["action_id", "ward_id", "subject", "action_type", "target", "params", "requested_at"],
          properties: {
            action_id: { type: "string" },
            ward_id: { type: "string" },
            subject: { type: "string" },
            action_type: { type: "string" },
            target: { type: "string" },
            params: { type: "object", additionalProperties: true },
            requested_at: { type: "string", format: "date-time" },
            nonce: { type: "string" },
            request_id: { type: "string" },
            telemetry: { type: "object", additionalProperties: true }
          }
        }
      }
    }
  };
}

export function createExecutionControlRuntimeServer(options: ExecutionControlRuntimeServerOptions): ExecutionControlRuntimeServer {
  const replayProtection = options.replayProtection !== false;
  // One ledger store for the whole server lifetime keeps append and replay checks
  // off the per-request full-scan path. A durable store (SQLite via options.ledger,
  // or Postgres via options.asyncLedger) can be supplied; otherwise a file store
  // is created from ledgerPath.
  const asyncLedger = options.asyncLedger;
  const ledger = asyncLedger ? undefined : (options.ledger ?? new LedgerStore(options.ledgerPath));
  const readRecords = (): Promise<GelRecord[]> => asyncLedger ? asyncLedger.records() : Promise.resolve(ledger!.records());
  const readTail = (limit: number): Promise<GelRecord[]> => asyncLedger ? asyncLedger.tail(limit) : Promise.resolve(ledger!.tail(limit));
  const readVerification = (): { ok: boolean; count: number; failure?: string } => asyncLedger ? asyncLedger.verification() : ledger!.verification();
  const rateLimiter = options.rateLimitPerMinute && options.rateLimitPerMinute > 0
    ? SubjectRateLimiter.perMinute(options.rateLimitPerMinute)
    : undefined;
  const logDecision = (entry: Record<string, unknown>): void => {
    if (options.logFormat === "json") process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`);
  };
  const requestId = (req: IncomingMessage): string => (typeof req.headers["x-request-id"] === "string" ? req.headers["x-request-id"] : randomUUID());
  const metrics = new RuntimeMetrics();
  // Resolve W3C trace context from (in priority) the request body, the traceparent
  // header, or explicit trace_id; stamped into the GEL record for correlation.
  const traceContextFor = (req: IncomingMessage, body: Record<string, unknown>): TraceContext | undefined => {
    if (body.trace_context && typeof body.trace_context === "object") {
      const normalized = normalizeTraceContext(body.trace_context as TraceContext);
      if (normalized) return normalized;
    }
    const traceparentHeader = typeof req.headers["traceparent"] === "string" ? req.headers["traceparent"] : undefined;
    return parseTraceparent(typeof body.traceparent === "string" ? body.traceparent : traceparentHeader);
  };
  const forwardAudit = (
    event: "evaluate" | "proxy",
    action: CanonicalActionInput,
    result: { decision: ExecutionControlDecision; reason_codes: ExecutionControlReasonCode[]; warrant?: Warrant; gel_record: GelRecord },
    principal?: Principal
  ): void => {
    if (!options.auditSink) return;
    const payload: AuditEvent = {
      event,
      ts: new Date().toISOString(),
      ward_id: options.ward.ward_id,
      subject: action.subject,
      action_type: action.action_type,
      decision: result.decision,
      reason_codes: result.reason_codes,
      warrant_id: result.warrant?.warrant_id,
      signing_key_id: result.warrant?.signing_key_id,
      actor: principal,
      record: result.gel_record
    };
    void deliverAuditEvent(options.auditSink, payload).then((delivery) => {
      if (!delivery.ok) logDecision({ event: "audit_sink_error", sink: options.auditSink, status: delivery.status, error: delivery.error });
    });
  };
  const authConfig: AuthConfig = { apiKey: options.apiKey, operators: options.operators, oidc: options.oidc };
  const requireAuth = authEnabled(authConfig) && !options.servePlayground;

  // Minimum role per route: read paths need viewer, decisions need operator,
  // operator actions (kill switch, revocation) need admin. Unknown /v1 paths
  // default to admin (fail-closed).
  const requiredRoleFor = (method: string, pathname: string): OperatorRole => {
    if (method === "GET" && (
      pathname === "/v1/execution-control/context" ||
      pathname === "/v1/execution-control/audit/tail" ||
      pathname === "/v1/execution-control/audit/verify" ||
      pathname === "/v1/execution-control/metrics"
    )) return "viewer";
    if (method === "POST" && (
      pathname === "/v1/execution-control/evaluate" ||
      pathname === "/v1/execution-control/proxy" ||
      pathname === "/v1/execution-control/governance/compile" ||
      pathname === "/v1/execution-control/governance/diff" ||
      pathname === "/v1/execution-control/governance/explain"
    )) return "operator";
    return "admin";
  };

  const forwardOperatorAudit = (action_type: string, principal: Principal | undefined, detail: Record<string, unknown>): void => {
    logDecision({ event: "operator_action", action_type, actor: principal ?? null, ...detail });
    if (!options.auditSink) return;
    const payload: AuditEvent = {
      event: "operator_action",
      ts: new Date().toISOString(),
      ward_id: options.ward.ward_id,
      subject: principal?.subject ?? "anonymous",
      action_type,
      decision: "ALLOW",
      reason_codes: [],
      actor: principal
    };
    void deliverAuditEvent(options.auditSink, payload).then((delivery) => {
      if (!delivery.ok) logDecision({ event: "audit_sink_error", sink: options.auditSink, status: delivery.status, error: delivery.error });
    });
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      // Health, OpenAPI, and Prometheus /metrics stay open for liveness/discovery.
      // /v1 routes are role-gated when any credential method is configured (and the
      // demo playground is not being served).
      let principal: Principal | undefined;
      if (requireAuth && url.pathname.startsWith("/v1/execution-control/")) {
        const outcome = resolvePrincipal(presentedCredential(req.headers), authConfig);
        if (outcome.status === "anonymous") { sendJson(res, 401, { error: "unauthorized" }); return; }
        if (outcome.status === "rejected") { sendJson(res, 401, { error: "unauthorized", detail: outcome.reason }); return; }
        if (outcome.status === "forbidden") {
          logDecision({ event: "rbac_denied", reason: outcome.reason, subject: outcome.subject, path: url.pathname });
          sendJson(res, 403, { error: "forbidden", detail: outcome.reason });
          return;
        }
        principal = outcome.principal;
        const needed = requiredRoleFor(req.method ?? "GET", url.pathname);
        if (!roleSatisfies(principal.role, needed)) {
          logDecision({ event: "rbac_denied", subject: principal.subject, role: principal.role, required: needed, path: url.pathname });
          sendJson(res, 403, { error: "forbidden", detail: `requires role ${needed}`, role: principal.role, required: needed });
          return;
        }
      }

      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, {
          ok: true,
          runtime: "aristotle-ward-warrant-execution-control",
          doctrine: "Governance must bind at the execution boundary before irreversible state mutation or external action occurs.",
          ward_id: options.ward.ward_id,
          authority_envelope_id: options.authorityEnvelope.envelope_id,
          kill_switch_engaged: !!(options.killSwitchPath && existsSync(options.killSwitchPath)),
          replay_protection: replayProtection,
          auth_required: requireAuth,
          auth_methods: {
            api_key: !!options.apiKey,
            operator_tokens: (options.operators?.length ?? 0) > 0,
            oidc: !!options.oidc
          }
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/openapi.json") {
        sendJson(res, 200, executionControlOpenApiSpec());
        return;
      }

      if (req.method === "GET" && url.pathname === "/metrics") {
        const chain = await readRecords();
        // Live in-process counters/histogram (decisions, reason codes, latency,
        // warrant/append failures, replay refusals) plus cumulative ledger gauges.
        const lines = [
          ...metrics.prometheus(),
          "# HELP aristotle_ledger_records Total Governance Evidence Ledger records",
          "# TYPE aristotle_ledger_records gauge",
          `aristotle_ledger_records ${chain.length}`,
          "# HELP aristotle_ledger_ok GEL chain integrity (1 ok, 0 broken)",
          "# TYPE aristotle_ledger_ok gauge",
          `aristotle_ledger_ok ${readVerification().ok ? 1 : 0}`
        ];
        res.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8" });
        res.end(`${lines.join("\n")}\n`);
        return;
      }

      if (req.method === "GET" && url.pathname === "/v1/execution-control/context") {
        sendJson(res, 200, {
          ward_id: options.ward.ward_id,
          subject: options.authorityEnvelope.subject,
          allowed_actions: options.authorityEnvelope.allowed_actions,
          denied_actions: options.authorityEnvelope.denied_actions,
          boundary_id: options.ward.physical_bounds?.permitted_boundary_id ?? "",
          signing_key_id: options.signer?.key_id ?? "ephemeral-dev"
        });
        return;
      }

      if (options.servePlayground && req.method === "GET" && (url.pathname === "/" || url.pathname === "/playground")) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(PLAYGROUND_HTML);
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/execution-control/evaluate") {
        const startedAt = Date.now();
        const body = await readJsonBody(req);
        const action = (body.action ?? body) as CanonicalActionInput;
        if (rateLimiter && !rateLimiter.allow(action.subject ?? "")) {
          sendJson(res, 429, { error: "rate_limited", subject: action.subject });
          return;
        }
        const evaluateParams = {
          ward: options.ward,
          authorityEnvelope: options.authorityEnvelope,
          action,
          runtimeRegister: body.runtime_register as RuntimeRegister | undefined,
          ledgerPath: options.ledgerPath,
          now: typeof body.now === "string" ? body.now : options.now,
          signer: options.signer,
          killSwitchPath: options.killSwitchPath,
          replayProtection,
          revocationListPath: options.revocationListPath,
          warrantTtlSeconds: options.warrantTtlSeconds,
          actor: principal,
          trace_context: traceContextFor(req, body),
          tracer: options.tracer
        };
        let result: EvaluateExecutionControlResult;
        try {
          result = asyncLedger
            ? await evaluateExecutionControlAsync({ ...evaluateParams, ledger: asyncLedger })
            : evaluateExecutionControl({ ...evaluateParams, ledger });
        } catch (error) {
          metrics.recordLedgerAppendFailure();
          throw error;
        }
        const latencyMs = Date.now() - startedAt;
        metrics.recordDecision(result.decision, result.reason_codes, latencyMs, !!result.warrant);
        logDecision({
          event: "evaluate",
          request_id: requestId(req),
          trace_id: result.gel_record.trace_context?.trace_id ?? null,
          subject: action.subject,
          action_type: action.action_type,
          decision: result.decision,
          reason_codes: result.reason_codes,
          warrant_id: result.warrant?.warrant_id ?? null,
          signing_key_id: result.warrant?.signing_key_id ?? null,
          actor: principal ?? null,
          latency_ms: latencyMs
        });
        forwardAudit("evaluate", action, result, principal);
        sendJson(res, result.decision === "ALLOW" ? 200 : result.decision === "ESCALATE" ? 202 : 409, result);
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/execution-control/proxy") {
        const startedAt = Date.now();
        const body = await readJsonBody(req);
        const action = (body.action ?? body) as CanonicalActionInput;
        if (rateLimiter && !rateLimiter.allow(action.subject ?? "")) {
          sendJson(res, 429, { error: "rate_limited", subject: action.subject });
          return;
        }
        const result = await proxyGovernedAction({
          ward: options.ward,
          authorityEnvelope: options.authorityEnvelope,
          action,
          ledgerPath: options.ledgerPath,
          signer: options.signer,
          broker: options.broker,
          now: typeof body.now === "string" ? body.now : options.now,
          killSwitchPath: options.killSwitchPath,
          replayProtection,
          revocationListPath: options.revocationListPath,
          warrantTtlSeconds: options.warrantTtlSeconds,
          ledger,
          asyncLedger,
          actor: principal,
          trace_context: traceContextFor(req, body),
          tracer: options.tracer
        });
        const status = result.decision === "ALLOW" ? (result.forwarded ? 200 : 502) : result.decision === "ESCALATE" ? 202 : 409;
        const latencyMs = Date.now() - startedAt;
        metrics.recordDecision(result.decision, result.reason_codes, latencyMs, !!result.warrant);
        if (result.decision === "ALLOW" && !result.forwarded && /warrant verification failed/.test(result.error ?? "")) metrics.recordWarrantFailure();
        logDecision({
          event: "proxy",
          request_id: requestId(req),
          trace_id: result.gel_record.trace_context?.trace_id ?? null,
          subject: action.subject,
          action_type: action.action_type,
          decision: result.decision,
          reason_codes: result.reason_codes,
          forwarded: result.forwarded,
          warrant_id: result.warrant?.warrant_id ?? null,
          actor: principal ?? null,
          status,
          latency_ms: latencyMs
        });
        forwardAudit("proxy", action, result, principal);
        sendJson(res, status, result);
        return;
      }

      if (req.method === "GET" && url.pathname === "/v1/execution-control/audit/tail") {
        const limit = Number(url.searchParams.get("limit") ?? "20");
        sendJson(res, 200, { items: await readTail(limit) });
        return;
      }

      if (req.method === "GET" && url.pathname === "/v1/execution-control/audit/verify") {
        sendJson(res, 200, verifyGelRecords(await readRecords()));
        return;
      }

      if (req.method === "GET" && url.pathname === "/v1/execution-control/metrics") {
        const chain = await readRecords();
        const decisions: Record<string, number> = { ALLOW: 0, REFUSE: 0, ESCALATE: 0 };
        const reasonCodes: Record<string, number> = {};
        for (const record of chain) {
          decisions[record.decision] = (decisions[record.decision] ?? 0) + 1;
          for (const code of record.reason_codes) reasonCodes[code] = (reasonCodes[code] ?? 0) + 1;
        }
        sendJson(res, 200, {
          total_records: chain.length,
          decisions,
          reason_codes: reasonCodes,
          ledger_ok: readVerification().ok,
          signing_key_id: options.signer?.key_id ?? "ephemeral-dev",
          kill_switch_engaged: !!(options.killSwitchPath && existsSync(options.killSwitchPath)),
          replay_protection: replayProtection,
          // Live in-process counters since this process started (latency histogram,
          // warrant/append failures, replay refusals) — complements the cumulative
          // ledger-derived totals above.
          runtime: metrics.snapshot()
        });
        return;
      }

      // Visual Governance Builder backend — pure analysis over provided artifacts
      // (no ledger mutation): compile/hash a draft, diff two drafts (flagging
      // authority-weakening changes), and explain what a draft permits/refuses by
      // running sample actions through the real Commit Gate.
      if (req.method === "POST" && url.pathname === "/v1/execution-control/governance/compile") {
        const body = await readJsonBody(req);
        const ward = (body.ward ?? options.ward) as WardManifest;
        const authorityEnvelope = (body.authority_envelope ?? body.authorityEnvelope ?? options.authorityEnvelope) as AuthorityEnvelope;
        const manifest = compileGovernanceManifest({ ward, authorityEnvelope, now: typeof body.now === "string" ? body.now : options.now });
        logDecision({ event: "governance_compile", request_id: requestId(req), actor: principal ?? null, manifest_hash: manifest.hashes.manifest_hash, validation_ok: manifest.validation.ok });
        sendJson(res, manifest.validation.ok ? 200 : 422, manifest);
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/execution-control/governance/diff") {
        const body = await readJsonBody(req);
        const toDraft = (raw: unknown): GovernanceDraft => {
          const d = (raw ?? {}) as Record<string, unknown>;
          return { ward: (d.ward ?? options.ward) as WardManifest, authorityEnvelope: (d.authority_envelope ?? d.authorityEnvelope ?? options.authorityEnvelope) as AuthorityEnvelope };
        };
        const before = toDraft(body.before);
        const after = toDraft(body.after);
        const entries = diffGovernanceManifests(before, after);
        const weakening = entries.filter((e) => e.weakening);
        logDecision({ event: "governance_diff", request_id: requestId(req), actor: principal ?? null, changes: entries.length, weakening: weakening.length });
        sendJson(res, 200, { entries, summary: { total: entries.length, weakening: weakening.length, requires_review: weakening.length > 0 } });
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/execution-control/governance/explain") {
        const body = await readJsonBody(req);
        const ward = (body.ward ?? options.ward) as WardManifest;
        const authorityEnvelope = (body.authority_envelope ?? body.authorityEnvelope ?? options.authorityEnvelope) as AuthorityEnvelope;
        const sampleActions = Array.isArray(body.sample_actions) ? (body.sample_actions as CanonicalActionInput[]) : undefined;
        const explanation = explainPolicy({ ward, authorityEnvelope, sampleActions, runtimeRegister: body.runtime_register as RuntimeRegister | undefined, now: typeof body.now === "string" ? body.now : options.now });
        logDecision({ event: "governance_explain", request_id: requestId(req), actor: principal ?? null, samples: explanation.samples.length });
        sendJson(res, 200, explanation);
        return;
      }

      // Admin-only operator actions. The top-of-handler gate already requires the
      // `admin` role; these are additionally disabled unless authentication is
      // configured, so an open/dev boundary never exposes a network kill switch.
      if (req.method === "POST" && url.pathname === "/v1/execution-control/admin/kill") {
        if (!requireAuth) { sendJson(res, 403, { error: "forbidden", detail: "operator actions require authentication to be configured" }); return; }
        if (!options.killSwitchPath) { sendJson(res, 409, { error: "kill_switch_not_configured" }); return; }
        const body = await readJsonBody(req);
        const engage = body.engaged === true || body.engaged === "true";
        const reason = typeof body.reason === "string" ? body.reason : undefined;
        if (engage) {
          mkdirSync(path.dirname(path.resolve(options.killSwitchPath)), { recursive: true });
          writeFileSync(options.killSwitchPath, `${JSON.stringify({ engaged_at: new Date().toISOString(), by: principal?.subject, role: principal?.role, reason }, null, 2)}\n`, "utf8");
        } else if (existsSync(options.killSwitchPath)) {
          rmSync(options.killSwitchPath);
        }
        forwardOperatorAudit(engage ? "kill_switch.engage" : "kill_switch.disengage", principal, { reason: reason ?? null });
        sendJson(res, 200, { kill_switch_engaged: engage, by: principal?.subject, reason });
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/execution-control/admin/revoke") {
        if (!requireAuth) { sendJson(res, 403, { error: "forbidden", detail: "operator actions require authentication to be configured" }); return; }
        if (!options.revocationListPath) { sendJson(res, 409, { error: "revocation_list_not_configured" }); return; }
        const body = await readJsonBody(req);
        const kind = body.kind;
        const id = body.id;
        if ((kind !== "key" && kind !== "envelope" && kind !== "warrant") || typeof id !== "string" || id.length === 0) {
          sendJson(res, 400, { error: "invalid_revocation", detail: "kind must be key|envelope|warrant and id is required" });
          return;
        }
        const list = addRevocation(options.revocationListPath, kind as RevocationKind, id);
        forwardOperatorAudit("revocation.add", principal, { kind, id, reason: typeof body.reason === "string" ? body.reason : null });
        sendJson(res, 200, { revoked: { kind, id }, list });
        return;
      }

      sendJson(res, 404, { error: "not_found" });
    } catch (error) {
      const statusCode = (error as { statusCode?: unknown })?.statusCode;
      const status = typeof statusCode === "number" ? statusCode : 400;
      sendJson(res, status, { error: "execution_control_runtime_error", message: error instanceof Error ? error.message : String(error) });
    }
  });
  return { server };
}

const MAX_REQUEST_BODY_BYTES = 1_000_000;

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_REQUEST_BODY_BYTES) {
      throw Object.assign(new Error(`request body exceeds ${MAX_REQUEST_BODY_BYTES} bytes`), { statusCode: 413 });
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) as Record<string, unknown> : {};
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(`${JSON.stringify(body, null, 2)}\n`);
}
