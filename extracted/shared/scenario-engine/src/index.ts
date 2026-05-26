/**
 * @aristotle/scenario-engine — declarative scenario engine for the
 * AristotleOS governance mesh.
 *
 * A {@link Scenario} is a sequence of {@link ScenarioStep}s. Each step
 * is executed against a real RootNode + WitnessNode + EdgeNode mesh and
 * appends one entry to the resulting {@link ScenarioTrace}. CI / tests
 * can then assert on the trace, e.g. "step #5 returned EXPIRE", "step
 * #7 caused exactly one conflict on reconcile".
 *
 * Step kinds
 *   - issue_envelope   provision a per-edge AuthorityEnvelope
 *   - issue_fluidity   issue a Fluidity Token to an edge
 *   - evaluate         have an edge evaluate a CommitRequest; trace
 *                      captures decision + reason_codes + warrant_id
 *   - partition        sever an edge from a peer
 *   - heal             restore a partitioned edge
 *   - revoke           root revokes an envelope or warrant
 *   - reconcile        edge syncs local decisions with root
 *   - wait             advance wall-clock by N ms
 *   - inject_spoof     evaluate, but with telemetry that does NOT
 *                      match the declared subject (GPS spoof / replay)
 *
 * The engine is deterministic given the same step list, secret, and
 * clock — there's no random fault injection. Scenarios ship as plain
 * data so they're easy to author by hand, persist as JSON, or
 * round-trip through the GEL for replay.
 */

import {
  bindRegistry,
  EdgeNode,
  RootNode,
  WitnessNode,
  type CommitDecision,
  type CommitRequest,
  type NodeId
} from "@aristotle/mesh-runtime";

export type ScenarioStep =
  | { kind: "issue_envelope"; edgeId: string; allowedActionTypes: string[]; envelopeId?: string; expiresInMs?: number }
  | { kind: "issue_fluidity"; edgeId: string; envelopeId?: string; ttlMs?: number }
  | { kind: "evaluate"; edgeId: string; actionType: string; params?: Record<string, unknown>; envelopeId?: string }
  | { kind: "partition"; edgeId: string; from: string }
  | { kind: "heal"; edgeId: string; from: string }
  | { kind: "revoke"; targetEnvelopeId: string; reason?: string }
  | { kind: "reconcile"; edgeId: string }
  | { kind: "wait"; ms: number }
  | { kind: "inject_spoof"; edgeId: string; actionType: string; falseSubject: string; params?: Record<string, unknown>; envelopeId?: string };

export interface ScenarioStepResult {
  step_index: number;
  kind: ScenarioStep["kind"];
  ok: boolean;
  /** Stable payload describing what happened. */
  payload: Record<string, unknown>;
}

export interface ScenarioTrace {
  scenario_id: string;
  started_at: string;
  finished_at: string;
  steps: ScenarioStepResult[];
}

export interface ScenarioOptions {
  scenarioId: string;
  edgeIds: string[];
  witnessIds?: string[];
  secret?: string;
  maxWarrantsWhileDisconnected?: number;
}

const DEFAULT_SECRET = "aos-scenario-secret";

/**
 * Run a declarative Scenario against a freshly-spun-up mesh and return
 * the trace.
 */
export async function runScenario(opts: ScenarioOptions, steps: ScenarioStep[]): Promise<ScenarioTrace> {
  const secret = opts.secret ?? DEFAULT_SECRET;
  const root = new RootNode({ id: "root", host: "127.0.0.1", port: 0, secret });
  const witnessIds = opts.witnessIds ?? ["witness-0"];
  const witnesses = witnessIds.map((id) => new WitnessNode({ id, host: "127.0.0.1", port: 0, secret }));
  const edges = opts.edgeIds.map((id) => new EdgeNode({
    id, host: "127.0.0.1", port: 0, secret,
    maxWarrantsWhileDisconnected: opts.maxWarrantsWhileDisconnected ?? 100
  }));
  const all = [root, ...witnesses, ...edges];
  const ids: NodeId[] = all.map((n) => n.asNodeId());
  for (const n of all) n.setPeers(ids.filter((p) => p.id !== n.getId()));
  const unbind = bindRegistry(all);

  const trace: ScenarioTrace = {
    scenario_id: opts.scenarioId,
    started_at: new Date().toISOString(),
    finished_at: "",
    steps: []
  };

  const edgeById = new Map<string, EdgeNode>();
  for (const e of edges) edgeById.set(e.getId(), e);

  function envIdFor(edgeId: string, explicit?: string): string { return explicit ?? `env-${edgeId}`; }

  try {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const result: ScenarioStepResult = { step_index: i, kind: step.kind, ok: true, payload: {} };
      try {
        switch (step.kind) {
          case "issue_envelope": {
            const envId = envIdFor(step.edgeId, step.envelopeId);
            const env = root.issueEnvelope({
              envelope_id: envId,
              mae_id: "mae-scenario",
              ward_id: "ward-scenario",
              subject: `agent:${step.edgeId}`,
              allowed_action_types: step.allowedActionTypes,
              expires_at: new Date(Date.now() + (step.expiresInMs ?? 3600_000)).toISOString(),
              version: 1
            });
            result.payload = { envelope_id: env.envelope_id, signature: env.signature };
            // allow propagation
            await new Promise((r) => setTimeout(r, 20));
            break;
          }
          case "issue_fluidity": {
            const envId = envIdFor(step.edgeId, step.envelopeId);
            const tok = root.issueFluidityToken({
              edge_id: step.edgeId,
              envelope_id: envId,
              ttl_ms: step.ttlMs ?? 60_000
            });
            const edge = edgeById.get(step.edgeId);
            edge?.receiveFluidityToken(tok);
            result.payload = { token_id: tok.token_id, expires_at: tok.expires_at };
            break;
          }
          case "evaluate": {
            const edge = edgeById.get(step.edgeId);
            if (!edge) { result.ok = false; result.payload = { error: "unknown-edge" }; break; }
            const req: CommitRequest = {
              action_id: `act-${step.edgeId}-${i}`,
              action_type: step.actionType,
              envelope_id: envIdFor(step.edgeId, step.envelopeId),
              subject: `agent:${step.edgeId}`,
              params: step.params ?? {},
              presented_at: new Date().toISOString()
            };
            const d: CommitDecision = await edge.evaluate(req);
            result.payload = {
              decision: d.decision,
              reason_codes: (d as { reason_codes?: string[] }).reason_codes ?? [],
              warrant_id: (d as { warrant?: { warrant_id?: string } }).warrant?.warrant_id ?? null
            };
            break;
          }
          case "partition": {
            const edge = edgeById.get(step.edgeId);
            if (!edge) { result.ok = false; result.payload = { error: "unknown-edge" }; break; }
            edge.partitionFrom(step.from);
            result.payload = { partitioned_from: step.from };
            break;
          }
          case "heal": {
            const edge = edgeById.get(step.edgeId);
            if (!edge) { result.ok = false; result.payload = { error: "unknown-edge" }; break; }
            edge.healPartition(step.from);
            result.payload = { healed_from: step.from };
            break;
          }
          case "revoke": {
            const rev = await root.revoke(step.targetEnvelopeId, "envelope", step.reason ?? "scenario-revoke");
            // give gossip a tick
            await new Promise((r) => setTimeout(r, 30));
            result.payload = { revocation_id: rev.revocation_id, target: rev.target_id };
            break;
          }
          case "reconcile": {
            const edge = edgeById.get(step.edgeId);
            if (!edge) { result.ok = false; result.payload = { error: "unknown-edge" }; break; }
            const conflicts = await edge.reconcile();
            result.payload = { conflicts: conflicts.length, details: conflicts };
            break;
          }
          case "wait": {
            await new Promise((r) => setTimeout(r, step.ms));
            result.payload = { waited_ms: step.ms };
            break;
          }
          case "inject_spoof": {
            // Spoof: subject in the request does not match the edge's
            // own id; the disconnected commit gate must refuse with
            // SUBJECT_MISMATCH regardless of action_type validity.
            const edge = edgeById.get(step.edgeId);
            if (!edge) { result.ok = false; result.payload = { error: "unknown-edge" }; break; }
            const req: CommitRequest = {
              action_id: `act-spoof-${step.edgeId}-${i}`,
              action_type: step.actionType,
              envelope_id: envIdFor(step.edgeId, step.envelopeId),
              subject: step.falseSubject, // <-- the spoof
              params: { ...(step.params ?? {}), _spoof: true },
              presented_at: new Date().toISOString()
            };
            const d: CommitDecision = await edge.evaluate(req);
            result.payload = {
              decision: d.decision,
              reason_codes: (d as { reason_codes?: string[] }).reason_codes ?? [],
              false_subject: step.falseSubject
            };
            break;
          }
        }
      } catch (err) {
        result.ok = false;
        result.payload = { error: err instanceof Error ? err.message : String(err) };
      }
      trace.steps.push(result);
    }
  } finally {
    unbind();
  }
  trace.finished_at = new Date().toISOString();
  return trace;
}

// ---------------------------------------------------------------------------
// Canned scenarios
// ---------------------------------------------------------------------------

/**
 * Mid-mission GPS spoof: edge is provisioned and starts ALLOWing
 * actions. Mid-flight, the agent reports a falsified subject claim
 * ("agent:other-uav" instead of its own id) — the commit gate must
 * REFUSE with SUBJECT_MISMATCH.
 */
export const GPS_SPOOF_MID_MISSION: { id: string; steps: ScenarioStep[] } = {
  id: "gps-spoof-mid-mission",
  steps: [
    { kind: "issue_envelope", edgeId: "uav-01", allowedActionTypes: ["uav.fly"] },
    { kind: "issue_fluidity", edgeId: "uav-01" },
    { kind: "evaluate", edgeId: "uav-01", actionType: "uav.fly", params: { waypoint: "A" } },
    { kind: "evaluate", edgeId: "uav-01", actionType: "uav.fly", params: { waypoint: "B" } },
    { kind: "inject_spoof", edgeId: "uav-01", actionType: "uav.fly", falseSubject: "agent:uav-99" },
    { kind: "evaluate", edgeId: "uav-01", actionType: "uav.fly", params: { waypoint: "C" } }
  ]
};

/**
 * Flash revocation: agent issues a couple of warrants nominally, root
 * revokes the envelope; gossip reaches the witness-path edge promptly
 * and subsequent evaluate() refuses. Step 5 must refuse with
 * ENVELOPE_REVOKED.
 */
export const FLASH_REVOCATION: { id: string; steps: ScenarioStep[] } = {
  id: "flash-revocation",
  steps: [
    { kind: "issue_envelope", edgeId: "agent-01", allowedActionTypes: ["chaos.do"] },
    { kind: "issue_fluidity", edgeId: "agent-01" },
    { kind: "evaluate", edgeId: "agent-01", actionType: "chaos.do" },
    { kind: "revoke", targetEnvelopeId: "env-agent-01" },
    { kind: "evaluate", edgeId: "agent-01", actionType: "chaos.do" }
  ]
};

/**
 * Partition + reconcile-with-conflict: edge is partitioned from root,
 * issues a warrant locally, then root retroactively revokes the
 * envelope (the revocation timestamp predates the warrant by clock
 * skew is NOT modeled — we count any envelope revocation before
 * reconciliation as a conflict candidate). Heal + reconcile produces
 * one conflict.
 */
export const PARTITION_RECONCILE: { id: string; steps: ScenarioStep[] } = {
  id: "partition-reconcile",
  steps: [
    { kind: "issue_envelope", edgeId: "edge-01", allowedActionTypes: ["chaos.do"], expiresInMs: 60_000 },
    { kind: "issue_fluidity", edgeId: "edge-01", ttlMs: 60_000 },
    { kind: "partition", edgeId: "edge-01", from: "root" },
    { kind: "partition", edgeId: "edge-01", from: "witness-0" },
    { kind: "evaluate", edgeId: "edge-01", actionType: "chaos.do" }, // ALLOW under FT
    { kind: "evaluate", edgeId: "edge-01", actionType: "chaos.do" },
    { kind: "heal", edgeId: "edge-01", from: "root" },
    { kind: "heal", edgeId: "edge-01", from: "witness-0" },
    { kind: "reconcile", edgeId: "edge-01" }
  ]
};

export type { CommitDecision, CommitRequest };
