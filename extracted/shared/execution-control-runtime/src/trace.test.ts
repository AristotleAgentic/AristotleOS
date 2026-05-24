import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  type AristotleSpan,
  type AristotleTracer,
  type AuthorityEnvelope,
  type CanonicalActionInput,
  type SpanAttributeValue,
  type TraceContext,
  type WardManifest,
  LedgerStore,
  RuntimeMetrics,
  createEd25519Signer,
  createExecutionControlRuntimeServer,
  evaluateExecutionControl,
  formatTraceparent,
  newTraceContext,
  normalizeTraceContext,
  parseTraceparent,
  verifyGelRecords
} from "./index.js";

function testSigner() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return createEd25519Signer({
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString()
  });
}

const ward: WardManifest = {
  ward_id: "trace-ward", name: "Trace Ward", sovereignty_context: "test",
  authority_domain: "ops", policy_version: "0.1.0", permitted_subjects: ["agent:t"]
};
const envelope: AuthorityEnvelope = {
  envelope_id: "ae-trace-001", ward_id: "trace-ward", subject: "agent:t",
  allowed_actions: ["do.thing"], denied_actions: [], constraints: {},
  expires_at: "2099-12-31T23:59:59Z", issuer: "root"
};
function action(requestId: string): CanonicalActionInput {
  return { action_id: `act-${requestId}`, ward_id: "trace-ward", subject: "agent:t", action_type: "do.thing", target: "x", params: {}, requested_at: "2026-05-23T12:00:00.000Z", request_id: requestId };
}

class RecordingTracer implements AristotleTracer {
  spans: Array<{ name: string; attributes: Record<string, SpanAttributeValue>; ok?: boolean }> = [];
  startSpan(name: string, attributes?: Record<string, SpanAttributeValue>): AristotleSpan {
    const entry = { name, attributes: { ...(attributes ?? {}) } as Record<string, SpanAttributeValue>, ok: undefined as boolean | undefined };
    this.spans.push(entry);
    return {
      setAttribute: (k, v) => { entry.attributes[k] = v; },
      setStatus: (s) => { entry.ok = s.ok; },
      end: () => { /* no-op */ }
    };
  }
}

test("W3C traceparent parses, normalizes, and round-trips", () => {
  const tp = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
  const ctx = parseTraceparent(tp);
  assert.equal(ctx?.trace_id, "0af7651916cd43dd8448eb211c80319c");
  assert.equal(ctx?.span_id, "b7ad6b7169203331");
  assert.equal(formatTraceparent(ctx!), tp);

  assert.equal(parseTraceparent("garbage"), undefined);
  assert.equal(parseTraceparent("00-" + "0".repeat(32) + "-b7ad6b7169203331-01"), undefined); // all-zero trace id
  assert.equal(normalizeTraceContext({ trace_id: "nothex" }), undefined);
  const minted = newTraceContext();
  assert.match(minted.trace_id, /^[0-9a-f]{32}$/);
});

test("trace context + request id are stamped into the signed GEL record", () => {
  const ledger = LedgerStore.memory();
  const trace: TraceContext = { trace_id: "a".repeat(32), span_id: "b".repeat(16), trace_flags: "01" };
  const result = evaluateExecutionControl({
    ward, authorityEnvelope: envelope, action: action("req-xyz"),
    ledgerPath: "unused", ledger, signer: testSigner(), trace_context: trace
  });
  assert.equal(result.gel_record.trace_context?.trace_id, "a".repeat(32));
  assert.equal(result.gel_record.request_id, "req-xyz");
  // The trace context and request id are part of the signed, hash-chained material.
  assert.equal(verifyGelRecords([result.gel_record]).ok, true);
  const tampered = { ...result.gel_record, trace_context: { trace_id: "c".repeat(32) } };
  assert.equal(verifyGelRecords([tampered]).ok, false);
});

test("an injected tracer receives spans for the decision phases", () => {
  const tracer = new RecordingTracer();
  const trace: TraceContext = { trace_id: "d".repeat(32) };
  evaluateExecutionControl({
    ward, authorityEnvelope: envelope, action: action("req-span"),
    ledgerPath: "unused", ledger: LedgerStore.memory(), signer: testSigner(), tracer, trace_context: trace
  });
  const names = tracer.spans.map((s) => s.name);
  assert.ok(names.includes("aristotle.execution_control.evaluate"));
  assert.ok(names.includes("aristotle.canonicalize"));
  assert.ok(names.includes("aristotle.commit_gate.decide"));
  assert.ok(names.includes("aristotle.gel.append"));
  const parent = tracer.spans.find((s) => s.name === "aristotle.execution_control.evaluate")!;
  assert.equal(parent.attributes["aristotle.trace_id"], "d".repeat(32));
  assert.equal(parent.attributes["aristotle.decision"], "ALLOW");
  assert.equal(parent.ok, true);
});

test("RuntimeMetrics counts decisions, reason codes, replay, and latency", () => {
  const m = new RuntimeMetrics();
  m.recordDecision("ALLOW", ["ALLOWED"], 7, true);
  m.recordDecision("REFUSE", ["REPLAY_DETECTED"], 3, false);
  m.recordWarrantFailure();
  const snap = m.snapshot();
  assert.equal(snap.decisions.ALLOW, 1);
  assert.equal(snap.decisions.REFUSE, 1);
  assert.equal(snap.reason_codes.REPLAY_DETECTED, 1);
  assert.equal(snap.replay_refusals, 1);
  assert.equal(snap.warrants_issued, 1);
  assert.equal(snap.warrant_failures, 1);
  assert.equal(snap.decision_latency_ms.count, 2);
  const prom = m.prometheus().join("\n");
  assert.match(prom, /aristotle_decision_latency_ms_bucket\{le="10"\} 2/);
  assert.match(prom, /aristotle_replay_refusals_total 1/);
});

test("HTTP: traceparent header propagates to the GEL and /metrics exposes the histogram", async () => {
  const file = `unused-${Date.now()}`; // overridden by an in-memory ledger
  const { server } = createExecutionControlRuntimeServer({
    ward, authorityEnvelope: envelope, ledgerPath: file, signer: testSigner(), ledger: LedgerStore.memory()
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const addr = server.address();
    const base = `http://127.0.0.1:${addr && typeof addr === "object" ? addr.port : 0}`;
    const traceparent = "00-11111111111111111111111111111111-2222222222222222-01";
    const decided = await fetch(`${base}/v1/execution-control/evaluate`, {
      method: "POST", headers: { "content-type": "application/json", traceparent }, body: JSON.stringify({ action: action("http-trace-1") })
    });
    assert.equal(decided.status, 200);

    const tail = await fetch(`${base}/v1/execution-control/audit/tail?limit=1`).then((r) => r.json());
    assert.equal(tail.items[0].trace_context.trace_id, "11111111111111111111111111111111");
    assert.equal(tail.items[0].request_id, "http-trace-1");

    const prom = await fetch(`${base}/metrics`).then((r) => r.text());
    assert.match(prom, /aristotle_decision_latency_ms_count 1/);
    assert.match(prom, /aristotle_reason_codes_total\{reason_code="ALLOWED"\} 1/);

    const jsonMetrics = await fetch(`${base}/v1/execution-control/metrics`).then((r) => r.json());
    assert.equal(jsonMetrics.runtime.decisions.ALLOW, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve()));
  }
});
