import { Antenna, Cable, ClipboardCheck, Download, FileCheck2, Gauge, GitCommitHorizontal, RadioTower, Route, ShieldCheck, Signal, Workflow } from "lucide-react";
import React from "react";
import {
  TELECOM_ADAPTERS,
  TELECOM_EVIDENCE_EXPORT,
  TELECOM_NOC_WORKFLOW,
  TELECOM_SCALE_DRILLS
} from "./mockData.js";
import { Badge, Metric, Panel, StatusDot, cx } from "./primitives.js";
import { useCommandStore } from "./store.js";
import type { Posture, TelecomNocStep } from "./types.js";

const stepTone: Record<TelecomNocStep["state"], "green" | "cyan" | "red" | "slate"> = {
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
    <Panel title="NOC Workflow" icon={<Workflow size={15} />} right={<Badge tone="cyan">mission to evidence</Badge>}>
      <div className="ac-timeline">
        {TELECOM_NOC_WORKFLOW.map((step, index) => (
          <div key={step.id} className={cx("ac-step", step.state === "active" && "is-active")}>
            <span className="ac-step-index">{index + 1}</span>
            <span className="ac-step-title">{step.label}</span>
            <span className="ac-step-detail">{step.owner} · {step.evidence}</span>
            <span style={{ marginLeft: "auto" }}><Badge tone={stepTone[step.state]}>{step.state}</Badge></span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function AdapterMatrix() {
  return (
    <Panel title="Telecom Adapter Surfaces" icon={<Route size={15} />} right={<Badge tone="green">typed boundaries</Badge>}>
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
          {TELECOM_ADAPTERS.map((adapter) => (
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
  const evidence = TELECOM_EVIDENCE_EXPORT;
  return (
    <Panel title="Telecom Evidence Bundle" icon={<FileCheck2 size={15} />} right={<button className="ac-btn" onClick={exportEvidence}><Download size={13} /> Export</button>}>
      <div className="ac-grid ac-cols-2">
        <div>
          <Metric label="Bundle" value={evidence.bundleVersion} sm />
          <Metric label="Verification" value={evidence.verification} tone={evidence.verification === "ok" ? "green" : "red"} />
          <div className="ac-divider" />
          <div className="ac-detail-grid" style={{ gridTemplateColumns: "116px 1fr" }}>
            <dt>Change ticket</dt><dd className="mono">{evidence.changeTicket}</dd>
            <dt>NOC operator</dt><dd className="mono">{evidence.nocOperator}</dd>
            <dt>Scope</dt><dd>{evidence.networkScope}</dd>
            <dt>Bundle hash</dt><dd className="mono">{evidence.bundleHash}</dd>
          </div>
        </div>
        <div className="ac-grid" style={{ gap: 10 }}>
          <div>
            <div className="ac-label">Impacted services</div>
            <div className="ac-chip-row">{evidence.impactedServices.map((s) => <span key={s} className="ac-chip">{s}</span>)}</div>
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

function ScaleDrills() {
  return (
    <Panel title="Carrier-Scale Drills" icon={<Gauge size={15} />} right={<Badge tone="amber">pilot proof</Badge>}>
      <div className="ac-grid ac-cols-2">
        {TELECOM_SCALE_DRILLS.map((drill) => (
          <div key={drill.id} className="ac-slo-card">
            <div className="ac-slo-head">
              <span>{drill.label}</span>
              <Badge tone={postureTone[drill.posture]}>{drill.posture}</Badge>
            </div>
            <div className="ac-slo-current" style={{ fontSize: 15 }}>{drill.current}</div>
            <div className="ac-muted">Target {drill.target}</div>
            <div className="ac-code-block" style={{ marginTop: 10, minHeight: 30 }}>
              <span className="ac-code-line">{drill.command}</span>
            </div>
            <p>{drill.evidence}</p>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function TelecomNocConsole() {
  return (
    <div className="ac-grid" style={{ gridTemplateColumns: "1fr", gap: 14 }}>
      <Panel title="Autonomous Network Pilot" icon={<RadioTower size={15} />} right={<Badge tone="green">CSP-ready motion</Badge>}>
        <div className="ac-adoption-hero">
          <div>
            <div className="ac-label">Authority before network consequence</div>
            <h2>Govern every autonomous network change at the commit point.</h2>
            <p>
              A carrier NOC can route service orders, NETCONF edits, gNMI set operations, and O-RAN policy changes
              through Wards, Authority Envelopes, dual-control approval, single-use Warrants, and telecom Evidence Bundles.
            </p>
          </div>
          <div className="ac-adoption-kpis">
            <Metric label="Ward" value="ran-region-west" tone="cyan" />
            <Metric label="Adapters" value={TELECOM_ADAPTERS.length} tone="green" />
            <Metric label="Decision path" value="ALLOW / REFUSE / ESCALATE" sm />
          </div>
        </div>
      </Panel>

      <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 1.2fr) minmax(320px, 0.8fr)", alignItems: "start" }}>
        <WorkflowRail />
        <Panel title="Network Commit Boundary" icon={<GitCommitHorizontal size={15} />} right={<Badge tone="cyan">warrant first</Badge>}>
          <div className="ac-identity-chain">
            {[
              ["Intent", <Signal size={14} />],
              ["Ward", <Antenna size={14} />],
              ["Authority", <ShieldCheck size={14} />],
              ["Adapter", <Cable size={14} />],
              ["GEL", <ClipboardCheck size={14} />]
            ].map(([label, icon], idx) => (
              <React.Fragment key={String(label)}>
                <div className="ac-identity-node">{icon}{label}</div>
                {idx < 4 && <span className="ac-identity-arrow">{"->"}</span>}
              </React.Fragment>
            ))}
          </div>
          <p className="ac-muted" style={{ marginTop: 12 }}>
            The adapter is never the authority. It is only an execution boundary that can proceed after the Commit Gate admits the action and the Warrant verifies against the canonical action hash.
          </p>
        </Panel>
      </div>

      <AdapterMatrix />
      <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", alignItems: "start" }}>
        <EvidenceExport />
        <ScaleDrills />
      </div>
    </div>
  );
}
