import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import {
  createEphemeralDevSigner, evaluateExecutionControl, proxyGovernedAction,
  verifyGelRecords, verifyWarrant, sha256, CredentialBroker, createExecutionControlRuntimeServer, BudgetGovernor, ApprovalStore,
  type WardManifest, type AuthorityEnvelope, type CanonicalActionInput
} from "./index.js";
import { SqliteEffectStore, effectObservationMaterial, verifyEffectEvidence, type EffectAttempt, type EffectObservation } from "./effects.js";

const now = "2026-10-06T12:00:00.000Z";
const ward: WardManifest = { ward_id: "http", name: "HTTP", sovereignty_context: "test", authority_domain: "http", policy_version: "1", permitted_subjects: ["agent:test"] };
const envelope: AuthorityEnvelope = { envelope_id: "env", ward_id: "http", subject: "agent:test", allowed_actions: ["http.post"], denied_actions: [], constraints: {}, expires_at: "2027-01-01T00:00:00Z", issuer: "root" };
const action: CanonicalActionInput = { action_id: "charge-1", ward_id: "http", subject: "agent:test", action_type: "http.post", target: "https://api.example.test/charges", params: { operation_id: "business-charge-1", body: { amount: 10 } }, requested_at: now };

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "aos-effect-"));
  const signer = createEphemeralDevSigner();
  const observer = createEphemeralDevSigner();
  const ledgerPath = path.join(dir, "admission.jsonl");
  const dbPath = path.join(dir, "effects.sqlite");
  const store = new SqliteEffectStore(dbPath, signer);
  const input = { ward, action, authorityEnvelope: envelope, now, signer, ledgerPath, effectStore: store };
  const admission = () => evaluateExecutionControl(input);
  const begin = () => { const result = admission(); return store.begin({ ward, action, warrant: result.warrant!, admission: result.gel_record, now, verify: { trustedKeyIds: [signer.key_id] } }); };
  function observation(attempt: EffectAttempt, outcome: EffectObservation["outcome"] = "CONFIRMED_EFFECT", overrides: Partial<EffectObservation> = {}): EffectObservation {
    const value: EffectObservation = {
      version: "aristotle.effect-observation.v1", observation_id: "observation-1", outcome, finality: "settled",
      operation_id: attempt.operation_id, attempt_id: attempt.attempt_id, warrant_id: attempt.warrant_id,
      authority_envelope_id: attempt.authority_envelope_id, canonical_action_hash: attempt.canonical_action_hash,
      ward_id: attempt.ward_id, subject: attempt.subject, target: attempt.target, state_fingerprint: attempt.state_fingerprint,
      observed_at: now, method: "authoritative-status", external_evidence_hash: sha256("settled receiver receipt"),
      observer_key_id: observer.key_id, signature: "", ...overrides
    };
    value.signature = observer.sign(effectObservationMaterial(value));
    return value;
  }
  const trust = { trustedObservers: { [observer.key_id]: observer.public_key_pem }, allowedMethods: ["authoritative-status"], now };
  return { dir, signer, observer, ledgerPath, dbPath, store, input, admission, begin, observation, trust };
}

test("consumption and signed pre-dispatch events persist together across connections", () => {
  const f = fixture();
  const attempt = f.begin();
  assert.equal(attempt.state, "IN_FLIGHT");
  assert.equal(attempt.consumed, true);
  const records = f.store.records();
  assert.deepEqual(records.map(r => r.effect_event?.attempt.state), ["AUTHORIZED", "IN_FLIGHT"]);
  assert.equal(verifyGelRecords(records).ok, true);
  const second = new SqliteEffectStore(f.dbPath, f.signer);
  assert.deepEqual(second.get(attempt.attempt_id), attempt);
  assert.throws(f.begin, /ALREADY_ATTEMPTED/);
  second.close(); f.store.close();
});

test("lost response persists unknown and blocks newly authorized blind redispatch", async () => {
  const f = fixture(); let effects = 0;
  const fetchImpl = (async () => { effects++; throw new Error("receiver committed; reply lost"); }) as typeof fetch;
  const first = await proxyGovernedAction({ ...f.input, fetchImpl });
  assert.equal(first.effect_state, "EFFECT_UNKNOWN");
  assert.equal(first.dispatch_status, "ATTEMPTED_UNKNOWN");
  assert.equal(first.warrant?.consumed, true);
  assert.equal(f.store.get(first.effect_attempt!.attempt_id).state, "EFFECT_UNKNOWN");
  const second = await proxyGovernedAction({ ...f.input, action: { ...action, action_id: "fresh-action-id" }, fetchImpl });
  assert.equal(second.dispatch_status, "NOT_ATTEMPTED");
  assert.match(second.error!, /ALREADY_ATTEMPTED/);
  assert.equal(effects, 1);
  f.store.close();
});

test("received HTTP success still needs business-effect evidence", async () => {
  const f = fixture();
  const result = await proxyGovernedAction({ ...f.input, fetchImpl: (async () => new Response("accepted", { status: 202 })) as typeof fetch });
  assert.equal(result.forwarded, true);
  assert.equal(result.dispatch_status, "RESPONSE_RECEIVED");
  assert.equal(result.effect_state, "EFFECT_UNKNOWN");
  const confirmed = f.store.reconcile(f.observation(result.effect_attempt!), f.trust);
  assert.equal(confirmed.state, "CONFIRMED_EFFECT");
  assert.throws(f.begin, /ALREADY_ATTEMPTED/);
  f.store.close();
});

test("response-body loss and HTTP errors do not prove no effect", async () => {
  for (const failure of ["body", "status"]) {
    const f = fixture();
    const fetchImpl = (async () => failure === "body"
      ? { text: async () => { throw new Error("body connection reset"); } }
      : new Response("server error after commit", { status: 500 })) as typeof fetch;
    const result = await proxyGovernedAction({ ...f.input, fetchImpl });
    assert.equal(result.effect_state, "EFFECT_UNKNOWN");
    f.store.close();
  }
});

test("refusal and invalid destination never reach dispatch", async () => {
  const f = fixture(); let called = 0;
  const fetchImpl = (async () => { called++; return new Response(); }) as typeof fetch;
  const refused = await proxyGovernedAction({ ...f.input, authorityEnvelope: { ...envelope, denied_actions: ["http.post"] }, fetchImpl });
  assert.equal(refused.decision, "REFUSE");
  assert.equal(refused.effect_state, "CONFIRMED_NO_EFFECT");
  const invalid = await proxyGovernedAction({ ...f.input, action: { ...action, params: { url: "https://evil.test" } }, fetchImpl });
  assert.equal(invalid.dispatch_status, "NOT_ATTEMPTED");
  assert.equal(f.store.records().length, 0);
  assert.equal(called, 0); f.store.close();
});

test("failed event signing rolls back consumption and blocks transport", async () => {
  const f = fixture();
  const bad = new SqliteEffectStore(path.join(f.dir, "bad.sqlite"), { ...f.signer, sign: () => { throw new Error("signer unavailable"); } });
  let called = 0;
  const result = await proxyGovernedAction({ ...f.input, effectStore: bad, fetchImpl: (async () => { called++; return new Response(); }) as typeof fetch });
  assert.equal(result.dispatch_status, "NOT_ATTEMPTED");
  assert.equal(bad.records().length, 0);
  assert.equal(called, 0); bad.close(); f.store.close();
});

test("concurrent proxy attempts share durable operation ownership", async () => {
  const f = fixture(); let count = 0; let finish!: () => void;
  const other = new SqliteEffectStore(f.dbPath, f.signer);
  const fetchImpl = (async () => { count++; await new Promise<void>(resolve => finish = resolve); return new Response("ok"); }) as typeof fetch;
  const pending = proxyGovernedAction({ ...f.input, fetchImpl });
  const duplicate = await proxyGovernedAction({ ...f.input, effectStore: other, fetchImpl });
  assert.equal(duplicate.dispatch_status, "NOT_ATTEMPTED");
  assert.equal(count, 1); finish(); await pending;
  other.close(); f.store.close();
});

test("reconciliation rejects forged, stale, mismatched and conflicting observations", () => {
  const f = fixture(); const attempt = f.begin(); f.store.markUnknown(attempt.attempt_id, now);
  const good = f.observation(attempt);
  assert.throws(() => f.store.reconcile({ ...good, signature: "bad" }, f.trust), /UNTRUSTED/);
  assert.throws(() => f.store.reconcile(good, { ...f.trust, trustedObservers: {} }), /UNTRUSTED/);
  for (const field of ["warrant_id", "operation_id", "target", "canonical_action_hash", "state_fingerprint", "authority_envelope_id"] as const) {
    assert.throws(() => f.store.reconcile(f.observation(attempt, "CONFIRMED_EFFECT", { [field]: "mismatch" }), f.trust), /MISMATCH/);
  }
  assert.throws(() => f.store.reconcile(f.observation(attempt, "CONFIRMED_EFFECT", { observed_at: "2026-10-01T00:00:00Z" }), f.trust), /STALE/);
  assert.throws(() => f.store.reconcile(f.observation(attempt, "CONFIRMED_EFFECT", { method: "redispatch" }), f.trust), /EVIDENCE_INVALID/);
  const confirmed = f.store.reconcile(good, f.trust);
  const count = f.store.count;
  assert.deepEqual(f.store.reconcile(good, f.trust), confirmed);
  assert.equal(f.store.count, count, "duplicate observation appends no new event");
  assert.throws(() => f.store.reconcile(f.observation(attempt, "CONFIRMED_NO_EFFECT", { observation_id: "conflict" }), f.trust), /TERMINAL_CONFLICT/);
  assert.equal(verifyGelRecords(f.store.records()).ok, true);
  const verifyOptions = { trustedLedgerKeys: { [f.signer.key_id]: f.signer.public_key_pem }, trustedObservers: f.trust.trustedObservers, allowedMethods: f.trust.allowedMethods, expectedTipHash: f.store.tipHash };
  assert.equal(verifyEffectEvidence(f.store.records(), verifyOptions).status, "PASS");
  assert.equal(verifyEffectEvidence(f.store.records(), { ...verifyOptions, expectedTipHash: undefined }).status, "INDETERMINATE");
  assert.equal(verifyEffectEvidence(f.store.records(), { ...verifyOptions, trustedObservers: {} }).status, "INDETERMINATE");
  assert.equal(verifyEffectEvidence(f.store.records(), { ...verifyOptions, expectedTipHash: "wrong" }).status, "FAIL");
  assert.equal(verifyEffectEvidence([{} as never], verifyOptions).status, "FAIL");
  assert.equal(verifyEffectEvidence(f.store.records(), { ...verifyOptions, allowedMethods: [] }).status, "FAIL");
  const tampered = structuredClone(f.store.records());
  tampered.at(-1)!.effect_event!.attempt.target = "forged-target";
  assert.equal(verifyGelRecords(tampered).ok, false); f.store.close();
});

test("no-effect reconciliation never frees the consumed Warrant", () => {
  const f = fixture(); const admitted = f.admission();
  const args = { ward, action, warrant: admitted.warrant!, admission: admitted.gel_record, now };
  const attempt = f.store.begin(args);
  assert.throws(() => f.store.reconcile(f.observation(attempt, "CONFIRMED_NO_EFFECT"), f.trust), /STILL_IN_FLIGHT/);
  f.store.markUnknown(attempt.attempt_id, now);
  f.store.reconcile(f.observation(attempt, "CONFIRMED_NO_EFFECT"), f.trust);
  assert.throws(() => f.store.begin(args), /UNIQUE/);
  const newAttempt = f.begin();
  assert.notEqual(newAttempt.warrant_id, attempt.warrant_id);
  assert.equal(newAttempt.state, "IN_FLIGHT"); f.store.close();
});

test("process exit after durable consumption cannot clear an in-flight attempt", () => {
  const f = fixture(); const admitted = f.admission();
  const inputPath = path.join(f.dir, "input.json");
  writeFileSync(inputPath, JSON.stringify({ ward, action, warrant: admitted.warrant, admission: admitted.gel_record, now }));
  const moduleUrl = new URL("./effects.ts", import.meta.url).href;
  const signingUrl = new URL("./signing.ts", import.meta.url).href;
  const code = `import { readFileSync } from 'node:fs'; import { SqliteEffectStore } from ${JSON.stringify(moduleUrl)}; import { createEphemeralDevSigner } from ${JSON.stringify(signingUrl)}; const input=JSON.parse(readFileSync(${JSON.stringify(inputPath)},'utf8')); const s=new SqliteEffectStore(${JSON.stringify(f.dbPath)},createEphemeralDevSigner(),{[input.warrant.signing_key_id]:input.warrant.signing_public_key}); s.begin(input); process.exit(73);`;
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { encoding: "utf8" });
  assert.equal(child.status, 73, child.stderr);
  assert.throws(f.begin, /ALREADY_ATTEMPTED/);
  assert.equal(f.store.records().at(-1)!.effect_event!.attempt.state, "IN_FLIGHT"); f.store.close();
});

test("HTTP redirects are not followed and broker prefix lookalikes receive no secret", async () => {
  const f = fixture(); let redirect: RequestRedirect | undefined;
  await proxyGovernedAction({ ...f.input, fetchImpl: (async (_url, init) => { redirect = init?.redirect; return new Response(null, { status: 307 }); }) as typeof fetch });
  assert.equal(redirect, "manual");
  const broker = new CredentialBroker([{ target_prefix: "https://api.example.test/charges", header: "Authorization", value: "secret" }]);
  assert.equal(broker.resolve(action).Authorization, "secret");
  for (const target of ["https://api.example.test.evil.test/charges", "https://api.example.test/charges-evil", "https://api.example.test:444/charges", "https://api.example.test@evil.test/charges"]) {
    assert.deepEqual(broker.resolve({ ...action, target }), {}, target);
  }
  f.store.close();
});

test("proxy rejects an HTTP method that differs from the admitted action class", async () => {
  const f = fixture(); let called = false;
  const result = await proxyGovernedAction({ ...f.input, action: { ...action, params: { method: "DELETE" } }, fetchImpl: (async () => { called = true; return new Response(); }) as typeof fetch });
  assert.match(result.error!, /method differs/);
  assert.equal(result.dispatch_status, "NOT_ATTEMPTED");
  assert.equal(called, false); f.store.close();
});

test("server proxy enforces configured budget, dual control, and degradation", async () => {
  for (const kind of ["budget", "approval", "degradation"] as const) {
    const f = fixture(); let hits = 0;
    const downstream = createServer((_req, res) => { hits++; res.end("ok"); });
    await new Promise<void>(resolve => downstream.listen(0, "127.0.0.1", resolve));
    const port = (downstream.address() as { port: number }).port;
    const constraints = kind === "budget" ? { budget: { windowMs: 60000, maxCallsPerWindow: 0 } }
      : kind === "approval" ? { dual_control: { required: 2, actions: ["http.post"] } } : {};
    const { server } = createExecutionControlRuntimeServer({ ward: { ...ward, criticality: "safety_critical" }, authorityEnvelope: { ...envelope, constraints }, ledgerPath: f.ledgerPath, now, signer: f.signer });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/execution-control/proxy`;
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: { ...action, target: `http://127.0.0.1:${port}/charge` }, ...(kind === "degradation" ? { degraded_conditions: ["control_plane_stale"] } : {}) }) });
      const result = await response.json();
      assert.equal(result.decision, kind === "approval" ? "ESCALATE" : "REFUSE", JSON.stringify(result));
      assert.equal(hits, 0);
    } finally {
      await Promise.all([new Promise<void>(r => server.close(() => r())), new Promise<void>(r => downstream.close(() => r()))]);
      f.store.close();
    }
  }
});

test("a redirect cannot send a request or brokered credential to a second destination", async () => {
  const f = fixture(); let escaped = 0;
  const destination = createServer((_req, res) => { escaped++; res.end("must not arrive"); });
  await new Promise<void>(r => destination.listen(0, "127.0.0.1", r));
  const redirector = createServer((_req, res) => { res.writeHead(307, { location: `http://127.0.0.1:${(destination.address() as { port: number }).port}/other` }); res.end(); });
  await new Promise<void>(r => redirector.listen(0, "127.0.0.1", r));
  try {
    const target = `http://127.0.0.1:${(redirector.address() as { port: number }).port}/charge`;
    const result = await proxyGovernedAction({ ...f.input, action: { ...action, target }, broker: new CredentialBroker([{ target_prefix: target, header: "Authorization", value: "test-secret" }]) });
    assert.equal(result.response?.status, 307);
    assert.equal(escaped, 0);
    assert.equal(result.effect_state, "EFFECT_UNKNOWN");
  } finally {
    await Promise.all([new Promise<void>(r => destination.close(() => r())), new Promise<void>(r => redirector.close(() => r()))]);
    f.store.close();
  }
});

test("invalid verification time cannot bypass a Warrant's expiry", () => {
  const f = fixture(); const admitted = f.admission();
  assert.equal(verifyWarrant(admitted.warrant!, admitted.canonical_action_hash, "invalid").reason, "WARRANT_INVALID_TIME");
  f.store.close();
});

test("execution API ignores caller-supplied backdating", async () => {
  const f = fixture();
  const { server } = createExecutionControlRuntimeServer({ ward, authorityEnvelope: { ...envelope, expires_at: "2026-10-05T00:00:00Z" }, ledgerPath: f.ledgerPath, now, signer: f.signer });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  try {
    for (const route of ["evaluate", "proxy"]) {
      const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/v1/execution-control/${route}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, now: "2026-10-01T00:00:00Z" })
      });
      const result = await response.json();
      assert.notEqual(result.decision, "ALLOW");
      assert.ok(result.reason_codes.includes("ENVELOPE_EXPIRED"), JSON.stringify(result));
    }
  } finally { await new Promise<void>(r => server.close(() => r())); f.store.close(); }
});

test("finalization failure preserves a durable non-redispatchable in-flight attempt", async () => {
  const f = fixture();
  f.store.markUnknown = () => { throw new Error("disk unavailable after dispatch"); };
  const result = await proxyGovernedAction({ ...f.input, fetchImpl: (async () => new Response("committed")) as typeof fetch });
  assert.equal(result.effect_state, "EFFECT_UNKNOWN");
  assert.equal(f.store.get(result.effect_attempt!.attempt_id).state, "IN_FLIGHT");
  const restarted = new SqliteEffectStore(f.dbPath, f.signer);
  const next = await proxyGovernedAction({ ...f.input, effectStore: restarted, fetchImpl: (async () => { throw new Error("MUST_NOT_DISPATCH"); }) as typeof fetch });
  assert.match(next.error!, /ALREADY_ATTEMPTED/);
  restarted.close(); f.store.close();
});

test("a substituted public key cannot borrow a trusted Warrant key id", () => {
  const f = fixture(); const attacker = createEphemeralDevSigner();
  const forged = evaluateExecutionControl({ ...f.input, signer: { ...attacker, key_id: f.signer.key_id } });
  assert.throws(() => f.store.begin({ ward, action, warrant: forged.warrant!, admission: forged.gel_record, now }), /KEY_UNTRUSTED/);
  assert.equal(f.store.count, 0); f.store.close();
});

test("corrupt budget and approval files cannot silently reset authority", () => {
  const f = fixture();
  for (const content of ["{broken", "{}", '{"version":"wrong","subjects":{},"requests":{}}']) {
    const file = path.join(f.dir, "state.json"); writeFileSync(file, content);
    assert.throws(() => new BudgetGovernor(file).check("agent:test", { windowMs: 1000, maxCallsPerWindow: 1 }, Date.parse(now), 0), /STATE_UNREADABLE/);
    assert.throws(() => new ApprovalStore(file).list(), /STATE_UNREADABLE/);
  }
  f.store.close();
});

test("negative and malformed costs cannot bypass an enforced budget", () => {
  const f = fixture();
  for (const cost of [-100, "100"] as const) {
    const result = evaluateExecutionControl({ ...f.input, budgetGovernor: BudgetGovernor.memory(), authorityEnvelope: { ...envelope, constraints: { budget: { windowMs: 1000, maxCostPerWindow: 10 } } }, action: { ...action, params: { cost } } });
    assert.equal(result.decision, "REFUSE");
    assert.ok(result.reason_codes.includes("BUDGET_EXCEEDED"));
  }
  assert.throws(() => evaluateExecutionControl({ ...f.input, approvalStore: ApprovalStore.memory(), authorityEnvelope: { ...envelope, constraints: { dual_control: { actions: ["http.post"], required: 0 } } } }), /POLICY_INVALID/);
  f.store.close();
});
