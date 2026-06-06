/**
 * /events, /branches, /replay, /timeline routes for evidence-ledger.
 *
 * Carved out of index.ts in stage 19 of the prototype-hardening
 * pass. Behavior preserved EXACTLY. Stage 2
 * (services/evidence-ledger/src/index.test.ts, 5 tests) pins the
 * replay-event + counterfactual-branch lifecycle envelopes.
 *
 * Routes mounted:
 *   POST /events/commit          — append a committed replay event (201)
 *   POST /branches               — open a counterfactual branch (201)
 *   POST /branches/:id/events    — append a hypothetical event (201 / 404)
 *   GET  /replay                 — list committed (or branch) events
 *   GET  /timeline               — committed events + open branches
 *
 * /artifacts and /artifacts/:id stay inline in index.ts — they
 * read artifactTypes + artifacts which are tangled with the
 * persistence loader. Future stage can lift them once those
 * helpers are factored.
 */

import type { Express } from "express";
import type {
  ArtifactType,
  CounterfactualBranch,
  ReplayEvent
} from "@aristotle/shared-types";

export type ReplayEventsRouteDeps = {
  /** In-memory committed-event stream — append-only here. */
  committed: ReplayEvent[];
  /** Open counterfactual branches keyed by branch id. */
  branches: Map<string, CounterfactualBranch>;
  /** Hypothetical events per branch — uncommitted, segregated
   *  from the committed stream. */
  hypothetical: Map<string, ReplayEvent[]>;
  /** id('evt'), id('cfb') generators (from lib.ts). */
  id: (prefix: string) => string;
  /** ISO timestamp generator. */
  now: () => string;
  /** Side-effect helper that scans a payload for embedded artifacts
   *  and registers them. Owned by index.ts because it touches
   *  artifacts/artifactTypes Maps. */
  ingestArtifactsFromPayload: (event: ReplayEvent) => void;
  /** Filter helper: does this event match the supplied relatedId
   *  (looking at chainId, payload.id, etc.)? Owned by index.ts. */
  eventMatchesRelatedId: (event: ReplayEvent, relatedId?: string) => boolean;
  /** Triggers the next persist tick (debounced fsync of state). */
  schedulePersist: () => Promise<void> | unknown;
};

export function mountReplayEventsRoutes(app: Express, deps: ReplayEventsRouteDeps): void {
  const {
    committed,
    branches,
    hypothetical,
    id,
    now,
    ingestArtifactsFromPayload,
    eventMatchesRelatedId,
    schedulePersist
  } = deps;

  app.post("/events/commit", async (req, res) => {
    const ev: ReplayEvent = {
      id: req.body.id ?? id("evt"),
      artifactType: "replay-event",
      timestamp: now(),
      actor: req.body.actor ?? "unknown",
      eventKind: req.body.eventKind ?? "unknown",
      committed: true,
      payload: req.body.payload ?? {},
      traceId: req.body.traceId,
      chainId: req.body.chainId
    };
    committed.push(ev);
    ingestArtifactsFromPayload(ev);
    await schedulePersist();
    res.status(201).json({ index: committed.length - 1, event: ev });
  });

  app.post("/branches", async (req, res) => {
    const branch: CounterfactualBranch = {
      id: req.body.id ?? id("cfb"),
      artifactType: "counterfactual-branch",
      timestamp: now(),
      actor: req.body.actor ?? "simulator",
      parentTraceId: req.body.parentTraceId ?? "unknown",
      label: req.body.label ?? "branch",
      status: "open",
      hypothetical: true
    };
    branches.set(branch.id, branch);
    hypothetical.set(branch.id, []);
    await schedulePersist();
    res.status(201).json(branch);
  });

  app.post("/branches/:id/events", async (req, res) => {
    const branch = branches.get(req.params.id);
    if (!branch) return res.status(404).json({ error: "branch_not_found" });
    const ev: ReplayEvent = {
      id: req.body.id ?? id("evt"),
      artifactType: "replay-event",
      timestamp: now(),
      actor: req.body.actor ?? "simulator",
      eventKind: req.body.eventKind ?? "counterfactual",
      committed: false,
      branchId: branch.id,
      payload: req.body.payload ?? {}
    };
    hypothetical.get(branch.id)!.push(ev);
    await schedulePersist();
    res.status(201).json(ev);
  });

  app.get("/replay", (req, res) => {
    const { traceId, branchId, relatedId } = req.query;
    if (branchId && typeof branchId === "string") {
      const items = (hypothetical.get(branchId) ?? []).filter((event) =>
        eventMatchesRelatedId(event, typeof relatedId === "string" ? relatedId : undefined)
      );
      return res.json({ committed: false, items });
    }
    const items = committed.filter(
      (event) =>
        (typeof traceId === "string" ? event.traceId === traceId : true) &&
        eventMatchesRelatedId(event, typeof relatedId === "string" ? relatedId : undefined)
    );
    res.json({ committed: true, items });
  });

  app.get("/timeline", (req, res) => {
    const traceId = typeof req.query.traceId === "string" ? req.query.traceId : undefined;
    const relatedId = typeof req.query.relatedId === "string" ? req.query.relatedId : undefined;
    res.json({
      committed: committed.filter(
        (event) => (traceId ? event.traceId === traceId : true) && eventMatchesRelatedId(event, relatedId)
      ),
      branches: [...branches.values()]
    });
  });
}

// Re-export the type so callers don't need a separate import; convenient when
// a stage extracts /artifacts too and wants the same ArtifactType union shape.
export type { ArtifactType };
