import { Activity, ClipboardCheck, Download, Droplets, FileCheck2, FlaskConical, Gauge, GitCommitHorizontal, ShieldCheck, Waves, Workflow, Wrench } from "lucide-react";
import React from "react";
import {
  WATER_ADAPTERS,
  WATER_EVIDENCE_EXPORT,
  WATER_OPS_WORKFLOW,
  WATER_SAFETY_DRILLS
} from "./mockData.js";
import { Badge, Metric, Panel, StatusDot, cx } from "./primitives.js";
import { useCommandStore } from "./store.js";
import type { Posture, WaterOpsStep } from "./types.js";

const stepTone: Record<WaterOpsStep["state"], "green" | "cyan" | "red" | "slate"> = {
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

function WorkflowWater() {
  return (
    <Panel title="Water Ops Workflow" icon={<Workflow size={15} />} right={<Badge tone="cyan">plant to evidence</Badge>}>
      <div className="ac-timeline">
        {WATER_OPS_WORKFLOW.map((step, index) => (
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
    <Panel title="Water Adapter Surfaces" icon={<Wrench size={15} />} right={<Badge tone="green">typed utility boundaries</Badge>}>
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
          {WATER_ADAPTERS.map((adapter) => (
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
  const evidence = WATER_EVIDENCE_EXPORT;
  return (
    <Panel title="Water Evidence Bundle" icon={<FileCheck2 size={15} />} right={<button className="ac-btn" onClick={exportEvidence}><Download size={13} /> Export</button>}>
      <div className="ac-grid ac-cols-2">
        <div>
          <Metric label="Bundle" value={evidence.bundleVersion} sm />
          <Metric label="Verification" value={evidence.verification} tone={evidence.verification === "ok" ? "green" : "red"} />
          <div className="ac-divider" />
          <div className="ac-detail-grid" style={{ gridTemplateColumns: "132px 1fr" }}>
            <dt>Utility</dt><dd className="mono">{evidence.utilityId}</dd>
            <dt>System</dt><dd className="mono">{evidence.waterSystemId}</dd>
            <dt>Facility</dt><dd>{evidence.facilityId}</dd>
            <dt>Asset</dt><dd className="mono">{evidence.assetId}</dd>
            <dt>Work order</dt><dd className="mono">{evidence.workOrder}</dd>
            <dt>Bundle hash</dt><dd className="mono">{evidence.bundleHash}</dd>
          </div>
        </div>
        <div className="ac-grid" style={{ gap: 10 }}>
          <div>
            <div className="ac-label">Ops center</div>
            <div>{evidence.operationsCenter}</div>
          </div>
          <div>
            <div className="ac-label">Process / Permit</div>
            <div>{evidence.processArea} / <span className="mono">{evidence.permitId}</span></div>
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
    <Panel title="Water Safety Invariants" icon={<Gauge size={15} />} right={<Badge tone="amber">SCADA boundary respected</Badge>}>
      <div className="ac-grid ac-cols-2">
        {WATER_SAFETY_DRILLS.map((drill) => (
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

export function WaterOpsConsole() {
  return (
    <div className="ac-grid" style={{ gridTemplateColumns: "1fr", gap: 14 }}>
      <Panel title="Water Infrastructure Pilot" icon={<Droplets size={15} />} right={<Badge tone="green">utility-ready motion</Badge>}>
        <div className="ac-adoption-hero">
          <div>
            <div className="ac-label">Authority before water consequence</div>
            <h2>Govern autonomous water and wastewater actions at the SCADA, PLC, pump, valve, dosing, and discharge boundary.</h2>
            <p>
              Plant SCADA, PLC/RTU, pump station, valve, chemical dosing, lab/LIMS, historian, AMI,
              tank/reservoir, lift station, UV disinfection, and wastewater discharge workflows pass through
              Wards, Authority Envelopes, Water Safety Invariants, dual-control approval, single-use Warrants,
              and Water Evidence Bundles.
            </p>
          </div>
          <div className="ac-adoption-kpis">
            <Metric label="Ward" value="water-plant-west" tone="cyan" />
            <Metric label="Adapters" value={WATER_ADAPTERS.length} tone="green" />
            <Metric label="Decision path" value="ALLOW / REFUSE / ESCALATE" sm />
          </div>
        </div>
      </Panel>

      <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 1.2fr) minmax(320px, 0.8fr)", alignItems: "start" }}>
        <WorkflowWater />
        <Panel title="Water Commit Boundary" icon={<GitCommitHorizontal size={15} />} right={<Badge tone="cyan">warrant first</Badge>}>
          <div className="ac-identity-chain">
            {[
              ["Intent", <Activity size={14} />],
              ["Ward", <Droplets size={14} />],
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
            AristotleOS does not replace SCADA, PLC, lab, treatment-process controls, or licensed operator procedure.
            It governs autonomous or automated action before those systems receive consequential commands, then preserves
            evidence for replay, compliance, and incident review.
          </p>
        </Panel>
      </div>

      <AdapterMatrix />
      <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", alignItems: "start" }}>
        <EvidenceExport />
        <SafetyDrills />
      </div>
      <Panel title="Water Boundary Rule" icon={<FlaskConical size={15} />} right={<Badge tone="red">fail closed</Badge>}>
        <p className="ac-muted">
          Chlorine overfeed, stale turbidity, pressure outside bounds, tank-level risk, backflow uncertainty,
          inactive disinfection, chemical inventory gaps, pump unavailability, valve-interlock uncertainty,
          active bypass, forbidden vendor remote sessions, or disconnected evidence storage prevent Warrant issuance
          before water or wastewater consequence.
        </p>
        <div className="ac-chip-row">
          <span className="ac-chip"><Droplets size={12} /> treatment</span>
          <span className="ac-chip"><Waves size={12} /> distribution</span>
          <span className="ac-chip"><FlaskConical size={12} /> chemistry</span>
        </div>
      </Panel>
    </div>
  );
}
