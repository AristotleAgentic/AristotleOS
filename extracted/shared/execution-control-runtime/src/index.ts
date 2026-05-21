import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";

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
  issuer: string;
  signature: string;
}

export interface WarrantVerification {
  ok: boolean;
  reason?: "WARRANT_CONSUMED" | "WARRANT_EXPIRED" | "ACTION_HASH_MISMATCH" | "DECISION_NOT_ALLOWED" | "SIGNATURE_MISMATCH";
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
  runtime_register_snapshot: RuntimeRegister;
  physical_invariant_result?: PhysicalInvariantResult;
}

export interface EvaluateExecutionControlInput extends CommitGateInput {
  ledgerPath: string;
}

export interface EvaluateExecutionControlResult {
  decision: ExecutionControlDecision;
  reason_codes: ExecutionControlReasonCode[];
  canonical_action_hash: string;
  warrant?: Warrant;
  gel_record: GelRecord;
  ledger_verification: { ok: boolean; count: number; failure?: string };
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
  verification: EvidenceBundleVerification;
}

export interface EvidenceBundleVerification {
  ok: boolean;
  failures: string[];
  ledger: { ok: boolean; count: number; failure?: string };
  warrant?: WarrantVerification;
  bundle_hash?: string;
}

export interface ExportEvidenceBundleInput {
  ledgerPath: string;
  ward: WardManifest;
  authorityEnvelope?: AuthorityEnvelope;
  recordId?: string;
  warrant?: Warrant;
  exportedAt?: string;
}

export interface ExecutionControlRuntimeServerOptions {
  ward: WardManifest;
  authorityEnvelope: AuthorityEnvelope;
  ledgerPath: string;
  now?: string;
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

const GENESIS_HASH = "GENESIS";

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

export function issueWarrant(decision: CommitGateDecision, action: CanonicalActionInput, envelope: AuthorityEnvelope, now = new Date().toISOString()): Warrant | undefined {
  if (decision.decision !== "ALLOW") return undefined;
  const expires_at = new Date(Date.parse(now) + 60_000).toISOString();
  const material = {
    authority_envelope_id: envelope.envelope_id,
    canonical_action_hash: decision.canonical_action_hash,
    expires_at,
    issued_at: now,
    issuer: envelope.issuer,
    subject: action.subject,
    ward_id: action.ward_id
  };
  const signature = `aristotle-execution-control-signature-${sha256(stableStringify(material))}`;
  return {
    warrant_id: `wrn-${sha256(stableStringify({ ...material, signature })).slice(0, 24)}`,
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
    issuer: envelope.issuer,
    signature
  };
}

export class AristotleWarrant {
  constructor(public readonly warrant: Warrant) {}

  verify(canonicalActionHash: string, now = new Date().toISOString()): WarrantVerification {
    return verifyWarrant(this.warrant, canonicalActionHash, now);
  }

  consume(canonicalActionHash: string, now = new Date().toISOString()): Warrant {
    const verification = this.verify(canonicalActionHash, now);
    if (!verification.ok) throw new Error(verification.reason ?? "WARRANT_VERIFICATION_FAILED");
    this.warrant.consumed = true;
    return this.warrant;
  }
}

export function verifyWarrant(warrant: Warrant, canonicalActionHash: string, now = new Date().toISOString()): WarrantVerification {
  if (warrant.decision !== "ALLOW") return { ok: false, reason: "DECISION_NOT_ALLOWED" };
  if (warrant.consumed) return { ok: false, reason: "WARRANT_CONSUMED" };
  if (Date.parse(warrant.expires_at) <= Date.parse(now)) return { ok: false, reason: "WARRANT_EXPIRED" };
  if (warrant.canonical_action_hash !== canonicalActionHash) return { ok: false, reason: "ACTION_HASH_MISMATCH" };
  const material = {
    authority_envelope_id: warrant.authority_envelope_id,
    canonical_action_hash: warrant.canonical_action_hash,
    expires_at: warrant.expires_at,
    issued_at: warrant.issued_at,
    issuer: warrant.issuer,
    subject: warrant.subject,
    ward_id: warrant.ward_id
  };
  const expected = `aristotle-execution-control-signature-${sha256(stableStringify(material))}`;
  if (warrant.signature !== expected) return { ok: false, reason: "SIGNATURE_MISMATCH" };
  return { ok: true };
}

export function consumeWarrant(warrant: Warrant, canonicalActionHash: string, now = new Date().toISOString()): Warrant {
  return new AristotleWarrant(warrant).consume(canonicalActionHash, now);
}

export function appendGelRecord(input: {
  ledgerPath: string;
  ward: WardManifest;
  action: CanonicalActionInput;
  decision: CommitGateDecision;
  warrant?: Warrant;
  now?: string;
}): GelRecord {
  const chain = loadGelChain(input.ledgerPath);
  const previous_hash = chain.at(-1)?.record_hash ?? GENESIS_HASH;
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
    runtime_register_snapshot: input.decision.runtime_register_snapshot,
    physical_invariant_result: input.decision.physical_invariant_result
  };
  const record_hash = sha256(stableStringify(base));
  const record: GelRecord = { ...base, record_hash };
  mkdirSync(path.dirname(path.resolve(input.ledgerPath)), { recursive: true });
  appendFileSync(input.ledgerPath, `${stableStringify(record)}\n`, "utf8");
  return record;
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
    const { record_hash: _recordHash, ...material } = record;
    const expected = sha256(stableStringify(material));
    if (record.record_hash !== expected) return { ok: false, count: chain.length, failure: `record ${index} hash mismatch` };
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
  const verification = verifyEvidenceBundle({ ...partial, hashes, verification: emptyEvidenceVerification() });
  hashes.bundle_hash = verification.bundle_hash ?? sha256(stableStringify({ ...partial, hashes: { ...hashes, bundle_hash: undefined } }));
  return {
    ...partial,
    hashes,
    verification: verifyEvidenceBundle({ ...partial, hashes, verification: emptyEvidenceVerification() })
  };
}

export function loadEvidenceBundle(file: string): EvidenceBundle {
  return JSON.parse(readFileSync(file, "utf8")) as EvidenceBundle;
}

export function verifyEvidenceBundle(bundle: EvidenceBundle): EvidenceBundleVerification {
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
    warrant = verifyWarrant(bundle.warrant, bundle.selected_record.canonical_action_hash, bundle.warrant.issued_at);
    if (!warrant.ok) failures.push(`warrant verification failed: ${warrant.reason}`);
    if (bundle.selected_record.warrant_id && bundle.selected_record.warrant_id !== bundle.warrant.warrant_id) failures.push("selected record Warrant id does not match bundled Warrant");
  } else if (bundle.selected_record.warrant_id) {
    failures.push("selected record references a Warrant but no Warrant material is bundled");
  }

  const expectedBundleHash = evidenceBundleHash(bundle);
  if (bundle.hashes.bundle_hash && bundle.hashes.bundle_hash !== expectedBundleHash) failures.push("evidence bundle hash mismatch");

  return {
    ok: failures.length === 0,
    failures,
    ledger,
    warrant,
    bundle_hash: expectedBundleHash
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

export function evaluateExecutionControl(input: EvaluateExecutionControlInput): EvaluateExecutionControlResult {
  if (!input.ward) throw new Error("ward manifest is required for GEL recording");
  const decision = evaluateCommitGate(input);
  const warrant = input.authorityEnvelope ? issueWarrant(decision, input.action, input.authorityEnvelope, input.now) : undefined;
  const gel_record = appendGelRecord({
    ledgerPath: input.ledgerPath,
    ward: input.ward,
    action: input.action,
    decision,
    warrant,
    now: input.now
  });
  return {
    decision: decision.decision,
    reason_codes: decision.reason_codes,
    canonical_action_hash: decision.canonical_action_hash,
    warrant,
    gel_record,
    ledger_verification: verifyGelChain(input.ledgerPath)
  };
}

export function loadWardManifest(file: string): WardManifest {
  return loadStructuredFile(file) as unknown as WardManifest;
}

export function loadAuthorityEnvelope(file: string): AuthorityEnvelope {
  return loadStructuredFile(file) as unknown as AuthorityEnvelope;
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

function missingRuntimeRegisters(envelope: AuthorityEnvelope, action: CanonicalActionInput, runtimeRegister: RuntimeRegister): string[] {
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
      version: "0.1.0",
      description: "AristotleOS-native execution-control boundary: Canonical Governed Action -> Commit Gate -> Warrant -> GEL."
    },
    paths: {
      "/health": {
        get: {
          summary: "Runtime health and active governance context",
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
      "/v1/execution-control/audit/tail": {
        get: {
          summary: "Return recent Governance Evidence Ledger records",
          responses: { "200": { description: "Recent GEL records" } }
        }
      },
      "/v1/execution-control/audit/verify": {
        get: {
          summary: "Verify GEL hash-chain integrity",
          responses: { "200": { description: "Ledger verification result" } }
        }
      },
      "/openapi.json": {
        get: {
          summary: "OpenAPI contract for the Ward/Warrant execution-control runtime",
          responses: { "200": { description: "OpenAPI 3 specification" } }
        }
      }
    },
    components: {
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
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, {
          ok: true,
          runtime: "aristotle-ward-warrant-execution-control",
          doctrine: "Governance must bind at the execution boundary before irreversible state mutation or external action occurs.",
          ward_id: options.ward.ward_id,
          authority_envelope_id: options.authorityEnvelope.envelope_id
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/openapi.json") {
        sendJson(res, 200, executionControlOpenApiSpec());
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/execution-control/evaluate") {
        const body = await readJsonBody(req);
        const action = (body.action ?? body) as CanonicalActionInput;
        const result = evaluateExecutionControl({
          ward: options.ward,
          authorityEnvelope: options.authorityEnvelope,
          action,
          runtimeRegister: body.runtime_register as RuntimeRegister | undefined,
          ledgerPath: options.ledgerPath,
          now: typeof body.now === "string" ? body.now : options.now
        });
        sendJson(res, result.decision === "ALLOW" ? 200 : result.decision === "ESCALATE" ? 202 : 409, result);
        return;
      }

      if (req.method === "GET" && url.pathname === "/v1/execution-control/audit/tail") {
        const limit = Number(url.searchParams.get("limit") ?? "20");
        sendJson(res, 200, { items: loadGelChain(options.ledgerPath).slice(-limit) });
        return;
      }

      if (req.method === "GET" && url.pathname === "/v1/execution-control/audit/verify") {
        sendJson(res, 200, verifyGelChain(options.ledgerPath));
        return;
      }

      sendJson(res, 404, { error: "not_found" });
    } catch (error) {
      sendJson(res, 400, { error: "execution_control_runtime_error", message: error instanceof Error ? error.message : String(error) });
    }
  });
  return { server };
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) as Record<string, unknown> : {};
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(`${JSON.stringify(body, null, 2)}\n`);
}
