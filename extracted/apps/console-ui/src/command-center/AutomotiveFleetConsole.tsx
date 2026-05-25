import { Car, ClipboardCheck, Download, FileCheck2, Gauge, GitCommitHorizontal, MapPinned, Route, ShieldCheck, Signal, Workflow, Wrench } from "lucide-react";
import React from "react";
import {
  AUTOMOTIVE_ADAPTERS,
  AUTOMOTIVE_EVIDENCE_EXPORT,
  AUTOMOTIVE_FLEET_WORKFLOW,
  AUTOMOTIVE_SAFETY_DRILLS
} from "./mockData.js";
import { Badge, Metric, Panel, StatusDot, cx } from "./primitives.js";
import { useCommandStore } from "./store.js";
import type { AutomotiveFleetStep, Posture } from "./types.js";

const stepTone: Record<AutomotiveFleetStep["state"], "green" | "cyan" | "red" | "slate"> = {
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
    <Panel title="Fleet Safety Workflow" icon={<Workflow size={15} />} right={<Badge tone="cyan">mission to evidence</Badge>}>
      <div className="ac-timeline">
        {AUTOMOTIVE_FLEET_WORKFLOW.map((step, index) => (
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
    <Panel title="Vehicle Adapter Surfaces" icon={<Route size={15} />} right={<Badge tone="green">typed boundaries</Badge>}>
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
          {AUTOMOTIVE_ADAPTERS.map((adapter) => (
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
  const evidence = AUTOMOTIVE_EVIDENCE_EXPORT;
  return (
    <Panel title="Automotive Evidence Bundle" icon={<FileCheck2 size={15} />} right={<button className="ac-btn" onClick={exportEvidence}><Download size={13} /> Export</button>}>
      <div className="ac-grid ac-cols-2">
        <div>
          <Metric label="Bundle" value={evidence.bundleVersion} sm />
          <Metric label="Verification" value={evidence.verification} tone={evidence.verification === "ok" ? "green" : "red"} />
          <div className="ac-divider" />
          <div className="ac-detail-grid" style={{ gridTemplateColumns: "116px 1fr" }}>
            <dt>Fleet</dt><dd className="mono">{evidence.fleetId}</dd>
            <dt>Vehicle</dt><dd className="mono">{evidence.vehicleId}</dd>
            <dt>Scope</dt><dd>{evidence.operationalScope}</dd>
            <dt>ODD</dt><dd>{evidence.oddId}</dd>
            <dt>Bundle hash</dt><dd className="mono">{evidence.bundleHash}</dd>
          </div>
        </div>
        <div className="ac-grid" style={{ gap: 10 }}>
          <div>
            <div className="ac-label">Safety operator</div>
            <div className="mono">{evidence.safetyOperator}</div>
          </div>
          <div>
            <div className="ac-label">Standards profile</div>
            <div className="ac-chip-row">{evidence.standardsProfile.map((s) => <span key={s} className="ac-chip">{s}</span>)}</div>
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
    <Panel title="Vehicle Safety Invariants" icon={<Gauge size={15} />} right={<Badge tone="amber">hard interlocks</Badge>}>
      <div className="ac-grid ac-cols-2">
        {AUTOMOTIVE_SAFETY_DRILLS.map((drill) => (
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

export function AutomotiveFleetConsole() {
  return (
    <div className="ac-grid" style={{ gridTemplateColumns: "1fr", gap: 14 }}>
      <Panel title="Autonomous Vehicle Pilot" icon={<Car size={15} />} right={<Badge tone="green">fleet-ready motion</Badge>}>
        <div className="ac-adoption-hero">
          <div>
            <div className="ac-label">Authority before vehicle consequence</div>
            <h2>Govern autonomous fleet actions at the vehicle commit point.</h2>
            <p>
              Fleet commands, OTA rollout, map activation, ROS 2 topics, AUTOSAR services, and remote-assist actions pass
              through Wards, Authority Envelopes, Vehicle Safety Invariants, dual-control approval, single-use Warrants, and automotive Evidence Bundles.
            </p>
          </div>
          <div className="ac-adoption-kpis">
            <Metric label="Ward" value="av-fleet-west" tone="cyan" />
            <Metric label="Adapters" value={AUTOMOTIVE_ADAPTERS.length} tone="green" />
            <Metric label="Decision path" value="ALLOW / REFUSE / ESCALATE" sm />
          </div>
        </div>
      </Panel>

      <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 1.2fr) minmax(320px, 0.8fr)", alignItems: "start" }}>
        <WorkflowRail />
        <Panel title="Vehicle Commit Boundary" icon={<GitCommitHorizontal size={15} />} right={<Badge tone="cyan">warrant first</Badge>}>
          <div className="ac-identity-chain">
            {[
              ["Intent", <Signal size={14} />],
              ["Ward", <MapPinned size={14} />],
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
            The vehicle bus is not the authority. It is the final execution boundary after deterministic admission, Warrant verification, and evidence finalization.
          </p>
        </Panel>
      </div>

      <AdapterMatrix />
      <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", alignItems: "start" }}>
        <EvidenceExport />
        <SafetyDrills />
      </div>
    </div>
  );
}
