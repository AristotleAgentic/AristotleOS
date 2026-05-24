import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createHmac, generateKeyPairSync, sign as cryptoSign, type KeyObject } from "node:crypto";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { AsyncLedgerStore, PostgresLedgerBackend, evaluateExecutionControlAsync } from "./index.js";
import {
  type AuthorityEnvelope,
  type CanonicalActionInput,
  type WardManifest,
  CredentialBroker,
  appendGelRecord,
  canonicalizeAction,
  createEd25519Signer,
  createEphemeralDevSigner,
  createSignerFromKeyProvider,
  deriveKeyId,
  executionControlOpenApiSpec,
  createExecutionControlRuntimeServer,
  consumeWarrant,
  deliverAuditEvent,
  evaluateCommitGate,
  evaluateExecutionControl,
  exportEvidenceBundle,
  InMemoryLedgerBackend,
  issueWarrant,
  LedgerStore,
  loadGelChain,
  loadWardManifest,
  SqliteLedgerBackend,
  SubjectRateLimiter,
  proxyGovernedAction,
  requireAllowedWarrant,
  submitGovernedAction,
  validateAuthorityEnvelope,
  validateWardManifest,
  verifyEd25519,
  verifyEvidenceBundle,
  verifyGelChain,
  verifyGelRecords,
  verifyWarrant,
  type OidcConfig,
  type OperatorCredential,
  createJwksKeyStore,
  importJwks,
  jwkToOidcKey,
  maxRole,
  resolvePrincipal,
  roleSatisfies,
  verifyJwt
} from "./index.js";

function testSigner() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return createEd25519Signer({
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString()
  });
}

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

test("degraded mode: a safety-critical Ward fails closed when the ledger is unavailable", () => {
  const safetyWard = { ...ward, criticality: "safety_critical" as const };
  const decision = evaluateCommitGate({ ward: safetyWard, authorityEnvelope: envelope, action, now, degradedConditions: ["ledger_unavailable"] });
  assert.equal(decision.decision, "REFUSE");
  assert.deepEqual(decision.reason_codes, ["DEGRADED_MODE"]);
});

test("degraded mode: a routine Ward escalates infra loss instead of hard-blocking", () => {
  const routineWard = { ...ward, criticality: "routine" as const };
  const decision = evaluateCommitGate({ ward: routineWard, authorityEnvelope: envelope, action, now, degradedConditions: ["ledger_unavailable"] });
  assert.equal(decision.decision, "ESCALATE");
  assert.deepEqual(decision.reason_codes, ["DEGRADED_MODE"]);
});

test("degraded mode: a best-effort Ward proceeds (allow_degraded) under a soft timeout", () => {
  const beWard = { ...ward, criticality: "best_effort" as const };
  const decision = evaluateCommitGate({ ward: beWard, authorityEnvelope: envelope, action, now, degradedConditions: ["dependency_timeout"] });
  assert.equal(decision.decision, "ALLOW"); // allow_degraded falls through to normal evaluation
  assert.deepEqual(decision.reason_codes, ["ALLOWED"]);
});

test("degraded mode: no conditions leaves the decision unchanged; unlabeled Ward defaults closed", () => {
  assert.equal(evaluateCommitGate({ ward, authorityEnvelope: envelope, action, now, degradedConditions: [] }).decision, "ALLOW");
  // Unlabeled ward defaults to mission_critical → refuses on ledger loss.
  const d = evaluateCommitGate({ ward, authorityEnvelope: envelope, action, now, degradedConditions: ["ledger_unavailable"] });
  assert.equal(d.decision, "REFUSE");
  assert.deepEqual(d.reason_codes, ["DEGRADED_MODE"]);
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

test("Warrant carries a real Ed25519 signature, not a recomputable hash", () => {
  const signer = testSigner();
  const decision = evaluateCommitGate({ ward, authorityEnvelope: envelope, action, now });
  const warrant = issueWarrant(decision, action, envelope, now, signer);
  assert.ok(warrant);
  assert.equal(warrant.signature_algorithm, "ed25519");
  assert.equal(warrant.signing_key_id, signer.key_id);
  assert.equal(warrant.signing_public_key, signer.public_key_pem);
  // The signature is a base64 Ed25519 signature, not the legacy sha256 string.
  assert.doesNotMatch(warrant.signature, /^aristotle-execution-control-signature-/);
  assert.equal(verifyWarrant(warrant, canonicalizeAction(action).canonical_action_hash, now).ok, true);
});

test("Warrant signature cannot be forged by recomputing a hash", () => {
  const decision = evaluateCommitGate({ ward, authorityEnvelope: envelope, action, now });
  const warrant = issueWarrant(decision, action, envelope, now);
  assert.ok(warrant);
  const hash = canonicalizeAction(action).canonical_action_hash;
  // Attacker who only knows the public material cannot produce a valid signature.
  const forged = { ...warrant, signature: Buffer.from("forged-signature").toString("base64") };
  assert.deepEqual(verifyWarrant(forged, hash, now), { ok: false, reason: "SIGNATURE_MISMATCH" });
});

test("Tampering with signed Warrant material breaks verification", () => {
  const decision = evaluateCommitGate({ ward, authorityEnvelope: envelope, action, now });
  const warrant = issueWarrant(decision, action, envelope, now);
  assert.ok(warrant);
  const hash = canonicalizeAction(action).canonical_action_hash;
  const tampered = { ...warrant, expires_at: "2099-01-01T00:00:00.000Z" };
  assert.deepEqual(verifyWarrant(tampered, hash, now), { ok: false, reason: "SIGNATURE_MISMATCH" });
});

test("Warrant verification can pin a trusted signing key id", () => {
  const signer = testSigner();
  const decision = evaluateCommitGate({ ward, authorityEnvelope: envelope, action, now });
  const warrant = issueWarrant(decision, action, envelope, now, signer);
  assert.ok(warrant);
  const hash = canonicalizeAction(action).canonical_action_hash;
  assert.equal(verifyWarrant(warrant, hash, now, { trustedKeyIds: [signer.key_id] }).ok, true);
  assert.deepEqual(
    verifyWarrant(warrant, hash, now, { trustedKeyIds: ["ed25519:not-this-key"] }),
    { ok: false, reason: "UNTRUSTED_SIGNING_KEY" }
  );
});

test("configured signer is non-ephemeral and verifiable against its embedded key", () => {
  const signer = testSigner();
  assert.equal(signer.ephemeral, false);
  assert.equal(signer.key_id, deriveKeyId(signer.public_key_pem));
  const message = "canonical-message";
  assert.equal(verifyEd25519(signer.public_key_pem, message, signer.sign(message)), true);
  assert.equal(verifyEd25519(signer.public_key_pem, "different-message", signer.sign(message)), false);
});

test("ephemeral dev signer is flagged ephemeral", () => {
  assert.equal(createEphemeralDevSigner().ephemeral, true);
});

test("createSignerFromKeyProvider loads the key from a managed provider and signs", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();

  // a stand-in for a secrets manager / KMS-decrypt fetch
  let fetches = 0;
  const signer = await createSignerFromKeyProvider({
    keyId: "ed25519:managed-test",
    getPrivateKeyPem: async () => { fetches += 1; return privateKeyPem; },
    getPublicKeyPem: async () => publicKeyPem
  });

  assert.equal(fetches, 1, "key is resolved once at startup");
  assert.equal(signer.ephemeral, false);
  assert.equal(signer.key_id, "ed25519:managed-test");
  const message = "warrant-canonical-material";
  // signing is synchronous after the async load, and verifies against the embedded key
  assert.equal(verifyEd25519(signer.public_key_pem, message, signer.sign(message)), true);
  assert.equal(signer.sign(message), signer.sign(message), "signing does not re-fetch the key");
  assert.equal(fetches, 1);

  // an empty/non-PEM secret fails closed rather than producing a broken signer
  await assert.rejects(
    createSignerFromKeyProvider({ getPrivateKeyPem: async () => "" }),
    /non-PEM private key/
  );
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

test("Evidence Bundle exports Ward, Authority Envelope, Warrant, and GEL for offline verification", () => {
  const file = ledgerPath();
  const result = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: file, now });
  const bundle = exportEvidenceBundle({
    ledgerPath: file,
    ward,
    authorityEnvelope: envelope,
    recordId: result.gel_record.record_id,
    warrant: result.warrant,
    exportedAt: now
  });

  assert.equal(bundle.bundle_version, "aristotle.execution-evidence.v1");
  assert.equal(bundle.verification.ok, true);
  assert.equal(bundle.selected_record.record_id, result.gel_record.record_id);
  assert.equal(bundle.warrant?.warrant_id, result.warrant?.warrant_id);
  assert.match(bundle.hashes.bundle_hash, /^[a-f0-9]{64}$/);
  assert.deepEqual(verifyEvidenceBundle(bundle), bundle.verification);
});

test("Evidence Bundle verification fails when selected record material is altered", () => {
  const file = ledgerPath();
  const result = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: file, now });
  const bundle = exportEvidenceBundle({
    ledgerPath: file,
    ward,
    authorityEnvelope: envelope,
    recordId: result.gel_record.record_id,
    warrant: result.warrant,
    exportedAt: now
  });
  const tampered = {
    ...bundle,
    selected_record: { ...bundle.selected_record, subject: "agent:unapproved" }
  };

  const verification = verifyEvidenceBundle(tampered);
  assert.equal(verification.ok, false);
  assert.ok(verification.failures.some((failure) => failure.includes("selected GEL record")));
});

test("GEL records are Ed25519-signed when a signer is configured", () => {
  const file = ledgerPath();
  const signer = testSigner();
  evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: file, now, signer });
  const [record] = loadGelChain(file);
  assert.equal(record.signature_algorithm, "ed25519");
  assert.equal(record.signing_key_id, signer.key_id);
  assert.equal(verifyEd25519(record.signing_public_key ?? "", record.record_hash, record.signature ?? ""), true);
  assert.deepEqual(verifyGelChain(file), { ok: true, count: 1 });
});

test("GEL verification fails when a record signature is tampered", () => {
  const file = ledgerPath();
  const signer = testSigner();
  evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: file, now, signer });
  const records = loadGelChain(file);
  records[0].signature = Buffer.from("not-a-real-signature").toString("base64");
  writeFileSync(file, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
  const verification = verifyGelChain(file);
  assert.equal(verification.ok, false);
  assert.match(verification.failure ?? "", /signature invalid/);
});

test("Evidence Bundle carries a verifiable bundle-level signature", () => {
  const file = ledgerPath();
  const signer = testSigner();
  const result = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: file, now, signer });
  const bundle = exportEvidenceBundle({
    ledgerPath: file,
    ward,
    authorityEnvelope: envelope,
    recordId: result.gel_record.record_id,
    warrant: result.warrant,
    exportedAt: now,
    signer
  });
  assert.ok(bundle.bundle_signature);
  assert.equal(bundle.bundle_signature?.key_id, signer.key_id);
  assert.equal(bundle.verification.ok, true);
  assert.equal(bundle.verification.bundle_signature_ok, true);
  // Pinning the signer's key id still verifies; pinning a different key fails.
  assert.equal(verifyEvidenceBundle(bundle, { trustedKeyIds: [signer.key_id] }).ok, true);
  assert.equal(verifyEvidenceBundle(bundle, { trustedKeyIds: ["ed25519:other"] }).ok, false);
});

test("Evidence Bundle signature fails when the bundle hash is altered", () => {
  const file = ledgerPath();
  const signer = testSigner();
  const result = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: file, now, signer });
  const bundle = exportEvidenceBundle({
    ledgerPath: file,
    ward,
    authorityEnvelope: envelope,
    recordId: result.gel_record.record_id,
    warrant: result.warrant,
    exportedAt: now,
    signer
  });
  const tampered = { ...bundle, hashes: { ...bundle.hashes, bundle_hash: "0".repeat(64) } };
  const verification = verifyEvidenceBundle(tampered);
  assert.equal(verification.ok, false);
  assert.ok(verification.failures.some((failure) => failure.includes("bundle")));
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

test("kill switch refuses every action while engaged and audits the attempt", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aos-kill-"));
  const file = path.join(dir, "gel.jsonl");
  const ks = path.join(dir, "KILL_SWITCH");
  writeFileSync(ks, "engaged");
  const result = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: file, now, killSwitchPath: ks });
  assert.equal(result.decision, "REFUSE");
  assert.deepEqual(result.reason_codes, ["KILL_SWITCH_ENGAGED"]);
  assert.equal(result.warrant, undefined);
  assert.equal(loadGelChain(file).length, 1);
});

test("replay protection refuses an identical previously-admitted action", () => {
  const file = ledgerPath();
  const first = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: file, now, replayProtection: true });
  assert.equal(first.decision, "ALLOW");
  const second = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: file, now, replayProtection: true });
  assert.equal(second.decision, "REFUSE");
  assert.deepEqual(second.reason_codes, ["REPLAY_DETECTED"]);
  assert.equal(second.warrant, undefined);
});

test("server enforces an API key on /v1 routes, leaves health open, and serves metrics", async () => {
  const file = ledgerPath();
  const { server } = createExecutionControlRuntimeServer({ ward, authorityEnvelope: envelope, ledgerPath: file, now, apiKey: "secret-key" });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const base = `http://127.0.0.1:${address && typeof address === "object" ? address.port : 0}`;

    const noKey = await fetch(`${base}/v1/execution-control/evaluate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    assert.equal(noKey.status, 401);

    const withKey = await fetch(`${base}/v1/execution-control/evaluate`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer secret-key" }, body: JSON.stringify({ action }) });
    assert.equal(withKey.status, 200);

    assert.equal((await fetch(`${base}/health`)).status, 200);

    const metrics = await fetch(`${base}/v1/execution-control/metrics`, { headers: { "x-api-key": "secret-key" } }).then((r) => r.json());
    assert.equal(metrics.total_records, 1);
    assert.equal(metrics.decisions.ALLOW, 1);
    assert.equal(metrics.ledger_ok, true);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("gate refuses when the Authority Envelope is revoked", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aos-rev-"));
  const file = path.join(dir, "gel.jsonl");
  const rev = path.join(dir, "revocations.json");
  writeFileSync(rev, JSON.stringify({ revoked_envelope_ids: [envelope.envelope_id] }));
  const result = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: file, now, revocationListPath: rev });
  assert.equal(result.decision, "REFUSE");
  assert.deepEqual(result.reason_codes, ["AUTHORITY_REVOKED"]);
  assert.equal(result.warrant, undefined);
});

test("verifyWarrant rejects a warrant signed by a revoked key", () => {
  const signer = testSigner();
  const decision = evaluateCommitGate({ ward, authorityEnvelope: envelope, action, now });
  const warrant = issueWarrant(decision, action, envelope, now, signer);
  assert.ok(warrant);
  const hash = canonicalizeAction(action).canonical_action_hash;
  const revocations = { revoked_key_ids: [signer.key_id], revoked_envelope_ids: [], revoked_warrant_ids: [] };
  assert.deepEqual(verifyWarrant(warrant, hash, now, { revocations }), { ok: false, reason: "REVOKED" });
  assert.equal(verifyWarrant(warrant, hash, now).ok, true);
});

test("evidence bundle verification fails against a revocation list", () => {
  const file = ledgerPath();
  const result = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: file, now });
  assert.ok(result.warrant);
  const bundle = exportEvidenceBundle({
    ledgerPath: file,
    ward,
    authorityEnvelope: envelope,
    recordId: result.gel_record.record_id,
    warrant: result.warrant,
    exportedAt: now
  });
  const revocations = { revoked_key_ids: [], revoked_envelope_ids: [], revoked_warrant_ids: [result.warrant.warrant_id] };
  const verification = verifyEvidenceBundle(bundle, { revocations });
  assert.equal(verification.ok, false);
  assert.ok(verification.failures.some((failure) => failure.includes("REVOKED")));
});

test("validateWardManifest and validateAuthorityEnvelope flag bad config", () => {
  const wardResult = validateWardManifest({ ward_id: "", permitted_subjects: [] });
  assert.equal(wardResult.ok, false);
  assert.ok(wardResult.issues.some((i) => i.path === "ward.ward_id"));
  assert.ok(wardResult.issues.some((i) => i.path === "ward.permitted_subjects"));
  assert.equal(validateWardManifest(ward).ok, true);

  const envResult = validateAuthorityEnvelope({ envelope_id: "e", ward_id: "w", subject: "s", issuer: "i", allowed_actions: [], denied_actions: [], expires_at: "not-a-date" });
  assert.equal(envResult.ok, false);
  assert.ok(envResult.issues.some((i) => i.path === "envelope.expires_at"));
  assert.equal(validateAuthorityEnvelope(envelope).ok, true);
});

test("loadWardManifest throws a readable error on invalid config", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aos-val-"));
  const file = path.join(dir, "ward.json");
  writeFileSync(file, JSON.stringify({ name: "missing required fields" }));
  assert.throws(() => loadWardManifest(file), /Ward Manifest is invalid/);
});

test("warrant TTL is configurable", () => {
  const decision = evaluateCommitGate({ ward, authorityEnvelope: envelope, action, now });
  const warrant = issueWarrant(decision, action, envelope, now, undefined, 5);
  assert.ok(warrant);
  assert.equal(Date.parse(warrant.expires_at) - Date.parse(warrant.issued_at), 5000);
});

test("LedgerStore tracks tip/count/admitted in memory and rebuilds from disk", () => {
  const file = ledgerPath();
  const store = new LedgerStore(file);
  assert.equal(store.count, 0);
  assert.equal(typeof store.tipHash, "string");

  const decision = evaluateCommitGate({ ward, authorityEnvelope: envelope, action, now });
  const warrant = issueWarrant(decision, action, envelope, now);
  const record = store.append({ ward, action, decision, warrant, now });
  assert.equal(store.count, 1);
  assert.equal(store.tipHash, record.record_hash);
  assert.equal(store.hasPriorAdmission(record.canonical_action_hash), true);
  assert.equal(store.hasPriorAdmission("not-a-known-hash"), false);

  // A fresh store over the same file rebuilds the same index from the JSONL.
  const reopened = new LedgerStore(file);
  assert.equal(reopened.count, 1);
  assert.equal(reopened.tipHash, record.record_hash);
  assert.equal(reopened.hasPriorAdmission(record.canonical_action_hash), true);
  assert.equal(reopened.verification().ok, true);
});

test("LedgerStore works over a pluggable in-memory backend (no file)", () => {
  const store = new LedgerStore(new InMemoryLedgerBackend());
  assert.equal(store.count, 0);
  const decision = evaluateCommitGate({ ward, authorityEnvelope: envelope, action, now });
  const warrant = issueWarrant(decision, action, envelope, now);
  const record = store.append({ ward, action, decision, warrant, now });
  assert.equal(store.count, 1);
  assert.equal(store.hasPriorAdmission(record.canonical_action_hash), true);
  assert.equal(store.tail(10).length, 1);
  assert.equal(store.verification().ok, true);
  assert.equal(store.records()[0].record_hash, record.record_hash);
});

test("SqliteLedgerBackend is durable across restarts and enforces replay via SQL", () => {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), "aos-sqlite-")), "gel.db");

  const store = new LedgerStore(new SqliteLedgerBackend(dbPath));
  const decision = evaluateCommitGate({ ward, authorityEnvelope: envelope, action, now });
  const warrant = issueWarrant(decision, action, envelope, now);
  const record = store.append({ ward, action, decision, warrant, now });
  assert.equal(store.count, 1);
  assert.equal(store.hasPriorAdmission(record.canonical_action_hash), true);
  assert.equal(store.verification().ok, true);

  // Reopen the same database file in a fresh backend — state must persist.
  const reopened = new LedgerStore(new SqliteLedgerBackend(dbPath));
  assert.equal(reopened.count, 1);
  assert.equal(reopened.tipHash, record.record_hash);
  assert.equal(reopened.hasPriorAdmission(record.canonical_action_hash), true);
  assert.equal(reopened.hasPriorAdmission("unknown-hash"), false);
  assert.equal(reopened.verification().ok, true);
  assert.equal(reopened.records()[0].record_hash, record.record_hash);
});

test("evaluateExecutionControl enforces replay over a durable SQLite store", () => {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), "aos-sqlite-")), "gel.db");
  const ledger = new LedgerStore(new SqliteLedgerBackend(dbPath));
  const first = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: "unused", now, ledger, replayProtection: true });
  assert.equal(first.decision, "ALLOW");
  const second = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: "unused", now, ledger, replayProtection: true });
  assert.equal(second.decision, "REFUSE");
  assert.deepEqual(second.reason_codes, ["REPLAY_DETECTED"]);
});

test("PostgresLedgerBackend (pglite): durable, ACID, with replay shared across instances", async () => {
  const db = await PGlite.create();
  const runner = (q: { query: (t: string, p?: never) => Promise<{ rows: unknown[] }> }) => ({
    query: async (text: string, params?: unknown[]) => {
      const result = await q.query(text, params as never);
      return { rows: result.rows as Array<Record<string, unknown>> };
    }
  });
  const queryable = {
    ...runner(db),
    transaction: <T,>(fn: (tx: { query: (t: string, p?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }) => Promise<T>) =>
      db.transaction((tx) => fn(runner(tx)))
  };

  const store = new AsyncLedgerStore(await PostgresLedgerBackend.create(queryable));
  const first = await evaluateExecutionControlAsync({ ward, authorityEnvelope: envelope, action, ledgerPath: "unused", now, ledger: store, replayProtection: true });
  assert.equal(first.decision, "ALLOW");
  assert.ok(first.warrant);

  // Replay refused via the shared database.
  const second = await evaluateExecutionControlAsync({ ward, authorityEnvelope: envelope, action, ledgerPath: "unused", now, ledger: store, replayProtection: true });
  assert.equal(second.decision, "REFUSE");
  assert.deepEqual(second.reason_codes, ["REPLAY_DETECTED"]);

  // A second boundary instance over the SAME database sees the prior admission —
  // this is the shared replay state that makes horizontal availability possible.
  const store2 = new AsyncLedgerStore(await PostgresLedgerBackend.create(queryable));
  assert.equal(store2.count, 2);
  assert.equal(await store2.hasPriorAdmission(first.canonical_action_hash), true);
  assert.equal((await store2.records()).length, 2);
  assert.equal(store2.verification().ok, true);
  assert.equal((await store2.records())[0].record_hash, first.gel_record.record_hash);

  // Serialized (transaction-locked) appends keep the hash chain valid.
  for (let i = 0; i < 5; i++) {
    await evaluateExecutionControlAsync({
      ward,
      authorityEnvelope: envelope,
      action: { ...action, action_id: `act-seq-${i}`, request_id: `req-seq-${i}` },
      ledgerPath: "unused",
      now,
      ledger: store,
      replayProtection: false
    });
  }
  const chain = await store.records();
  assert.equal(verifyGelRecords(chain).ok, true, "serialized append chain must verify");

  await db.close();
});

test("SubjectRateLimiter enforces an independent per-subject budget", () => {
  const limiter = new SubjectRateLimiter(2, 0); // capacity 2, no refill
  assert.equal(limiter.allow("agent:a"), true);
  assert.equal(limiter.allow("agent:a"), true);
  assert.equal(limiter.allow("agent:a"), false);
  assert.equal(limiter.allow("agent:b"), true); // a different subject has its own bucket
});

test("server returns 429 when a subject exceeds its rate limit", async () => {
  const file = ledgerPath();
  const { server } = createExecutionControlRuntimeServer({ ward, authorityEnvelope: envelope, ledgerPath: file, now, rateLimitPerMinute: 1, replayProtection: false });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const url = `http://127.0.0.1:${address && typeof address === "object" ? address.port : 0}/v1/execution-control/evaluate`;
    const post = () => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    assert.equal((await post()).status, 200);
    assert.equal((await post()).status, 429);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("server enforces replay protection across requests via the shared ledger index", async () => {
  const file = ledgerPath();
  const { server } = createExecutionControlRuntimeServer({ ward, authorityEnvelope: envelope, ledgerPath: file, now });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const url = `http://127.0.0.1:${address && typeof address === "object" ? address.port : 0}/v1/execution-control/evaluate`;
    const post = () => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });

    const first = await post();
    assert.equal(first.status, 200);

    const second = await post();
    assert.equal(second.status, 409);
    const body = await second.json();
    assert.deepEqual(body.reason_codes, ["REPLAY_DETECTED"]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("deliverAuditEvent posts the signed record to the sink", async () => {
  let received: { decision?: string; record?: { record_hash?: string } } = {};
  const sink = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => { received = JSON.parse(Buffer.concat(chunks).toString("utf8")); res.writeHead(200); res.end("ok"); });
  });
  await new Promise<void>((resolve) => sink.listen(0, "127.0.0.1", resolve));
  const port = (sink.address() as { port: number }).port;
  try {
    const file = ledgerPath();
    const result = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: file, now });
    const delivery = await deliverAuditEvent(`http://127.0.0.1:${port}/ingest`, {
      event: "evaluate", ts: now, ward_id: ward.ward_id, subject: action.subject, action_type: action.action_type,
      decision: result.decision, reason_codes: result.reason_codes, warrant_id: result.warrant?.warrant_id,
      signing_key_id: result.warrant?.signing_key_id, record: result.gel_record
    });
    assert.equal(delivery.ok, true);
    assert.equal(received.decision, "ALLOW");
    assert.equal(received.record?.record_hash, result.gel_record.record_hash);
  } finally {
    await new Promise<void>((resolve, reject) => sink.close((error) => error ? reject(error) : resolve()));
  }
});

test("deliverAuditEvent reports failure when the sink is unreachable", async () => {
  const delivery = await deliverAuditEvent("http://127.0.0.1:1/ingest", {
    event: "evaluate", ts: now, ward_id: ward.ward_id, subject: action.subject, action_type: action.action_type,
    decision: "ALLOW", reason_codes: ["ALLOWED"], record: { record_hash: "x" } as never
  });
  assert.equal(delivery.ok, false);
  assert.ok(delivery.error);
});

test("server exposes Prometheus metrics", async () => {
  const file = ledgerPath();
  const { server } = createExecutionControlRuntimeServer({ ward, authorityEnvelope: envelope, ledgerPath: file, now });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const base = `http://127.0.0.1:${address && typeof address === "object" ? address.port : 0}`;
    await fetch(`${base}/v1/execution-control/evaluate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    const res = await fetch(`${base}/metrics`);
    assert.match(res.headers.get("content-type") ?? "", /text\/plain/);
    const body = await res.text();
    assert.match(body, /aristotle_decisions_total\{decision="ALLOW"\} 1/);
    assert.match(body, /aristotle_ledger_records 1/);
    assert.match(body, /aristotle_ledger_ok 1/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("runtime server serves the playground and context when enabled", async () => {
  const file = ledgerPath();
  const { server } = createExecutionControlRuntimeServer({ ward, authorityEnvelope: envelope, ledgerPath: file, now, servePlayground: true });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const base = `http://127.0.0.1:${address && typeof address === "object" ? address.port : 0}`;
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await page.text(), /AristotleOS/);
    const ctx = await fetch(`${base}/v1/execution-control/context`).then((r) => r.json());
    assert.equal(ctx.ward_id, ward.ward_id);
    assert.deepEqual(ctx.allowed_actions, envelope.allowed_actions);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("runtime server does not serve the playground unless enabled", async () => {
  const file = ledgerPath();
  const { server } = createExecutionControlRuntimeServer({ ward, authorityEnvelope: envelope, ledgerPath: file, now });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const base = `http://127.0.0.1:${address && typeof address === "object" ? address.port : 0}`;
    assert.equal((await fetch(`${base}/`)).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("OpenAPI spec describes the execution boundary", () => {
  const spec = executionControlOpenApiSpec();
  assert.equal(spec.info.title, "AristotleOS Ward/Warrant Execution-Control Path");
  assert.ok(spec.paths["/v1/execution-control/evaluate"]);
  assert.ok(spec.paths["/v1/execution-control/proxy"]);
  assert.ok(spec.components.schemas.CanonicalGovernedAction);
});

test("credential broker injects only matched secrets", () => {
  const broker = CredentialBroker.fromConfig(
    { rules: [{ action_type: "http.post", target_prefix: "https://api.example.com", header: "Authorization", value_env: "TEST_SECRET", scheme: "Bearer" }] },
    { TEST_SECRET: "s3cr3t" }
  );
  const matched: CanonicalActionInput = { ...action, action_type: "http.post", target: "https://api.example.com/charge", params: {} };
  assert.deepEqual(broker.describe(matched), ["Authorization"]);
  assert.deepEqual(broker.resolve(matched), { Authorization: "Bearer s3cr3t" });
  const unmatched: CanonicalActionInput = { ...matched, target: "https://elsewhere.example.org/x" };
  assert.deepEqual(broker.resolve(unmatched), {});
});

test("credential broker throws when a matched secret is missing", () => {
  const broker = CredentialBroker.fromConfig({ rules: [{ action_type: "http.post", header: "Authorization", value_env: "MISSING" }] }, {});
  assert.throws(() => broker.resolve({ ...action, action_type: "http.post" }), /missing secret/);
});

test("proxy forwards an approved action with brokered credentials and never leaks the secret", async () => {
  let seenAuth = "";
  const downstream = createServer((req, res) => {
    seenAuth = (req.headers["authorization"] as string) ?? "";
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => downstream.listen(0, "127.0.0.1", resolve));
  const downstreamPort = (downstream.address() as { port: number }).port;
  try {
    const file = ledgerPath();
    const broker = CredentialBroker.fromConfig(
      { rules: [{ action_type: "http.post", header: "Authorization", value_env: "S", scheme: "Bearer" }] },
      { S: "topsecret" }
    );
    const proxyEnvelope: AuthorityEnvelope = { ...envelope, allowed_actions: ["http.post"], denied_actions: [], constraints: {} };
    const httpAction: CanonicalActionInput = {
      ...action,
      action_type: "http.post",
      target: `http://127.0.0.1:${downstreamPort}/charge`,
      params: { url: `http://127.0.0.1:${downstreamPort}/charge`, body: { amount: 10 } }
    };
    const result = await proxyGovernedAction({ ward, authorityEnvelope: proxyEnvelope, action: httpAction, ledgerPath: file, broker, now });
    assert.equal(result.decision, "ALLOW");
    assert.equal(result.forwarded, true);
    assert.deepEqual(result.injected_headers, ["Authorization"]);
    assert.equal(result.response?.status, 200);
    assert.equal(seenAuth, "Bearer topsecret");
    assert.doesNotMatch(JSON.stringify(result), /topsecret/);
  } finally {
    await new Promise<void>((resolve, reject) => downstream.close((error) => error ? reject(error) : resolve()));
  }
});

test("proxy refuses to forward when params.url diverges from the authorized target (SSRF guard)", async () => {
  let evilHit = false;
  const evil = createServer((_req, res) => { evilHit = true; res.end("x"); });
  await new Promise<void>((resolve) => evil.listen(0, "127.0.0.1", resolve));
  const evilPort = (evil.address() as { port: number }).port;
  try {
    const file = ledgerPath();
    const proxyEnvelope: AuthorityEnvelope = { ...envelope, allowed_actions: ["http.post"], denied_actions: [], constraints: {} };
    const httpAction: CanonicalActionInput = {
      ...action,
      action_type: "http.post",
      target: "https://authorized.example.com/ok",
      params: { url: `http://127.0.0.1:${evilPort}/evil` }
    };
    const result = await proxyGovernedAction({ ward, authorityEnvelope: proxyEnvelope, action: httpAction, ledgerPath: file, now });
    assert.equal(result.decision, "ALLOW");
    assert.equal(result.forwarded, false);
    assert.match(result.error ?? "", /destination mismatch/);
    assert.equal(evilHit, false);
  } finally {
    await new Promise<void>((resolve, reject) => evil.close((error) => error ? reject(error) : resolve()));
  }
});

test("proxy refuses a denied action and never forwards", async () => {
  let called = false;
  const downstream = createServer((_req, res) => { called = true; res.end("x"); });
  await new Promise<void>((resolve) => downstream.listen(0, "127.0.0.1", resolve));
  const downstreamPort = (downstream.address() as { port: number }).port;
  try {
    const file = ledgerPath();
    const httpAction: CanonicalActionInput = {
      ...action,
      action_type: "drone.disable_geofence",
      target: `http://127.0.0.1:${downstreamPort}/x`,
      params: { url: `http://127.0.0.1:${downstreamPort}/x` }
    };
    const result = await proxyGovernedAction({ ward, authorityEnvelope: envelope, action: httpAction, ledgerPath: file, now });
    assert.equal(result.decision, "REFUSE");
    assert.equal(result.forwarded, false);
    assert.equal(result.injected_headers.length, 0);
    assert.equal(called, false);
  } finally {
    await new Promise<void>((resolve, reject) => downstream.close((error) => error ? reject(error) : resolve()));
  }
});

// ---------------------------------------------------------------------------
// Operator RBAC + OIDC attribution
// ---------------------------------------------------------------------------

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function makeJwt(header: Record<string, unknown>, payload: Record<string, unknown>, sign: (data: Buffer) => Buffer): string {
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  return `${signingInput}.${b64url(sign(Buffer.from(signingInput, "ascii")))}`;
}

function rsaKeypair() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { privateKey, publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString() };
}
function ecKeypair() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return { privateKey, publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString() };
}
function edKeypair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { privateKey, publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString() };
}
const signRs256 = (key: KeyObject) => (data: Buffer) => cryptoSign("sha256", data, key);
const signEs256 = (key: KeyObject) => (data: Buffer) => cryptoSign("sha256", data, { key, dsaEncoding: "ieee-p1363" });
const signEdDsa = (key: KeyObject) => (data: Buffer) => cryptoSign(null, data, key);

const operators: OperatorCredential[] = [
  { token: "tok-viewer", role: "viewer", subject: "obs@corp", label: "viewer-key" },
  { token: "tok-operator", role: "operator", subject: "alice@corp", label: "operator-key" },
  { token: "tok-admin", role: "admin", subject: "root@corp", label: "admin-key" }
];

function serverBase(server: ReturnType<typeof createExecutionControlRuntimeServer>["server"]): string {
  const address = server.address();
  return `http://127.0.0.1:${address && typeof address === "object" ? address.port : 0}`;
}

test("role hierarchy and static-token principal resolution", () => {
  assert.equal(roleSatisfies("admin", "operator"), true);
  assert.equal(roleSatisfies("operator", "admin"), false);
  assert.equal(roleSatisfies("viewer", "viewer"), true);
  assert.equal(maxRole(["viewer", "admin", "operator"]), "admin");
  assert.equal(maxRole([]), undefined);

  const config = { operators };
  assert.equal(resolvePrincipal(undefined, config).status, "anonymous");
  assert.equal(resolvePrincipal("nope", config).status, "rejected");
  const ok = resolvePrincipal("tok-operator", config);
  assert.equal(ok.status, "authenticated");
  if (ok.status === "authenticated") {
    assert.equal(ok.principal.subject, "alice@corp");
    assert.equal(ok.principal.role, "operator");
    assert.equal(ok.principal.auth, "token");
    assert.equal(ok.principal.key_id, "operator-key");
  }
});

test("RBAC: viewer can read but not decide; operator can decide", async () => {
  const file = ledgerPath();
  const { server } = createExecutionControlRuntimeServer({ ward, authorityEnvelope: envelope, ledgerPath: file, now, operators });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = serverBase(server);
    const evaluate = (token: string) => fetch(`${base}/v1/execution-control/evaluate`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ action }) });

    assert.equal((await fetch(`${base}/v1/execution-control/context`)).status, 401); // no creds
    assert.equal((await fetch(`${base}/v1/execution-control/context`, { headers: { authorization: "Bearer tok-viewer" } })).status, 200);

    const viewerDecide = await evaluate("tok-viewer");
    assert.equal(viewerDecide.status, 403); // viewer cannot evaluate
    assert.equal((await viewerDecide.json()).required, "operator");

    const operatorDecide = await evaluate("tok-operator");
    assert.equal(operatorDecide.status, 200);

    assert.equal((await fetch(`${base}/health`)).status, 200); // health stays open
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("operator identity is attributed in the GEL and is tamper-evident", async () => {
  const file = ledgerPath();
  const { server } = createExecutionControlRuntimeServer({ ward, authorityEnvelope: envelope, ledgerPath: file, now, operators });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = serverBase(server);
    const decided = await fetch(`${base}/v1/execution-control/evaluate`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer tok-operator" }, body: JSON.stringify({ action }) });
    assert.equal(decided.status, 200);

    const tail = await fetch(`${base}/v1/execution-control/audit/tail?limit=1`, { headers: { authorization: "Bearer tok-viewer" } }).then((r) => r.json());
    assert.equal(tail.items[0].actor.subject, "alice@corp");
    assert.equal(tail.items[0].actor.role, "operator");
    assert.equal(tail.items[0].actor.auth, "token");

    // The chain verifies as written...
    assert.equal(verifyGelChain(file).ok, true);
    // ...but tampering with the attributed actor breaks the signed hash.
    const lines = readFileSync(file, "utf8").trim().split(/\r?\n/);
    const last = JSON.parse(lines[lines.length - 1]);
    last.actor.subject = "mallory@corp";
    lines[lines.length - 1] = JSON.stringify(last);
    writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
    assert.equal(verifyGelChain(file).ok, false);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("admin-only kill switch and revocation; non-admins are refused", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aos-rbac-admin-"));
  const file = path.join(dir, "gel.jsonl");
  const killSwitchPath = path.join(dir, "HALT");
  const revocationListPath = path.join(dir, "revocations.json");
  const { server } = createExecutionControlRuntimeServer({ ward, authorityEnvelope: envelope, ledgerPath: file, now, operators, killSwitchPath, revocationListPath, replayProtection: false });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = serverBase(server);
    const evaluate = (token: string) => fetch(`${base}/v1/execution-control/evaluate`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ action }) }).then((r) => r.json());
    const kill = (token: string, engaged: boolean) => fetch(`${base}/v1/execution-control/admin/kill`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ engaged, reason: "drill" }) });

    // operator cannot engage the kill switch
    assert.equal((await kill("tok-operator", true)).status, 403);
    assert.equal((await evaluate("tok-operator")).decision, "ALLOW");

    // admin engages it -> decisions fail closed
    assert.equal((await kill("tok-admin", true)).status, 200);
    assert.deepEqual((await evaluate("tok-operator")).reason_codes, ["KILL_SWITCH_ENGAGED"]);

    // admin disengages it -> decisions resume
    assert.equal((await kill("tok-admin", false)).status, 200);
    assert.equal((await evaluate("tok-operator")).decision, "ALLOW");

    // admin revokes the envelope -> decisions fail closed
    const revoked = await fetch(`${base}/v1/execution-control/admin/revoke`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer tok-admin" }, body: JSON.stringify({ kind: "envelope", id: envelope.envelope_id, reason: "compromised" }) });
    assert.equal(revoked.status, 200);
    assert.deepEqual((await evaluate("tok-operator")).reason_codes, ["AUTHORITY_REVOKED"]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("verifyJwt accepts RS256/ES256/EdDSA and enforces iss/aud/exp", () => {
  const nowSec = 1_800_000_000;
  for (const [alg, kp, sign] of [
    ["RS256", rsaKeypair(), (k: KeyObject) => signRs256(k)],
    ["ES256", ecKeypair(), (k: KeyObject) => signEs256(k)],
    ["EdDSA", edKeypair(), (k: KeyObject) => signEdDsa(k)]
  ] as const) {
    const config: OidcConfig = { issuer: "https://idp.corp", audience: "aristotle", keys: [{ publicKeyPem: kp.publicKeyPem, alg }] };
    const claims = { sub: "u-1", iss: "https://idp.corp", aud: "aristotle", exp: nowSec + 3600, roles: ["operator"] };
    const token = makeJwt({ alg, typ: "JWT" }, claims, sign(kp.privateKey));
    const ok = verifyJwt(token, config, nowSec);
    assert.equal(ok.ok, true, `${alg} should verify`);
    if (ok.ok) assert.equal(ok.claims.sub, "u-1");

    // expired (beyond the default 60s clock-skew tolerance)
    const expired = makeJwt({ alg, typ: "JWT" }, { ...claims, exp: nowSec - 3600 }, sign(kp.privateKey));
    assert.equal(verifyJwt(expired, config, nowSec).ok, false);
    // wrong issuer
    const wrongIss = makeJwt({ alg, typ: "JWT" }, { ...claims, iss: "https://evil" }, sign(kp.privateKey));
    assert.equal(verifyJwt(wrongIss, config, nowSec).ok, false);
    // wrong audience
    const wrongAud = makeJwt({ alg, typ: "JWT" }, { ...claims, aud: "someone-else" }, sign(kp.privateKey));
    assert.equal(verifyJwt(wrongAud, config, nowSec).ok, false);
    // tampered payload (signature no longer matches)
    const [h, , s] = token.split(".");
    const tampered = `${h}.${b64url(JSON.stringify({ ...claims, sub: "attacker" }))}.${s}`;
    assert.equal(verifyJwt(tampered, config, nowSec).ok, false);
  }
});

test("verifyJwt rejects alg:none and HMAC alg-confusion", () => {
  const nowSec = 1_800_000_000;
  const kp = rsaKeypair();
  const config: OidcConfig = { issuer: "https://idp.corp", keys: [{ publicKeyPem: kp.publicKeyPem, alg: "RS256" }] };
  const claims = { sub: "u-1", iss: "https://idp.corp", exp: nowSec + 3600, roles: ["admin"] };

  // alg:none with empty signature
  const none = `${b64url(JSON.stringify({ alg: "none", typ: "JWT" }))}.${b64url(JSON.stringify(claims))}.`;
  const noneResult = verifyJwt(none, config, nowSec);
  assert.equal(noneResult.ok, false);
  if (!noneResult.ok) assert.match(noneResult.reason, /disallowed alg/);

  // alg-confusion: HS256 signed with the RSA *public* key as the HMAC secret
  const hs = makeJwt({ alg: "HS256", typ: "JWT" }, claims, (data) => createHmac("sha256", kp.publicKeyPem).update(data).digest());
  assert.equal(verifyJwt(hs, config, nowSec).ok, false);

  // unknown kid when multiple keys are configured
  const multi: OidcConfig = { issuer: "https://idp.corp", keys: [{ kid: "k1", publicKeyPem: kp.publicKeyPem, alg: "RS256" }, { kid: "k2", publicKeyPem: rsaKeypair().publicKeyPem, alg: "RS256" }] };
  const unknownKid = makeJwt({ alg: "RS256", kid: "k9", typ: "JWT" }, claims, signRs256(kp.privateKey));
  assert.equal(verifyJwt(unknownKid, multi, nowSec).ok, false);
});

test("OIDC bearer token authenticates and attributes the sub at the HTTP boundary", async () => {
  const kp = rsaKeypair();
  const oidc: OidcConfig = {
    issuer: "https://idp.corp",
    audience: "aristotle",
    keys: [{ kid: "main", publicKeyPem: kp.publicKeyPem, alg: "RS256" }],
    roleMap: { "ops-engineers": "operator" }
  };
  const file = ledgerPath();
  const { server } = createExecutionControlRuntimeServer({ ward, authorityEnvelope: envelope, ledgerPath: file, now, oidc });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = serverBase(server);
    const claims = { sub: "alice@corp", iss: "https://idp.corp", aud: "aristotle", exp: Math.floor(Date.now() / 1000) + 3600, roles: ["ops-engineers"] };
    const token = makeJwt({ alg: "RS256", kid: "main", typ: "JWT" }, claims, signRs256(kp.privateKey));

    const decided = await fetch(`${base}/v1/execution-control/evaluate`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ action }) });
    assert.equal(decided.status, 200);

    const tail = await fetch(`${base}/v1/execution-control/audit/tail?limit=1`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json());
    assert.equal(tail.items[0].actor.subject, "alice@corp");
    assert.equal(tail.items[0].actor.auth, "oidc");
    assert.equal(tail.items[0].actor.issuer, "https://idp.corp");

    // a verified token whose role does not map is forbidden (no role)
    const rolelessClaims = { ...claims, roles: ["interns"] };
    const rolelessToken = makeJwt({ alg: "RS256", kid: "main", typ: "JWT" }, rolelessClaims, signRs256(kp.privateKey));
    const forbidden = await fetch(`${base}/v1/execution-control/context`, { headers: { authorization: `Bearer ${rolelessToken}` } });
    assert.equal(forbidden.status, 403);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

function rsaJwk(kid: string, use?: string) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use };
  return { privateKey, jwk };
}

test("jwkToOidcKey + importJwks materialize verification keys from a JWKS document", () => {
  const nowSec = 1_800_000_000;
  const { privateKey, jwk } = rsaJwk("k-2024");

  // a single JWK -> OidcKey (SPKI PEM + kid/alg preserved)
  const oidcKey = jwkToOidcKey(jwk);
  assert.equal(oidcKey.kid, "k-2024");
  assert.equal(oidcKey.alg, "RS256");
  assert.match(oidcKey.publicKeyPem, /BEGIN PUBLIC KEY/);

  // a full JWKS: an encryption key (use=enc) must be filtered out of the verification set
  const { jwk: encJwk } = rsaJwk("enc-1", "enc");
  const keys = importJwks({ keys: [jwk, encJwk] });
  assert.equal(keys.length, 1, "encryption key (use=enc) is excluded from verification keys");
  assert.equal(keys[0].kid, "k-2024");

  // a token signed by the JWK's private key verifies against the imported key
  const config: OidcConfig = { issuer: "https://idp.corp", audience: "aristotle", keys };
  const claims = { sub: "u-9", iss: "https://idp.corp", aud: "aristotle", exp: nowSec + 3600, roles: ["operator"] };
  const token = makeJwt({ alg: "RS256", kid: "k-2024", typ: "JWT" }, claims, signRs256(privateKey));
  assert.equal(verifyJwt(token, config, nowSec).ok, true);
});

test("createJwksKeyStore caches, refreshes on key rotation, and fails static", async () => {
  const nowSec = 1_800_000_000;
  const a = rsaJwk("k1");
  const b = rsaJwk("k2");
  let served: { keys: unknown[] } = { keys: [a.jwk] };
  let calls = 0;
  let failNext = false;
  const fetchImpl = (async () => {
    calls += 1;
    if (failNext) throw new Error("jwks endpoint unreachable");
    return { ok: true, json: async () => served } as unknown as Response;
  }) as unknown as typeof fetch;

  const store = createJwksKeyStore({ uri: "https://idp.corp/.well-known/jwks.json", fetchImpl, ttlSec: 300 });
  const config: OidcConfig = { issuer: "https://idp.corp", audience: "aristotle", keyStore: store };
  const claimsFor = () => ({ sub: "u", iss: "https://idp.corp", aud: "aristotle", exp: nowSec + 3600, roles: ["operator"] });
  const tokenA = makeJwt({ alg: "RS256", kid: "k1", typ: "JWT" }, claimsFor(), signRs256(a.privateKey));

  // before any refresh the cache is empty -> verification fails closed (no keys)
  assert.equal(verifyJwt(tokenA, config, nowSec).ok, false);

  // the first refresh populates the cache from the JWKS endpoint
  await store.refresh();
  assert.equal(calls, 1);
  assert.equal(store.keys().length, 1);
  assert.equal(verifyJwt(tokenA, config, nowSec).ok, true);

  // a keys() read within the TTL is a cache hit (no additional fetch)
  store.keys();
  assert.equal(calls, 1);

  // key rotation: the IdP now serves k2. A k2 token misses and triggers a background refresh.
  served = { keys: [b.jwk] };
  const tokenB = makeJwt({ alg: "RS256", kid: "k2", typ: "JWT" }, claimsFor(), signRs256(b.privateKey));
  assert.equal(verifyJwt(tokenB, config, nowSec).ok, false, "unknown kid fails closed on first sight");
  await store.refresh(); // settle the rotation the verifier kicked off
  assert.equal(verifyJwt(tokenB, config, nowSec).ok, true);

  // fail-static: a failed fetch keeps the last-good cache rather than dropping all keys
  failNext = true;
  await store.refresh();
  assert.equal(store.keys().length, 1, "last-good cache retained through a failed refresh");
  assert.equal(verifyJwt(tokenB, config, nowSec).ok, true);
});

test("governance builder endpoints compile/diff/explain over the real backend, role-gated", async () => {
  const file = ledgerPath();
  const { server } = createExecutionControlRuntimeServer({ ward, authorityEnvelope: envelope, ledgerPath: file, now, operators });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = serverBase(server);
    const post = (path: string, body: unknown, token: string) =>
      fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });

    // compile — returns a real content-addressed manifest with a hash
    const compiled = await post("/v1/execution-control/governance/compile", { ward, authority_envelope: envelope }, "tok-operator");
    assert.equal(compiled.status, 200);
    const manifest = await compiled.json();
    assert.equal(manifest.manifest_version, "aristotle.governance-manifest.v1");
    assert.match(manifest.hashes.manifest_hash, /^[0-9a-f]{64}$/);
    assert.equal(manifest.validation.ok, true);

    // diff — adding an allowed action is flagged as authority-weakening
    const after = { ...envelope, allowed_actions: [...envelope.allowed_actions, "drone.deploy_payload"] };
    const diffed = await post("/v1/execution-control/governance/diff", { before: { ward, authority_envelope: envelope }, after: { ward, authority_envelope: after } }, "tok-operator");
    assert.equal(diffed.status, 200);
    const diff = await diffed.json();
    assert.equal(diff.summary.requires_review, true);
    assert.ok(diff.entries.some((e: { path: string; weakening: boolean }) => e.weakening && e.path.includes("drone.deploy_payload")));

    // explain — runs sample actions through the real Commit Gate
    const explained = await post("/v1/execution-control/governance/explain", { ward, authority_envelope: envelope, sample_actions: [action, { ...action, action_id: "act-x", action_type: "drone.disable_geofence" }] }, "tok-operator");
    assert.equal(explained.status, 200);
    const explanation = await explained.json();
    assert.equal(explanation.samples.length, 2);
    assert.equal(explanation.samples[0].decision, "ALLOW");
    assert.equal(explanation.samples[1].decision, "REFUSE");

    // role-gated: a viewer cannot author (requires operator)
    const forbidden = await post("/v1/execution-control/governance/compile", { ward, authority_envelope: envelope }, "tok-viewer");
    assert.equal(forbidden.status, 403);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("shadow/reconcile/marshal endpoints run the real engines over the boundary, role-gated", async () => {
  const file = ledgerPath();
  const { server } = createExecutionControlRuntimeServer({ ward, authorityEnvelope: envelope, ledgerPath: file, now, operators });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = serverBase(server);
    const post = (path: string, body: unknown, token: string) =>
      fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });

    // Shadow Mode — observe-only profiling against the configured Ward/Authority.
    const deniedAction = { ...action, action_id: "act-shadow-deny", action_type: "drone.disable_geofence" };
    const shadowed = await post("/v1/execution-control/shadow", { actions: [{ action }, { action: deniedAction }], now }, "tok-operator");
    assert.equal(shadowed.status, 200);
    const shadow = await shadowed.json();
    assert.equal(shadow.count, 2);
    assert.equal(shadow.decisions.ALLOW, 1);
    assert.equal(shadow.decisions.REFUSE, 1);
    assert.equal(typeof shadow.rollout.ready, "boolean");

    // Edge reconciliation — classify an offline edge decision vs current policy.
    const reconciled = await post(
      "/v1/execution-control/reconcile",
      { records: [{ action: deniedAction, edge_decision: "ALLOW", edge_policy_version: "0.0.9" }], now },
      "tok-operator"
    );
    assert.equal(reconciled.status, 200);
    const reconcile = await reconciled.json();
    assert.equal(reconcile.count, 1);
    assert.equal(reconcile.conflicts, 1);
    assert.equal(reconcile.items[0].conflict_kind, "edge_more_permissive");

    // Ward Marshal census — risk-score observed agents against the approved registry.
    const census = await post(
      "/v1/execution-control/marshal/census",
      {
        observations: [
          { observation_id: "o1", source: "mcp", observed_at: now, location: "mcp/prod", service_account: "cluster-admin-agent", tool_targets: ["shell.exec", "firewall.rules.write"], credential_refs: ["kubeconfig:prod-admin"] }
        ],
        registry: { registry_version: "t1", agents: [] },
        now
      },
      "tok-operator"
    );
    assert.equal(census.status, 200);
    const censusReport = await census.json();
    assert.equal(censusReport.summary.observed, 1);
    assert.ok(censusReport.summary.rogue >= 1);

    // Ward Marshal behavior — denial-burst detection over an event stream.
    const events = Array.from({ length: 6 }, (_, i) => ({
      event_id: `e${i}`,
      subject: "agent:probe",
      decision: "REFUSE",
      reason_codes: ["ACTION_DENIED"],
      occurred_at: new Date(Date.parse(now) + i * 10_000).toISOString()
    }));
    const behavior = await post(
      "/v1/execution-control/marshal/behavior",
      { events, config: { denialBurstThreshold: 5, windowMs: 3_600_000 }, now: new Date(Date.parse(now) + 100_000).toISOString() },
      "tok-operator"
    );
    assert.equal(behavior.status, 200);
    const behaviorReport = await behavior.json();
    assert.ok(behaviorReport.summary.findings >= 1);

    // The OpenAPI contract advertises the operator engines.
    const spec = await fetch(`${base}/openapi.json`).then((r) => r.json());
    for (const p of ["/v1/execution-control/shadow", "/v1/execution-control/reconcile", "/v1/execution-control/marshal/census", "/v1/execution-control/marshal/behavior"]) {
      assert.ok(spec.paths[p], `spec advertises ${p}`);
    }

    // Role-gated: a viewer cannot run these operator engines.
    const forbidden2 = await post("/v1/execution-control/shadow", { actions: [{ action }], now }, "tok-viewer");
    assert.equal(forbidden2.status, 403);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("conflict inbox: ingest, list, resolve over the durable store, role-gated", async () => {
  const file = ledgerPath();
  const { server } = createExecutionControlRuntimeServer({ ward, authorityEnvelope: envelope, ledgerPath: file, now, operators });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = serverBase(server);
    const post = (path: string, body: unknown, token: string) =>
      fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    const get = (path: string, token: string) =>
      fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });

    // An edge that ALLOWED an action central now denies, plus an agreement.
    const permissive = { ...action, action_id: "edge-permissive", action_type: "drone.disable_geofence" };
    const agree = { ...action, action_id: "edge-agree" };
    const ingested = await post("/v1/execution-control/conflicts/ingest", { records: [{ action: permissive, edge_decision: "ALLOW", occurred_at: now }, { action: agree, edge_decision: "ALLOW", occurred_at: now }], now }, "tok-operator");
    assert.equal(ingested.status, 200);
    const ingestBody = await ingested.json();
    assert.equal(ingestBody.report.count, 2);
    assert.equal(ingestBody.report.conflicts, 1);
    assert.equal(ingestBody.summary.open, 1);

    // Viewer can list.
    const listed = await get("/v1/execution-control/conflicts", "tok-viewer");
    assert.equal(listed.status, 200);
    const listBody = await listed.json();
    assert.equal(listBody.items.length, 2);
    assert.equal(listBody.items[0].agrees, false); // conflict ordered first

    // Operator resolves the conflict; attribution is recorded.
    const resolved = await post("/v1/execution-control/conflicts/resolve", { action_id: "edge-permissive", action: "reject", reason: "edge exceeded current authority" }, "tok-operator");
    assert.equal(resolved.status, 200);
    const resolveBody = await resolved.json();
    assert.equal(resolveBody.item.status, "rejected");
    assert.equal(resolveBody.item.resolved_by, "alice@corp");
    assert.equal(resolveBody.summary.open, 0);

    // Double resolution is refused.
    const again = await post("/v1/execution-control/conflicts/resolve", { action_id: "edge-permissive", action: "accept" }, "tok-operator");
    assert.equal(again.status, 409);

    // Invalid resolution is a 400.
    const bad = await post("/v1/execution-control/conflicts/resolve", { action_id: "edge-permissive", action: "bogus" }, "tok-operator");
    assert.equal(bad.status, 400);

    // Role-gated: a viewer cannot ingest or resolve.
    assert.equal((await post("/v1/execution-control/conflicts/ingest", { records: [] }, "tok-viewer")).status, 403);
    assert.equal((await post("/v1/execution-control/conflicts/resolve", { action_id: "edge-agree", action: "accept" }, "tok-viewer")).status, 403);

    // The OpenAPI contract advertises the inbox routes.
    const spec = await fetch(`${base}/openapi.json`).then((r) => r.json());
    for (const p of ["/v1/execution-control/conflicts", "/v1/execution-control/conflicts/ingest", "/v1/execution-control/conflicts/resolve"]) {
      assert.ok(spec.paths[p], `spec advertises ${p}`);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("evaluate endpoint honors degraded_conditions against the Ward criticality", async () => {
  const file = ledgerPath();
  const safetyWard = { ...ward, criticality: "safety_critical" as const };
  const { server } = createExecutionControlRuntimeServer({ ward: safetyWard, authorityEnvelope: envelope, ledgerPath: file, now });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = serverBase(server);
    const post = (body: unknown) => fetch(`${base}/v1/execution-control/evaluate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

    // Healthy: the action is allowed and a Warrant issues.
    const healthy = await post({ action }).then((r) => r.json());
    assert.equal(healthy.decision, "ALLOW");

    // Degraded: ledger unavailable + safety-critical ⇒ fail closed, no Warrant.
    const degraded = await post({ action: { ...action, action_id: "act-degraded" }, degraded_conditions: ["ledger_unavailable"] }).then((r) => r.json());
    assert.equal(degraded.decision, "REFUSE");
    assert.deepEqual(degraded.reason_codes, ["DEGRADED_MODE"]);
    assert.equal(degraded.warrant, undefined);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("evaluate self-detects an unavailable ledger and returns a governed degraded decision (no 500)", async () => {
  // A ledger path whose parent is a regular file ⇒ the default ledger-writability
  // probe reports ledger_unavailable. The boundary must answer with a governed
  // degraded decision, not an ungoverned 500 from a failed append.
  const dir = mkdtempSync(path.join(tmpdir(), "aos-degraded-ledger-"));
  const asFile = path.join(dir, "not-a-dir");
  writeFileSync(asFile, "i am a file");
  const badLedger = path.join(asFile, "gel.jsonl");

  const safetyWard = { ...ward, criticality: "safety_critical" as const };
  const safety = createExecutionControlRuntimeServer({ ward: safetyWard, authorityEnvelope: envelope, ledgerPath: badLedger, now });
  await new Promise<void>((resolve) => safety.server.listen(0, "127.0.0.1", resolve));
  try {
    const r = await fetch(`${serverBase(safety.server)}/v1/execution-control/evaluate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    assert.equal(r.status, 200); // governed, not a 500
    const body = await r.json();
    assert.equal(body.decision, "REFUSE");
    assert.deepEqual(body.reason_codes, ["DEGRADED_MODE"]);
    assert.equal(body.degraded, true);
    assert.equal(body.anchored, false);
  } finally {
    await new Promise<void>((resolve, reject) => safety.server.close((error) => error ? reject(error) : resolve()));
  }

  // A best-effort Ward admits the action in a marked, unanchored degraded posture.
  const beWard = { ...ward, criticality: "best_effort" as const };
  const be = createExecutionControlRuntimeServer({ ward: beWard, authorityEnvelope: envelope, ledgerPath: badLedger, now });
  await new Promise<void>((resolve) => be.server.listen(0, "127.0.0.1", resolve));
  try {
    const body = await fetch(`${serverBase(be.server)}/v1/execution-control/evaluate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) }).then((r) => r.json());
    assert.equal(body.decision, "ALLOW");
    assert.equal(body.degraded, true);
    assert.equal(body.anchored, false);
  } finally {
    await new Promise<void>((resolve, reject) => be.server.close((error) => error ? reject(error) : resolve()));
  }
});

test("GET /degradation reports live health and the projected fail action", async () => {
  // Healthy file ledger → no conditions, fail_action allow.
  const healthy = createExecutionControlRuntimeServer({ ward, authorityEnvelope: envelope, ledgerPath: ledgerPath(), now });
  await new Promise<void>((resolve) => healthy.server.listen(0, "127.0.0.1", resolve));
  try {
    const body = await fetch(`${serverBase(healthy.server)}/v1/execution-control/degradation`).then((r) => r.json());
    assert.equal(body.healthy, true);
    assert.deepEqual(body.conditions, []);
    assert.equal(body.fail_action, "allow");
    assert.equal(body.ward_id, ward.ward_id);
  } finally {
    await new Promise<void>((resolve, reject) => healthy.server.close((error) => error ? reject(error) : resolve()));
  }

  // Unwritable ledger → ledger_unavailable; mission-critical default ⇒ fail_action refuse.
  const dir = mkdtempSync(path.join(tmpdir(), "aos-degr-health-"));
  const asFile = path.join(dir, "not-a-dir");
  writeFileSync(asFile, "file");
  const degraded = createExecutionControlRuntimeServer({ ward, authorityEnvelope: envelope, ledgerPath: path.join(asFile, "gel.jsonl"), now });
  await new Promise<void>((resolve) => degraded.server.listen(0, "127.0.0.1", resolve));
  try {
    const body = await fetch(`${serverBase(degraded.server)}/v1/execution-control/degradation`).then((r) => r.json());
    assert.equal(body.healthy, false);
    assert.deepEqual(body.conditions, ["ledger_unavailable"]);
    assert.equal(body.fail_action, "refuse");
    assert.equal(body.binding_condition, "ledger_unavailable");
  } finally {
    await new Promise<void>((resolve, reject) => degraded.server.close((error) => error ? reject(error) : resolve()));
  }
});
