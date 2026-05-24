import type { ExecutionControlDecision, ExecutionControlReasonCode, GelRecord } from "./index.js";

/**
 * Forward governance decisions to an external audit sink (SIEM, log pipeline,
 * durable store). Delivery is best-effort and happens off the request hot path;
 * the boundary's availability never depends on the sink. The forwarded payload is
 * the signed GEL record, so the sink receives tamper-evident evidence.
 */
export interface AuditEvent {
  event: "evaluate" | "proxy";
  ts: string;
  ward_id: string;
  subject: string;
  action_type: string;
  decision: ExecutionControlDecision;
  reason_codes: ExecutionControlReasonCode[];
  warrant_id?: string;
  signing_key_id?: string;
  record: GelRecord;
}

export interface AuditDeliveryResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export async function deliverAuditEvent(
  url: string,
  event: AuditEvent,
  fetchImpl: typeof fetch = fetch,
  headers: Record<string, string> = {}
): Promise<AuditDeliveryResult> {
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(event)
    });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
