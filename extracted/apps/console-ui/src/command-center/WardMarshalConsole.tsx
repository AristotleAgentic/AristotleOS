import { Ban, Fingerprint, KeyRound, Radar, Search, ShieldCheck, ShieldX, Siren, Unplug, Workflow } from "lucide-react";
import React from "react";
import { WARD_MARSHAL_FINDINGS } from "./mockData.js";
import { Badge, DetailGrid, Metric, Panel, StatusDot, truncHash } from "./primitives.js";
import { useCommandStore } from "./store.js";
import type { WardMarshalFinding } from "./types.js";

const statusTone: Record<WardMarshalFinding["status"], "green" | "amber" | "red" | "cyan" | "violet"> = {
  governed: "green",
  shadow: "cyan",
  rogue: "red",
  orphaned: "amber",
  contained: "violet"
};

const riskTone: Record<WardMarshalFinding["riskBand"], "green" | "amber" | "red" | "cyan"> = {
  low: "green",
  medium: "cyan",
  high: "amber",
  critical: "red"
};

function FindingCard({ finding, selected, onSelect }: { finding: WardMarshalFinding; selected: boolean; onSelect: () => void }) {
  return (
    <button className={`ac-row-btn ${selected ? "is-active" : ""}`} onClick={onSelect} style={{ alignItems: "stretch" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div className="ac-row-title"><StatusDot tone={statusTone[finding.status]} pulse={finding.status === "rogue"} />{finding.subject}</div>
          <div className="ac-row-sub">{finding.observedLocations[0]}</div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
          <Badge tone={statusTone[finding.status]}>{finding.status}</Badge>
          <Badge tone={riskTone[finding.riskBand]}>{finding.riskBand} {finding.riskScore}</Badge>
        </div>
      </div>
      <div className="ac-row-sub" style={{ marginTop: 8 }}>
        disposition: <span className="mono">{finding.recommendedDisposition}</span>
      </div>
    </button>
  );
}

function InterdictionPipeline({ finding }: { finding: WardMarshalFinding }) {
  const steps = [
    ["Agent observed", "Agent Census binds raw observation to a stable finding."],
    ["Ward resolved", `${finding.wardId} owns the governed response context.`],
    ["Authority checked", "Ward Marshal envelope must delegate this containment class."],
    ["Warrant requested", "Containment action receives a single-use Warrant only on ALLOW."],
    ["Action executed", `${finding.recommendedDisposition.replace(/_/g, " ")} is dispatched to the authorized enforcement adapter.`],
    ["GEL committed", "Detection, decision, Warrant, and result become replayable evidence."]
  ];
  return (
    <div className="ac-timeline">
      {steps.map(([title, detail], index) => (
        <div key={title} className="ac-step">
          <span className="ac-step-index">{index + 1}</span>
          <span className="ac-step-title">{title}</span>
          <span className="ac-step-detail">{detail}</span>
        </div>
      ))}
    </div>
  );
}

export function WardMarshalConsole() {
  const [selectedId, setSelectedId] = React.useState(WARD_MARSHAL_FINDINGS[0]?.id ?? "");
  const toast = useCommandStore((s) => s.toast);
  const exportEvidence = useCommandStore((s) => s.exportEvidence);
  // Live census findings when the boundary is reachable; curated sample otherwise.
  const liveFindings = useCommandStore((s) => s.marshalFindings);
  const findings = liveFindings ?? WARD_MARSHAL_FINDINGS;
  const finding = findings.find((item) => item.id === selectedId) ?? findings[0];
  const rogue = findings.filter((item) => item.status === "rogue").length;
  const governed = findings.filter((item) => item.status === "governed").length;
  const high = findings.filter((item) => item.riskBand === "high" || item.riskBand === "critical").length;

  const requestInterdiction = (kind: string) => {
    toast(`Ward Marshal ${kind} requested. Commit Gate will require authority registers, Warrant, and GEL evidence.`, kind === "terminate execution" ? "red" : "amber");
  };

  return (
    <div className="ac-grid" style={{ gridTemplateColumns: "minmax(300px, 0.9fr) minmax(0, 1.5fr)", alignItems: "start" }}>
      <div className="ac-stack">
        <Panel title="Agent Census" icon={<Search size={15} />} right={<Badge tone={rogue ? "red" : "green"}>{rogue} rogue</Badge>}>
          <div className="ac-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 12 }}>
            <Metric label="Observed" value={findings.length} tone="cyan" />
            <Metric label="Governed" value={governed} tone="green" />
            <Metric label="High/Critical" value={high} tone={high ? "red" : "green"} />
          </div>
          <div className="ac-stack" style={{ gap: 8 }}>
            {findings.map((item) => (
              <FindingCard key={item.id} finding={item} selected={item.id === finding.id} onSelect={() => setSelectedId(item.id)} />
            ))}
          </div>
        </Panel>

        <Panel title="Discovery Surfaces" icon={<Radar size={15} />}>
          <div className="ac-chip-row">
            {["Kubernetes", "MCP tools", "developer workstations", "CI/CD", "SaaS automations", "API gateways", "edge nodes"].map((surface) => (
              <span key={surface} className="ac-chip">{surface}</span>
            ))}
          </div>
        </Panel>
      </div>

      <div className="ac-stack">
        <Panel
          title="Ward Marshal Finding"
          icon={finding.status === "rogue" ? <ShieldX size={15} /> : <ShieldCheck size={15} />}
          right={<Badge tone={statusTone[finding.status]}>{finding.status}</Badge>}
        >
          <div className="ac-grid" style={{ gridTemplateColumns: "1.2fr 0.8fr", alignItems: "start" }}>
            <DetailGrid rows={[
              ["Subject", finding.subject, true],
              ["Ward", finding.wardId, true],
              ["Owner", finding.owner],
              ["Risk", `${finding.riskBand.toUpperCase()} / ${finding.riskScore}`],
              ["Disposition", finding.recommendedDisposition, true],
              ["Evidence hash", truncHash(finding.evidenceHash, 16), true],
              ["Last seen", new Date(finding.lastSeen).toLocaleString()]
            ]} />
            <div className="ac-code-block" style={{ minHeight: 170 }}>
              <span className="ac-code-line">action_type: ward_marshal.{finding.recommendedDisposition}</span>
              <span className="ac-code-line">target: {finding.subject}</span>
              <span className="ac-code-line">requires: operator_ticket</span>
              <span className="ac-code-line">requires: interdiction_authority</span>
              <span className="ac-code-line">warrant: single_use</span>
              <span className="ac-code-line">gel: detection + containment</span>
            </div>
          </div>
        </Panel>

        <Panel title="Risk Signals" icon={<Fingerprint size={15} />}>
          <div className="ac-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            {finding.signals.map((signal) => (
              <div key={signal.code} className="ac-mini-card">
                <div className="ac-mini-top"><Badge tone={signal.weight >= 20 ? "red" : "amber"}>+{signal.weight}</Badge><span className="mono">{signal.code}</span></div>
                <p>{signal.detail}</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Governed Interdiction Path" icon={<Workflow size={15} />}>
          <InterdictionPipeline finding={finding} />
        </Panel>

        <Panel title="Operator Actions" icon={<Siren size={15} />}>
          <div className="ac-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
            <button className="ac-btn" onClick={() => requestInterdiction("quarantine")}><Unplug size={13} /> Quarantine</button>
            <button className="ac-btn" onClick={() => requestInterdiction("revoke credentials")}><KeyRound size={13} /> Revoke</button>
            <button className="ac-btn is-danger" onClick={() => requestInterdiction("terminate execution")}><Ban size={13} /> Terminate</button>
            <button className="ac-btn" onClick={exportEvidence}>Export Evidence</button>
          </div>
          <p className="ac-muted" style={{ marginTop: 10 }}>
            These controls do not bypass governance. Each intervention is a new governed action: Ward resolution, Authority Envelope, Commit Gate, Warrant, execution, GEL.
          </p>
        </Panel>
      </div>
    </div>
  );
}
