import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  type AuthorityEnvelope,
  type CanonicalActionInput,
  type RuntimeRegister,
  type WardManifest,
  LedgerStore,
  createEd25519Signer,
  evaluateCommitGate,
  evaluateExecutionControl,
  evaluatePhysicalInvariants,
  missingRuntimeRegisters,
  verifyGelRecords,
  verifyWarrant
} from "./index.js";

/**
 * Property / differential verification of the Commit Gate.
 *
 * The decision function is pure and deterministic, so we can hold it to a spec.
 * An independent oracle mirrors the gate's ordered checks; we generate thousands
 * of randomized cases (deterministic, seeded) that exercise every branch and assert:
 *   - the gate's decision + reason codes EXACTLY match the oracle (differential test);
 *   - warrant present IFF decision === ALLOW;
 *   - on ALLOW the Warrant verifies and is bound to the canonical action hash;
 *   - the GEL record's decision + action hash match the result;
 *   - the signed ledger chain stays intact across every append.
 * Reproduce a failure with AOS_PROP_SEED=<n>.
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SUBJECTS = ["agent:a", "agent:b", "agent:c"];
const ACTIONS = ["drone.takeoff", "drone.scan", "drone.return", "drone.disable_geofence", "shell.exec"];
const BOUNDARIES = ["zone-a", "zone-b"];
const NOW = "2026-05-24T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);

interface Case {
  ward: WardManifest;
  envelope: AuthorityEnvelope;
  action: CanonicalActionInput;
  registers: RuntimeRegister;
}

function genCase(rand: () => number, i: number): Case {
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
  const chance = (p: number) => rand() < p;
  const subject = pick(SUBJECTS);
  const actionType = pick(ACTIONS);

  const ward: WardManifest = {
    ward_id: "ward-prop",
    name: "Property Ward",
    sovereignty_context: "test",
    authority_domain: "drone-ops",
    policy_version: "1.0.0",
    permitted_subjects: chance(0.85) ? [subject] : [pick(SUBJECTS.filter((s) => s !== subject)) ?? "agent:none"],
    physical_bounds: chance(0.6) ? { max_altitude_m: 120, permitted_boundary_id: "zone-a", battery_minimum_pct: 20 } : undefined
  };

  const requiresRegisters = chance(0.3);
  const envelope: AuthorityEnvelope = {
    envelope_id: "ae-prop",
    ward_id: chance(0.9) ? ward.ward_id : "ward-other",
    subject: chance(0.9) ? subject : (pick(SUBJECTS.filter((s) => s !== subject)) ?? "agent:none"),
    allowed_actions: chance(0.8) ? [actionType, "drone.scan"] : ["drone.return"],
    denied_actions: chance(0.2) ? [actionType] : ["drone.smuggle"],
    constraints: requiresRegisters ? { required_runtime_registers: ["telemetry.gps_lock"] } : {},
    expires_at: chance(0.85) ? "2099-12-31T23:59:59Z" : "2000-01-01T00:00:00Z",
    issuer: "root"
  };

  const action: CanonicalActionInput = {
    action_id: `act-${i}`,
    ward_id: ward.ward_id,
    subject,
    action_type: actionType,
    target: "unit-1",
    params: {
      altitude_m: chance(0.5) ? 80 : 200,
      battery_pct: chance(0.5) ? 90 : 5,
      boundary_id: pick(BOUNDARIES)
    },
    requested_at: NOW,
    request_id: `req-${i}`,
    telemetry: { gps_lock: chance(0.7) }
  };

  const registers: RuntimeRegister = {
    ...(chance(0.2) ? { policy_version: chance(0.5) ? "1.0.0" : "9.9.9" } : {})
  } as RuntimeRegister;

  return { ward, envelope, action, registers };
}

/** Independent oracle mirroring evaluateCommitGate's ordered checks. */
function oracle({ ward, envelope, action, registers }: Case): { decision: string; reason: string } {
  if (!ward.permitted_subjects.includes(action.subject)) return { decision: "REFUSE", reason: "SUBJECT_NOT_IN_WARD" };
  if (envelope.ward_id !== ward.ward_id || envelope.subject !== action.subject) return { decision: "REFUSE", reason: "ACTION_NOT_ALLOWED" };
  const pv = (registers as { policy_version?: string }).policy_version;
  if (pv && pv !== ward.policy_version) return { decision: "ESCALATE", reason: "POLICY_VERSION_MISMATCH" };
  if (Date.parse(envelope.expires_at) <= NOW_MS) return { decision: "REFUSE", reason: "ENVELOPE_EXPIRED" };
  if (missingRuntimeRegisters(envelope, action, registers).length) return { decision: "ESCALATE", reason: "RUNTIME_STATE_MISSING" };
  if (envelope.denied_actions.includes(action.action_type)) return { decision: "REFUSE", reason: "ACTION_DENIED" };
  if (!envelope.allowed_actions.includes(action.action_type)) return { decision: "REFUSE", reason: "ACTION_NOT_ALLOWED" };
  if (!evaluatePhysicalInvariants(action, ward.physical_bounds).ok) return { decision: "REFUSE", reason: "PHYSICAL_INVARIANT_FAILED" };
  return { decision: "ALLOW", reason: "ALLOWED" };
}

function signer() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return createEd25519Signer({ privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString() });
}

test("Commit Gate matches its spec oracle and upholds warrant/evidence invariants over 4000 randomized cases", () => {
  const seed = Number(process.env.AOS_PROP_SEED ?? 1337);
  const rand = mulberry32(seed);
  const s = signer();
  const ledger = LedgerStore.memory();
  const N = 4000;

  for (let i = 0; i < N; i++) {
    const c = genCase(rand, i);
    const expected = oracle(c);

    // 1. differential: pure gate decision + primary reason code match the oracle
    const pure = evaluateCommitGate({ ward: c.ward, authorityEnvelope: c.envelope, action: c.action, runtimeRegister: c.registers, now: NOW });
    assert.equal(pure.decision, expected.decision, `seed=${seed} i=${i} decision; reasons=${pure.reason_codes.join(",")}`);
    assert.ok(pure.reason_codes.includes(expected.reason), `seed=${seed} i=${i} expected reason ${expected.reason}, got ${pure.reason_codes.join(",")}`);

    // 2. determinism: identical inputs -> identical output
    const pure2 = evaluateCommitGate({ ward: c.ward, authorityEnvelope: c.envelope, action: c.action, runtimeRegister: c.registers, now: NOW });
    assert.deepEqual(pure2, pure, `seed=${seed} i=${i} non-deterministic`);

    // 3. full evaluation: warrant + GEL invariants
    const full = evaluateExecutionControl({ ward: c.ward, authorityEnvelope: c.envelope, action: c.action, runtimeRegister: c.registers, now: NOW, ledger, ledgerPath: "unused", signer: s, replayProtection: false });
    assert.equal(full.decision, expected.decision, `seed=${seed} i=${i} full decision`);
    assert.equal(Boolean(full.warrant), full.decision === "ALLOW", `seed=${seed} i=${i} warrant<->ALLOW`);
    assert.equal(full.gel_record.decision, full.decision, `seed=${seed} i=${i} gel decision`);
    assert.equal(full.gel_record.canonical_action_hash, full.canonical_action_hash, `seed=${seed} i=${i} gel hash`);
    if (full.decision === "ALLOW") {
      assert.equal(full.warrant!.canonical_action_hash, full.canonical_action_hash, `seed=${seed} i=${i} warrant hash bind`);
      assert.equal(verifyWarrant(full.warrant!, full.canonical_action_hash, NOW).ok, true, `seed=${seed} i=${i} warrant verify`);
    }
  }

  // 4. the entire signed chain produced across all appends verifies
  const chain = verifyGelRecords(ledger.records());
  assert.equal(chain.ok, true, `seed=${seed} chain failure: ${chain.failure}`);
  assert.equal(chain.count, N);
});

test("a guaranteed-clean action always ALLOWs with a verifiable warrant (sufficiency)", () => {
  const ward: WardManifest = { ward_id: "w", name: "w", sovereignty_context: "t", authority_domain: "d", policy_version: "1.0.0", permitted_subjects: ["agent:ok"] };
  const envelope: AuthorityEnvelope = { envelope_id: "ae", ward_id: "w", subject: "agent:ok", allowed_actions: ["x.do"], denied_actions: [], constraints: {}, expires_at: "2099-12-31T23:59:59Z", issuer: "root" };
  const action: CanonicalActionInput = { action_id: "a1", ward_id: "w", subject: "agent:ok", action_type: "x.do", target: "t", params: {}, requested_at: NOW, request_id: "r1" };
  const out = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, now: NOW, ledger: LedgerStore.memory(), ledgerPath: "unused", signer: signer(), replayProtection: false });
  assert.equal(out.decision, "ALLOW");
  assert.ok(out.warrant);
  assert.equal(verifyWarrant(out.warrant!, out.canonical_action_hash, NOW).ok, true);
});
