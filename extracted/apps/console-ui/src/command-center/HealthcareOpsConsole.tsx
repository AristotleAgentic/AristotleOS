import { Activity, ClipboardCheck, Database, Download, FileCheck2, GitCommitHorizontal, HeartPulse, Pill, ShieldCheck, Stethoscope, Workflow } from "lucide-react";
import React from "react";
import {
  HEALTHCARE_ADAPTERS,
  HEALTHCARE_EVIDENCE_EXPORT,
  HEALTHCARE_OPS_WORKFLOW,
  HEALTHCARE_SAFETY_DRILLS
} from "./mockData.js";
import { Badge, Metric, Panel, StatusDot, cx } from "./primitives.js";
import { useCommandStore } from "./store.js";
import type { HealthcareOpsStep, Posture } from "./types.js";

const stepTone: Record<HealthcareOpsStep["state"], "green" | "cyan" | "red" | "slate"> = {
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

function WorkflowHealthcare() {
  return (
    <Panel title="Healthcare Ops Workflow" icon={<Workflow size={15} />} right={<Badge tone="cyan">patient context to evidence</Badge>}>
      <div className="ac-timeline">
        {HEALTHCARE_OPS_WORKFLOW.map((step, index) => (
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
    <Panel title="Clinical Adapter Surfaces" icon={<Database size={15} />} right={<Badge tone="green">typed healthcare boundaries</Badge>}>
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
          {HEALTHCARE_ADAPTERS.map((adapter) => (
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
  const evidence = HEALTHCARE_EVIDENCE_EXPORT;
  return (
    <Panel title="Healthcare Evidence Bundle" icon={<FileCheck2 size={15} />} right={<button className="ac-btn" onClick={exportEvidence}><Download size={13} /> Export</button>}>
      <div className="ac-grid ac-cols-2">
        <div>
          <Metric label="Bundle" value={evidence.bundleVersion} sm />
          <Metric label="Verification" value={evidence.verification} tone={evidence.verification === "ok" ? "green" : "red"} />
          <div className="ac-divider" />
          <div className="ac-detail-grid" style={{ gridTemplateColumns: "126px 1fr" }}>
            <dt>System</dt><dd className="mono">{evidence.systemId}</dd>
            <dt>Facility</dt><dd>{evidence.facilityId}</dd>
            <dt>Unit</dt><dd>{evidence.clinicalUnit}</dd>
            <dt>Encounter</dt><dd className="mono">{evidence.encounterId}</dd>
            <dt>Patient ctx</dt><dd className="mono">{evidence.patientContextHash}</dd>
            <dt>Bundle hash</dt><dd className="mono">{evidence.bundleHash}</dd>
          </div>
        </div>
        <div className="ac-grid" style={{ gap: 10 }}>
          <div>
            <div className="ac-label">Action family</div>
            <div>{evidence.actionFamily}</div>
          </div>
          <div>
            <div className="ac-label">Evidence profile</div>
            <div className="ac-chip-row">{evidence.profiles.map((s) => <span key={s} className="ac-chip">{s}</span>)}</div>
          </div>
          <div>
            <div className="ac-label">PHI redaction manifest</div>
            <div className="ac-chip-row">{evidence.redactedFields.map((s) => <span key={s} className="ac-chip">{s}</span>)}</div>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function SafetyDrills() {
  return (
    <Panel title="Clinical Safety and Privacy Invariants" icon={<HeartPulse size={15} />} right={<Badge tone="amber">patient boundary respected</Badge>}>
      <div className="ac-grid ac-cols-2">
        {HEALTHCARE_SAFETY_DRILLS.map((drill) => (
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

export function HealthcareOpsConsole() {
  return (
    <div className="ac-grid" style={{ gridTemplateColumns: "1fr", gap: 14 }}>
      <Panel title="Healthcare Clinical Operations Pilot" icon={<Stethoscope size={15} />} right={<Badge tone="green">patient-safe automation</Badge>}>
        <div className="ac-adoption-hero">
          <div>
            <div className="ac-label">Authority before patient consequence</div>
            <h2>Govern clinical automation before it touches records, orders, medications, devices, claims, or PHI.</h2>
            <p>
              FHIR, HL7, EHR writeback, pharmacy, prior authorization, claims, imaging,
              medical-device, patient-message, and research-export workflows pass through Wards,
              Authority Envelopes, clinical invariants, dual-control approval, single-use Warrants,
              and Healthcare Evidence Bundles.
            </p>
          </div>
          <div className="ac-adoption-kpis">
            <Metric label="Ward" value="healthcare-clinical-ops" tone="cyan" />
            <Metric label="Adapters" value={HEALTHCARE_ADAPTERS.length} tone="green" />
            <Metric label="Decision path" value="ALLOW / REFUSE / ESCALATE" sm />
          </div>
        </div>
      </Panel>

      <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 1.2fr) minmax(320px, 0.8fr)", alignItems: "start" }}>
        <WorkflowHealthcare />
        <Panel title="Clinical Commit Boundary" icon={<GitCommitHorizontal size={15} />} right={<Badge tone="cyan">warrant first</Badge>}>
          <div className="ac-identity-chain">
            {[
              ["Intent", <Stethoscope size={14} />],
              ["Ward", <ShieldCheck size={14} />],
              ["Patient Ctx", <ClipboardCheck size={14} />],
              ["Adapter", <Activity size={14} />],
              ["GEL", <FileCheck2 size={14} />]
            ].map(([label, icon], idx) => (
              <React.Fragment key={String(label)}>
                <div className="ac-identity-node">{icon}{label}</div>
                {idx < 4 && <span className="ac-identity-arrow">{"->"}</span>}
              </React.Fragment>
            ))}
          </div>
          <p className="ac-muted" style={{ marginTop: 12 }}>
            AristotleOS does not replace clinical systems. It governs autonomous or automated healthcare actions
            before those systems receive consequential commands, then preserves PHI-minimized evidence for replay,
            privacy review, quality investigation, and audit.
          </p>
        </Panel>
      </div>

      <AdapterMatrix />
      <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", alignItems: "start" }}>
        <EvidenceExport />
        <SafetyDrills />
      </div>
      <Panel title="Clinical Boundary Rule" icon={<Pill size={15} />} right={<Badge tone="red">fail closed</Badge>}>
        <p className="ac-muted">
          Missing patient context, stale clinical state, absent consent/TPO basis, inactive clinician privilege,
          allergy conflict, medication interaction risk, PHI overreach, disabled device alarm, unsafe device command,
          unapproved research export, or unsupported claim attestation prevents Warrant issuance before patient consequence.
        </p>
        <div className="ac-chip-row">
          <span className="ac-chip"><Stethoscope size={12} /> clinical</span>
          <span className="ac-chip"><Pill size={12} /> pharmacy</span>
          <span className="ac-chip"><ShieldCheck size={12} /> privacy</span>
        </div>
      </Panel>
    </div>
  );
}
