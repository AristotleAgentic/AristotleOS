/**
 * @aristotle/observability-otel — tests.
 *
 * No real @opentelemetry/api SDK required. The adapter only consumes
 * a small structural shape (OtelLikeTracer + OtelLikeSpan); we
 * validate it against a hand-rolled mock that records every call.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  type AuthorityEnvelope,
  type CanonicalActionInput,
  type WardManifest,
  LedgerStore,
  createEd25519Signer,
  evaluateExecutionControl
} from "@aristotle/execution-control-runtime";
import {
  SpanStatusCode,
  createOtelTracerAdapter,
  mapAristotleStatusToOtel,
  type OtelLikeSpan,
  type OtelLikeTracer
} from "./index.js";

interface CapturedOtelSpan {
  name: string;
  initialAttributes: Record<string, unknown>;
  attributesSetLater: Array<{ key: string; value: unknown }>;
  status: { code: number; message?: string } | null;
  ended: boolean;
}

function mockOtelTracer(): { tracer: OtelLikeTracer; spans: CapturedOtelSpan[] } {
  const spans: CapturedOtelSpan[] = [];
  const tracer: OtelLikeTracer = {
    startSpan(name, options) {
      const captured: CapturedOtelSpan = {
        name,
        initialAttributes: { ...(options?.attributes ?? {}) },
        attributesSetLater: [],
        status: null,
        ended: false
      };
      spans.push(captured);
      const span: OtelLikeSpan = {
        setAttribute(key, value) {
          captured.attributesSetLater.push({ key, value });
          return span;
        },
        setStatus(status) { captured.status = { ...status }; return span; },
        end() { captured.ended = true; }
      };
      return span;
    }
  };
  return { tracer, spans };
}

// ---------------------------------------------------------------------------
// mapAristotleStatusToOtel
// ---------------------------------------------------------------------------

test("mapAristotleStatusToOtel: ok=true -> OK code, no message", () => {
  const r = mapAristotleStatusToOtel({ ok: true });
  assert.equal(r.code, SpanStatusCode.OK);
  assert.equal(r.message, undefined);
});

test("mapAristotleStatusToOtel: ok=false -> ERROR code, message preserved", () => {
  const r = mapAristotleStatusToOtel({ ok: false, message: "something failed" });
  assert.equal(r.code, SpanStatusCode.ERROR);
  assert.equal(r.message, "something failed");
});

test("mapAristotleStatusToOtel: ok=false with no message -> ERROR + undefined message", () => {
  const r = mapAristotleStatusToOtel({ ok: false });
  assert.equal(r.code, SpanStatusCode.ERROR);
  assert.equal(r.message, undefined);
});

// ---------------------------------------------------------------------------
// createOtelTracerAdapter — unit
// ---------------------------------------------------------------------------

test("adapter: startSpan forwards initial attributes to the OTel tracer", () => {
  const { tracer, spans } = mockOtelTracer();
  const adapter = createOtelTracerAdapter(tracer);
  adapter.startSpan("test.span", { foo: "bar", n: 42 }).end();
  assert.equal(spans.length, 1);
  assert.equal(spans[0].name, "test.span");
  assert.deepEqual(spans[0].initialAttributes, { foo: "bar", n: 42 });
  assert.equal(spans[0].ended, true);
});

test("adapter: startSpan with no attributes does NOT pass an empty options object", () => {
  const seen: Array<{ name: string; options: unknown }> = [];
  const tracer: OtelLikeTracer = {
    startSpan(name, options) {
      seen.push({ name, options });
      return { setAttribute() { return this; }, setStatus() { return this; }, end() {} };
    }
  };
  const adapter = createOtelTracerAdapter(tracer);
  adapter.startSpan("no-attrs").end();
  assert.equal(seen[0].options, undefined,
    "passing no attributes must produce options=undefined (let OTel pick defaults)");
});

test("adapter: setAttribute after startSpan forwards to the OTel span", () => {
  const { tracer, spans } = mockOtelTracer();
  const adapter = createOtelTracerAdapter(tracer);
  const span = adapter.startSpan("test.span");
  span.setAttribute("late.key", "late-value");
  span.setAttribute("count", 7);
  span.end();
  assert.equal(spans[0].attributesSetLater.length, 2);
  assert.deepEqual(spans[0].attributesSetLater[0], { key: "late.key", value: "late-value" });
  assert.deepEqual(spans[0].attributesSetLater[1], { key: "count", value: 7 });
});

test("adapter: setStatus({ ok: true }) -> OTel SpanStatusCode.OK", () => {
  const { tracer, spans } = mockOtelTracer();
  const adapter = createOtelTracerAdapter(tracer);
  const span = adapter.startSpan("test.span");
  span.setStatus({ ok: true });
  span.end();
  assert.equal(spans[0].status?.code, SpanStatusCode.OK);
});

test("adapter: setStatus({ ok: false, message }) -> OTel SpanStatusCode.ERROR + message", () => {
  const { tracer, spans } = mockOtelTracer();
  const adapter = createOtelTracerAdapter(tracer);
  const span = adapter.startSpan("test.span");
  span.setStatus({ ok: false, message: "boom" });
  span.end();
  assert.equal(spans[0].status?.code, SpanStatusCode.ERROR);
  assert.equal(spans[0].status?.message, "boom");
});

test("adapter: end() forwards to the OTel span", () => {
  const { tracer, spans } = mockOtelTracer();
  const adapter = createOtelTracerAdapter(tracer);
  const span = adapter.startSpan("test.span");
  assert.equal(spans[0].ended, false);
  span.end();
  assert.equal(spans[0].ended, true);
});

// ---------------------------------------------------------------------------
// End-to-end: evaluateExecutionControl with the OTel adapter emits a span
// that lands in the mock OTel tracer with documented attributes + ok status.
// ---------------------------------------------------------------------------

const NOW = "2026-05-24T12:00:00.000Z";

const ward: WardManifest = {
  ward_id: "w-otel", name: "OTel Ward", sovereignty_context: "test",
  authority_domain: "test-ops", policy_version: "1.0.0",
  permitted_subjects: ["agent:a"]
};
const envelope: AuthorityEnvelope = {
  envelope_id: "ae-otel", ward_id: "w-otel", subject: "agent:a",
  allowed_actions: ["x.do"], denied_actions: [], constraints: {},
  expires_at: "2099-12-31T23:59:59Z", issuer: "root"
};
const action: CanonicalActionInput = {
  action_id: "a-otel", ward_id: "w-otel", subject: "agent:a",
  action_type: "x.do", target: "t", params: {},
  requested_at: NOW, request_id: "r-otel"
};

function signer() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return createEd25519Signer({
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString()
  });
}

test("e2e: evaluateExecutionControl + OTel adapter emits the documented gate span", () => {
  const { tracer, spans } = mockOtelTracer();
  const adapter = createOtelTracerAdapter(tracer);

  const result = evaluateExecutionControl({
    ward, authorityEnvelope: envelope, action,
    now: NOW, ledger: LedgerStore.memory(), ledgerPath: "unused",
    signer: signer(), replayProtection: false,
    tracer: adapter
  });
  assert.equal(result.decision, "ALLOW");
  // The substrate's documented span name + attributes land in the OTel mock.
  const gateSpan = spans.find((s) => s.name === "aristotle.execution_control.evaluate");
  assert.ok(gateSpan, "gate span must be emitted");
  assert.equal(gateSpan!.initialAttributes["aristotle.ward_id"], "w-otel");
  assert.equal(gateSpan!.initialAttributes["aristotle.action_type"], "x.do");
  assert.equal(gateSpan!.status?.code, SpanStatusCode.OK,
    "ALLOW path must set OTel span status to OK");
  assert.equal(gateSpan!.ended, true);
});

test("e2e: trace_context.trace_id is forwarded as aristotle.trace_id attribute", () => {
  const { tracer, spans } = mockOtelTracer();
  const adapter = createOtelTracerAdapter(tracer);
  const trace_context = {
    trace_id: "0123456789abcdef0123456789abcdef",
    span_id: "fedcba9876543210"
  };
  evaluateExecutionControl({
    ward, authorityEnvelope: envelope, action,
    now: NOW, ledger: LedgerStore.memory(), ledgerPath: "unused",
    signer: signer(), replayProtection: false,
    tracer: adapter, trace_context
  });
  const gateSpan = spans.find((s) => s.name === "aristotle.execution_control.evaluate");
  assert.ok(gateSpan);
  assert.equal(gateSpan!.initialAttributes["aristotle.trace_id"], trace_context.trace_id);
});
