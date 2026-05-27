import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalizeAction,
  type AuthorityEnvelope,
  type CanonicalActionInput,
  type GelRecord,
  type WardManifest
} from "@aristotle/execution-control-runtime";
import {
  runCounterfactual,
  runCounterfactualSweep,
  serializeSweep,
  loadSweep,
  summarizeSweep,
  compareSweeps,
  SWEEP_ARTIFACT_FORMAT
} from "./index.js";

const WARD_PERMISSIVE: WardManifest = {
  ward_id: "ward-test",
  name: "Test Ward",
  sovereignty_context: "test",
  authority_domain: "test.local",
  policy_version: "v1.0.0",
  permitted_subjects: ["agent:alpha", "agent:beta"],
  physical_bounds: { max_altitude_m: 200 }
};

const WARD_STRICTER: WardManifest = {
  ...WARD_PERMISSIVE,
  policy_version: "v2.0.0",
  physical_bounds: { max_altitude_m: 100 }
};

const ENVELOPE_PERMISSIVE: AuthorityEnvelope = {
  envelope_id: "env-test",
  ward_id: "ward-test",
  subject: "agent:alpha",
  allowed_actions: ["uav.takeoff", "uav.land"],
  denied_actions: [],
  constraints: {},
  expires_at: "2099-01-01T00:00:00.000Z",
  issuer: "issuer-test"
};

const ENVELOPE_STRICTER: AuthorityEnvelope = {
  ...ENVELOPE_PERMISSIVE,
  envelope_id: "env-test-v2",
  // Removes uav.takeoff from allowed_actions
  allowed_actions: ["uav.land"]
};

function mkAction(overrides: Partial<CanonicalActionInput> = {}): CanonicalActionInput {
  return {
    action_id: "act-001",
    ward_id: "ward-test",
    subject: "agent:alpha",
    action_type: "uav.takeoff",
    target: "uav-01",
    params: { altitude_m: 150 },
    requested_at: "2026-05-26T15:00:00.000Z",
    ...overrides
  };
}

function mkHistoricalRecord(action: CanonicalActionInput, overrides: Partial<GelRecord> = {}): GelRecord {
  const canonical = canonicalizeAction(action);
  return {
    record_id: "rec-001",
    previous_hash: "GENESIS",
    record_hash: "0".repeat(64),
    timestamp: "2026-05-26T15:00:01.000Z",
    ward_id: "ward-test",
    subject: "agent:alpha",
    canonical_action_hash: canonical.canonical_action_hash,
    decision: "ALLOW",
    reason_codes: ["ALLOWED"],
    runtime_register_snapshot: {},
    ...overrides
  };
}

test("original replay reproduces historical ALLOW decision exactly", async () => {
  const action = mkAction();
  const record = mkHistoricalRecord(action);
  const result = runCounterfactual({
    action,
    originalWard: WARD_PERMISSIVE,
    originalEnvelope: ENVELOPE_PERMISSIVE,
    historicalRecord: record,
    counterfactuals: []
  });
  assert.equal(result.original_reproduces_historical, true);
  assert.equal(result.original.decision, "ALLOW");
  assert.equal(result.counterfactuals.length, 0);
  assert.equal(result.decisions_flipped, 0);
});

test("counterfactual that removes action from envelope flips ALLOW to REFUSE", async () => {
  const action = mkAction();
  const record = mkHistoricalRecord(action);
  const result = runCounterfactual({
    action,
    originalWard: WARD_PERMISSIVE,
    originalEnvelope: ENVELOPE_PERMISSIVE,
    historicalRecord: record,
    counterfactuals: [{
      name: "stricter-envelope-v2",
      ward: WARD_PERMISSIVE,
      authorityEnvelope: ENVELOPE_STRICTER
    }]
  });
  assert.equal(result.original.decision, "ALLOW");
  assert.equal(result.counterfactuals.length, 1);
  const cf = result.counterfactuals[0];
  assert.equal(cf.decision, "REFUSE");
  assert.equal(cf.changed_from_original.decision_changed, true);
  assert.ok(cf.changed_from_original.added_reason_codes.includes("ACTION_NOT_ALLOWED"));
  assert.equal(result.decisions_flipped, 1);
});

test("counterfactual reports policy_version mismatch as ESCALATE", async () => {
  const action = mkAction();
  const record = mkHistoricalRecord(action);
  const result = runCounterfactual({
    action,
    originalWard: WARD_PERMISSIVE,
    originalEnvelope: ENVELOPE_PERMISSIVE,
    originalRuntimeRegister: { policy_version: "v1.0.0" },
    historicalRecord: record,
    counterfactuals: [{
      name: "stricter-ward-v2",
      ward: WARD_STRICTER,
      authorityEnvelope: ENVELOPE_PERMISSIVE,
      runtimeRegister: { policy_version: "v1.0.0" } // out-of-date runtime
    }]
  });
  assert.equal(result.original.decision, "ALLOW");
  const cf = result.counterfactuals[0];
  assert.equal(cf.decision, "ESCALATE");
  assert.ok(cf.reason_codes.includes("POLICY_VERSION_MISMATCH"));
});

test("original_reproduces_historical false when ward/envelope inputs don't match record", async () => {
  const action = mkAction();
  // Historical record says ALLOW, but we feed mismatched inputs that
  // would yield REFUSE today; we must surface the drift.
  const record = mkHistoricalRecord(action, { decision: "ALLOW" });
  const result = runCounterfactual({
    action,
    originalWard: WARD_PERMISSIVE,
    originalEnvelope: ENVELOPE_STRICTER, // mismatch: today's stricter envelope
    historicalRecord: record,
    counterfactuals: []
  });
  // Today's stricter envelope refuses, but record says ALLOW -> drift detected.
  assert.equal(result.original.decision, "REFUSE");
  assert.equal(result.original_reproduces_historical, false);
});

test("multiple counterfactuals: decisions_flipped counts only those that differ from original", async () => {
  const action = mkAction();
  const record = mkHistoricalRecord(action);
  const result = runCounterfactual({
    action,
    originalWard: WARD_PERMISSIVE,
    originalEnvelope: ENVELOPE_PERMISSIVE,
    historicalRecord: record,
    counterfactuals: [
      { name: "same-policy", ward: WARD_PERMISSIVE, authorityEnvelope: ENVELOPE_PERMISSIVE },
      { name: "stricter-envelope", ward: WARD_PERMISSIVE, authorityEnvelope: ENVELOPE_STRICTER },
      { name: "unknown-subject", ward: { ...WARD_PERMISSIVE, permitted_subjects: ["agent:other"] }, authorityEnvelope: ENVELOPE_PERMISSIVE }
    ]
  });
  assert.equal(result.counterfactuals.length, 3);
  // same-policy should match
  assert.equal(result.counterfactuals[0].changed_from_original.decision_changed, false);
  // stricter-envelope should flip
  assert.equal(result.counterfactuals[1].changed_from_original.decision_changed, true);
  // unknown-subject should flip (SUBJECT_NOT_IN_WARD)
  assert.equal(result.counterfactuals[2].changed_from_original.decision_changed, true);
  assert.ok(result.counterfactuals[2].reason_codes.includes("SUBJECT_NOT_IN_WARD"));
  assert.equal(result.decisions_flipped, 2);
});

test("runCounterfactualSweep: ALLOW_to_REFUSE transition count across a small batch", async () => {
  const records: GelRecord[] = [];
  const actionsByRecord = new Map<string, CanonicalActionInput>();
  for (let i = 0; i < 5; i++) {
    const a = mkAction({ action_id: `act-${i}`, params: { altitude_m: 50 + i * 10 } });
    const r = mkHistoricalRecord(a, { record_id: `rec-${i}` });
    records.push(r);
    actionsByRecord.set(r.record_id, a);
  }
  const sweep = runCounterfactualSweep({
    records,
    resolveAction: (r) => actionsByRecord.get(r.record_id) ?? null,
    resolveOriginal: () => ({ ward: WARD_PERMISSIVE, envelope: ENVELOPE_PERMISSIVE }),
    counterfactual: {
      name: "stricter-envelope-v2",
      ward: WARD_PERMISSIVE,
      envelope: ENVELOPE_STRICTER
    }
  });
  assert.equal(sweep.total_records, 5);
  assert.equal(sweep.resolved_records, 5);
  assert.equal(sweep.flipped.length, 5);
  // Every ALLOW would have been REFUSED.
  assert.equal(sweep.transitions["ALLOW_to_REFUSE"], 5);
});

test("runCounterfactualSweep: unresolved actions counted but not evaluated", async () => {
  const records: GelRecord[] = [];
  for (let i = 0; i < 3; i++) {
    const a = mkAction({ action_id: `act-${i}` });
    const r = mkHistoricalRecord(a, { record_id: `rec-${i}` });
    records.push(r);
  }
  const sweep = runCounterfactualSweep({
    records,
    resolveAction: () => null, // can't resolve anything
    resolveOriginal: () => ({ ward: WARD_PERMISSIVE, envelope: ENVELOPE_PERMISSIVE }),
    counterfactual: { name: "x" }
  });
  assert.equal(sweep.resolved_records, 0);
  assert.equal(sweep.unresolved_records, 3);
  assert.equal(sweep.flipped.length, 0);
});

test("serializeSweep + loadSweep: round-trip preserves content and format tag", () => {
  const sweep = runCounterfactualSweep({
    records: [mkHistoricalRecord(mkAction())],
    resolveAction: () => mkAction(),
    resolveOriginal: () => ({ ward: WARD_PERMISSIVE, envelope: ENVELOPE_PERMISSIVE }),
    counterfactual: { name: "stricter", ward: WARD_PERMISSIVE, envelope: ENVELOPE_STRICTER }
  });
  const artifact = serializeSweep(sweep, "2026-05-26T20:00:00.000Z");
  assert.equal(artifact.format, SWEEP_ARTIFACT_FORMAT);
  assert.equal(artifact.generated_at, "2026-05-26T20:00:00.000Z");
  // Round-trip through JSON
  const json = JSON.stringify(artifact);
  const parsed = loadSweep(JSON.parse(json));
  assert.equal(parsed.format, SWEEP_ARTIFACT_FORMAT);
  assert.equal(parsed.result.name, "stricter");
  assert.equal(parsed.result.flipped.length, 1);
});

test("loadSweep: rejects artifacts without the expected format tag", () => {
  assert.throws(() => loadSweep({ format: "wrong.format.v1", result: {} }), /unexpected sweep format/);
  assert.throws(() => loadSweep(null), /sweep artifact is not an object/);
  assert.throws(() => loadSweep({ format: SWEEP_ARTIFACT_FORMAT }), /missing 'result'/);
});

test("summarizeSweep: produces a single-line CI-friendly string", () => {
  const records = [mkHistoricalRecord(mkAction({ action_id: "a1" }), { record_id: "r1" })];
  const map = new Map([["r1", mkAction({ action_id: "a1" })]]);
  const sweep = runCounterfactualSweep({
    records,
    resolveAction: (r) => map.get(r.record_id) ?? null,
    resolveOriginal: () => ({ ward: WARD_PERMISSIVE, envelope: ENVELOPE_PERMISSIVE }),
    counterfactual: { name: "v2", ward: WARD_PERMISSIVE, envelope: ENVELOPE_STRICTER }
  });
  const line = summarizeSweep(sweep);
  assert.match(line, /counterfactual 'v2'/);
  assert.match(line, /1\/1 resolved records flipped/);
  assert.match(line, /ALLOW_to_REFUSE: 1/);
});

test("compareSweeps: rows sorted by flipped descending; total_resolved_records is the max", () => {
  const sweepA: ReturnType<typeof runCounterfactualSweep> = {
    name: "small-change", total_records: 10, resolved_records: 10, unresolved_records: 0,
    flipped: [{ record_id: "r1", historical_decision: "ALLOW", counterfactual_decision: "REFUSE" }],
    transitions: { ALLOW_to_REFUSE: 1 }
  };
  const sweepB: ReturnType<typeof runCounterfactualSweep> = {
    name: "big-change", total_records: 10, resolved_records: 10, unresolved_records: 0,
    flipped: [1, 2, 3, 4, 5].map((i) => ({ record_id: `r${i}`, historical_decision: "ALLOW" as const, counterfactual_decision: "REFUSE" as const })),
    transitions: { ALLOW_to_REFUSE: 5 }
  };
  const cmp = compareSweeps([sweepA, sweepB]);
  assert.equal(cmp.total_resolved_records, 10);
  assert.equal(cmp.rows[0].name, "big-change");
  assert.equal(cmp.rows[0].flipped, 5);
  assert.equal(cmp.rows[1].name, "small-change");
});
