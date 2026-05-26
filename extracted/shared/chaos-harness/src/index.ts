/**
 * @aristotle/chaos-harness — failure-mode test harness for the
 * AristotleOS governance mesh.
 *
 * Each scenario drives the real mesh-runtime (RootNode / WitnessNode /
 * EdgeNode) through a specific failure pattern and returns a
 * deterministic scorecard. The harness is intentionally NOT a
 * randomized fuzzer — every scenario has an expected outcome that
 * holds true across runs, so CI can assert on it.
 *
 * Scenarios shipped here cover the audit's substrate #6 failure modes:
 *
 *   - revocation_lag       — revocation racing across a partitioned
 *                            witness; assert the witness-reachable
 *                            edge refuses immediately and the
 *                            fully-isolated edge keeps issuing until
 *                            Fluidity Token TTL.
 *   - malicious_envelope   — a node-other-than-root forges an envelope
 *                            signature with the wrong secret and tries
 *                            to inject it into an edge cache; assert
 *                            the edge rejects it and never issues
 *                            warrants under it.
 *   - hallucinated_command — an agent attempts an action_type the
 *                            envelope does not allow; assert REFUSE
 *                            with ACTION_OUTSIDE_ENVELOPE every time.
 *   - fluidity_ttl_expiry  — an edge is partitioned past Fluidity Token
 *                            TTL; assert it returns EXPIRE rather than
 *                            ALLOW or REFUSE.
 *   - quota_exhaustion     — an edge with maxWarrantsWhileDisconnected:N
 *                            is partitioned and asked for N+k actions;
 *                            assert the first N return ALLOW and
 *                            actions N+1..N+k return REFUSE with
 *                            DISCONNECTED_QUOTA_EXCEEDED.
 *
 * The output is a {@link ChaosScorecard} object: a stable shape that
 * CI / dashboards can read without parsing prose.
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

const SECRET = "aos-demo-chaos-secret";
const FORGED_SECRET = "attacker-forged-secret";

export interface ChaosScorecard {
  scenario: string;
  /** True when every per-step expectation in the scenario held. */
  passed: boolean;
  /** Stable counters by name. CI can assert on these. */
  counters: Record<string, number>;
  /** Per-step expectation results (one entry per assertion the scenario evaluated). */
  expectations: Array<{ what: string; expected: unknown; observed: unknown; ok: boolean }>;
}

function expect<T>(report: ChaosScorecard, what: string, expected: T, observed: T): void {
  const ok = JSON.stringify(expected) === JSON.stringify(observed);
  report.expectations.push({ what, expected, observed, ok });
  if (!ok) report.passed = false;
}

function bump(report: ChaosScorecard, key: string, by = 1): void {
  report.counters[key] = (report.counters[key] ?? 0) + by;
}

function defaultReport(scenario: string): ChaosScorecard {
  return { scenario, passed: true, counters: {}, expectations: [] };
}

interface MeshBundle {
  root: RootNode;
  witnesses: WitnessNode[];
  edges: EdgeNode[];
  unbind: () => void;
}

function bringUpMesh(opts: {
  witnessCount?: number;
  edgeCount: number;
  maxWarrantsWhileDisconnected?: number;
  edgePrefix?: string;
}): MeshBundle {
  const witnessCount = opts.witnessCount ?? 1;
  const edgePrefix = opts.edgePrefix ?? "edge";
  const root = new RootNode({ id: "root", host: "127.0.0.1", port: 0, secret: SECRET });
  const witnesses: WitnessNode[] = [];
  for (let i = 0; i < witnessCount; i++) {
    witnesses.push(new WitnessNode({ id: `witness-${i}`, host: "127.0.0.1", port: 0, secret: SECRET }));
  }
  const edges: EdgeNode[] = [];
  for (let i = 0; i < opts.edgeCount; i++) {
    edges.push(new EdgeNode({
      id: `${edgePrefix}-${String(i).padStart(2, "0")}`,
      host: "127.0.0.1", port: 0, secret: SECRET,
      maxWarrantsWhileDisconnected: opts.maxWarrantsWhileDisconnected ?? 100
    }));
  }
  const all = [root, ...witnesses, ...edges];
  const ids: NodeId[] = all.map((n) => n.asNodeId());
  for (const n of all) n.setPeers(ids.filter((p) => p.id !== n.getId()));
  const unbind = bindRegistry(all);
  return { root, witnesses, edges, unbind };
}

// ---------------------------------------------------------------------------
// Scenario: revocation_lag
// ---------------------------------------------------------------------------

export async function runRevocationLagScenario(opts: { edgeCount?: number; fluidityTtlMs?: number } = {}): Promise<ChaosScorecard> {
  const edgeCount = opts.edgeCount ?? 4;
  const fluidityTtlMs = opts.fluidityTtlMs ?? 1200;
  const report = defaultReport("revocation_lag");
  const mesh = bringUpMesh({ witnessCount: 1, edgeCount });

  try {
    for (let i = 0; i < edgeCount; i++) {
      mesh.root.issueEnvelope({
        envelope_id: `env-${mesh.edges[i].getId()}`,
        mae_id: "mae-chaos",
        ward_id: "ward-chaos",
        subject: `agent:${mesh.edges[i].getId()}`,
        allowed_action_types: ["chaos.do"],
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
        version: 1
      });
    }
    await new Promise((r) => setTimeout(r, 30));
    for (let i = 0; i < edgeCount; i++) {
      const tok = mesh.root.issueFluidityToken({
        edge_id: mesh.edges[i].getId(),
        envelope_id: `env-${mesh.edges[i].getId()}`,
        ttl_ms: fluidityTtlMs
      });
      mesh.edges[i].receiveFluidityToken(tok);
    }

    // Half the edges keep the witness path; the other half is fully isolated.
    const witnessReachable = mesh.edges.slice(0, Math.floor(edgeCount / 2));
    const fullyIsolated = mesh.edges.slice(Math.floor(edgeCount / 2));
    for (const e of witnessReachable) {
      e.partitionFrom("root");
    }
    for (const e of fullyIsolated) {
      e.partitionFrom("root");
      e.partitionFrom("witness-0");
    }

    // Revoke every envelope at the root.
    for (let i = 0; i < edgeCount; i++) {
      await mesh.root.revoke(`env-${mesh.edges[i].getId()}`, "envelope", "chaos-revoke");
      bump(report, "revocations_issued");
    }
    // Let gossip reach the witness-reachable half.
    await new Promise((r) => setTimeout(r, 50));

    // Witness-reachable edges should now REFUSE (they saw the revocation).
    for (const e of witnessReachable) {
      const d = await e.evaluate(reqFor(e.getId()));
      if (d.decision === "REFUSE") bump(report, "witness_half_refused");
      else bump(report, "witness_half_other");
    }
    // Fully-isolated edges should still ALLOW (haven't seen revocation).
    for (const e of fullyIsolated) {
      const d = await e.evaluate(reqFor(e.getId()));
      if (d.decision === "ALLOW") bump(report, "isolated_half_allowed");
      else bump(report, "isolated_half_other");
    }

    expect(report, "witness-reachable edges all refused", witnessReachable.length, report.counters["witness_half_refused"] ?? 0);
    expect(report, "fully-isolated edges still allowed (no gossip)", fullyIsolated.length, report.counters["isolated_half_allowed"] ?? 0);
  } finally {
    mesh.unbind();
  }
  return report;
}

// ---------------------------------------------------------------------------
// Scenario: malicious_envelope
//
// An attacker tries to inject a forged AuthorityEnvelope into an edge's
// cache by directly invoking the edge's mesh handler with a wrong-secret
// signature. The edge must reject the envelope; subsequent evaluate()
// against the forged envelope_id must REFUSE with UNKNOWN_ENVELOPE.
// ---------------------------------------------------------------------------

export async function runMaliciousEnvelopeScenario(): Promise<ChaosScorecard> {
  const report = defaultReport("malicious_envelope");
  const mesh = bringUpMesh({ edgeCount: 1 });
  try {
    const edge = mesh.edges[0];
    // Construct a "rogue root" that signs envelopes with the WRONG secret.
    // It will propagate a malicious envelope; the edge verifies the signature
    // against its own secret and must reject the envelope outright.
    const evilRoot = new RootNode({ id: "evil-root", host: "127.0.0.1", port: 0, secret: FORGED_SECRET });
    evilRoot.setPeers([edge.asNodeId()]);
    edge.setPeers([mesh.root.asNodeId(), evilRoot.asNodeId()]);
    // Register evilRoot under the same bindRegistry pool by binding a
    // small extra registry on top. The harness's bindRegistry already
    // exposed mesh.root + edges; we explicitly add evilRoot.
    const extraUnbind = bindRegistry([evilRoot, ...mesh.witnesses, ...mesh.edges, mesh.root]);
    try {
      const env = evilRoot.issueEnvelope({
        envelope_id: "env-forged",
        mae_id: "mae-attacker",
        ward_id: "ward-attacker",
        subject: `agent:${edge.getId()}`,
        allowed_action_types: ["chaos.do"],
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
        version: 1
      });
      bump(report, "forged_envelopes_attempted");
      // Let async propagation try.
      await new Promise((r) => setTimeout(r, 50));

      // Edge MUST NOT have cached the forged envelope.
      const cached = edge.cachedEnvelopeCount();
      expect(report, "edge did not accept forged envelope (cache count = 0)", 0, cached);
      // Evaluate an action against the forged envelope id. Expect REFUSE / UNKNOWN_ENVELOPE.
      const d = await edge.evaluate({
        action_id: "act-forged",
        action_type: "chaos.do",
        envelope_id: env.envelope_id,
        subject: `agent:${edge.getId()}`,
        params: {},
        presented_at: new Date().toISOString()
      });
      expect(report, "evaluate against forged envelope_id refuses", "REFUSE", d.decision);
      if (d.decision === "REFUSE") {
        expect(report, "reason_code is UNKNOWN_ENVELOPE", true, d.reason_codes.includes("UNKNOWN_ENVELOPE"));
      }
    } finally {
      extraUnbind();
    }
  } finally {
    mesh.unbind();
  }
  return report;
}

// ---------------------------------------------------------------------------
// Scenario: hallucinated_command
//
// An agent attempts an action_type the envelope does not allow. The
// edge must REFUSE every such attempt with ACTION_OUTSIDE_ENVELOPE.
// We run it `attempts` times to make sure the disconnected-cap
// behavior doesn't accidentally flip the decision.
// ---------------------------------------------------------------------------

export async function runHallucinatedCommandScenario(opts: { attempts?: number } = {}): Promise<ChaosScorecard> {
  const attempts = opts.attempts ?? 50;
  const report = defaultReport("hallucinated_command");
  const mesh = bringUpMesh({ edgeCount: 1, maxWarrantsWhileDisconnected: 10 });
  try {
    const edge = mesh.edges[0];
    mesh.root.issueEnvelope({
      envelope_id: `env-${edge.getId()}`,
      mae_id: "mae-chaos",
      ward_id: "ward-chaos",
      subject: `agent:${edge.getId()}`,
      allowed_action_types: ["chaos.do"],
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      version: 1
    });
    await new Promise((r) => setTimeout(r, 30));
    const tok = mesh.root.issueFluidityToken({
      edge_id: edge.getId(),
      envelope_id: `env-${edge.getId()}`,
      ttl_ms: 60_000
    });
    edge.receiveFluidityToken(tok);

    for (let i = 0; i < attempts; i++) {
      const d = await edge.evaluate({
        action_id: `act-evil-${i}`,
        action_type: "chaos.exfil_secrets", // NOT in allowed_action_types
        envelope_id: `env-${edge.getId()}`,
        subject: `agent:${edge.getId()}`,
        params: { index: i },
        presented_at: new Date().toISOString()
      });
      if (d.decision === "REFUSE" && d.reason_codes.includes("ACTION_OUTSIDE_ENVELOPE")) {
        bump(report, "hallucinated_refused");
      } else {
        bump(report, "hallucinated_other");
      }
    }
    expect(report, "every hallucinated action refused", attempts, report.counters["hallucinated_refused"] ?? 0);
  } finally {
    mesh.unbind();
  }
  return report;
}

// ---------------------------------------------------------------------------
// Scenario: fluidity_ttl_expiry
// ---------------------------------------------------------------------------

export async function runFluidityTtlExpiryScenario(opts: { ttlMs?: number; sleepBufferMs?: number } = {}): Promise<ChaosScorecard> {
  const ttlMs = opts.ttlMs ?? 150;
  const sleepBufferMs = opts.sleepBufferMs ?? 30;
  const report = defaultReport("fluidity_ttl_expiry");
  const mesh = bringUpMesh({ edgeCount: 1 });
  try {
    const edge = mesh.edges[0];
    mesh.root.issueEnvelope({
      envelope_id: `env-${edge.getId()}`,
      mae_id: "mae-chaos",
      ward_id: "ward-chaos",
      subject: `agent:${edge.getId()}`,
      allowed_action_types: ["chaos.do"],
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      version: 1
    });
    await new Promise((r) => setTimeout(r, 30));
    const tok = mesh.root.issueFluidityToken({
      edge_id: edge.getId(),
      envelope_id: `env-${edge.getId()}`,
      ttl_ms: ttlMs
    });
    edge.receiveFluidityToken(tok);

    // Before TTL: ALLOW
    const before = await edge.evaluate(reqFor(edge.getId()));
    expect(report, "ALLOW before TTL", "ALLOW", before.decision);
    if (before.decision === "ALLOW") bump(report, "before_ttl_allowed");

    // Partition + wait past TTL.
    edge.partitionFrom("root");
    await new Promise((r) => setTimeout(r, ttlMs + sleepBufferMs));

    const after = await edge.evaluate(reqFor(edge.getId()));
    expect(report, "EXPIRE after TTL", "EXPIRE", after.decision);
    if (after.decision === "EXPIRE") bump(report, "after_ttl_expired");
  } finally {
    mesh.unbind();
  }
  return report;
}

// ---------------------------------------------------------------------------
// Scenario: quota_exhaustion
// ---------------------------------------------------------------------------

export async function runQuotaExhaustionScenario(opts: { quota?: number; overshoot?: number } = {}): Promise<ChaosScorecard> {
  const quota = opts.quota ?? 5;
  const overshoot = opts.overshoot ?? 3;
  const report = defaultReport("quota_exhaustion");
  const mesh = bringUpMesh({ edgeCount: 1, maxWarrantsWhileDisconnected: quota });
  try {
    const edge = mesh.edges[0];
    mesh.root.issueEnvelope({
      envelope_id: `env-${edge.getId()}`,
      mae_id: "mae-chaos",
      ward_id: "ward-chaos",
      subject: `agent:${edge.getId()}`,
      allowed_action_types: ["chaos.do"],
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      version: 1
    });
    await new Promise((r) => setTimeout(r, 30));
    const tok = mesh.root.issueFluidityToken({
      edge_id: edge.getId(),
      envelope_id: `env-${edge.getId()}`,
      ttl_ms: 60_000
    });
    edge.receiveFluidityToken(tok);

    edge.partitionFrom("root");
    edge.partitionFrom("witness-0");
    for (let i = 0; i < quota + overshoot; i++) {
      const d = await edge.evaluate(reqFor(edge.getId(), i));
      if (d.decision === "ALLOW") bump(report, "allowed_under_quota");
      else if (d.decision === "REFUSE" && d.reason_codes.includes("DISCONNECTED_QUOTA_EXCEEDED")) bump(report, "refused_quota_exceeded");
      else bump(report, `other_${d.decision}`);
    }
    expect(report, "first N=quota requests allowed", quota, report.counters["allowed_under_quota"] ?? 0);
    expect(report, "subsequent overshoot all DISCONNECTED_QUOTA_EXCEEDED", overshoot, report.counters["refused_quota_exceeded"] ?? 0);
  } finally {
    mesh.unbind();
  }
  return report;
}

// ---------------------------------------------------------------------------
// runAllChaosScenarios — convenience for CI
// ---------------------------------------------------------------------------

export async function runAllChaosScenarios(): Promise<{
  scorecards: ChaosScorecard[];
  passed: number;
  failed: number;
}> {
  const scorecards = [
    await runRevocationLagScenario(),
    await runMaliciousEnvelopeScenario(),
    await runHallucinatedCommandScenario(),
    await runFluidityTtlExpiryScenario(),
    await runQuotaExhaustionScenario()
  ];
  let passed = 0, failed = 0;
  for (const sc of scorecards) {
    if (sc.passed) passed++; else failed++;
  }
  return { scorecards, passed, failed };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function reqFor(edgeId: string, n = 0): CommitRequest {
  return {
    action_id: `act-${edgeId}-${n}`,
    action_type: "chaos.do",
    envelope_id: `env-${edgeId}`,
    subject: `agent:${edgeId}`,
    params: { n },
    presented_at: new Date().toISOString()
  };
}

export type { CommitDecision };
