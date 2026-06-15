import { FlaskConical, Play, Radar, Sparkles } from "lucide-react";
import React from "react";
import { ENVELOPES } from "./mockData.js";
import type { SimulationOutcome } from "./types.js";
import { Badge, Metric, Panel, cx, decisionTone } from "./primitives.js";
import { useCommandStore } from "./store.js";

interface Scenario {
  id: string;
  label: string;
  question: string;
  run: () => SimulationOutcome;
}

const SCENARIOS: Scenario[] = [
  {
    id: "revoke",
    label: "Revoke authority envelope",
    question: "What if ae-survey-001 were revoked right now?",
    run: () => ({
      decision: "refuse",
      rationale: "With the envelope revoked, the Commit Gate finds no scoped authority for the subject. Action refused before execution; revocation propagates on the bus within ~800ms.",
      reasonCodes: ["AUTHORITY_REVOKED"],
      invariants: [{ id: "i1", name: "Envelope present", expression: "envelope ∈ ward", result: "fail" }]
    })
  },
  {
    id: "retry",
    label: "Agent retries refused action",
    question: "What if SURVEYOR-7 retried drone.disable_geofence?",
    run: () => ({
      decision: "refuse",
      rationale: "The action is in the envelope's denied set and violates a physical invariant. The decision is deterministic — retries produce the same refusal and are recorded as replay attempts.",
      reasonCodes: ["ACTION_DENIED", "REPLAY_DETECTED"],
      invariants: [{ id: "i1", name: "Geofence containment", expression: "boundary ∈ permitted", result: "fail" }]
    })
  },
  {
    id: "partition",
    label: "Network partition",
    question: "What if the gate were partitioned from the ledger?",
    run: () => ({
      decision: "fail-closed",
      rationale: "Without a path to write durable evidence and confirm fresh authority, the gate fails closed. No warrant is issued; the agent operates only within previously cached, still-valid authority.",
      reasonCodes: ["PARTITION_FAIL_CLOSED"],
      invariants: [{ id: "i1", name: "Evidence reachable", expression: "ledger.reachable = true", result: "fail" }]
    })
  },
  {
    id: "latency",
    label: "Latency exceeds threshold",
    question: "What if gate latency exceeded the SLA?",
    run: () => ({
      decision: "escalate",
      rationale: "When the pipeline cannot decide within the deterministic budget, the gate escalates rather than guessing. A human authority is asked to adjudicate; the action holds.",
      reasonCodes: ["LATENCY_BUDGET_EXCEEDED"],
      invariants: [{ id: "i1", name: "Decision budget", expression: "latency ≤ budget", result: "fail" }]
    })
  },
  {
    id: "physical",
    label: "Physical invariant violated",
    question: "What if altitude exceeded 120m mid-action?",
    run: () => ({
      decision: "refuse",
      rationale: "The Physical Invariant Gater holds independently of software governance. A hard interlock refuses the action and asserts containment even if software authority existed.",
      reasonCodes: ["PHYSICAL_INVARIANT_FAILED"],
      invariants: [{ id: "i1", name: "Altitude ceiling", expression: "altitude_m ≤ 120", result: "fail" }]
    })
  }
];

export function SimulationPanel() {
  const [scenarioId, setScenarioId] = React.useState<string>(SCENARIOS[0].id);
  const [outcome, setOutcome] = React.useState<SimulationOutcome | null>(null);
  const [runningVertical, setRunningVertical] = React.useState(false);
  const swarmResult = useCommandStore((s) => s.swarmAirspaceSimulation);
  const reconciliation = swarmResult?.reconciliation;
  const runSwarmAirspaceSimulation = useCommandStore((s) => s.runSwarmAirspaceSimulation);
  const setSection = useCommandStore((s) => s.setSection);
  const selectVertical = useCommandStore((s) => s.selectVertical);
  const scenario = SCENARIOS.find((s) => s.id === scenarioId)!;
  const openSwarmVertical = () => {
    selectVertical("swarm");
    setSection("vertical-detail");
  };
  const runVerticalSimulation = async () => {
    setRunningVertical(true);
    try {
      await runSwarmAirspaceSimulation();
    } finally {
      setRunningVertical(false);
    }
  };

  return (
    <div className="ac-grid" style={{ gridTemplateColumns: "1fr", gap: 14, alignItems: "start" }}>
      <Panel title="Vertical Simulation Hub" icon={<Radar size={15} />} right={<Badge tone="green">primary</Badge>}>
        <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(260px, 0.55fr)", gap: 14, alignItems: "start" }}>
          <div>
            <div className="ac-label">Flagship live run</div>
            <h2 style={{ margin: "4px 0 8px", fontSize: 20 }}>UAV swarm partition reconciliation</h2>
            <p className="ac-muted" style={{ marginTop: 0 }}>
              The generic simulation tab now points first to vertical proof: a 40-UAV swarm run with mixed connectivity, authority change during partition, degraded allowed actions, blocked mission expansion, reconnect, and classified reconciliation evidence.
            </p>
            <div className="ac-chip-row" style={{ marginBottom: 12 }}>
              <span className="ac-chip">UAV Swarm vertical</span>
              <span className="ac-chip">Aviation constraints</span>
              <span className="ac-chip">Gateway + GEL</span>
              <span className="ac-chip">Partition reconciliation</span>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="ac-btn is-primary" onClick={() => void runVerticalSimulation()} disabled={runningVertical}>
                <Play size={14} /> {runningVertical ? "Running..." : "Run partition drill"}
              </button>
              <button className="ac-btn" onClick={openSwarmVertical}>
                <Radar size={14} /> Open Swarm vertical
              </button>
            </div>
            {swarmResult ? (
              <div className="ac-code-block" style={{ marginTop: 12, minHeight: 36 }}>
                <span className="ac-code-line">{swarmResult.scenarioId}</span>
                <span className="ac-code-line">airspace: {swarmResult.airspace.authorization} / {swarmResult.airspace.corridorRevision}</span>
              </div>
            ) : null}
          </div>
          <div className="ac-adoption-kpis">
            <Metric label="Swarm size" value={swarmResult?.swarmSize ?? 40} tone="cyan" />
            <Metric label="Continue" value={swarmResult?.allowedUnits ?? "-"} tone="green" />
            <Metric label="Reroute" value={swarmResult?.reroutedUnits ?? "-"} tone="amber" />
            <Metric label="Hold-safe" value={swarmResult?.haltedUnits ?? "-"} tone="red" />
            <Metric label="Reconciled" value={reconciliation?.actionsTotal ?? "-"} tone="cyan" />
            <Metric label="Blocked" value={reconciliation?.blockedMissionExpansions ?? "-"} tone="red" />
          </div>
        </div>
      </Panel>

      <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.2fr)", alignItems: "start" }}>
        <Panel title="Local Counterfactual Dry Runs" icon={<FlaskConical size={15} />} right={<Badge tone="slate">secondary</Badge>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {SCENARIOS.map((s) => (
              <button
                key={s.id}
                className={cx("ac-ops-btn", scenarioId === s.id && "is-active")}
                style={scenarioId === s.id ? { borderColor: "var(--ac-cyan-dim)", background: "rgba(56,212,232,0.06)" } : undefined}
                onClick={() => { setScenarioId(s.id); setOutcome(null); }}
              >
                <span className="ic"><Sparkles size={15} /></span>
                <span>
                  <span className="t">{s.label}</span>
                  <span className="d">{s.question}</span>
                </span>
              </button>
            ))}
            <button className="ac-btn" style={{ justifyContent: "center", marginTop: 4 }} onClick={() => setOutcome(scenario.run())}>
              <Play size={14} /> Run dry run
            </button>
          </div>
        </Panel>

        <Panel title="Dry-Run Outcome" icon={<FlaskConical size={15} />}>
          {outcome ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span className="ac-label">Commit gate would</span>
                <span className={cx("ac-badge", `t-${decisionTone(outcome.decision)}`)} style={{ fontSize: 13, padding: "5px 12px" }}>
                  {outcome.decision.replace("-", " ").toUpperCase()}
                </span>
              </div>
              <div>
                <div className="ac-label" style={{ marginBottom: 6 }}>Reason codes</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {outcome.reasonCodes.map((c) => <Badge key={c} tone={decisionTone(outcome.decision)}>{c}</Badge>)}
                </div>
              </div>
              <div>
                <div className="ac-label" style={{ marginBottom: 6 }}>Rationale</div>
                <p style={{ margin: 0, fontSize: 13, color: "var(--ac-text-2)", lineHeight: 1.55 }}>{outcome.rationale}</p>
              </div>
              <div>
                <div className="ac-label" style={{ marginBottom: 6 }}>Decisive invariant</div>
                {outcome.invariants.map((i) => (
                  <div key={i.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                    <span className="ac-mono ac-muted">{i.expression}</span>
                    <Badge tone={i.result === "pass" ? "green" : "red"}>{i.result}</Badge>
                  </div>
                ))}
              </div>
              <div className="ac-confirm-warn" style={{ background: "rgba(56,212,232,0.06)", borderColor: "var(--ac-cyan-dim)", color: "var(--ac-text-2)" }}>
                <FlaskConical size={15} color="var(--ac-cyan)" /> Local dry run only. Use vertical simulations for recorded gateway/GEL counterfactuals.
              </div>
            </div>
          ) : (
            <div className="ac-empty">Choose a local dry run, or use the vertical simulation above for recorded live evidence.</div>
          )}
        </Panel>
      </div>
    </div>
  );
}
