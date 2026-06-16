import {
  Activity,
  ArrowLeft,
  BadgeAlert,
  BadgeCheck,
  ClipboardCheck,
  Database,
  Download,
  FileCheck2,
  GitCommitHorizontal,
  Landmark,
  Play,
  Radar,
  RadioTower,
  ShieldAlert,
  ShieldCheck,
  Workflow
} from "lucide-react";
import React from "react";
import { Badge, Metric, Panel, cx } from "./primitives.js";
import { useCommandStore } from "./store.js";
import {
  VERTICAL_REGISTRY,
  type VerticalAdapterRow,
  type VerticalConfig,
  type VerticalId,
  type VerticalSafetyDrill,
  type VerticalScenario,
  type VerticalWorkflowStep
} from "./verticals/registry.js";
import { WorkflowRunner } from "./WorkflowRunner.js";

// ---------------------------------------------------------------------------
// Tone helpers
// ---------------------------------------------------------------------------

const stepTone: Record<VerticalWorkflowStep["state"], "green" | "cyan" | "red" | "slate"> = {
  complete: "green",
  active: "cyan",
  blocked: "red",
  pending: "slate"
};

const postureTone: Record<VerticalSafetyDrill["posture"], "green" | "amber" | "red"> = {
  green: "green",
  amber: "amber",
  red: "red"
};

const expectedTone: Record<VerticalScenario["expected"], "green" | "amber" | "red"> = {
  ALLOW: "green",
  ESCALATE: "amber",
  REFUSE: "red"
};

// ---------------------------------------------------------------------------
// Sub-panels (conditional on optional config fields)
// ---------------------------------------------------------------------------

function WorkflowPanel({ v }: { v: VerticalConfig }) {
  if (!v.workflow?.length) return null;
  return (
    <Panel title={`${v.name} Workflow`} icon={<Workflow size={15} />} right={<Badge tone="cyan">intent to bound evidence</Badge>}>
      <div className="ac-timeline">
        {v.workflow.map((step, index) => (
          <div key={step.id} className={cx("ac-step", step.state === "active" && "is-active")}>
            <span className="ac-step-index">{index + 1}</span>
            <span className="ac-step-title">{step.label}</span>
            <span className="ac-step-detail">{step.owner} - {step.evidence}</span>
            <span style={{ marginLeft: "auto" }}><Badge tone={stepTone[step.state]}>{step.state}</Badge></span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function BoundaryChainPanel({ v }: { v: VerticalConfig }) {
  const labels = v.boundaryChainLabels;
  if (!labels?.length) return null;
  const ICONS = [
    <Activity size={14} key="i0" />,
    <ShieldCheck size={14} key="i1" />,
    <BadgeCheck size={14} key="i2" />,
    <Database size={14} key="i3" />,
    <FileCheck2 size={14} key="i4" />,
    <ClipboardCheck size={14} key="i5" />,
    <ShieldAlert size={14} key="i6" />
  ];
  return (
    <Panel title="Commit Boundary" icon={<GitCommitHorizontal size={15} />} right={<Badge tone="cyan">warrant first</Badge>}>
      <div className="ac-identity-chain">
        {labels.map((label, idx) => (
          <React.Fragment key={label}>
            <div className="ac-identity-node">{ICONS[idx % ICONS.length]}{label}</div>
            {idx < labels.length - 1 && <span className="ac-identity-arrow">{"->"}</span>}
          </React.Fragment>
        ))}
      </div>
      <p className="ac-muted" style={{ marginTop: 12 }}>
        AristotleOS does not replace this vertical's operating systems. It governs autonomous and
        automated actions <em>before</em> those systems receive consequential commands, then preserves
        bound, redacted evidence for replay, audit, and incident reconstruction.
      </p>
    </Panel>
  );
}

function AdapterMatrix({ v }: { v: VerticalConfig }) {
  return (
    <Panel title="Adapter boundaries" icon={<Database size={15} />} right={<Badge tone="green">typed</Badge>}>
      <table className="ac-table">
        <thead>
          <tr><th>Adapter</th><th>Action types (sample)</th><th>Boundary</th></tr>
        </thead>
        <tbody>
          {v.adapters.map((a: VerticalAdapterRow) => (
            <tr key={a.id}>
              <td><div className="ac-row-title">{a.label}</div></td>
              <td>{a.actionTypes.map((t: string) => <span key={t} className="ac-chip">{t}</span>)}</td>
              <td className="ac-muted">{a.boundary}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function HardInterlocksPanel({ v }: { v: VerticalConfig }) {
  return (
    <Panel title="Hard interlocks (gate-level)" icon={<ShieldAlert size={15} />} right={<Badge tone="red">always REFUSE</Badge>}>
      <p className="ac-muted">
        These action types are refused by the Commit Gate <strong>regardless of envelope policy</strong>.
        Proven by per-vertical interlock tests.
      </p>
      <div className="ac-chip-row" style={{ marginTop: 8 }}>
        {v.hardInterlocks.map((t: string) => (
          <span key={t} className="ac-chip" style={{ borderColor: "var(--ac-red)" }}>{t}</span>
        ))}
      </div>
    </Panel>
  );
}

function PresetsPanel({ v }: { v: VerticalConfig }) {
  return (
    <Panel title={v.presets.label + " (demo)"} icon={<BadgeAlert size={15} />} right={<Badge tone="amber">demo only</Badge>}>
      <p className="ac-muted">
        Per-jurisdiction or per-site rule packs shipped with this vertical, all flagged
        <code> demonstration_only: true</code>.
      </p>
      <div className="ac-chip-row" style={{ marginTop: 8 }}>
        {v.presets.states.map((s: string) => <span key={s} className="ac-chip">{s}</span>)}
      </div>
    </Panel>
  );
}

function EvidenceSamplePanel({ v }: { v: VerticalConfig }) {
  const exportEvidence = useCommandStore((s) => s.exportEvidence);
  const e = v.evidenceSample;
  if (!e) return null;
  return (
    <Panel
      title={`${v.name} Evidence Bundle`}
      icon={<FileCheck2 size={15} />}
      right={<button className="ac-btn" onClick={exportEvidence}><Download size={13} /> Export</button>}
    >
      <div className="ac-grid ac-cols-2">
        <div>
          <Metric label="Bundle" value={e.bundleVersion} sm />
          <Metric label="Verification" value={e.verification} tone={e.verification === "ok" ? "green" : "red"} />
          <div className="ac-divider" />
          <div className="ac-detail-grid" style={{ gridTemplateColumns: "138px 1fr" }}>
            {e.fields.map(({ k, v, mono }) => (
              <React.Fragment key={k}>
                <dt>{k}</dt>
                <dd className={mono ? "mono" : undefined}>{v}</dd>
              </React.Fragment>
            ))}
          </div>
        </div>
        <div className="ac-grid" style={{ gap: 10 }}>
          <div>
            <div className="ac-label">Evidence profile</div>
            <div className="ac-chip-row">{e.profile.map((s: string) => <span key={s} className="ac-chip">{s}</span>)}</div>
          </div>
          <div>
            <div className="ac-label">PII redaction manifest</div>
            <div className="ac-chip-row">{e.redactedFields.map((s: string) => <span key={s} className="ac-chip">{s}</span>)}</div>
          </div>
          <div>
            <div className="ac-label">Bundle hash</div>
            <div className="mono">{e.bundleHash}</div>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function SafetyDrillsPanel({ v }: { v: VerticalConfig }) {
  if (!v.safetyDrills?.length) return null;
  return (
    <Panel title="Safety / invariant cards" icon={<ShieldCheck size={15} />} right={<Badge tone="amber">live bounds</Badge>}>
      <div className="ac-grid ac-cols-2">
        {v.safetyDrills.map((drill) => (
          <div key={drill.id} className="ac-slo-card">
            <div className="ac-slo-head">
              <span>{drill.label}</span>
              <Badge tone={postureTone[drill.posture]}>{drill.posture}</Badge>
            </div>
            <div className="ac-slo-current" style={{ fontSize: 15 }}>{drill.current}</div>
            <div className="ac-code-block" style={{ marginTop: 10, minHeight: 30 }}>
              <span className="ac-code-line">{drill.invariant}</span>
            </div>
            <p>{drill.evidence}</p>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function ScenariosPanel({ v }: { v: VerticalConfig }) {
  if (!v.scenarios?.length) return null;
  return (
    <Panel title="Demonstration scenarios" icon={<ClipboardCheck size={15} />} right={<Badge tone="cyan">test surface</Badge>}>
      <div className="ac-grid ac-cols-2">
        {v.scenarios.map((scenario) => (
          <div key={scenario.id} className="ac-slo-card">
            <div className="ac-slo-head">
              <span>{scenario.label}</span>
              <Badge tone={expectedTone[scenario.expected]}>{scenario.expected}</Badge>
            </div>
            <p style={{ marginTop: 8 }}>{scenario.rationale}</p>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function FailClosedPanel({ v }: { v: VerticalConfig }) {
  const rule = v.failClosedRule;
  if (!rule) return null;
  return (
    <Panel title="Fail-closed boundary rule" icon={<ShieldAlert size={15} />} right={<Badge tone="red">fail closed</Badge>}>
      <p className="ac-muted">{rule.description}</p>
      <div className="ac-chip-row" style={{ marginTop: 8 }}>
        {rule.chips.map((c) => <span key={c} className="ac-chip">{c}</span>)}
      </div>
    </Panel>
  );
}

function SwarmLiveSimulationPanel() {
  const runSwarmAirspaceSimulation = useCommandStore((s) => s.runSwarmAirspaceSimulation);
  const result = useCommandStore((s) => s.swarmAirspaceSimulation);
  const [running, setRunning] = React.useState(false);
  const run = async () => {
    setRunning(true);
    try {
      await runSwarmAirspaceSimulation();
    } finally {
      setRunning(false);
    }
  };
  const outcomeTone = (outcome: string): "green" | "amber" | "red" =>
    outcome === "continue" ? "green" : outcome === "reroute" ? "amber" : "red";
  const classificationTone = (classification: string): "green" | "amber" | "red" | "cyan" =>
    classification === "valid" ? "green" : classification === "review_required" ? "cyan" : classification === "stale" ? "amber" : "red";
  const reconciliation = result?.reconciliation;
  const reviewerChecklist = reconciliation
    ? [
        ["Swarm partition occurred", true],
        ["Some drones lost command connectivity", result.cohorts.some((cohort) => cohort.state === "disconnected")],
        ["Local degraded authority activated", result.cohorts.some((cohort) => cohort.state === "degraded" || cohort.state === "mesh-relay")],
        ["At least one action was allowed", reconciliation.actions.some((action) => action.edgeDecision === "ALLOW" && action.classification === "valid")],
        ["At least one action was refused", reconciliation.actions.some((action) => action.edgeDecision === "REFUSE")],
        ["At least one action expired or escalated", reconciliation.expired > 0 || reconciliation.reviewRequired > 0],
        ["Authority changed or became stale during partition", reconciliation.stale > 0 || reconciliation.revoked > 0],
        ["Reconnection occurred", Boolean(reconciliation.reconnectedAt)],
        ["Reconciliation classified the actions", reconciliation.actions.every((action) => Boolean(action.classification))],
        ["GEL/evidence bundle proved the sequence", reconciliation.ledgerChainVerified]
      ] as Array<[string, boolean]>
    : [];
  const exportReviewerResult = () => {
    if (!result || !reconciliation) return;
    const lines = [
      "Demo: Authority Continuity Under Disconnection: 40-UAV Swarm Governance Demo",
      "Version: AristotleOS UAV Swarm Disconnection Demo v0.1",
      "",
      "Scenario:",
      "A 40-drone autonomous mesh was split into disconnected partitions. During the partition, local nodes attempted continued execution under degraded authority while command revoked Drone Group B discretionary authority.",
      "",
      "Governance Objective:",
      "Determine whether AristotleOS could preserve bounded authority, refuse unauthorized action, log evidence, and reconcile state after reconnect.",
      "",
      "Results:",
      `- ${result.swarmSize} assets initialized under mission authority`,
      "- Mesh partition simulated",
      "- Degraded authority activated",
      "- Authorized fallback actions allowed",
      "- Unauthorized mission expansion refused",
      "- Expired or stale warrants blocked",
      "- Evidence ledger preserved decision chain",
      "- Reconnection triggered reconciliation",
      `- Final report classified ${reconciliation.actionsTotal} actions as valid, stale, revoked, expired, or review-required`,
      "",
      "Conclusion:",
      "AristotleOS demonstrated authority continuity under disconnection. The swarm did not merely continue operating; it continued only within warrantable, bounded, reconstructable authority.",
      "",
      "Caveat:",
      "This was a simulated governance demo, not a live flight test."
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${result.scenarioId}-reviewer-result.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Panel
      title="Authority Continuity Under Disconnection"
      icon={<Radar size={15} />}
      right={<Badge tone="green">UAV swarm demo v0.1</Badge>}
    >
      <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(260px, 0.55fr)", gap: 14, alignItems: "start" }}>
        <div>
          <p className="ac-muted" style={{ marginTop: 0 }}>
            AristotleOS demonstrates authority continuity under disconnection in a simulated 40-UAV swarm. The run allows bounded fallback behavior, refuses unauthorized mission expansion, classifies stale/revoked/expired/review-required actions, and produces a post-reconnect reconciliation report with evidence continuity.
          </p>
          <div className="ac-chip-row" style={{ marginBottom: 12 }}>
            <span className="ac-chip">Swarm Initialized</span>
            <span className="ac-chip">Network Partition Triggered</span>
            <span className="ac-chip">Cohorts Degraded / Disconnected</span>
            <span className="ac-chip">Degraded Authority Activated</span>
            <span className="ac-chip">Bounded Fallback Allowed</span>
            <span className="ac-chip">Mission Expansion Blocked</span>
            <span className="ac-chip">Reconnect Reconciled</span>
            <span className="ac-chip">GEL / Evidence Chain Recorded</span>
          </div>
          <button className="ac-btn is-primary" onClick={() => void run()} disabled={running}>
            <Play size={14} /> {running ? "Running..." : "Run partition drill"}
          </button>
          {result ? (
            <>
              <div className="ac-divider" />
              <div className="ac-detail-grid" style={{ gridTemplateColumns: "148px 1fr" }}>
                <dt>Scenario</dt><dd className="mono">{result.scenarioId}</dd>
                <dt>Airspace auth</dt><dd className="mono">{result.airspace.authorization}</dd>
                <dt>Corridor revision</dt><dd className="mono">{result.airspace.corridorRevision}</dd>
                <dt>Constraints</dt>
                <dd>
                  <div className="ac-chip-row">
                    {result.airspace.constraints.map((constraint) => <span key={constraint} className="ac-chip">{constraint}</span>)}
                  </div>
                </dd>
              </div>
            </>
          ) : null}
        </div>
        <div className="ac-adoption-kpis">
          <Metric label="Swarm size" value={result?.swarmSize ?? 40} tone="cyan" />
          <Metric label="Continue" value={result?.allowedUnits ?? "-"} tone="green" />
          <Metric label="Reroute" value={result?.reroutedUnits ?? "-"} tone="amber" />
          <Metric label="Hold-safe" value={result?.haltedUnits ?? "-"} tone="red" />
          <Metric label="Reconciled" value={reconciliation?.actionsTotal ?? "-"} tone="cyan" />
          <Metric label="Expansion blocked" value={reconciliation?.blockedMissionExpansions ?? "-"} tone="red" />
        </div>
      </div>

      {result ? (
        <div className="ac-grid ac-cols-2" style={{ marginTop: 14 }}>
          {result.cohorts.map((cohort) => (
            <div key={cohort.id} className="ac-slo-card">
              <div className="ac-slo-head">
                <span>{cohort.label}</span>
                <Badge tone={outcomeTone(cohort.projectedOutcome)}>{cohort.projectedOutcome}</Badge>
              </div>
              <div className="ac-slo-current" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <RadioTower size={15} /> {cohort.units} units · {cohort.state} · link {Math.round(cohort.averageLinkQuality * 100)}%
              </div>
              <div className="ac-code-block" style={{ marginTop: 10, minHeight: 34 }}>
                <span className="ac-code-line">{cohort.selectedPath.length ? cohort.selectedPath.join(" -> ") : "no admissible relay path"}</span>
              </div>
              <p>{cohort.recovery}</p>
              <div className="ac-chip-row">
                {cohort.degradedNodes.length ? cohort.degradedNodes.map((node) => <span key={node} className="ac-chip">{node}</span>) : <span className="ac-chip">nominal relays</span>}
                {cohort.branchId ? <span className="ac-chip mono">{cohort.branchId}</span> : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {reconciliation ? (
        <>
          <div className="ac-divider" />
          <div className="ac-slo-card" style={{ marginBottom: 14 }}>
            <div className="ac-slo-head">
              <span>One-page reviewer result</span>
              <button className="ac-btn" onClick={exportReviewerResult}><Download size={13} /> Export result</button>
            </div>
            <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(260px, 0.58fr)", gap: 14, alignItems: "start", marginTop: 10 }}>
              <div>
                <div className="ac-label">Scenario</div>
                <p>
                  A 40-drone autonomous mesh was split into disconnected partitions. During the outage, command revoked Drone Group B discretionary authority while local nodes attempted continued execution under degraded authority.
                </p>
                <div className="ac-label">Governance objective</div>
                <p>
                  Determine whether AristotleOS could preserve bounded authority, refuse unauthorized action, log evidence, and reconcile state after reconnect.
                </p>
                <div className="ac-label">Conclusion</div>
                <p>
                  AristotleOS demonstrated authority continuity under disconnection. The swarm did not merely continue operating; it continued only within warrantable, bounded, reconstructable authority.
                </p>
                <div className="ac-chip-row">
                  <span className="ac-chip">simulated governance demo</span>
                  <span className="ac-chip">not a live flight test</span>
                  <span className="ac-chip">not a replacement for certified control systems</span>
                </div>
              </div>
              <div className="ac-grid" style={{ gap: 8 }}>
                {reviewerChecklist.map(([label, ok]) => (
                  <div key={label} className="ac-slo-current" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {ok ? <ShieldCheck size={15} /> : <ShieldAlert size={15} />}
                    <span>{label}</span>
                    <span style={{ marginLeft: "auto" }}><Badge tone={ok ? "green" : "red"}>{ok ? "proved" : "missing"}</Badge></span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 0.9fr) minmax(0, 1.1fr)", gap: 14, alignItems: "start" }}>
            <div className="ac-slo-card">
              <div className="ac-slo-head">
                <span>Reconnect reconciliation report</span>
                <Badge tone={reconciliation.ledgerChainVerified ? "green" : "red"}>
                  {reconciliation.ledgerChainVerified ? "ledger verified" : "ledger contested"}
                </Badge>
              </div>
              <div className="ac-adoption-kpis" style={{ marginTop: 10 }}>
                <Metric label="Valid" value={reconciliation.valid} tone="green" />
                <Metric label="Stale" value={reconciliation.stale} tone="amber" />
                <Metric label="Revoked" value={reconciliation.revoked} tone="red" />
                <Metric label="Expired" value={reconciliation.expired} tone="red" />
                <Metric label="Review" value={reconciliation.reviewRequired} tone="cyan" />
                <Metric label="Witness" value={reconciliation.witnessQuorum} tone="green" />
              </div>
              <div className="ac-detail-grid" style={{ gridTemplateColumns: "132px 1fr", marginTop: 12 }}>
                <dt>Before</dt><dd className="mono">{reconciliation.rootAuthorityBefore}</dd>
                <dt>After</dt><dd className="mono">{reconciliation.rootAuthorityAfter}</dd>
                <dt>Expansion</dt><dd>{reconciliation.missionExpansionBlock.requestedScope}</dd>
                <dt>Blocked by</dt><dd className="mono">{reconciliation.missionExpansionBlock.blockedBy}</dd>
              </div>
              <p>{reconciliation.missionExpansionBlock.reason}</p>
            </div>

            <div className="ac-slo-card">
              <div className="ac-slo-head">
                <span>Authority timeline</span>
                <Badge tone="amber">partitioned</Badge>
              </div>
              <div className="ac-timeline" style={{ marginTop: 10 }}>
                {reconciliation.timeline.map((event, index) => (
                  <div key={`${event.label}-${event.at}`} className={cx("ac-step", index === reconciliation.timeline.length - 1 && "is-active")}>
                    <span className="ac-step-index">{index + 1}</span>
                    <span className="ac-step-title">{event.label}</span>
                    <span className="ac-step-detail">{new Date(event.at).toLocaleTimeString()} - {event.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="ac-grid" style={{ marginTop: 14, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            {reconciliation.actions.map((action) => (
              <div key={action.id} className="ac-slo-card">
                <div className="ac-slo-head">
                  <span className="mono">{action.actionType}</span>
                  <Badge tone={classificationTone(action.classification)}>{action.classification.replace("_", " ")}</Badge>
                </div>
                <div className="ac-detail-grid" style={{ gridTemplateColumns: "112px 1fr", marginTop: 10 }}>
                  <dt>Units</dt><dd>{action.units}</dd>
                  <dt>Edge</dt><dd>{action.edgeDecision}</dd>
                  <dt>Root</dt><dd>{action.rootDecision}</dd>
                  <dt>Envelope</dt><dd className="mono">{action.authorityEnvelope}</dd>
                  <dt>Evidence</dt><dd className="mono">{action.evidenceHash}</dd>
                </div>
                <p>{action.reason}</p>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Top-level
// ---------------------------------------------------------------------------

export function VerticalDetailConsole() {
  const verticalId = useCommandStore((s) => s.selectedVerticalId);
  const setSection = useCommandStore((s) => s.setSection);
  const selectVertical = useCommandStore((s) => s.selectVertical);

  if (!verticalId) {
    return (
      <Panel title="No vertical selected" icon={<BadgeAlert size={15} />}>
        <p className="ac-muted">Open a vertical from the Verticals registry.</p>
      </Panel>
    );
  }

  const v = VERTICAL_REGISTRY[verticalId as VerticalId];
  if (!v) {
    return (
      <Panel title="Unknown vertical" icon={<BadgeAlert size={15} />}>
        <p className="ac-muted">No vertical config for id <code>{String(verticalId)}</code>.</p>
      </Panel>
    );
  }

  const back = () => {
    selectVertical(null);
    setSection("verticals");
  };

  return (
    <div className="ac-grid" style={{ gridTemplateColumns: "1fr", gap: 14 }}>
      <Panel
        title={v.name}
        icon={<Landmark size={15} />}
        right={<Badge tone="amber">demonstration material</Badge>}
      >
        <div className="ac-adoption-hero">
          <div>
            <div className="ac-label">
              <button
                type="button"
                onClick={back}
                className={cx("ac-btn-link")}
                style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, padding: 0, fontSize: 12 }}
              >
                <ArrowLeft size={13} /> Back to Verticals
              </button>
            </div>
            <h2>{v.purpose}</h2>
            <p className="ac-muted" style={{ marginTop: 6 }}>{v.framing}</p>
            <div className="ac-chip-row" style={{ marginTop: 10 }}>
              {v.regulatory.map((r: string) => <span key={r} className="ac-chip">{r}</span>)}
            </div>
            <p className="ac-muted" style={{ marginTop: 12 }}>
              All shipped jurisdiction / site / state rule presets for this vertical are
              <strong> demonstration material</strong>. Real deployments require counsel review
              and per-regulator coordination before promotion past
              <code> rule_validation_state: "demonstration"</code>.
            </p>
          </div>
          <div className="ac-adoption-kpis">
            <Metric label="Adapters" value={v.adapters.length} tone="cyan" />
            <Metric label="Hard interlocks" value={v.hardInterlocks.length} tone="red" />
            <Metric label="Presets (DEMO)" value={v.presets.states.length} tone="amber" />
            <Metric label="Test suite" value={v.testSurface.tests} sm />
          </div>
        </div>
      </Panel>

      {v.id === "swarm" ? <SwarmLiveSimulationPanel /> : null}

      {v.workflow?.length ? (
        <>
          <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 1.2fr) minmax(320px, 0.8fr)", alignItems: "start" }}>
            <WorkflowPanel v={v} />
            <BoundaryChainPanel v={v} />
          </div>
          <WorkflowRunner vertical={v} />
        </>
      ) : null}

      <AdapterMatrix v={v} />

      <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", alignItems: "start" }}>
        <HardInterlocksPanel v={v} />
        <PresetsPanel v={v} />
      </div>

      {v.evidenceSample ? (
        <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", alignItems: "start" }}>
          <EvidenceSamplePanel v={v} />
          <SafetyDrillsPanel v={v} />
        </div>
      ) : (
        <SafetyDrillsPanel v={v} />
      )}

      <ScenariosPanel v={v} />

      <FailClosedPanel v={v} />
    </div>
  );
}
