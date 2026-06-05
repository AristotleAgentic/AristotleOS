/**
 * @aristotle/k8s-admission — govern Kubernetes AdmissionReview requests
 * through the AristotleOS Commit Gate.
 *
 * Same hardware-governance shape as MAVLink / ROS2 / OPC-UA / DNP3:
 *
 *   AdmissionReview (kubectl apply / controller create) -> CanonicalAction
 *   -> client.evaluate(...) -> ALLOW/REFUSE/ESCALATE -> AdmissionResponse
 *
 * Kubernetes calls a webhook URL with an AdmissionReview JSON body; the
 * webhook returns an AdmissionResponse keyed by the same UID. This
 * adapter implements that contract on top of the Commit Gate. REFUSE /
 * ESCALATE / GATE_UNREACHABLE all serialize as `allowed: false` with a
 * structured `status.reason` and `status.code`.
 *
 * Production deployments must terminate TLS in front (e.g. nginx / Envoy /
 * an API Gateway) — the Kubernetes API server requires HTTPS for
 * admission webhooks. This package emits the JSON payload only.
 */

import { governThroughResponse } from "@aristotle/adapter-sdk";
import { AristotleClient, type CanonicalAction } from "@aristotle/os-sdk";

/** Subset of the Kubernetes AdmissionReview v1 request we care about. */
export interface AdmissionReviewRequest {
  apiVersion: "admission.k8s.io/v1";
  kind: "AdmissionReview";
  request: {
    uid: string;
    kind: { group: string; version: string; kind: string };
    resource: { group: string; version: string; resource: string };
    name?: string;
    namespace?: string;
    operation: "CREATE" | "UPDATE" | "DELETE" | "CONNECT";
    userInfo?: {
      username?: string;
      uid?: string;
      groups?: string[];
    };
    object?: Record<string, unknown>;
    oldObject?: Record<string, unknown>;
    dryRun?: boolean;
    requestKind?: { group: string; version: string; kind: string };
    requestResource?: { group: string; version: string; resource: string };
  };
}

export interface AdmissionReviewResponse {
  apiVersion: "admission.k8s.io/v1";
  kind: "AdmissionReview";
  response: {
    uid: string;
    allowed: boolean;
    status?: {
      code: number;
      message: string;
      reason?: string;
    };
    warnings?: string[];
  };
}

export interface GovernAdmissionOptions {
  client: AristotleClient;
  wardId: string;
  /** Subject template. Defaults to `agent:k8s.{userInfo.username ?? "anonymous"}`. */
  subject?: string | ((req: AdmissionReviewRequest["request"]) => string);
  /** Override the action_type. Default: `k8s.{operation}.{kind}` lowercased, e.g. `k8s.create.pod`. */
  actionTypeFor?: (req: AdmissionReviewRequest["request"]) => string;
  /** Override the canonical action id. Defaults to `k8s-{uid}`. */
  actionIdFor?: (req: AdmissionReviewRequest["request"]) => string;
  /**
   * When true, treat ESCALATE as REFUSE for admission purposes (block
   * the apply, but return ESCALATE in the status reason). Default true.
   * Set false only if your cluster has an out-of-band approval mechanism
   * that can re-issue the AdmissionReview later.
   */
  escalateBlocksAdmission?: boolean;
}

const defaultSubject = (req: AdmissionReviewRequest["request"]): string => {
  const u = req.userInfo?.username ?? "anonymous";
  return `agent:k8s.${u}`;
};

const defaultActionType = (req: AdmissionReviewRequest["request"]): string => {
  const op = req.operation.toLowerCase();
  const kind = (req.kind?.kind ?? "resource").toLowerCase();
  return `k8s.${op}.${kind}`;
};

const defaultActionId = (req: AdmissionReviewRequest["request"]): string => `k8s-${req.uid}`;

/**
 * Translate one AdmissionReview into a Commit Gate decision and back
 * into an AdmissionResponse. Fail-closed: any gate error -> `allowed:false`.
 */
/**
 * Govern a Kubernetes AdmissionReview request.
 *
 * Implementation note: this function delegates to
 * `governThroughResponse` from @aristotle/adapter-sdk so its
 * fail-closed pipeline stays in lockstep with every other adapter
 * (HTTP error -> GATE_HTTP_<status>, network error -> GATE_UNREACHABLE,
 * !ALLOW -> GATE_REFUSED with decision, missing Warrant ->
 * MISSING_WARRANT). The k8s-specific bits live in the two callbacks:
 *
 *   - buildAction:           AdmissionReviewRequest -> CanonicalAction
 *   - buildAllowResponse:    success AdmissionReviewResponse
 *   - buildRefusalResponse:  map substrate refusal codes ->
 *                            AdmissionReviewResponse status objects
 *                            (503 for gate-unreachable, 403 for
 *                            REFUSE/EXPIRE, 409 for ESCALATE-blocks,
 *                            202 for ESCALATE-without-blocks)
 *
 * Public API (function name, options shape, response shape) is
 * unchanged from the pre-migration version; all existing tests pass.
 */
export async function governAdmissionReview(
  review: AdmissionReviewRequest,
  options: GovernAdmissionOptions
): Promise<AdmissionReviewResponse> {
  const escalateBlocks = options.escalateBlocksAdmission ?? true;

  return governThroughResponse<AdmissionReviewRequest, AdmissionReviewResponse>(review, {
    client: options.client,
    buildAction: (rev): CanonicalAction => {
      const req = rev.request;
      const subject = typeof options.subject === "function" ? options.subject(req)
        : options.subject ?? defaultSubject(req);
      const actionType = options.actionTypeFor ? options.actionTypeFor(req) : defaultActionType(req);
      const actionId = options.actionIdFor ? options.actionIdFor(req) : defaultActionId(req);
      const obj = req.object ?? {};
      const meta = (obj["metadata"] ?? {}) as Record<string, unknown>;
      const spec = (obj["spec"] ?? {}) as Record<string, unknown>;
      return {
        action_id: actionId,
        ward_id: options.wardId,
        subject,
        action_type: actionType,
        params: {
          operation: req.operation,
          group: req.kind?.group ?? "",
          kind: req.kind?.kind ?? "",
          version: req.kind?.version ?? "",
          resource: req.resource?.resource ?? "",
          name: req.name ?? meta["name"] ?? null,
          namespace: req.namespace ?? meta["namespace"] ?? null,
          labels: meta["labels"] ?? null,
          annotations: meta["annotations"] ?? null,
          image: extractContainerImages(spec),
          privileged: extractPrivileged(spec),
          host_network: spec["hostNetwork"] ?? null,
          dry_run: req.dryRun === true
        },
        requested_at: new Date().toISOString(),
        telemetry: { agent_runtime: "kubernetes-admission" }
      };
    },
    buildAllowResponse: (rev, _decision, warrant) => ({
      apiVersion: "admission.k8s.io/v1",
      kind: "AdmissionReview",
      response: {
        uid: rev.request.uid,
        allowed: true,
        warnings: warrant.warrant_id ? [`AristotleOS warrant ${warrant.warrant_id}`] : []
      }
    }),
    buildRefusalResponse: (rev, refusal) => {
      const uid = rev.request.uid;
      // Gate unreachable / HTTP error -> fail closed with 503.
      if (refusal.code === "GATE_UNREACHABLE" || refusal.code.startsWith("GATE_HTTP_")) {
        return refuseResponse(uid, 503, refusal.code, refusal.detail);
      }
      // MISSING_WARRANT (substrate invariant violation) -> 500.
      if (refusal.code === "MISSING_WARRANT") {
        return refuseResponse(uid, 500, refusal.code, refusal.detail);
      }
      // GATE_REFUSED: dispatch on the decision shape.
      const decision = refusal.decision;
      if (decision && decision.decision === "ESCALATE" && !escalateBlocks) {
        return {
          apiVersion: "admission.k8s.io/v1",
          kind: "AdmissionReview",
          response: {
            uid,
            allowed: false,
            status: {
              code: 202,
              message: "AristotleOS requires human approval; resubmit after warrant issuance",
              reason: "ESCALATE"
            }
          }
        };
      }
      if (decision) {
        const code = decision.decision === "ESCALATE" ? 409 : 403;
        return refuseResponse(uid, code, decision.decision, decision.reason_codes.join(", ") || "no reason");
      }
      // Defensive: no decision attached to the refusal (shouldn't
      // happen for GATE_REFUSED, but the SDK type allows it).
      return refuseResponse(uid, 403, refusal.code, refusal.detail);
    }
  });
}

function refuseResponse(uid: string, code: number, reason: string, message: string): AdmissionReviewResponse {
  return {
    apiVersion: "admission.k8s.io/v1",
    kind: "AdmissionReview",
    response: {
      uid,
      allowed: false,
      status: { code, message, reason }
    }
  };
}

function extractContainerImages(spec: Record<string, unknown>): string[] {
  const out: string[] = [];
  const containers = (spec["containers"] ?? []) as Array<Record<string, unknown>>;
  for (const c of containers) {
    if (typeof c["image"] === "string") out.push(c["image"] as string);
  }
  const initContainers = (spec["initContainers"] ?? []) as Array<Record<string, unknown>>;
  for (const c of initContainers) {
    if (typeof c["image"] === "string") out.push(c["image"] as string);
  }
  // Pod template (Deployment / Job / StatefulSet)
  const template = (spec["template"] ?? {}) as Record<string, unknown>;
  const templateSpec = (template["spec"] ?? {}) as Record<string, unknown>;
  if (templateSpec["containers"] || templateSpec["initContainers"]) {
    out.push(...extractContainerImages(templateSpec));
  }
  return out;
}

function extractPrivileged(spec: Record<string, unknown>): boolean {
  const containers = (spec["containers"] ?? []) as Array<Record<string, unknown>>;
  for (const c of containers) {
    const sc = (c["securityContext"] ?? {}) as Record<string, unknown>;
    if (sc["privileged"] === true) return true;
  }
  const template = (spec["template"] ?? {}) as Record<string, unknown>;
  const templateSpec = (template["spec"] ?? {}) as Record<string, unknown>;
  if (templateSpec["containers"]) {
    return extractPrivileged(templateSpec);
  }
  return false;
}

/**
 * Minimal HTTP handler factory. Bind the returned function to your
 * HTTPS server's `/admit` route; it parses the body and returns the
 * admission response JSON. The server is the caller's responsibility —
 * we don't bind a port or terminate TLS here.
 */
export interface AdmissionHandler {
  handle(rawBody: string): Promise<string>;
}

export function createAdmissionHandler(options: GovernAdmissionOptions): AdmissionHandler {
  return {
    async handle(rawBody: string): Promise<string> {
      let review: AdmissionReviewRequest;
      try { review = JSON.parse(rawBody) as AdmissionReviewRequest; }
      catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({
          apiVersion: "admission.k8s.io/v1",
          kind: "AdmissionReview",
          response: { uid: "", allowed: false, status: { code: 400, message: msg, reason: "MALFORMED_REQUEST" } }
        });
      }
      if (!review || review.kind !== "AdmissionReview" || !review.request) {
        return JSON.stringify({
          apiVersion: "admission.k8s.io/v1",
          kind: "AdmissionReview",
          response: { uid: review?.request?.uid ?? "", allowed: false, status: { code: 400, message: "not an AdmissionReview", reason: "MALFORMED_REQUEST" } }
        });
      }
      const resp = await governAdmissionReview(review, options);
      return JSON.stringify(resp);
    }
  };
}

export { AristotleClient, AristotleApiError } from "@aristotle/os-sdk";
export type { CanonicalAction, EvaluateResponse } from "@aristotle/os-sdk";
