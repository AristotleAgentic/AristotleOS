import { randomBytes } from "node:crypto";

/**
 * Distributed-trace propagation for AristotleOS.
 *
 * AristotleOS does not ship a tracing UI and takes no OpenTelemetry dependency.
 * Instead it (a) accepts W3C trace context as data and stamps it into the signed
 * GEL record, so governance evidence stitches into your existing traces, and
 * (b) emits spans through an *injected*, OpenTelemetry-shaped tracer — wire your
 * real tracer at the host and the boundary's decisions show up in Langfuse /
 * LangSmith / Phoenix / any OTel backend, with zero coupling here.
 */

export interface TraceContext {
  /** W3C trace id (32 lowercase hex). */
  trace_id: string;
  /** W3C span id of the caller's active span (16 lowercase hex), when known. */
  span_id?: string;
  /** W3C trace flags (2 hex, e.g. "01" = sampled). */
  trace_flags?: string;
}

const TRACE_ID_RE = /^[0-9a-f]{32}$/;
const SPAN_ID_RE = /^[0-9a-f]{16}$/;
const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

/** Parse a W3C `traceparent` header into a TraceContext, or undefined if invalid. */
export function parseTraceparent(traceparent: string | undefined): TraceContext | undefined {
  if (!traceparent) return undefined;
  const match = TRACEPARENT_RE.exec(traceparent.trim());
  if (!match) return undefined;
  const [, trace_id, span_id, trace_flags] = match;
  if (trace_id === "0".repeat(32) || span_id === "0".repeat(16)) return undefined;
  return { trace_id, span_id, trace_flags };
}

/** Serialize a TraceContext as a W3C `traceparent` header value. */
export function formatTraceparent(context: TraceContext): string {
  const span = context.span_id && SPAN_ID_RE.test(context.span_id) ? context.span_id : randomBytes(8).toString("hex");
  const flags = context.trace_flags && /^[0-9a-f]{2}$/.test(context.trace_flags) ? context.trace_flags : "01";
  return `00-${context.trace_id}-${span}-${flags}`;
}

/** Normalize/validate an inbound TraceContext; returns undefined when the trace id is invalid. */
export function normalizeTraceContext(context: TraceContext | undefined): TraceContext | undefined {
  if (!context || !TRACE_ID_RE.test(context.trace_id)) return undefined;
  return {
    trace_id: context.trace_id,
    span_id: context.span_id && SPAN_ID_RE.test(context.span_id) ? context.span_id : undefined,
    trace_flags: context.trace_flags && /^[0-9a-f]{2}$/.test(context.trace_flags) ? context.trace_flags : undefined
  };
}

/** Mint a fresh sampled trace context. */
export function newTraceContext(): TraceContext {
  return { trace_id: randomBytes(16).toString("hex"), span_id: randomBytes(8).toString("hex"), trace_flags: "01" };
}

export type SpanAttributeValue = string | number | boolean;

/** OpenTelemetry-shaped span. A host adapter maps this onto a real OTel Span. */
export interface AristotleSpan {
  setAttribute(key: string, value: SpanAttributeValue): void;
  setStatus(status: { ok: boolean; message?: string }): void;
  end(): void;
}

/** OpenTelemetry-shaped tracer. Inject one to emit spans; omit it for a no-op. */
export interface AristotleTracer {
  startSpan(name: string, attributes?: Record<string, SpanAttributeValue>): AristotleSpan;
}

export const NOOP_SPAN: AristotleSpan = {
  setAttribute() { /* no-op */ },
  setStatus() { /* no-op */ },
  end() { /* no-op */ }
};

/**
 * Run `fn` inside a span (synchronous). When no tracer is provided, `fn` still runs
 * and receives a no-op span, so call sites stay branch-free. The span records ok /
 * error status and always ends.
 */
export function traceSpan<T>(
  tracer: AristotleTracer | undefined,
  name: string,
  attributes: Record<string, SpanAttributeValue> | undefined,
  fn: (span: AristotleSpan) => T
): T {
  if (!tracer) return fn(NOOP_SPAN);
  const span = tracer.startSpan(name, attributes);
  try {
    const result = fn(span);
    span.setStatus({ ok: true });
    return result;
  } catch (error) {
    span.setStatus({ ok: false, message: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Captured span record produced by createInMemoryTracer(). One per
 * startSpan + end() cycle.
 */
export interface CapturedSpan {
  name: string;
  attributes: Record<string, SpanAttributeValue>;
  status: { ok: boolean; message?: string };
  ended: boolean;
}

export interface InMemoryTracer extends AristotleTracer {
  /** All spans that have been started, in order. */
  readonly spans: CapturedSpan[];
  /** Convenience: every captured span's name, in order. */
  spanNames(): string[];
  /** Find the first span whose name matches; throws if none. */
  findSpan(name: string): CapturedSpan;
  /** Reset captured state without rebuilding the tracer. */
  reset(): void;
}

/**
 * First-party in-memory tracer suitable for tests and local validation
 * of an OTel wiring. Captures every span (name, attributes, final
 * status) without an OTel SDK dependency. To bridge to a real OTel
 * deployment:
 *
 *   import { trace } from "@opentelemetry/api";
 *   const otelTracer = trace.getTracer("aristotle");
 *   const adapter: AristotleTracer = {
 *     startSpan(name, attrs) {
 *       const span = otelTracer.startSpan(name, { attributes: attrs });
 *       return {
 *         setAttribute: (k, v) => { span.setAttribute(k, v); },
 *         setStatus: (s) => { span.setStatus({ code: s.ok ? 1 : 2, message: s.message }); },
 *         end: () => { span.end(); }
 *       };
 *     }
 *   };
 *
 * That bridge is intentionally documentation rather than code because
 * @opentelemetry/api is a per-deployment choice (and version-pinning
 * matters); shipping a hard dependency here would force every consumer
 * to take it.
 */
export function createInMemoryTracer(): InMemoryTracer {
  const spans: CapturedSpan[] = [];
  return {
    spans,
    startSpan(name: string, attributes?: Record<string, SpanAttributeValue>): AristotleSpan {
      const rec: CapturedSpan = {
        name,
        attributes: { ...(attributes ?? {}) },
        status: { ok: true },
        ended: false
      };
      spans.push(rec);
      return {
        setAttribute(key: string, value: SpanAttributeValue): void { rec.attributes[key] = value; },
        setStatus(s: { ok: boolean; message?: string }): void { rec.status = { ...s }; },
        end(): void { rec.ended = true; }
      };
    },
    spanNames(): string[] { return spans.map((s) => s.name); },
    findSpan(name: string): CapturedSpan {
      const found = spans.find((s) => s.name === name);
      if (!found) throw new Error(`InMemoryTracer: no captured span named '${name}'. Captured: ${spans.map((s) => s.name).join(", ")}`);
      return found;
    },
    reset(): void { spans.length = 0; }
  };
}
