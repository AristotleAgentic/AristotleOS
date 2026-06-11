/**
 * /v1/* trial-API route handlers for http-gateway.
 *
 * Carved out of index.ts in stage 17 of the prototype-hardening
 * pass. Behavior preserved EXACTLY. Stage 16
 * (adapters/http-gateway/src/trial-api.test.ts, 6 tests) pins the
 * envelope shapes of the routes that don't require auth fan-out.
 *
 * The /v1/* surface drives @aristotle/trial-engine over HTTP. It's
 * self-contained: no downstream service fan-out, just an in-memory
 * GEL record store + a per-process deferred-approvals Map + a
 * mutable policy source.
 *
 * Module contract follows the same dep-injection pattern as
 * stage-6's operator-auth and stage-10's mission routes — a deps
 * bag holds mutable state references and the local
 * evaluateTrialRequest helper that index.ts owns; pure trial-engine
 * imports come in directly.
 *
 * The mutable policy source needs special handling: the original
 * inline code used `let trialPolicySource = ...` and the
 * /v1/policy/apply handler rebound it with `trialPolicySource =
 * source`. A `let` binding can't be shared across modules, so the
 * caller wraps the source in `{ source }` and we mutate via
 * `trialState.source = ...`. Same observable behavior, but
 * extractable. Stage 16's tests pin the envelopes /apply produces;
 * stage 17 doesn't ship a test for the mutation flow because it
 * doesn't change behavior — the new boilerplate just relocates
 * where the read/write happens.
 */

import type { Express } from "express";
import {
  TRIAL_SCENARIOS,
  evaluateTrialAction,
  parseGovernanceSource,
  planGovernanceChange,
  validateGovernanceSource,
  type TrialActionIntent,
  type TrialEvaluation,
  type TrialGelRecord
} from "@aristotle/trial-engine";

/** Mutable wrapper for the in-process policy source. /v1/policy/apply
 *  swaps `source` to install a new compiled policy; every other
 *  handler reads it. Wrapping in an object lets the carved-out
 *  module share the mutation with the parent module. */
export type TrialState = { source: string };

/** Shape of the deferred-approvals Map entry. */
export type TrialApproval = {
  intent: TrialActionIntent;
  source: string;
  evaluation: TrialEvaluation;
};

export type TrialApiDeps = {
  /** Mutable policy-source ref shared with index.ts. */
  trialState: TrialState;
  /** Append-only ring buffer (newest first, capped at 100). */
  trialGelRecords: TrialGelRecord[];
  /** Deferred-approvals registry, keyed by deferToken. */
  trialApprovals: Map<string, TrialApproval>;
  /** Append a fresh evaluation's gelRecord onto the ring buffer
   *  (caller-owned because index.ts uses it for the cap-at-100
   *  ringing logic + may emit metrics in a future hook). */
  appendTrialRecord: (evaluation: TrialEvaluation) => void;
  /** Local helper that drives evaluateTrialAction with the
   *  per-request policy source + scenario lookup. Owned by index.ts
   *  because it touches the same trialState ref + the trialApprovals
   *  Map; passing it in keeps the module purely about route mounting. */
  evaluateTrialRequest: (
    body: Record<string, unknown>,
    approval?: "approve" | "deny" | "more_info" | "reduced_authority"
  ) => { scenario: unknown; intent: TrialActionIntent; evaluation: TrialEvaluation };
};

export function mountTrialApiRoutes(app: Express, deps: TrialApiDeps): void {
  const { trialState, trialGelRecords, trialApprovals, appendTrialRecord, evaluateTrialRequest } = deps;

  app.get("/v1/status", (_req, res) => {
    const validation = validateGovernanceSource(trialState.source);
    res.json({
      ok: validation.ok,
      runtime: "aristotle-trial",
      activePolicyHash: validation.policy?.policyHash,
      governanceMode: "deterministic-trial",
      doctrine: "Governance must bind at the execution boundary before irreversible state mutation or external action occurs.",
      scenarios: TRIAL_SCENARIOS.map(({ id, title, summary }) => ({ id, title, summary }))
    });
  });

  app.post("/v1/actions/evaluate", (req, res) => {
    res.json(evaluateTrialRequest(req.body as Record<string, unknown>));
  });

  app.post("/v1/actions/execute", (req, res) => {
    const result = evaluateTrialRequest(
      req.body as Record<string, unknown>,
      (req.body as { approval?: "approve" | "deny" | "more_info" | "reduced_authority" }).approval
    );
    const executable = result.evaluation.decision === "PERMIT";
    res.status(executable ? 200 : result.evaluation.decision === "DEFER" ? 202 : 409).json({
      ...result,
      execution: executable
        ? { status: "executed", boundary: "commit-gate", warrantId: result.evaluation.warrant?.id }
        : { status: "not_executed", reason: result.evaluation.decisionCode }
    });
  });

  app.get("/v1/audit/tail", (_req, res) => res.json({ items: trialGelRecords.slice(0, 25) }));

  app.get("/v1/audit/:recordId", (req, res) => {
    const record = trialGelRecords.find((item) => item.recordId === req.params.recordId);
    if (!record) {
      res.status(404).json({ error: "record_not_found" });
      return;
    }
    res.json(record);
  });

  app.post("/v1/replay", (req, res) => {
    const body = req.body as Record<string, unknown>;
    const result = evaluateTrialAction({
      source: typeof body.policy === "string" ? body.policy : trialState.source,
      intent: (body.intent && typeof body.intent === "object" ? body.intent : TRIAL_SCENARIOS[0].intent) as TrialActionIntent,
      previousHash: typeof body.previousHash === "string" ? body.previousHash : "GENESIS",
      now: typeof body.now === "string" ? body.now : "2026-01-01T00:00:00.000Z"
    });
    res.json({ replayed: true, evaluation: result });
  });

  app.get("/v1/approvals", (_req, res) => {
    res.json({
      items: Array.from(trialApprovals.entries()).map(([id, value]) => ({
        id,
        intent: value.intent,
        decisionCode: value.evaluation.decisionCode,
        explanation: value.evaluation.explanation
      }))
    });
  });

  app.post("/v1/approvals/:id/approve", (req, res) => {
    const deferred = trialApprovals.get(req.params.id);
    if (!deferred) {
      res.status(404).json({ error: "approval_not_found" });
      return;
    }
    const evaluation = evaluateTrialAction({
      source: deferred.source,
      intent: deferred.intent,
      approval: (req.body as { reducedAuthority?: boolean }).reducedAuthority ? "reduced_authority" : "approve",
      previousHash: trialGelRecords[0]?.currentHash
    });
    appendTrialRecord(evaluation);
    trialApprovals.delete(req.params.id);
    res.json({ approved: true, evaluation });
  });

  app.post("/v1/approvals/:id/deny", (req, res) => {
    const deferred = trialApprovals.get(req.params.id);
    if (!deferred) {
      res.status(404).json({ error: "approval_not_found" });
      return;
    }
    const evaluation = evaluateTrialAction({
      source: deferred.source,
      intent: deferred.intent,
      approval: "deny",
      previousHash: trialGelRecords[0]?.currentHash
    });
    appendTrialRecord(evaluation);
    trialApprovals.delete(req.params.id);
    res.json({ denied: true, evaluation });
  });

  app.post("/v1/policy/check", (req, res) => {
    const source = typeof req.body?.policy === "string" ? req.body.policy : trialState.source;
    const { policy, ...validation } = validateGovernanceSource(source);
    res.status(validation.ok ? 200 : 422).json({ ...validation, policyHash: policy?.policyHash });
  });

  app.post("/v1/policy/plan", (req, res) => {
    const source = typeof req.body?.policy === "string" ? req.body.policy : trialState.source;
    const plan = planGovernanceChange(source, trialState.source);
    res.status(plan.ok ? 200 : 422).json(plan);
  });

  app.post("/v1/policy/apply", (req, res) => {
    const source = typeof req.body?.policy === "string" ? req.body.policy : "";
    const validation = validateGovernanceSource(source);
    if (!validation.ok || !validation.policy) {
      res.status(422).json(validation);
      return;
    }
    trialState.source = source;
    parseGovernanceSource(trialState.source);
    res.json({ applied: true, policyHash: validation.policy.policyHash });
  });
}
