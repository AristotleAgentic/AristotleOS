import { Cable, ClipboardCheck, Download, FileCheck2, Gauge, GitCommitHorizontal, Landmark, RadioTower, Route, ShieldCheck, Signal, Workflow, Wrench } from "lucide-react";
import React from "react";
import {
  RAIL_ADAPTERS,
  RAIL_EVIDENCE_EXPORT,
  RAIL_OPS_WORKFLOW,
  RAIL_SAFETY_DRILLS
} from "./mockData.js";
import { Badge, Metric, Panel, StatusDot, cx } from "./primitives.js";
import { useCommandStore } from "./store.js";
import type { Posture, RailOpsStep } from "./types.js";

const stepTone: Record<RailOpsStep["state"], "green" | "cyan" | "red" | "slate"> = {
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
    <Panel title="Rail Ops Workflow" icon={<Workflow size={15} />} right={<Badge tone="cyan">movement to evidence</Badge>}>
      <div className="ac-timeline">
        {RAIL_OPS_WORKFLOW.map((step, index) => (
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
    <Panel title="Rail Adapter Surfaces" icon={<Route size={15} />} right={<Badge tone="green">typed rail boundaries</Badge>}>
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
          {RAIL_ADAPTERS.map((adapter) => (
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
  const evidence = RAIL_EVIDENCE_EXPORT;
  return (
    <Panel title="Rail Evidence Bundle" icon={<FileCheck2 size={15} />} right={<button className="ac-btn" onClick={exportEvidence}><Download size={13} /> Export</button>}>
      <div className="ac-grid ac-cols-2">
        <div>
          <Metric label="Bundle" value={evidence.bundleVersion} sm />
          <Metric label="Verification" value={evidence.verification} tone={evidence.verification === "ok" ? "green" : "red"} />
          <div className="ac-divider" />
          <div className="ac-detail-grid" style={{ gridTemplateColumns: "126px 1fr" }}>
            <dt>Railroad</dt><dd className="mono">{evidence.railroadId}</dd>
            <dt>Ops center</dt><dd>{evidence.operationsCenter}</dd>
            <dt>Train</dt><dd className="mono">{evidence.trainId}</dd>
            <dt>Symbol</dt><dd className="mono">{evidence.trainSymbol}</dd>
            <dt>Authority</dt><dd className="mono">{evidence.movementAuthority}</dd>
            <dt>Bundle hash</dt><dd className="mono">{evidence.bundleHash}</dd>
          </div>
        </div>
        <div className="ac-grid" style={{ gap: 10 }}>
          <div>
            <div className="ac-label">Territory</div>
            <div>{evidence.territory} / {evidence.subdivision}</div>
          </div>
          <div>
            <div className="ac-label">Locomotive</div>
            <div className="mono">{evidence.locomotiveId}</div>
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
    <Panel title="Rail Safety Invariants" icon={<Gauge size={15} />} right={<Badge tone="amber">vital boundary respected</Badge>}>
      <div className="ac-grid ac-cols-2">
        {RAIL_SAFETY_DRILLS.map((drill) => (
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

export function RailOpsConsole() {
  return (
    <div className="ac-grid" style={{ gridTemplateColumns: "1fr", gap: 14 }}>
      <Panel title="Railroad Pilot" icon={<Landmark size={15} />} right={<Badge tone="green">rail-ready motion</Badge>}>
        <div className="ac-adoption-hero">
          <div>
            <div className="ac-label">Authority before movement consequence</div>
            <h2>Govern autonomous rail actions at the dispatch and PTC boundary.</h2>
            <p>
              Dispatch/CAD, PTC back office, wayside signal, switch machine, grade crossing, locomotive,
              crew, consist, hazmat, maintenance-of-way, and yard automation actions pass through Wards,
              Authority Envelopes, Rail Safety Invariants, dual-control approval, single-use Warrants,
              and Rail Evidence Bundles.
            </p>
          </div>
          <div className="ac-adoption-kpis">
            <Metric label="Ward" value="rail-subdivision-west" tone="cyan" />
            <Metric label="Adapters" value={RAIL_ADAPTERS.length} tone="green" />
            <Metric label="Decision path" value="ALLOW / REFUSE / ESCALATE" sm />
          </div>
        </div>
      </Panel>

      <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 1.2fr) minmax(320px, 0.8fr)", alignItems: "start" }}>
        <WorkflowRail />
        <Panel title="Rail Commit Boundary" icon={<GitCommitHorizontal size={15} />} right={<Badge tone="cyan">warrant first</Badge>}>
          <div className="ac-identity-chain">
            {[
              ["Intent", <Signal size={14} />],
              ["Ward", <Landmark size={14} />],
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
            AristotleOS does not replace PTC, signal, or other vital rail systems. It governs autonomous or automated action before those systems receive consequential commands, then preserves evidence for replay and audit.
          </p>
        </Panel>
      </div>

      <AdapterMatrix />
      <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", alignItems: "start" }}>
        <EvidenceExport />
        <SafetyDrills />
      </div>
      <Panel title="Rail Boundary Rule" icon={<Cable size={15} />} right={<Badge tone="red">fail closed</Badge>}>
        <p className="ac-muted">
          Missing PTC state, conflicting authority, unproven switch position, stop signal, unreleased work zone,
          missing track bulletin acknowledgement, stale authority, or disconnected evidence storage prevents
          Warrant issuance before dispatch, PTC, wayside, or yard execution.
        </p>
      </Panel>
    </div>
  );
}
