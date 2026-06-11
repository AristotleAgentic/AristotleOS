import { Cable, ClipboardCheck, Download, FileCheck2, Gauge, GitCommitHorizontal, Power, Route, ShieldCheck, Signal, Workflow, Wrench, Zap } from "lucide-react";
import React from "react";
import {
  GRID_ADAPTERS,
  GRID_CONTROL_WORKFLOW,
  GRID_EVIDENCE_EXPORT,
  GRID_SAFETY_DRILLS
} from "./mockData.js";
import { Badge, Metric, Panel, StatusDot, cx } from "./primitives.js";
import { useCommandStore } from "./store.js";
import type { GridControlStep, Posture } from "./types.js";

const stepTone: Record<GridControlStep["state"], "green" | "cyan" | "red" | "slate"> = {
  complete: "green",
  active: "cyan",
  blocked: "red",
  pending: "slate"
};

const postureTone: Record<Posture, "green" | "amber" | "red"> = {
  green: "green",
  amber: "amber",
  red: "red"
};

function WorkflowRail() {
  return (
    <Panel title="Grid Control Workflow" icon={<Workflow size={15} />} right={<Badge tone="cyan">switching to evidence</Badge>}>
      <div className="ac-timeline">
        {GRID_CONTROL_WORKFLOW.map((step, index) => (
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

function AdapterMatrix() {
  return (
    <Panel title="Utility Adapter Surfaces" icon={<Route size={15} />} right={<Badge tone="green">typed OT boundaries</Badge>}>
      <table className="ac-table">
        <thead>
          <tr>
            <th>Surface</th>
            <th>Actions</th>
            <th>Registers</th>
            <th>Posture</th>
          </tr>
        </thead>
        <tbody>
          {GRID_ADAPTERS.map((adapter) => (
            <tr key={adapter.id}>
              <td>
                <div className="ac-row-title"><StatusDot tone={postureTone[adapter.posture]} />{adapter.label}</div>
                <div className="ac-row-sub">{adapter.boundary}</div>
              </td>
              <td>{adapter.actionTypes.map((a) => <span key={a} className="ac-chip">{a}</span>)}</td>
              <td>{adapter.requiredRegisters.map((r) => <span key={r} className="ac-chip">{r}</span>)}</td>
              <td><Badge tone={postureTone[adapter.posture]}>{adapter.standard}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function EvidenceExport() {
  const exportEvidence = useCommandStore((s) => s.exportEvidence);
  const evidence = GRID_EVIDENCE_EXPORT;
  return (
    <Panel title="Grid Evidence Bundle" icon={<FileCheck2 size={15} />} right={<button className="ac-btn" onClick={exportEvidence}><Download size={13} /> Export</button>}>
      <div className="ac-grid ac-cols-2">
        <div>
          <Metric label="Bundle" value={evidence.bundleVersion} sm />
          <Metric label="Verification" value={evidence.verification} tone={evidence.verification === "ok" ? "green" : "red"} />
          <div className="ac-divider" />
          <div className="ac-detail-grid" style={{ gridTemplateColumns: "126px 1fr" }}>
            <dt>Utility</dt><dd className="mono">{evidence.utilityId}</dd>
            <dt>Control center</dt><dd>{evidence.controlCenter}</dd>
            <dt>Asset</dt><dd className="mono">{evidence.assetId}</dd>
            <dt>Switching order</dt><dd className="mono">{evidence.switchingOrder}</dd>
            <dt>Bundle hash</dt><dd className="mono">{evidence.bundleHash}</dd>
          </div>
        </div>
        <div className="ac-grid" style={{ gap: 10 }}>
          <div>
            <div className="ac-label">Operational scope</div>
            <div>{evidence.operationalScope}</div>
          </div>
          <div>
            <div className="ac-label">Topology model</div>
            <div className="mono">{evidence.topologyModel}</div>
          </div>
          <div>
            <div className="ac-label">Evidence profile</div>
            <div className="ac-chip-row">{evidence.profiles.map((s) => <span key={s} className="ac-chip">{s}</span>)}</div>
          </div>
          <div>
            <div className="ac-label">Redaction manifest</div>
            <div className="ac-chip-row">{evidence.redactedFields.map((s) => <span key={s} className="ac-chip">{s}</span>)}</div>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function SafetyDrills() {
  return (
    <Panel title="Grid Electrical Invariants" icon={<Gauge size={15} />} right={<Badge tone="amber">hard interlocks</Badge>}>
      <div className="ac-grid ac-cols-2">
        {GRID_SAFETY_DRILLS.map((drill) => (
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

export function GridControlConsole() {
  return (
    <div className="ac-grid" style={{ gridTemplateColumns: "1fr", gap: 14 }}>
      <Panel title="Electric Utility Pilot" icon={<Zap size={15} />} right={<Badge tone="green">grid-ready motion</Badge>}>
        <div className="ac-adoption-hero">
          <div>
            <div className="ac-label">Authority before grid consequence</div>
            <h2>Govern autonomous grid actions at the switching boundary.</h2>
            <p>
              SCADA commands, IEC 61850 and DNP3 operations, DERMS dispatch, relay settings, firmware campaigns,
              and historian records pass through Wards, Authority Envelopes, Grid Electrical Invariants,
              dual-control approval, single-use Warrants, and Grid Evidence Bundles.
            </p>
          </div>
          <div className="ac-adoption-kpis">
            <Metric label="Ward" value="grid-transmission-west" tone="cyan" />
            <Metric label="Adapters" value={GRID_ADAPTERS.length} tone="green" />
            <Metric label="Decision path" value="ALLOW / REFUSE / ESCALATE" sm />
          </div>
        </div>
      </Panel>

      <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 1.2fr) minmax(320px, 0.8fr)", alignItems: "start" }}>
        <WorkflowRail />
        <Panel title="Grid Commit Boundary" icon={<GitCommitHorizontal size={15} />} right={<Badge tone="cyan">warrant first</Badge>}>
          <div className="ac-identity-chain">
            {[
              ["Intent", <Signal size={14} />],
              ["Ward", <Power size={14} />],
              ["Authority", <ShieldCheck size={14} />],
              ["Adapter", <Wrench size={14} />],
              ["GEL", <ClipboardCheck size={14} />]
            ].map(([label, icon], idx) => (
              <React.Fragment key={String(label)}>
                <div className="ac-identity-node">{icon}{label}</div>
                {idx < 4 && <span className="ac-identity-arrow">{"->"}</span>}
              </React.Fragment>
            ))}
          </div>
          <p className="ac-muted" style={{ marginTop: 12 }}>
            The OT protocol is not the authority. IEC 61850, DNP3, Modbus, SCADA, and DERMS clients execute only after deterministic admission, Warrant verification, and evidence finalization.
          </p>
        </Panel>
      </div>

      <AdapterMatrix />
      <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", alignItems: "start" }}>
        <EvidenceExport />
        <SafetyDrills />
      </div>
      <Panel title="OT Boundary Rule" icon={<Cable size={15} />} right={<Badge tone="red">fail closed</Badge>}>
        <p className="ac-muted">
          Missing switching order, stale SCADA, unknown protection state, unreleased crew clearance, topology mismatch,
          or ledger degradation prevents Warrant issuance before field execution.
        </p>
      </Panel>
    </div>
  );
}
