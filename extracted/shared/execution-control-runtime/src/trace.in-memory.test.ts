/**
 * In-memory tracer + end-to-end OTel-shape span emission test.
 *
 * Closes the in-repo portion of ROADMAP_TO_100.md Category 1 "Add
 * OpenTelemetry tracing through the gate" by:
 *
 *   - Shipping a first-party reusable InMemoryTracer factory
 *     (createInMemoryTracer) so any test / local-dev wiring can
 *     capture spans without rolling its own implementation or taking
 *     an @opentelemetry/api dependency.
 *
 *   - Proving end-to-end that evaluateExecutionControl emits the spans
 *     the substrate documents, with the documented attributes.
 *
 * A bridge to a real OTel Tracer is one ~10-line adapter; the
 * trace.ts module documents the shape in createInMemoryTracer's
 * jsdoc. Shipping the adapter would force a hard
 * @opentelemetry/api dep on every consumer, which is the wrong
 * default; consumers add it themselves.
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
  createInMemoryTracer,
  evaluateExecutionControl
} from "./index.js";

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

// ---------------------------------------------------------------------------
// Tracer plumbing
// ---------------------------------------------------------------------------

test("createInMemoryTracer: starts empty, captures startSpan + attribute + status + end", () => {
  const tracer = createInMemoryTracer();
  assert.deepEqual(tracer.spans, []);
  const span = tracer.startSpan("my.span", { "my.attr": "value-1" });
  span.setAttribute("my.attr.late", 42);
  span.setStatus({ ok: true });
  span.end();
  assert.equal(tracer.spans.length, 1);
  const captured = tracer.spans[0];
  assert.equal(captured.name, "my.span");
  assert.equal(captured.attributes["my.attr"], "value-1");
  assert.equal(captured.attributes["my.attr.late"], 42);
  assert.equal(captured.status.ok, true);
  assert.equal(captured.ended, true);
});

test("createInMemoryTracer: findSpan throws on miss with a useful list of captured names", () => {
  const tracer = createInMemoryTracer();
  tracer.startSpan("a", {}).end();
  tracer.startSpan("b", {}).end();
  assert.throws(() => tracer.findSpan("missing"),
    /no captured span named 'missing'.*Captured: a, b/);
});

test("createInMemoryTracer: reset() clears captured state but keeps the tracer reusable", () => {
  const tracer = createInMemoryTracer();
  tracer.startSpan("a").end();
  assert.equal(tracer.spans.length, 1);
  tracer.reset();
  assert.equal(tracer.spans.length, 0);
  tracer.startSpan("b").end();
  assert.deepEqual(tracer.spanNames(), ["b"]);
});

// ---------------------------------------------------------------------------
// End-to-end: gate emits the documented spans
// ---------------------------------------------------------------------------

test("evaluateExecutionControl: emits aristotle.execution_control.evaluate span with ward + action attributes", () => {
  const tracer = createInMemoryTracer();
  const result = evaluateExecutionControl({
    ward, authorityEnvelope: envelope, action,
    now: NOW, ledger: LedgerStore.memory(), ledgerPath: "unused",
    signer: signer(), replayProtection: false,
    tracer
  });
  assert.equal(result.decision, "ALLOW");
  // The outermost span the gate emits is well-known.
  const span = tracer.findSpan("aristotle.execution_control.evaluate");
  assert.equal(span.attributes["aristotle.ward_id"], "w-otel");
  assert.equal(span.attributes["aristotle.action_type"], "x.do");
  assert.equal(span.status.ok, true, "ALLOW path must produce ok=true span status");
  assert.equal(span.ended, true);
});

test("evaluateExecutionControl: spans capture trace_context when provided", () => {
  const tracer = createInMemoryTracer();
  const trace_context = {
    trace_id: "0123456789abcdef0123456789abcdef",
    span_id: "fedcba9876543210"
  };
  evaluateExecutionControl({
    ward, authorityEnvelope: envelope, action,
    now: NOW, ledger: LedgerStore.memory(), ledgerPath: "unused",
    signer: signer(), replayProtection: false,
    tracer, trace_context
  });
  const span = tracer.findSpan("aristotle.execution_control.evaluate");
  assert.equal(
    span.attributes["aristotle.trace_id"],
    "0123456789abcdef0123456789abcdef"
  );
});
