import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type AuthorityEnvelope,
  type CanonicalActionInput,
  type WardManifest,
  appendGelRecord,
  canonicalizeAction,
  executionControlOpenApiSpec,
  createExecutionControlRuntimeServer,
  consumeWarrant,
  evaluateCommitGate,
  evaluateExecutionControl,
  issueWarrant,
  loadGelChain,
  requireAllowedWarrant,
  submitGovernedAction,
  verifyGelChain,
  verifyWarrant
} from "./index.js";

const ward: WardManifest = {
  ward_id: "montana-drone-test-range",
  name: "Montana Drone Test Range",
  sovereignty_context: "private-ranch-field-test",
  authority_domain: "drone-swarm-ops",
  policy_version: "0.1.0",
  permitted_subjects: ["agent:survey-planner"],
  physical_bounds: {
    max_altitude_m: 120,
    permitted_boundary_id: "ranch-test-grid-a",
    battery_minimum_pct: 20
  }
};

const envelope: AuthorityEnvelope = {
  envelope_id: "ae-drone-survey-001",
  ward_id: ward.ward_id,
  subject: "agent:survey-planner",
  allowed_actions: ["drone.takeoff", "drone.scan_area", "drone.return_home"],
  denied_actions: ["drone.leave_boundary", "drone.disable_geofence"],
  constraints: {
    required_runtime_registers: ["telemetry.gps_lock"],
    max_altitude_m: 120,
    permitted_boundary_id: "ranch-test-grid-a"
  },
  expires_at: "2026-12-31T23:59:59Z",
  issuer: "aristotle-root"
};

const action: CanonicalActionInput = {
  action_id: "act-drone-takeoff-001",
  ward_id: ward.ward_id,
  subject: "agent:survey-planner",
  action_type: "drone.takeoff",
  target: "drone-swarm/unit-7",
  params: { altitude_m: 80, boundary_id: "ranch-test-grid-a", battery_pct: 87 },
  requested_at: "2026-05-21T14:00:00Z",
  request_id: "req-drone-001",
  telemetry: { gps_lock: true, wind_speed_mps: 4 }
};

const now = "2026-05-21T14:00:00.000Z";

function ledgerPath() {
  return path.join(mkdtempSync(path.join(tmpdir(), "aos-execution-control-")), "gel.jsonl");
}

test("canonical action hash is stable across equivalent key orderings", () => {
  const reordered = {
    target: action.target,
    telemetry: { wind_speed_mps: 4, gps_lock: true },
    action_type: action.action_type,
    params: { battery_pct: 87, boundary_id: "ranch-test-grid-a", altitude_m: 80 },
    request_id: action.request_id,
    requested_at: action.requested_at,
    subject: action.subject,
    ward_id: action.ward_id,
    action_id: action.action_id
  } as CanonicalActionInput;
  assert.equal(canonicalizeAction(action).canonical_action_hash, canonicalizeAction(reordered).canonical_action_hash);
});

test("allowed action produces ALLOW and issues a Warrant", () => {
  const decision = evaluateCommitGate({ ward, authorityEnvelope: envelope, action, now });
  assert.equal(decision.decision, "ALLOW");
  assert.deepEqual(decision.reason_codes, ["ALLOWED"]);
  const warrant = issueWarrant(decision, action, envelope, now);
  assert.ok(warrant);
  assert.equal(warrant.single_use, true);
});

test("denied action produces REFUSE and no Warrant", () => {
  const deniedAction = { ...action, action_type: "drone.disable_geofence" };
  const decision = evaluateCommitGate({ ward, authorityEnvelope: envelope, action: deniedAction, now });
  assert.equal(decision.decision, "REFUSE");
  assert.deepEqual(decision.reason_codes, ["ACTION_DENIED"]);
  assert.equal(issueWarrant(decision, deniedAction, envelope, now), undefined);
});

test("expired Authority Envelope produces REFUSE", () => {
  const expired = { ...envelope, expires_at: "2026-01-01T00:00:00Z" };
  const decision = evaluateCommitGate({ ward, authorityEnvelope: expired, action, now });
  assert.equal(decision.decision, "REFUSE");
  assert.deepEqual(decision.reason_codes, ["ENVELOPE_EXPIRED"]);
});

test("missing runtime state produces ESCALATE", () => {
  const missingRuntime = { ...action, telemetry: undefined };
  const decision = evaluateCommitGate({ ward, authorityEnvelope: envelope, action: missingRuntime, now });
  assert.equal(decision.decision, "ESCALATE");
  assert.deepEqual(decision.reason_codes, ["RUNTIME_STATE_MISSING"]);
});

test("physical invariant violation produces REFUSE", () => {
  const outsideBoundary = { ...action, action_type: "drone.scan_area", params: { ...action.params, boundary_id: "neighboring-grid-b" } };
  const decision = evaluateCommitGate({ ward, authorityEnvelope: envelope, action: outsideBoundary, now });
  assert.equal(decision.decision, "REFUSE");
  assert.deepEqual(decision.reason_codes, ["PHYSICAL_INVARIANT_FAILED"]);
  assert.equal(decision.physical_invariant_result?.ok, false);
});

test("Warrant cannot be consumed twice", () => {
  const decision = evaluateCommitGate({ ward, authorityEnvelope: envelope, action, now });
  const warrant = issueWarrant(decision, action, envelope, now);
  assert.ok(warrant);
  const hash = canonicalizeAction(action).canonical_action_hash;
  consumeWarrant(warrant, hash, now);
  assert.throws(() => consumeWarrant(warrant, hash, now), /WARRANT_CONSUMED/);
});

test("Warrant verification fails for mismatched action hash", () => {
  const decision = evaluateCommitGate({ ward, authorityEnvelope: envelope, action, now });
  const warrant = issueWarrant(decision, action, envelope, now);
  assert.ok(warrant);
  assert.deepEqual(verifyWarrant(warrant, "not-the-action-hash", now), { ok: false, reason: "ACTION_HASH_MISMATCH" });
});

test("GEL chain verifies after normal append", () => {
  const file = ledgerPath();
  const decision = evaluateCommitGate({ ward, authorityEnvelope: envelope, action, now });
  const warrant = issueWarrant(decision, action, envelope, now);
  appendGelRecord({ ledgerPath: file, ward, action, decision, warrant, now });
  assert.deepEqual(verifyGelChain(file), { ok: true, count: 1 });
});

test("GEL chain verification fails after tampering with prior record", () => {
  const file = ledgerPath();
  const decision = evaluateCommitGate({ ward, authorityEnvelope: envelope, action, now });
  appendGelRecord({ ledgerPath: file, ward, action, decision, warrant: issueWarrant(decision, action, envelope, now), now });
  const secondAction = { ...action, action_id: "act-drone-takeoff-002", request_id: "req-drone-002" };
  const secondDecision = evaluateCommitGate({ ward, authorityEnvelope: envelope, action: secondAction, now });
  appendGelRecord({ ledgerPath: file, ward, action: secondAction, decision: secondDecision, warrant: issueWarrant(secondDecision, secondAction, envelope, now), now });

  const records = loadGelChain(file);
  records[0].subject = "agent:tampered";
  writeFileSync(file, records.map((record) => JSON.stringify(record)).join("\n") + "\n");

  const verification = verifyGelChain(file);
  assert.equal(verification.ok, false);
  assert.match(verification.failure ?? "", /hash mismatch/);
});

test("vertical slice evaluates action, writes GEL, and verifies ledger", () => {
  const file = ledgerPath();
  const result = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: file, now });
  assert.equal(result.decision, "ALLOW");
  assert.ok(result.warrant?.warrant_id);
  assert.equal(result.ledger_verification.ok, true);
});

test("runtime server exposes health, evaluate, audit tail, and audit verify", async () => {
  const file = ledgerPath();
  const { server } = createExecutionControlRuntimeServer({ ward, authorityEnvelope: envelope, ledgerPath: file, now });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    const base = `http://127.0.0.1:${address && typeof address === "object" ? address.port : 0}`;

    const health = await fetch(`${base}/health`).then((response) => response.json());
    assert.equal(health.ok, true);
    assert.equal(health.ward_id, ward.ward_id);

    const evaluationResponse = await fetch(`${base}/v1/execution-control/evaluate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action })
    });
    assert.equal(evaluationResponse.status, 200);
    const evaluation = await evaluationResponse.json();
    assert.equal(evaluation.decision, "ALLOW");
    assert.match(evaluation.warrant.warrant_id, /^wrn-/);

    const tail = await fetch(`${base}/v1/execution-control/audit/tail`).then((response) => response.json());
    assert.equal(tail.items.length, 1);

    const verification = await fetch(`${base}/v1/execution-control/audit/verify`).then((response) => response.json());
    assert.deepEqual(verification, { ok: true, count: 1 });

    const spec = await fetch(`${base}/openapi.json`).then((response) => response.json());
    assert.equal(spec.openapi, "3.0.3");
    assert.ok(spec.paths["/v1/execution-control/evaluate"]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("client helper submits action and requires a verified Warrant", async () => {
  const file = ledgerPath();
  const { server } = createExecutionControlRuntimeServer({ ward, authorityEnvelope: envelope, ledgerPath: file, now });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const endpoint = `http://127.0.0.1:${address && typeof address === "object" ? address.port : 0}/v1/execution-control/evaluate`;
    const result = await submitGovernedAction({ endpoint, action, now });
    const warrant = requireAllowedWarrant(result);
    assert.match(warrant.warrant_id, /^wrn-/);

    const refused = await submitGovernedAction({
      endpoint,
      action: { ...action, action_type: "drone.disable_geofence" },
      now
    });
    assert.throws(() => requireAllowedWarrant(refused), /execution refused/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("OpenAPI spec describes the execution boundary", () => {
  const spec = executionControlOpenApiSpec();
  assert.equal(spec.info.title, "AristotleOS Ward/Warrant Execution-Control Path");
  assert.ok(spec.paths["/v1/execution-control/evaluate"]);
  assert.ok(spec.components.schemas.CanonicalGovernedAction);
});
