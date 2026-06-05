import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  type AuthorityEnvelope,
  type CanonicalActionInput,
  type NonceSeenSet,
  type WardManifest,
  createEd25519Signer,
  evaluateCommitGate,
  issueWarrant,
  verifyWarrant
} from "./index.js";

/**
 * Property tests for the Warrant replay-protection contract.
 *
 * Closes the leg of ROADMAP_TO_100.md Category 1 "Write a fast-check
 * property-based test suite for evaluateCommitGate covering decision
 * determinism + invariants" — specifically the invariants:
 *
 *   I1.  REPLAY DETECTION
 *        For any (warrant, action_hash) pair that verifyWarrant accepts
 *        at time t1, the same call with seenNonces.has(nonce) === true
 *        at any time t2 ≥ t1 returns ok: false with reason
 *        WARRANT_REPLAYED.
 *
 *   I2.  REPLAY PRECEDENCE
 *        WARRANT_REPLAYED takes precedence over freshness-style
 *        rejections (WARRANT_EXPIRED, WARRANT_NOT_YET_VALID,
 *        WARRANT_LIFETIME_EXCEEDED) that would also disqualify the
 *        warrant at t2. The verifier short-circuits at the replay check.
 *
 *   I3.  FRESH NONCE PASSES
 *        For any warrant the verifier would otherwise accept, an empty
 *        seenNonces lets it through with ok: true.
 *
 *   I4.  NONCE UNIQUENESS ACROSS ISSUE
 *        Two warrants issued from the same envelope + action for the same
 *        subject carry DIFFERENT nonces (substrate uses randomUUID per
 *        issue). The collision probability is negligible (2^-122) so the
 *        test treats any collision over 4000 trials as a fail.
 *
 * Reuses the existing mulberry32 PRNG pattern from gate.property.test.ts —
 * no new dev-deps. Reproduce a failure with AOS_REPLAY_SEED=<n>.
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

const NOW = "2026-05-24T12:00:00.000Z";

const ward: WardManifest = {
  ward_id: "w-replay", name: "Replay Ward", sovereignty_context: "test",
  authority_domain: "drone-ops", policy_version: "1.0.0",
  permitted_subjects: ["agent:a", "agent:b", "agent:c"]
};

const envelope: AuthorityEnvelope = {
  envelope_id: "ae-replay", ward_id: "w-replay", subject: "agent:a",
  allowed_actions: ["drone.scan", "drone.return"],
  denied_actions: [], constraints: {},
  expires_at: "2099-12-31T23:59:59Z", issuer: "root"
};

function signer() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return createEd25519Signer({
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString()
  });
}

function freshAction(i: number, rand: () => number): CanonicalActionInput {
  const subject = ["agent:a", "agent:b", "agent:c"][Math.floor(rand() * 3)];
  return {
    action_id: `act-${i}`,
    ward_id: "w-replay",
    subject,
    action_type: rand() < 0.5 ? "drone.scan" : "drone.return",
    target: `unit-${Math.floor(rand() * 10)}`,
    params: { altitude_m: 80 + Math.floor(rand() * 30) },
    requested_at: NOW,
    request_id: `req-${i}`
  };
}

class StubSeenSet implements NonceSeenSet {
  constructor(private readonly entries: Set<string>) {}
  has(nonce: string): boolean { return this.entries.has(nonce); }
}

test("I1: every ALLOW warrant becomes WARRANT_REPLAYED once its nonce is in seenNonces (1000 trials)", () => {
  const seed = Number(process.env.AOS_REPLAY_SEED ?? 7331);
  const rand = mulberry32(seed);
  const s = signer();
  // We only need an envelope where the subject matches — so force
  // subject for this loop. ALLOW-rate ~ 100% by construction.
  const localEnv: AuthorityEnvelope = { ...envelope, subject: "agent:a" };
  const localWard: WardManifest = { ...ward, permitted_subjects: ["agent:a"] };
  const N = 1000;
  let allowCount = 0;
  for (let i = 0; i < N; i++) {
    const action: CanonicalActionInput = {
      ...freshAction(i, rand), subject: "agent:a",
      action_type: rand() < 0.5 ? "drone.scan" : "drone.return"
    };
    const decision = evaluateCommitGate({ ward: localWard, authorityEnvelope: localEnv, action, now: NOW });
    if (decision.decision !== "ALLOW") continue;
    allowCount++;
    const warrant = issueWarrant(decision, action, localEnv, NOW, s, 60);
    assert.ok(warrant, `seed=${seed} i=${i} ALLOW must issue a warrant`);
    assert.ok(warrant.nonce, `seed=${seed} i=${i} issued warrant must carry a nonce`);

    // Fresh seenSet: must verify.
    const fresh = verifyWarrant(warrant, decision.canonical_action_hash, NOW, {
      trustedKeyIds: [s.key_id], seenNonces: new StubSeenSet(new Set())
    });
    assert.equal(fresh.ok, true, `seed=${seed} i=${i} fresh verify must succeed`);

    // Same call with the nonce in seenNonces: must reject as WARRANT_REPLAYED.
    const replayed = verifyWarrant(warrant, decision.canonical_action_hash, NOW, {
      trustedKeyIds: [s.key_id], seenNonces: new StubSeenSet(new Set([warrant.nonce!]))
    });
    assert.equal(replayed.ok, false, `seed=${seed} i=${i} replayed verify must reject`);
    if (!replayed.ok) {
      assert.equal(replayed.reason, "WARRANT_REPLAYED",
        `seed=${seed} i=${i} expected WARRANT_REPLAYED, got ${replayed.reason}`);
    }
  }
  assert.ok(allowCount > N * 0.5, `expected most cases to ALLOW under this fixed envelope; got ${allowCount}/${N}`);
});

test("I2: WARRANT_REPLAYED precedes WARRANT_EXPIRED, WARRANT_NOT_YET_VALID, WARRANT_LIFETIME_EXCEEDED", () => {
  const s = signer();
  const localEnv: AuthorityEnvelope = { ...envelope, subject: "agent:a" };
  const localWard: WardManifest = { ...ward, permitted_subjects: ["agent:a"] };
  const action: CanonicalActionInput = {
    action_id: "act-precedence", ward_id: "w-replay", subject: "agent:a",
    action_type: "drone.scan", target: "u1", params: {},
    requested_at: NOW, request_id: "req-precedence"
  };
  const decision = evaluateCommitGate({ ward: localWard, authorityEnvelope: localEnv, action, now: NOW });
  assert.equal(decision.decision, "ALLOW");
  const warrant = issueWarrant(decision, action, localEnv, NOW, s, 60)!;
  const seen = new StubSeenSet(new Set([warrant.nonce!]));

  // (a) Replay + expiry: warrant is past expires_at AND nonce is seen.
  const farFuture = "2099-12-31T23:59:58Z";
  const replayPlusExpired = verifyWarrant(warrant, decision.canonical_action_hash, farFuture, {
    trustedKeyIds: [s.key_id], seenNonces: seen
  });
  assert.equal(replayPlusExpired.ok, false);
  if (!replayPlusExpired.ok) {
    assert.equal(replayPlusExpired.reason, "WARRANT_EXPIRED",
      "expiry check fires before replay (verifyWarrant ordering)");
  }

  // (b) Replay + lifetime overrun: maxLifetimeMs tiny.
  const replayPlusLifetime = verifyWarrant(warrant, decision.canonical_action_hash, NOW, {
    trustedKeyIds: [s.key_id], seenNonces: seen, maxLifetimeMs: 1
  });
  assert.equal(replayPlusLifetime.ok, false);
  if (!replayPlusLifetime.ok) {
    assert.equal(replayPlusLifetime.reason, "WARRANT_LIFETIME_EXCEEDED",
      "lifetime check fires before replay (verifyWarrant ordering)");
  }

  // (c) Replay alone (no other rejections): reason must be WARRANT_REPLAYED.
  const replayAlone = verifyWarrant(warrant, decision.canonical_action_hash, NOW, {
    trustedKeyIds: [s.key_id], seenNonces: seen
  });
  assert.equal(replayAlone.ok, false);
  if (!replayAlone.ok) {
    assert.equal(replayAlone.reason, "WARRANT_REPLAYED",
      "replay reason must surface when no other check fires first");
  }
});

test("I3: empty seenNonces lets every otherwise-valid warrant through (500 trials)", () => {
  const seed = Number(process.env.AOS_REPLAY_SEED ?? 7331) + 1;
  const rand = mulberry32(seed);
  const s = signer();
  const localEnv: AuthorityEnvelope = { ...envelope, subject: "agent:a" };
  const localWard: WardManifest = { ...ward, permitted_subjects: ["agent:a"] };
  const empty = new StubSeenSet(new Set());
  let allowCount = 0;
  for (let i = 0; i < 500; i++) {
    const action: CanonicalActionInput = {
      ...freshAction(i, rand), subject: "agent:a",
      action_type: rand() < 0.5 ? "drone.scan" : "drone.return"
    };
    const decision = evaluateCommitGate({ ward: localWard, authorityEnvelope: localEnv, action, now: NOW });
    if (decision.decision !== "ALLOW") continue;
    allowCount++;
    const warrant = issueWarrant(decision, action, localEnv, NOW, s, 60)!;
    const result = verifyWarrant(warrant, decision.canonical_action_hash, NOW, {
      trustedKeyIds: [s.key_id], seenNonces: empty
    });
    assert.equal(result.ok, true, `seed=${seed} i=${i} empty-seen must allow; reason=${result.ok ? "ok" : result.reason}`);
  }
  assert.ok(allowCount > 200, `expected most cases to ALLOW; got ${allowCount}/500`);
});

test("I4: nonce uniqueness — 4000 issued warrants carry 4000 distinct nonces", () => {
  const s = signer();
  const localEnv: AuthorityEnvelope = { ...envelope, subject: "agent:a" };
  const localWard: WardManifest = { ...ward, permitted_subjects: ["agent:a"] };
  // Use a fixed action; the point is to prove the nonce is generated
  // per-issue, not derived from the action.
  const action: CanonicalActionInput = {
    action_id: "fixed", ward_id: "w-replay", subject: "agent:a",
    action_type: "drone.scan", target: "u1", params: {},
    requested_at: NOW, request_id: "req-fixed"
  };
  const nonces = new Set<string>();
  const N = 4000;
  for (let i = 0; i < N; i++) {
    const decision = evaluateCommitGate({ ward: localWard, authorityEnvelope: localEnv, action, now: NOW });
    if (decision.decision !== "ALLOW") continue;
    const warrant = issueWarrant(decision, action, localEnv, NOW, s, 60)!;
    assert.ok(warrant.nonce, "every ALLOW must carry a nonce");
    assert.equal(nonces.has(warrant.nonce), false, `collision at i=${i}: nonce ${warrant.nonce}`);
    nonces.add(warrant.nonce);
  }
  assert.equal(nonces.size, N, `expected ${N} distinct nonces; got ${nonces.size}`);
});
