import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  EventBus,
  WebhookDispatcher,
  attachSseHandler,
  eventMatches,
  makeEvent,
  EVENT_FORMAT,
  type ExecutionControlEvent,
  type SseResponse
} from "./index.js";

test("makeEvent: defaults format, event_id, emitted_at", () => {
  const e = makeEvent({ event_type: "decision.allow", subject: "agent:a", action_type: "x.do" });
  assert.equal(e.format, EVENT_FORMAT);
  assert.equal(e.event_type, "decision.allow");
  assert.ok(e.event_id.startsWith("evt-"));
  assert.ok(e.emitted_at);
});

test("eventMatches: filter by event_type", () => {
  const e = makeEvent({ event_type: "decision.allow" });
  assert.equal(eventMatches(e, { event_types: ["decision.allow"] }), true);
  assert.equal(eventMatches(e, { event_types: ["decision.refuse"] }), false);
});

test("eventMatches: filter by action_type_prefix and subject_prefix", () => {
  const e = makeEvent({ event_type: "decision.allow", action_type: "ot.modbus.write_single_register", subject: "agent:scada-controller" });
  assert.equal(eventMatches(e, { action_type_prefix: "ot.modbus." }), true);
  assert.equal(eventMatches(e, { action_type_prefix: "k8s." }), false);
  assert.equal(eventMatches(e, { subject_prefix: "agent:scada" }), true);
  assert.equal(eventMatches(e, { subject_prefix: "agent:uav" }), false);
});

test("EventBus: subscribers receive matching events; unsubscribe stops delivery", async () => {
  const bus = new EventBus();
  const received: ExecutionControlEvent[] = [];
  const off = bus.subscribe((e) => { received.push(e); });
  await bus.publish(makeEvent({ event_type: "decision.allow" }));
  await bus.publish(makeEvent({ event_type: "decision.refuse" }));
  assert.equal(received.length, 2);
  off();
  await bus.publish(makeEvent({ event_type: "decision.allow" }));
  assert.equal(received.length, 2);
});

test("EventBus: filter restricts delivery", async () => {
  const bus = new EventBus();
  const received: ExecutionControlEvent[] = [];
  bus.subscribe((e) => { received.push(e); }, { event_types: ["decision.refuse"] });
  await bus.publish(makeEvent({ event_type: "decision.allow" }));
  await bus.publish(makeEvent({ event_type: "decision.refuse" }));
  assert.equal(received.length, 1);
  assert.equal(received[0].event_type, "decision.refuse");
});

test("EventBus: a throwing subscriber doesn't poison the bus", async () => {
  const bus = new EventBus();
  let okReceived = 0;
  bus.subscribe(() => { throw new Error("bad"); });
  bus.subscribe(() => { okReceived++; });
  const r = await bus.publish(makeEvent({ event_type: "decision.allow" }));
  assert.equal(r.delivered, 1);
  assert.equal(r.failed, 1);
  assert.equal(okReceived, 1);
});

test("WebhookDispatcher: ALLOW path POSTs with HMAC signature header", async () => {
  const seen: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
  const fn = (async (url: string, init?: { headers?: Record<string, string>; body?: string }) => {
    seen.push({ url, body: init?.body ?? "", headers: init?.headers ?? {} });
    return { status: 200, ok: true, async text() { return ""; } };
  }) as unknown as typeof fetch;
  const d = new WebhookDispatcher({ fetchImpl: fn });
  d.add({ url: "https://hook.example/aristotle", secret: "shh" });
  const event = makeEvent({ event_type: "decision.allow", action_type: "x.do" });
  const results = await d.dispatch(event);
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, true);
  assert.equal(seen.length, 1);
  assert.match(seen[0].headers["x-aristotle-signature"], /^sha256=[0-9a-f]{64}$/);
  // Verifier can confirm.
  assert.equal(WebhookDispatcher.verifySignature(seen[0].body, "shh", seen[0].headers["x-aristotle-signature"]), true);
  assert.equal(WebhookDispatcher.verifySignature(seen[0].body, "wrong-secret", seen[0].headers["x-aristotle-signature"]), false);
});

test("WebhookDispatcher: retries on non-2xx and stops after maxAttempts; calls onDeadLetter", async () => {
  let calls = 0;
  const fn = (async () => { calls++; return { status: 500, ok: false, async text() { return ""; } }; }) as unknown as typeof fetch;
  const deadLetters: Array<{ url: string; event_id: string }> = [];
  const d = new WebhookDispatcher({ fetchImpl: fn, onDeadLetter: (r) => { deadLetters.push({ url: r.url, event_id: r.event_id }); } });
  d.add({ url: "https://hook.example", secret: "x", maxAttempts: 3, retryDelayMs: 1 });
  const event = makeEvent({ event_type: "decision.refuse" });
  const results = await d.dispatch(event);
  assert.equal(calls, 3);
  assert.equal(results[0].ok, false);
  assert.equal(results[0].attempts, 3);
  assert.equal(results[0].status, 500);
  assert.equal(deadLetters.length, 1);
  assert.equal(deadLetters[0].event_id, event.event_id);
});

test("WebhookDispatcher: filter excludes non-matching subscriptions", async () => {
  let calls = 0;
  const fn = (async () => { calls++; return { status: 200, ok: true, async text() { return ""; } }; }) as unknown as typeof fetch;
  const d = new WebhookDispatcher({ fetchImpl: fn });
  d.add({ url: "https://hook.allow", secret: "x", filter: { event_types: ["decision.allow"] } });
  d.add({ url: "https://hook.refuse", secret: "x", filter: { event_types: ["decision.refuse"] } });
  await d.dispatch(makeEvent({ event_type: "decision.allow" }));
  assert.equal(calls, 1);
});

test("WebhookDispatcher.verifySignature: tamper detection", () => {
  const body = JSON.stringify(makeEvent({ event_type: "decision.allow" }));
  const correct = `sha256=${createHmac("sha256", "shh").update(body).digest("hex")}`;
  assert.equal(WebhookDispatcher.verifySignature(body, "shh", correct), true);
  assert.equal(WebhookDispatcher.verifySignature(body + "X", "shh", correct), false);
  assert.equal(WebhookDispatcher.verifySignature(body, "shh", "sha256=" + "0".repeat(64)), false);
});

test("attachSseHandler: writes SSE-framed events on publish; closes on response close", async () => {
  const bus = new EventBus();
  const written: string[] = [];
  const headers: Record<string, string> = {};
  let closeCallback: (() => void) | undefined;
  const res: SseResponse = {
    setHeader(name, value) { headers[name] = value; },
    write(chunk) { written.push(chunk); return true; },
    end() { /* */ },
    on(_event, listener) { closeCallback = listener; }
  };
  attachSseHandler(bus, res, { event_types: ["decision.allow"] });
  assert.equal(headers["Content-Type"], "text/event-stream");
  assert.ok(written[0].startsWith(":connected"));
  await bus.publish(makeEvent({ event_type: "decision.allow", subject: "agent:a" }));
  await bus.publish(makeEvent({ event_type: "decision.refuse", subject: "agent:b" })); // filtered out
  // first published event added three frame lines.
  const sseFrames = written.join("").split("\n\n").filter(Boolean);
  // sseFrames[0] is the :connected comment
  assert.match(sseFrames[1], /event: decision\.allow/);
  assert.match(sseFrames[1], /"subject":"agent:a"/);
  assert.equal(sseFrames.length, 2);
  // Simulate client close
  closeCallback?.();
  await bus.publish(makeEvent({ event_type: "decision.allow" }));
  // No additional frames after close.
  const sseFramesAfter = written.join("").split("\n\n").filter(Boolean);
  assert.equal(sseFramesAfter.length, 2);
});
