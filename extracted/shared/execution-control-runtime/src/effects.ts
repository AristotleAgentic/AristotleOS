import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  LedgerStore, GENESIS_HASH, canonicalizeAction, stableStringify, sha256,
  verifyGelRecords, verifyWarrant, type GelRecord, type LedgerBackend,
  type CanonicalActionInput, type WardManifest, type Warrant,
  type AristotleSigner, type CommitGateDecision, type WarrantVerifyOptions
} from "./index.js";
import { verifyEd25519 } from "./signing.js";

export type EffectState = "AUTHORIZED" | "IN_FLIGHT" | "CONFIRMED_EFFECT" | "CONFIRMED_NO_EFFECT" | "EFFECT_UNKNOWN";

export interface EffectBinding {
  operation_id: string;
  attempt_id: string;
  warrant_id: string;
  authority_envelope_id: string;
  canonical_action_hash: string;
  ward_id: string;
  subject: string;
  target: string;
  state_fingerprint: string;
}

export interface EffectObservation extends EffectBinding {
  version: "aristotle.effect-observation.v1";
  observation_id: string;
  outcome: "CONFIRMED_EFFECT" | "CONFIRMED_NO_EFFECT" | "EFFECT_UNKNOWN";
  /** A settled no-effect observation must exclude delayed future commit. */
  finality: "settled" | "unresolved";
  observed_at: string;
  method: string;
  external_evidence_hash: string;
  observer_key_id: string;
  signature: string;
}

export interface EffectAttempt extends EffectBinding {
  state: EffectState;
  consumed: true;
  started_at: string;
  updated_at: string;
  admission_record_hash: string;
}

export interface EffectEvent {
  version: "aristotle.effect-event.v1";
  event_id: string;
  attempt: EffectAttempt;
  observation?: EffectObservation;
}

interface Context {
  ward: WardManifest;
  action: CanonicalActionInput;
  decision: CommitGateDecision;
  warrant: Warrant;
}
interface Stored { attempt: EffectAttempt; context: Context }
interface Row { json: string }
interface Database {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...values: unknown[]): unknown;
    get(...values: unknown[]): Row | undefined;
    all(...values: unknown[]): Row[];
  };
  close(): void;
}

export function effectObservationMaterial(observation: EffectObservation): string {
  const { signature: _signature, ...material } = observation;
  return stableStringify(material);
}

/** Offline consistency and provenance check. PASS means the supplied evidence
 * satisfies this contract, not that an external system cannot lie or that the
 * supplied chain is complete. Anchor its final hash independently for that. */
export function verifyEffectEvidence(records: GelRecord[], options: {
  trustedLedgerKeys: Readonly<Record<string, string>>;
  trustedObservers: Readonly<Record<string, string>>;
  allowedMethods?: readonly string[];
  expectedTipHash?: string;
}): { status: "PASS" | "FAIL" | "INDETERMINATE"; reasons: string[] } {
  try { return verifyEffectEvidenceUnchecked(records, options); }
  catch { return { status: "FAIL", reasons: ["EFFECT_EVIDENCE_MALFORMED"] }; }
}

function verifyEffectEvidenceUnchecked(records: GelRecord[], options: {
  trustedLedgerKeys: Readonly<Record<string, string>>;
  trustedObservers: Readonly<Record<string, string>>;
  allowedMethods?: readonly string[];
  expectedTipHash?: string;
}): { status: "PASS" | "FAIL" | "INDETERMINATE"; reasons: string[] } {
  const chain = verifyGelRecords(records);
  if (!chain.ok) return { status: "FAIL", reasons: ["EFFECT_CHAIN_INVALID"] };
  if (options.expectedTipHash !== undefined && (records.at(-1)?.record_hash ?? GENESIS_HASH) !== options.expectedTipHash) return { status: "FAIL", reasons: ["EFFECT_ANCHOR_MISMATCH"] };
  const latest = new Map<string, EffectAttempt>();
  const operations = new Map<string, string>();
  const usedWarrants = new Set<string>();
  for (const record of records) {
    const key = record.signing_key_id && Object.hasOwn(options.trustedLedgerKeys, record.signing_key_id) ? options.trustedLedgerKeys[record.signing_key_id] : undefined;
    if (!key) return { status: "INDETERMINATE", reasons: ["EFFECT_LEDGER_TRUST_MISSING"] };
    if (!record.signature || !verifyEd25519(key, record.record_hash, record.signature)) return { status: "FAIL", reasons: ["EFFECT_LEDGER_SIGNATURE_INVALID"] };
    const event = record.effect_event;
    if (!event || event.version !== "aristotle.effect-event.v1") return { status: "FAIL", reasons: ["EFFECT_EVENT_INVALID"] };
    const attempt = event.attempt, previous = latest.get(attempt.attempt_id);
    if (!["AUTHORIZED", "IN_FLIGHT", "EFFECT_UNKNOWN", "CONFIRMED_EFFECT", "CONFIRMED_NO_EFFECT"].includes(attempt.state) || !Number.isFinite(Date.parse(attempt.started_at)) || !Number.isFinite(Date.parse(attempt.updated_at))) return { status: "FAIL", reasons: ["EFFECT_STATE_INVALID"] };
    if (record.warrant_id !== attempt.warrant_id || record.authority_envelope_id !== attempt.authority_envelope_id || record.canonical_action_hash !== attempt.canonical_action_hash || record.subject !== attempt.subject || record.ward_id !== attempt.ward_id || !attempt.consumed) return { status: "FAIL", reasons: ["EFFECT_RECORD_BINDING_INVALID"] };
    if (!previous) {
      if (attempt.state !== "AUTHORIZED" || usedWarrants.has(attempt.warrant_id)) return { status: "FAIL", reasons: ["EFFECT_CONSUMPTION_INVALID"] };
      const scope = stableStringify([attempt.ward_id, attempt.subject, attempt.operation_id]);
      const previousAttempt = operations.get(scope);
      if (previousAttempt && latest.get(previousAttempt)?.state !== "CONFIRMED_NO_EFFECT") return { status: "FAIL", reasons: ["EFFECT_DUPLICATE_OPERATION"] };
      operations.set(scope, attempt.attempt_id);
      usedWarrants.add(attempt.warrant_id);
    } else {
      const immutable = (a: EffectAttempt) => { const { state: _state, updated_at: _updated, ...rest } = a; return stableStringify(rest); };
      if (immutable(previous) !== immutable(attempt) || ["CONFIRMED_EFFECT", "CONFIRMED_NO_EFFECT"].includes(previous.state) ||
          (previous.state === "AUTHORIZED" && attempt.state !== "IN_FLIGHT") ||
          (previous.state !== "AUTHORIZED" && ["AUTHORIZED", "IN_FLIGHT"].includes(attempt.state))) return { status: "FAIL", reasons: ["EFFECT_TRANSITION_INVALID"] };
    }
    if (["CONFIRMED_EFFECT", "CONFIRMED_NO_EFFECT"].includes(attempt.state) || event.observation) {
      const obs = event.observation;
      if (!obs || obs.outcome !== attempt.state || obs.finality !== "settled" && obs.outcome !== "EFFECT_UNKNOWN") return { status: "FAIL", reasons: ["EFFECT_OBSERVATION_REQUIRED"] };
      if (!options.allowedMethods) return { status: "INDETERMINATE", reasons: ["EFFECT_OBSERVATION_POLICY_MISSING"] };
      if (obs.version !== "aristotle.effect-observation.v1" || !options.allowedMethods.includes(obs.method) || !/^[a-f0-9]{64}$/.test(obs.external_evidence_hash) ||
          !Number.isFinite(Date.parse(obs.observed_at)) || Date.parse(obs.observed_at) < Date.parse(attempt.started_at) || Date.parse(obs.observed_at) > Date.parse(attempt.updated_at) ||
          obs.outcome === "CONFIRMED_NO_EFFECT" && previous?.state === "IN_FLIGHT") return { status: "FAIL", reasons: ["EFFECT_OBSERVATION_INVALID"] };
      for (const field of ["operation_id", "attempt_id", "warrant_id", "authority_envelope_id", "canonical_action_hash", "ward_id", "subject", "target", "state_fingerprint"] as const) {
        if (obs[field] !== attempt[field]) return { status: "FAIL", reasons: ["EFFECT_OBSERVATION_BINDING_INVALID"] };
      }
      const observerKey = Object.hasOwn(options.trustedObservers, obs.observer_key_id) ? options.trustedObservers[obs.observer_key_id] : undefined;
      if (!observerKey) return { status: "INDETERMINATE", reasons: ["EFFECT_OBSERVER_TRUST_MISSING"] };
      if (!verifyEd25519(observerKey, effectObservationMaterial(obs), obs.signature)) return { status: "FAIL", reasons: ["EFFECT_OBSERVATION_SIGNATURE_INVALID"] };
    }
    latest.set(attempt.attempt_id, attempt);
  }
  const reasons = [];
  if (options.expectedTipHash === undefined) reasons.push("EFFECT_COMPLETENESS_UNANCHORED");
  if (!latest.size || [...latest.values()].some(a => !["CONFIRMED_EFFECT", "CONFIRMED_NO_EFFECT"].includes(a.state))) reasons.push("EFFECT_UNRESOLVED");
  return { status: reasons.length ? "INDETERMINATE" : "PASS", reasons };
}

/** Local-host durable dispatch ownership. All competing dispatchers must share
 * this database; independent files/hosts do not provide global replay protection.
 * Effect events use the existing signed GEL format in an explicitly separate
 * chain, linked to the admission chain by admission_record_hash. */
export class SqliteEffectStore implements LedgerBackend {
  private readonly db: Database;
  private readonly ledger: LedgerStore;

  constructor(dbPath: string, private readonly signer: AristotleSigner,
    private readonly trustedWarrantKeys: Readonly<Record<string, string>> = { [signer.key_id]: signer.public_key_pem }) {
    if (dbPath !== ":memory:") mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
    const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (p: string) => Database };
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    this.db.exec(`CREATE TABLE IF NOT EXISTS effect_attempts (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      attempt_id TEXT UNIQUE NOT NULL, warrant_id TEXT UNIQUE NOT NULL,
      nonce TEXT UNIQUE NOT NULL, scope TEXT NOT NULL, json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS effect_scope ON effect_attempts(scope, seq);
    CREATE TABLE IF NOT EXISTS effect_gel (seq INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS effect_observations (id TEXT PRIMARY KEY, material TEXT NOT NULL);`);
    this.ledger = new LedgerStore(this);
    try { this.assertIntegrity(); } catch (error) { this.db.close(); throw error; }
  }

  get tipHash(): string { return this.tail(1)[0]?.record_hash ?? GENESIS_HASH; }
  get count(): number { return this.records().length; }
  hasAdmitted(hash: string): boolean { return this.records().some(r => r.canonical_action_hash === hash); }
  records(): GelRecord[] { return this.db.prepare("SELECT json FROM effect_gel ORDER BY seq").all().map(r => JSON.parse(r.json)); }
  tail(limit: number): GelRecord[] { return this.db.prepare("SELECT json FROM effect_gel ORDER BY seq DESC LIMIT ?").all(limit).map(r => JSON.parse(r.json) as GelRecord).reverse(); }
  verification(): ReturnType<typeof verifyGelRecords> { return verifyGelRecords(this.records()); }
  persist(record: GelRecord): void { this.db.prepare("INSERT INTO effect_gel(json) VALUES (?)").run(JSON.stringify(record)); }
  close(): void { this.db.close(); }

  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = fn(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  private load(attemptId: string): Stored {
    const row = this.db.prepare("SELECT json FROM effect_attempts WHERE attempt_id=?").get(attemptId);
    if (!row) throw new Error("EFFECT_ATTEMPT_NOT_FOUND");
    return JSON.parse(row.json) as Stored;
  }

  get(attemptId: string): EffectAttempt { return this.load(attemptId).attempt; }

  private assertIntegrity(): void {
    const records = this.records();
    const result = verifyGelRecords(records);
    if (!result.ok) throw new Error(`EFFECT_LEDGER_INVALID: ${result.failure}`);
    const latest = new Map<string, EffectAttempt>();
    for (const record of records) {
      if (!record.signature || !record.effect_event) throw new Error("EFFECT_EVENT_UNSIGNED_OR_MISSING");
      latest.set(record.effect_event.attempt.attempt_id, record.effect_event.attempt);
    }
    const rows = this.db.prepare("SELECT json FROM effect_attempts").all();
    if (latest.size !== rows.length) throw new Error("EFFECT_STATE_LEDGER_MISMATCH");
    for (const row of rows) {
      const stored = JSON.parse(row.json) as Stored;
      if (stableStringify(latest.get(stored.attempt.attempt_id)) !== stableStringify(stored.attempt)) throw new Error("EFFECT_STATE_LEDGER_MISMATCH");
    }
  }

  private event(stored: Stored, observation?: EffectObservation): void {
    this.ledger.append({
      ...stored.context, now: stored.attempt.updated_at, signer: this.signer,
      effect_event: { version: "aristotle.effect-event.v1", event_id: randomUUID(), attempt: stored.attempt, ...(observation ? { observation } : {}) }
    });
  }

  begin(input: {
    ward: WardManifest; action: CanonicalActionInput; warrant: Warrant;
    admission: GelRecord; now?: string; verify?: WarrantVerifyOptions;
  }): EffectAttempt {
    const now = input.now ?? new Date().toISOString();
    if (!Number.isFinite(Date.parse(now))) throw new Error("EFFECT_INVALID_TIME");
    const hash = canonicalizeAction(input.action).canonical_action_hash;
    const warrantKey = Object.hasOwn(this.trustedWarrantKeys, input.warrant.signing_key_id) ? this.trustedWarrantKeys[input.warrant.signing_key_id] : undefined;
    if (!warrantKey || warrantKey !== input.warrant.signing_public_key) throw new Error("EFFECT_WARRANT_KEY_UNTRUSTED");
    const verification = verifyWarrant(input.warrant, hash, now, input.verify);
    if (!verification.ok || !input.warrant.nonce) throw new Error(`EFFECT_WARRANT_INVALID: ${verification.reason ?? "NONCE_MISSING"}`);
    if (input.admission.canonical_action_hash !== hash || input.admission.warrant_id !== input.warrant.warrant_id || input.admission.decision !== "ALLOW") throw new Error("EFFECT_ADMISSION_MISMATCH");
    const operation = input.action.params.operation_id ?? input.action.action_id;
    if (typeof operation !== "string" || operation.trim().length === 0 || operation.length > 512) throw new Error("EFFECT_OPERATION_ID_REQUIRED");
    const scope = stableStringify([input.action.ward_id, input.action.subject, operation]);
    const attempt: EffectAttempt = {
      operation_id: operation, attempt_id: randomUUID(), warrant_id: input.warrant.warrant_id,
      authority_envelope_id: input.warrant.authority_envelope_id,
      canonical_action_hash: hash, ward_id: input.action.ward_id, subject: input.action.subject,
      target: input.action.target,
      state_fingerprint: sha256(stableStringify({ telemetry: input.action.telemetry, registers: input.admission.runtime_register_snapshot })),
      state: "AUTHORIZED", consumed: true, started_at: now, updated_at: now,
      admission_record_hash: input.admission.record_hash
    };
    // GEL construction needs identifiers, not secret-bearing request bodies or headers.
    const context: Context = {
      ward: { ...input.ward },
      action: { action_id: input.action.action_id, ward_id: input.action.ward_id, subject: input.action.subject,
        action_type: input.action.action_type, target: input.action.target, requested_at: input.action.requested_at,
        request_id: input.action.request_id, params: {} },
      decision: { decision: "ALLOW", reason_codes: input.admission.reason_codes, canonical_action_hash: hash,
        authority_envelope_id: input.warrant.authority_envelope_id, policy_version: input.admission.policy_version,
        runtime_register_snapshot: {} },
      warrant: { ...input.warrant, consumed: true }
    };
    return this.transaction(() => {
      const previous = this.db.prepare("SELECT json FROM effect_attempts WHERE scope=? ORDER BY seq DESC LIMIT 1").get(scope);
      if (previous && (JSON.parse(previous.json) as Stored).attempt.state !== "CONFIRMED_NO_EFFECT") throw new Error("EFFECT_OPERATION_ALREADY_ATTEMPTED");
      const stored = { attempt, context };
      this.db.prepare("INSERT INTO effect_attempts(attempt_id,warrant_id,nonce,scope,json) VALUES (?,?,?,?,?)")
        .run(attempt.attempt_id, attempt.warrant_id, input.warrant.nonce, scope, JSON.stringify(stored));
      this.event(stored);
      attempt.state = "IN_FLIGHT";
      this.db.prepare("UPDATE effect_attempts SET json=? WHERE attempt_id=?").run(JSON.stringify(stored), attempt.attempt_id);
      this.event(stored);
      return { ...attempt };
    });
  }

  /** A receipt or exception is not proof of the business effect. */
  markUnknown(attemptId: string, now = new Date().toISOString()): EffectAttempt {
    if (!Number.isFinite(Date.parse(now))) throw new Error("EFFECT_INVALID_TIME");
    return this.transaction(() => {
      const stored = this.load(attemptId);
      if (stored.attempt.state !== "IN_FLIGHT") return stored.attempt;
      stored.attempt = { ...stored.attempt, state: "EFFECT_UNKNOWN", updated_at: now };
      this.db.prepare("UPDATE effect_attempts SET json=? WHERE attempt_id=?").run(JSON.stringify(stored), attemptId);
      this.event(stored);
      return stored.attempt;
    });
  }

  /** Pure observation ingestion: this method has no transport or dispatch hook.
   * Observer keys and methods are operator configuration, never request-supplied. */
  reconcile(observation: EffectObservation, options: {
    trustedObservers: Readonly<Record<string, string>>; allowedMethods: readonly string[];
    now?: string; maxAgeMs?: number;
  }): EffectAttempt {
    const now = options.now ?? new Date().toISOString();
    const nowMs = Date.parse(now), observedMs = Date.parse(observation.observed_at);
    const maxAge = options.maxAgeMs ?? 300_000;
    const key = Object.hasOwn(options.trustedObservers, observation.observer_key_id) ? options.trustedObservers[observation.observer_key_id] : undefined;
    if (observation.version !== "aristotle.effect-observation.v1" || !key || !verifyEd25519(key, effectObservationMaterial(observation), observation.signature)) throw new Error("EFFECT_OBSERVER_UNTRUSTED");
    if (!["CONFIRMED_EFFECT", "CONFIRMED_NO_EFFECT", "EFFECT_UNKNOWN"].includes(observation.outcome)) throw new Error("EFFECT_OUTCOME_INVALID");
    if (observation.outcome !== "EFFECT_UNKNOWN" && observation.finality !== "settled") throw new Error("EFFECT_OBSERVATION_NOT_FINAL");
    if (!options.allowedMethods.includes(observation.method) || !/^[a-f0-9]{64}$/.test(observation.external_evidence_hash) || !observation.observation_id) throw new Error("EFFECT_EVIDENCE_INVALID");
    if (!Number.isFinite(nowMs) || !Number.isFinite(observedMs) || !Number.isFinite(maxAge) || maxAge < 0 || observedMs > nowMs || nowMs - observedMs > maxAge) throw new Error("EFFECT_OBSERVATION_STALE");
    return this.transaction(() => {
      const stored = this.load(observation.attempt_id);
      for (const field of ["operation_id", "attempt_id", "warrant_id", "authority_envelope_id", "canonical_action_hash", "ward_id", "subject", "target", "state_fingerprint"] as const) {
        if (observation[field] !== stored.attempt[field]) throw new Error(`EFFECT_BINDING_MISMATCH: ${field}`);
      }
      if (observedMs < Date.parse(stored.attempt.started_at)) throw new Error("EFFECT_OBSERVATION_PREDATES_ATTEMPT");
      const material = effectObservationMaterial(observation);
      const previous = this.db.prepare("SELECT material AS json FROM effect_observations WHERE id=?").get(observation.observation_id);
      if (previous) {
        if (previous.json !== material) throw new Error("EFFECT_OBSERVATION_ID_REUSED");
        return stored.attempt;
      }
      if (["CONFIRMED_EFFECT", "CONFIRMED_NO_EFFECT"].includes(stored.attempt.state)) throw new Error("EFFECT_TERMINAL_CONFLICT");
      // Live dispatch may still commit later. Require the boundary to have
      // marked uncertainty after transport completion/failure before no-effect.
      if (stored.attempt.state === "IN_FLIGHT" && observation.outcome === "CONFIRMED_NO_EFFECT") throw new Error("EFFECT_ATTEMPT_STILL_IN_FLIGHT");
      stored.attempt = { ...stored.attempt, state: observation.outcome, updated_at: now };
      this.db.prepare("INSERT INTO effect_observations(id,material) VALUES (?,?)").run(observation.observation_id, material);
      this.db.prepare("UPDATE effect_attempts SET json=? WHERE attempt_id=?").run(JSON.stringify(stored), observation.attempt_id);
      this.event(stored, observation);
      return stored.attempt;
    });
  }
}
