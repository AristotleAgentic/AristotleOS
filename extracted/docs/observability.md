# Observability: traces, metrics, and evidence

AristotleOS is not a trace UI. It **exports governance evidence** into the tooling
you already run (Langfuse, LangSmith, Phoenix, any OTel backend, your SIEM) and
**joins it to your distributed traces** — without taking an OpenTelemetry
dependency.

## Trace context → signed GEL record

Pass W3C trace context into a governed action and it is stamped into the
**signed, hash-chained** GEL record (so the correlation is tamper-evident), in
priority order:

1. request body `trace_context` (`{ trace_id, span_id?, trace_flags? }`)
2. request body `traceparent` (W3C string)
3. the `traceparent` request header

The action's `request_id` (or the `x-request-id` header, surfaced in logs) is
recorded as the GEL record's `request_id`. Example:

```bash
curl -XPOST $BOUNDARY/v1/execution-control/evaluate \
  -H 'content-type: application/json' \
  -H 'traceparent: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01' \
  -d '{"action": { ... , "request_id": "req-42" }}'
# → the GEL record carries trace_context.trace_id and request_id
```

Programmatically, pass `trace_context` (and an optional `tracer`) to
`evaluateExecutionControl`, `proxyGovernedAction`, or `governSandboxExecution`.
Helpers: `parseTraceparent`, `formatTraceparent`, `normalizeTraceContext`,
`newTraceContext`.

## OpenTelemetry spans (injected tracer)

Inject an OTel-shaped tracer; the boundary emits spans around each decision phase:

| Span | Covers |
|------|--------|
| `aristotle.execution_control.evaluate` | parent; attrs: `aristotle.trace_id`, `ward_id`, `action_type`, `decision` |
| `aristotle.canonicalize` | canonical-action hashing |
| `aristotle.commit_gate.decide` | authority resolution + decision + warrant issuance |
| `aristotle.gel.append` | ledger append |

```ts
import { trace } from "@opentelemetry/api";
const otel = trace.getTracer("aristotle");
const tracer = {
  startSpan(name, attributes) {
    const span = otel.startSpan(name, { attributes });
    return {
      setAttribute: (k, v) => span.setAttribute(k, v),
      setStatus: ({ ok, message }) => span.setStatus({ code: ok ? 1 : 2, message }),
      end: () => span.end()
    };
  }
};
createExecutionControlRuntimeServer({ ...opts, tracer });
```

No tracer? Spans are no-ops; nothing else changes.

## Metrics

**`GET /metrics`** (Prometheus, open for scraping) exposes live in-process series:

- `aristotle_decisions_total{decision}` — ALLOW / REFUSE / ESCALATE
- `aristotle_reason_codes_total{reason_code}` — per reason code
- `aristotle_warrants_issued_total`, `aristotle_warrant_failures_total`
- `aristotle_replay_refusals_total`, `aristotle_ledger_append_failures_total`
- `aristotle_decision_latency_ms` — histogram (`_bucket`/`_sum`/`_count`)
- `aristotle_ledger_records`, `aristotle_ledger_ok` — cumulative ledger gauges

**`GET /v1/execution-control/metrics`** (JSON) returns the cumulative
ledger-derived totals plus a `runtime` snapshot (the same live counters +
latency histogram). A Grafana dashboard and Prometheus `ServiceMonitor` example
ship under `manifests/k8s/observability.yaml`.

## Wiring into trace/eval platforms

Because the GEL record carries `trace_id`, the governance decision lines up with
your existing spans:

- **Langfuse / LangSmith** — annotate the trace/run with the GEL `record_id`,
  `decision`, and `warrant_id`; filter by `trace_id` to see "was this action
  authorized?" next to the model call.
- **Phoenix / OpenInference** — emit the GEL record as a span event on the same
  `trace_id`.
- **SIEM** — set `--audit-sink`; each decision's signed GEL record (including
  `trace_context`, `request_id`, and operator `actor`) is forwarded best-effort.

The boundary never depends on any of these being reachable — evidence is durable
in the ledger first; export is best-effort on top.
