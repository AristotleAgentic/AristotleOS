/**
 * @aristotle/event-stream — event delivery for AristotleOS.
 *
 * Substrate audit #11 was at 95%; the remaining 5% was "webhook
 * event streaming". This package fills that gap with:
 *
 *   - `ExecutionControlEvent` — the canonical event shape (decision /
 *     warrant / GEL / killSwitch / revocation).
 *   - `EventBus` — in-process pub/sub keyed by event_type +
 *     optional action_type / subject prefix filters.
 *   - `WebhookDispatcher` — HMAC-signed POSTs with bounded retry and
 *     dead-letter on persistent failure.
 *   - `sseStreamHandler` — turns the bus into a Node `http` response
 *     handler that streams events in text/event-stream format.
 *
 * The package is intentionally transport-agnostic — callers wire it
 * to their existing http server / fetch / queue infrastructure.
 */

import { createHmac } from "node:crypto";

export const EVENT_FORMAT = "aristotle.execution-control-event.v1";

export type ExecutionControlEventType =
  | "decision.allow"
  | "decision.refuse"
  | "decision.escalate"
  | "decision.expire"
  | "warrant.issued"
  | "warrant.consumed"
  | "warrant.revoked"
  | "gel.appended"
  | "kill_switch.engaged"
  | "kill_switch.released"
  | "envelope.revoked";

export interface ExecutionControlEvent {
  format: typeof EVENT_FORMAT;
  event_id: string;
  event_type: ExecutionControlEventType;
  /** When the event was emitted (the gate's clock). */
  emitted_at: string;
  /** Logical record this event refers to (GEL record_id, warrant_id, etc.). */
  record_id?: string;
  /** Decision artifacts: subject + action_type + decision when applicable. */
  subject?: string;
  action_type?: string;
  decision?: string;
  reason_codes?: string[];
  ward_id?: string;
  /** Free-form payload — keep below ~64 KB for webhook compatibility. */
  payload?: Record<string, unknown>;
}

export interface EventFilter {
  /** Match only events whose event_type is in this set. */
  event_types?: ExecutionControlEventType[];
  /** Match only events whose action_type starts with this prefix. */
  action_type_prefix?: string;
  /** Match only events whose subject starts with this prefix. */
  subject_prefix?: string;
  /** Match only events whose ward_id matches exactly. */
  ward_id?: string;
}

export function eventMatches(event: ExecutionControlEvent, filter?: EventFilter): boolean {
  if (!filter) return true;
  if (filter.event_types && !filter.event_types.includes(event.event_type)) return false;
  if (filter.action_type_prefix && !(event.action_type ?? "").startsWith(filter.action_type_prefix)) return false;
  if (filter.subject_prefix && !(event.subject ?? "").startsWith(filter.subject_prefix)) return false;
  if (filter.ward_id && event.ward_id !== filter.ward_id) return false;
  return true;
}

// ---------------------------------------------------------------------------
// EventBus — in-process pub/sub
// ---------------------------------------------------------------------------

export type EventListener = (event: ExecutionControlEvent) => void | Promise<void>;

export class EventBus {
  private subscribers: Map<string, { listener: EventListener; filter?: EventFilter }> = new Map();
  private nextId = 0;

  /** Subscribe; returns an unsubscribe handle. */
  subscribe(listener: EventListener, filter?: EventFilter): () => void {
    const id = `sub-${++this.nextId}`;
    this.subscribers.set(id, { listener, filter });
    return () => { this.subscribers.delete(id); };
  }

  /** Publish to all matching subscribers. Errors thrown by listeners
   *  are swallowed so one bad subscriber can't poison the bus. */
  async publish(event: ExecutionControlEvent): Promise<{ delivered: number; failed: number }> {
    let delivered = 0, failed = 0;
    for (const { listener, filter } of this.subscribers.values()) {
      if (!eventMatches(event, filter)) continue;
      try { await listener(event); delivered++; }
      catch { failed++; }
    }
    return { delivered, failed };
  }

  subscriberCount(): number { return this.subscribers.size; }
}

// ---------------------------------------------------------------------------
// WebhookDispatcher — HMAC-signed POSTs with bounded retry
// ---------------------------------------------------------------------------

export interface WebhookSubscription {
  url: string;
  /** HMAC secret used to sign the X-Aristotle-Signature header. */
  secret: string;
  filter?: EventFilter;
  /** Max delivery attempts before giving up. Default 5. */
  maxAttempts?: number;
  /** Delay between attempts in ms (linear). Default 100ms. */
  retryDelayMs?: number;
}

export interface WebhookDeliveryResult {
  url: string;
  event_id: string;
  attempts: number;
  ok: boolean;
  status?: number;
  error?: string;
}

export interface WebhookDispatcherOptions {
  fetchImpl?: typeof fetch;
  /** Called when a delivery permanently fails (all attempts exhausted). */
  onDeadLetter?: (result: WebhookDeliveryResult, event: ExecutionControlEvent) => void;
}

export class WebhookDispatcher {
  private subscriptions: WebhookSubscription[] = [];
  private fetchImpl: typeof fetch;
  private onDeadLetter?: (result: WebhookDeliveryResult, event: ExecutionControlEvent) => void;

  constructor(opts: WebhookDispatcherOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.onDeadLetter = opts.onDeadLetter;
  }

  add(sub: WebhookSubscription): void { this.subscriptions.push(sub); }
  count(): number { return this.subscriptions.length; }

  /** Dispatch the event to every matching subscription. */
  async dispatch(event: ExecutionControlEvent): Promise<WebhookDeliveryResult[]> {
    const results: WebhookDeliveryResult[] = [];
    for (const sub of this.subscriptions) {
      if (!eventMatches(event, sub.filter)) continue;
      results.push(await this.deliver(sub, event));
    }
    return results;
  }

  private async deliver(sub: WebhookSubscription, event: ExecutionControlEvent): Promise<WebhookDeliveryResult> {
    const maxAttempts = sub.maxAttempts ?? 5;
    const retryDelayMs = sub.retryDelayMs ?? 100;
    const body = JSON.stringify(event);
    const signature = createHmac("sha256", sub.secret).update(body).digest("hex");
    let lastError: string | undefined;
    let lastStatus: number | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await this.fetchImpl(sub.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-aristotle-signature": `sha256=${signature}`,
            "x-aristotle-event-id": event.event_id,
            "x-aristotle-event-type": event.event_type
          },
          body
        });
        lastStatus = res.status;
        if (res.status >= 200 && res.status < 300) {
          return { url: sub.url, event_id: event.event_id, attempts: attempt, ok: true, status: res.status };
        }
        lastError = `non-2xx status ${res.status}`;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, retryDelayMs));
      }
    }
    const result: WebhookDeliveryResult = {
      url: sub.url, event_id: event.event_id, attempts: maxAttempts,
      ok: false,
      ...(lastStatus !== undefined ? { status: lastStatus } : {}),
      ...(lastError !== undefined ? { error: lastError } : {})
    };
    if (this.onDeadLetter) this.onDeadLetter(result, event);
    return result;
  }

  /** Verify a webhook delivery's HMAC signature. Receivers call this
   *  to confirm the body is from a sender that holds `secret`. */
  static verifySignature(rawBody: string, secret: string, signatureHeader: string): boolean {
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    return signatureHeader === `sha256=${expected}`;
  }
}

// ---------------------------------------------------------------------------
// SSE — Server-Sent Events helper
// ---------------------------------------------------------------------------

/** Shape of the Node ServerResponse subset we use, kept as an
 *  interface so the package doesn't import "http" types at the top
 *  level (consumers may run in non-Node runtimes). */
export interface SseResponse {
  setHeader(name: string, value: string): void;
  write(chunk: string): boolean;
  end(): void;
  on(event: "close", listener: () => void): void;
}

/**
 * Pump events from `bus` to the SSE response. Returns when the client
 * disconnects. Subscribers' filter applies per-connection.
 */
export function attachSseHandler(bus: EventBus, res: SseResponse, filter?: EventFilter): { close: () => void } {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  let closed = false;
  const unsubscribe = bus.subscribe((event) => {
    if (closed) return;
    res.write(`id: ${event.event_id}\n`);
    res.write(`event: ${event.event_type}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }, filter);
  res.on("close", () => {
    closed = true;
    unsubscribe();
    try { res.end(); } catch { /* already ended */ }
  });
  // Send a comment to flush headers immediately.
  res.write(":connected\n\n");
  return {
    close: () => {
      if (!closed) {
        closed = true;
        unsubscribe();
        try { res.end(); } catch { /* already ended */ }
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Convenience: a default new-event factory.
// ---------------------------------------------------------------------------

let nextLocalId = 0;
export function makeEvent(partial: Omit<ExecutionControlEvent, "format" | "event_id" | "emitted_at"> & { event_id?: string; emitted_at?: string }): ExecutionControlEvent {
  return {
    format: EVENT_FORMAT,
    event_id: partial.event_id ?? `evt-${Date.now().toString(16)}-${(++nextLocalId).toString(16)}`,
    emitted_at: partial.emitted_at ?? new Date().toISOString(),
    event_type: partial.event_type,
    record_id: partial.record_id,
    subject: partial.subject,
    action_type: partial.action_type,
    decision: partial.decision,
    reason_codes: partial.reason_codes,
    ward_id: partial.ward_id,
    payload: partial.payload
  };
}
