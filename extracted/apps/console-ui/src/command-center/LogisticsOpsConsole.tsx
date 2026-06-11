import { Boxes, ClipboardCheck, Download, FileCheck2, Gauge, GitCommitHorizontal, Route, ShieldCheck, Truck, Workflow, Wrench } from "lucide-react";
import React from "react";
import {
  LOGISTICS_ADAPTERS,
  LOGISTICS_EVIDENCE_EXPORT,
  LOGISTICS_OPS_WORKFLOW,
  LOGISTICS_SAFETY_DRILLS
} from "./mockData.js";
import { Badge, Metric, Panel, StatusDot, cx } from "./primitives.js";
import { useCommandStore } from "./store.js";
import type { LogisticsOpsStep, Posture } from "./types.js";

const stepTone: Record<LogisticsOpsStep["state"], "green" | "cyan" | "red" | "slate"> = {
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

function WorkflowLogistics() {
  return (
    <Panel title="Logistics Ops Workflow" icon={<Workflow size={15} />} right={<Badge tone="cyan">load to evidence</Badge>}>
      <div className="ac-timeline">
        {LOGISTICS_OPS_WORKFLOW.map((step, index) => (
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
    <Panel title="Logistics Adapter Surfaces" icon={<Route size={15} />} right={<Badge tone="green">typed freight boundaries</Badge>}>
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
          {LOGISTICS_ADAPTERS.map((adapter) => (
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
  const evidence = LOGISTICS_EVIDENCE_EXPORT;
  return (
    <Panel title="Logistics Evidence Bundle" icon={<FileCheck2 size={15} />} right={<button className="ac-btn" onClick={exportEvidence}><Download size={13} /> Export</button>}>
      <div className="ac-grid ac-cols-2">
        <div>
          <Metric label="Bundle" value={evidence.bundleVersion} sm />
          <Metric label="Verification" value={evidence.verification} tone={evidence.verification === "ok" ? "green" : "red"} />
          <div className="ac-divider" />
          <div className="ac-detail-grid" style={{ gridTemplateColumns: "126px 1fr" }}>
            <dt>Network</dt><dd className="mono">{evidence.networkId}</dd>
            <dt>Ops center</dt><dd>{evidence.operationsCenter}</dd>
            <dt>Load</dt><dd className="mono">{evidence.loadId}</dd>
            <dt>Shipment</dt><dd className="mono">{evidence.shipmentId}</dd>
            <dt>Carrier</dt><dd className="mono">{evidence.carrierId}</dd>
            <dt>Bundle hash</dt><dd className="mono">{evidence.bundleHash}</dd>
          </div>
        </div>
        <div className="ac-grid" style={{ gap: 10 }}>
          <div>
            <div className="ac-label">Driver / Tractor / Trailer</div>
            <div>{evidence.driverId} / {evidence.tractorId} / {evidence.trailerId}</div>
          </div>
          <div>
            <div className="ac-label">Trip / Route</div>
            <div className="mono">{evidence.tripId} / {evidence.routeId}</div>
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
    <Panel title="Logistics Safety and Fraud Invariants" icon={<Gauge size={15} />} right={<Badge tone="amber">dispatch boundary respected</Badge>}>
      <div className="ac-grid ac-cols-2">
        {LOGISTICS_SAFETY_DRILLS.map((drill) => (
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

export function LogisticsOpsConsole() {
  return (
    <div className="ac-grid" style={{ gridTemplateColumns: "1fr", gap: 14 }}>
      <Panel title="Trucking and Logistics Pilot" icon={<Truck size={15} />} right={<Badge tone="green">fleet-ready motion</Badge>}>
        <div className="ac-adoption-hero">
          <div>
            <div className="ac-label">Authority before freight consequence</div>
            <h2>Govern autonomous load movement at the dispatch, tender, route, yard, and payment boundary.</h2>
            <p>
              TMS dispatch, broker/carrier tender, ELD/HOS, telematics, WMS, YMS, fuel advance,
              accessorial/payment, cold-chain, hazmat, DVIR, and customs workflows pass through Wards,
              Authority Envelopes, Logistics Safety Invariants, dual-control approval, single-use Warrants,
              and Logistics Evidence Bundles.
            </p>
          </div>
          <div className="ac-adoption-kpis">
            <Metric label="Ward" value="logistics-network-west" tone="cyan" />
            <Metric label="Adapters" value={LOGISTICS_ADAPTERS.length} tone="green" />
            <Metric label="Decision path" value="ALLOW / REFUSE / ESCALATE" sm />
          </div>
        </div>
      </Panel>

      <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 1.2fr) minmax(320px, 0.8fr)", alignItems: "start" }}>
        <WorkflowLogistics />
        <Panel title="Logistics Commit Boundary" icon={<GitCommitHorizontal size={15} />} right={<Badge tone="cyan">warrant first</Badge>}>
          <div className="ac-identity-chain">
            {[
              ["Intent", <Truck size={14} />],
              ["Ward", <Boxes size={14} />],
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
            AristotleOS does not replace TMS, ELD, telematics, WMS, YMS, payment, customs, or maintenance systems.
            It governs autonomous or automated load actions before those systems receive consequential commands, then preserves evidence for replay, claims, compliance, and audit.
          </p>
        </Panel>
      </div>

      <AdapterMatrix />
      <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", alignItems: "start" }}>
        <EvidenceExport />
        <SafetyDrills />
      </div>
      <Panel title="Logistics Boundary Rule" icon={<Boxes size={15} />} right={<Badge tone="red">fail closed</Badge>}>
        <p className="ac-muted">
          HOS overrun, stale ELD, invalid carrier authority, missing insurance, unqualified driver, route violation,
          broken seal, invalid appointment, temperature excursion, hazmat endorsement gap, double-broker flag,
          or unapproved fuel/payment request prevents Warrant issuance before freight consequence.
        </p>
        <div className="ac-chip-row">
          <span className="ac-chip"><Truck size={12} /> dispatch</span>
          <span className="ac-chip"><Route size={12} /> route</span>
          <span className="ac-chip"><ShieldCheck size={12} /> authority</span>
        </div>
      </Panel>
    </div>
  );
}
