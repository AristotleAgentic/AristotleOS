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
import { type TrialActionIntent, type TrialEvaluation, type TrialGelRecord } from "@aristotle/trial-engine";
/** Mutable wrapper for the in-process policy source. /v1/policy/apply
 *  swaps `source` to install a new compiled policy; every other
 *  handler reads it. Wrapping in an object lets the carved-out
 *  module share the mutation with the parent module. */
export type TrialState = {
    source: string;
};
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
    evaluateTrialRequest: (body: Record<string, unknown>, approval?: "approve" | "deny" | "more_info" | "reduced_authority") => {
        scenario: unknown;
        intent: TrialActionIntent;
        evaluation: TrialEvaluation;
    };
};
export declare function mountTrialApiRoutes(app: Express, deps: TrialApiDeps): void;
