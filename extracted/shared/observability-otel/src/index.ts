/**
 * @aristotle/observability-otel
 *
 * First-party OpenTelemetry tracer adapter for AristotleOS. Closes
 * the "OTel SDK bridge" portion of ROADMAP_TO_100.md Category 1 by
 * shipping the ~30-line adapter that consumers used to have to
 * inline themselves (per the documentation jsdoc in
 * @aristotle/execution-control-runtime's createInMemoryTracer).
 *
 * Design constraint: the substrate must NOT force every consumer to
 * take a hard `@opentelemetry/api` dependency. So this package
 * declares `@opentelemetry/api` as an OPTIONAL peerDependency.
 * Consumers who want OTel-shaped tracing install it; everyone else
 * doesn't pay the cost.
 *
 * What ships:
 *
 *   - createOtelTracerAdapter(otelTracer) — wraps any structurally
 *     OTel-shaped Tracer as an AristotleTracer. Span ends, attribute
 *     setting, and status mapping all preserved.
 *
 *   - OtelLikeTracer / OtelLikeSpan interfaces — the minimal
 *     structural shape this adapter requires. The real
 *     `@opentelemetry/api` Tracer satisfies this; so does any test
 *     double, so consumers can validate their wiring without an OTel
 *     SDK.
 *
 *   - mapAristotleStatusToOtel — the small enum mapping
 *     (AristotleStatus { ok, message } -> OTel SpanStatusCode).
 *     Exported so callers can reuse it in their own adapters or
 *     custom span emitters.
 *
 * Usage in a service:
 *
 *   import { trace } from "@opentelemetry/api";
 *   import { createOtelTracerAdapter } from "@aristotle/observability-otel";
 *   import { evaluateExecutionControl } from "@aristotle/execution-control-runtime";
 *
 *   const tracer = createOtelTracerAdapter(trace.getTracer("aristotle"));
 *
 *   evaluateExecutionControl({ ..., tracer });
 *
 * Spans emitted under the name "aristotle.execution_control.evaluate"
 * land in your OTel backend with attributes "aristotle.ward_id",
 * "aristotle.action_type", "aristotle.trace_id".
 */

import type { AristotleSpan, AristotleTracer, SpanAttributeValue } from "@aristotle/execution-control-runtime";

// ---------------------------------------------------------------------------
// Structural OTel shape we depend on. The real @opentelemetry/api Span
// has more methods (recordException, addEvent, updateName, ...) but
// AristotleSpan only uses these three, so we declare the minimum here
// and let TS structurally validate that the consumer's tracer satisfies it.
// ---------------------------------------------------------------------------

/** Minimal OTel-compatible Span shape this adapter consumes. */
export interface OtelLikeSpan {
  setAttribute(key: string, value: SpanAttributeValue): OtelLikeSpan;
  setStatus(status: { code: number; message?: string }): OtelLikeSpan;
  end(endTime?: number): void;
}

/** Minimal OTel-compatible Tracer shape this adapter consumes. */
export interface OtelLikeTracer {
  startSpan(
    name: string,
    options?: { attributes?: Record<string, SpanAttributeValue> }
  ): OtelLikeSpan;
}

// ---------------------------------------------------------------------------
// OTel SpanStatusCode (from @opentelemetry/api; replicated here so we
// don't need the SDK to compile)
// ---------------------------------------------------------------------------

/** OTel SpanStatusCode replication. UNSET=0, OK=1, ERROR=2. */
export const SpanStatusCode = {
  UNSET: 0,
  OK: 1,
  ERROR: 2
} as const;
export type SpanStatusCode = (typeof SpanStatusCode)[keyof typeof SpanStatusCode];

/**
 * Map AristotleSpan status to OTel SpanStatusCode. Substrate uses
 * `{ ok: boolean, message?: string }`; OTel uses an integer enum.
 */
export function mapAristotleStatusToOtel(
  status: { ok: boolean; message?: string }
): { code: SpanStatusCode; message?: string } {
  if (status.ok) return { code: SpanStatusCode.OK };
  return { code: SpanStatusCode.ERROR, message: status.message };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Wrap an OTel-shaped Tracer as an AristotleTracer. Every span the
 * substrate starts is translated to a real OTel span; every attribute
 * is forwarded; status mapping uses mapAristotleStatusToOtel; end()
 * is called on the OTel span when the substrate calls end().
 */
export function createOtelTracerAdapter(otelTracer: OtelLikeTracer): AristotleTracer {
  return {
    startSpan(name: string, attributes?: Record<string, SpanAttributeValue>): AristotleSpan {
      const otelSpan = otelTracer.startSpan(name, attributes ? { attributes } : undefined);
      return {
        setAttribute(key: string, value: SpanAttributeValue): void {
          otelSpan.setAttribute(key, value);
        },
        setStatus(status: { ok: boolean; message?: string }): void {
          otelSpan.setStatus(mapAristotleStatusToOtel(status));
        },
        end(): void {
          otelSpan.end();
        }
      };
    }
  };
}
