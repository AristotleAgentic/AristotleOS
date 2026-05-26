import { Anchor, Boxes, ClipboardCheck, Download, FileCheck2, Gauge, GitCommitHorizontal, Route, ShieldCheck, Ship, Truck, Workflow, Wrench } from "lucide-react";
import React from "react";
import {
  PORT_ADAPTERS,
  PORT_EVIDENCE_EXPORT,
  PORT_OPS_WORKFLOW,
  PORT_SAFETY_DRILLS
} from "./mockData.js";
import { Badge, Metric, Panel, StatusDot, cx } from "./primitives.js";
import { useCommandStore } from "./store.js";
import type { PortOpsStep, Posture } from "./types.js";

const stepTone: Record<PortOpsStep["state"], "green" | "cyan" | "red" | "slate"> = {
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

function WorkflowPort() {
  return (
    <Panel title="Port Ops Workflow" icon={<Workflow size={15} />} right={<Badge tone="cyan">terminal to evidence</Badge>}>
      <div className="ac-timeline">
        {PORT_OPS_WORKFLOW.map((step, index) => (
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
    <Panel title="Port Adapter Surfaces" icon={<Route size={15} />} right={<Badge tone="green">typed terminal boundaries</Badge>}>
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
          {PORT_ADAPTERS.map((adapter) => (
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
  const evidence = PORT_EVIDENCE_EXPORT;
  return (
    <Panel title="Port Evidence Bundle" icon={<FileCheck2 size={15} />} right={<button className="ac-btn" onClick={exportEvidence}><Download size={13} /> Export</button>}>
      <div className="ac-grid ac-cols-2">
        <div>
          <Metric label="Bundle" value={evidence.bundleVersion} sm />
          <Metric label="Verification" value={evidence.verification} tone={evidence.verification === "ok" ? "green" : "red"} />
          <div className="ac-divider" />
          <div className="ac-detail-grid" style={{ gridTemplateColumns: "126px 1fr" }}>
            <dt>Port</dt><dd className="mono">{evidence.portId}</dd>
            <dt>Terminal</dt><dd className="mono">{evidence.terminalId}</dd>
            <dt>Ops center</dt><dd>{evidence.operationsCenter}</dd>
            <dt>Container</dt><dd className="mono">{evidence.containerId}</dd>
            <dt>Vessel</dt><dd className="mono">{evidence.vesselImo}</dd>
            <dt>Bundle hash</dt><dd className="mono">{evidence.bundleHash}</dd>
          </div>
        </div>
        <div className="ac-grid" style={{ gap: 10 }}>
          <div>
            <div className="ac-label">Berth / Yard / Gate</div>
            <div>{evidence.berthId} / {evidence.yardBlock} / {evidence.gateId}</div>
          </div>
          <div>
            <div className="ac-label">Release order</div>
            <div className="mono">{evidence.releaseOrder}</div>
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
    <Panel title="Port Safety Invariants" icon={<Gauge size={15} />} right={<Badge tone="amber">terminal boundary respected</Badge>}>
      <div className="ac-grid ac-cols-2">
        {PORT_SAFETY_DRILLS.map((drill) => (
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

export function PortOpsConsole() {
  return (
    <div className="ac-grid" style={{ gridTemplateColumns: "1fr", gap: 14 }}>
      <Panel title="Maritime Port Pilot" icon={<Anchor size={15} />} right={<Badge tone="green">port-ready motion</Badge>}>
        <div className="ac-adoption-hero">
          <div>
            <div className="ac-label">Authority before terminal consequence</div>
            <h2>Govern autonomous port actions at the TOS, gate, crane, and vessel boundary.</h2>
            <p>
              Terminal Operating System, Port Community / EDI, customs hold, VTS/AIS/PNT, crane, gate,
              yard tractor, reefer, weighbridge, shore-power, and hazmat workflows pass through Wards,
              Authority Envelopes, Port Safety Invariants, dual-control approval, single-use Warrants,
              and Port Evidence Bundles.
            </p>
          </div>
          <div className="ac-adoption-kpis">
            <Metric label="Ward" value="port-terminal-alpha" tone="cyan" />
            <Metric label="Adapters" value={PORT_ADAPTERS.length} tone="green" />
            <Metric label="Decision path" value="ALLOW / REFUSE / ESCALATE" sm />
          </div>
        </div>
      </Panel>

      <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 1.2fr) minmax(320px, 0.8fr)", alignItems: "start" }}>
        <WorkflowPort />
        <Panel title="Port Commit Boundary" icon={<GitCommitHorizontal size={15} />} right={<Badge tone="cyan">warrant first</Badge>}>
          <div className="ac-identity-chain">
            {[
              ["Intent", <Ship size={14} />],
              ["Ward", <Anchor size={14} />],
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
            AristotleOS does not replace TOS, VTS, customs, PLC, crane safety, or shore-power systems. It governs autonomous or automated action before those systems receive consequential commands, then preserves evidence for replay and audit.
          </p>
        </Panel>
      </div>

      <AdapterMatrix />
      <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", alignItems: "start" }}>
        <EvidenceExport />
        <SafetyDrills />
      </div>
      <Panel title="Port Boundary Rule" icon={<Boxes size={15} />} right={<Badge tone="red">fail closed</Badge>}>
        <p className="ac-muted">
          Customs/security holds, missing VGM, stale PNT/AIS, unclear crane exclusion zones, berth conflicts,
          invalid appointments, unverified drivers, unsafe shore-power state, hazmat route gaps, vendor remote
          sessions, or disconnected evidence storage prevent Warrant issuance before terminal consequence.
        </p>
        <div className="ac-chip-row">
          <span className="ac-chip"><Truck size={12} /> gate</span>
          <span className="ac-chip"><Ship size={12} /> vessel</span>
          <span className="ac-chip"><Anchor size={12} /> terminal</span>
        </div>
      </Panel>
    </div>
  );
}
