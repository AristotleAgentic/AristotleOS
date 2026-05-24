import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type AuthorityEnvelope,
  type CanonicalActionInput,
  type WardManifest,
  CredentialBroker,
  appendGelRecord,
  canonicalizeAction,
  createEd25519Signer,
  createEphemeralDevSigner,
  deriveKeyId,
  executionControlOpenApiSpec,
  createExecutionControlRuntimeServer,
  consumeWarrant,
  evaluateCommitGate,
  evaluateExecutionControl,
  exportEvidenceBundle,
  issueWarrant,
  loadGelChain,
  proxyGovernedAction,
  requireAllowedWarrant,
  submitGovernedAction,
  verifyEd25519,
  verifyEvidenceBundle,
  verifyGelChain,
  verifyWarrant
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
