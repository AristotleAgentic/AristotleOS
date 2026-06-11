import { Activity, BadgeCheck, ClipboardCheck, Database, Download, FileCheck2, FileText, GitCommitHorizontal, Landmark, ScrollText, ShieldCheck, Workflow } from "lucide-react";
import React from "react";
import {
  TITLE_ADAPTERS,
  TITLE_EVIDENCE_EXPORT,
  TITLE_JURISDICTION_PRESETS,
  TITLE_OPS_WORKFLOW,
  TITLE_SCENARIOS
} from "./mockData.js";
import { Badge, Metric, Panel, StatusDot, cx } from "./primitives.js";
import { useCommandStore } from "./store.js";
import { TitleSubmissionWalkthrough } from "./TitleSubmissionWalkthrough.js";
import type { Posture, TitleOpsStep, TitleScenario } from "./types.js";

const stepTone: Record<TitleOpsStep["state"], "green" | "cyan" | "red" | "slate"> = {
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

const expectedTone: Record<TitleScenario["expected"], "green" | "amber" | "red"> = {
  ALLOW: "green",
  ESCALATE: "amber",
  REFUSE: "red"
};

function WorkflowTitle() {
  return (
    <Panel title="Title Transaction Workflow" icon={<Workflow size={15} />} right={<Badge tone="cyan">intent to bound evidence</Badge>}>
      <div className="ac-timeline">
        {TITLE_OPS_WORKFLOW.map((step, index) => (
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
    <Panel title="Title Adapter Surfaces" icon={<Database size={15} />} right={<Badge tone="green">typed title boundaries</Badge>}>
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
          {TITLE_ADAPTERS.map((adapter) => (
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
  const evidence = TITLE_EVIDENCE_EXPORT;
  return (
    <Panel title="Title Evidence Bundle" icon={<FileCheck2 size={15} />} right={<button className="ac-btn" onClick={exportEvidence}><Download size={13} /> Export</button>}>
      <div className="ac-grid ac-cols-2">
        <div>
          <Metric label="Bundle" value={evidence.bundleVersion} sm />
          <Metric label="Verification" value={evidence.verification} tone={evidence.verification === "ok" ? "green" : "red"} />
          <div className="ac-divider" />
          <div className="ac-detail-grid" style={{ gridTemplateColumns: "138px 1fr" }}>
            <dt>Actor</dt><dd className="mono">{evidence.actorId}</dd>
            <dt>Organization</dt><dd>{evidence.organizationId} ({evidence.organizationKind})</dd>
            <dt>Jurisdiction</dt><dd>{evidence.jurisdiction}</dd>
            <dt>Rule version</dt><dd className="mono">{evidence.stateRuleVersion}</dd>
            <dt>Transaction</dt><dd className="mono">{evidence.transactionId} / {evidence.transactionType}</dd>
            <dt>VIN</dt><dd className="mono">{evidence.vin}</dd>
            <dt>Title state</dt><dd>{evidence.titleState}</dd>
            <dt>Bundle hash</dt><dd className="mono">{evidence.bundleHash}</dd>
          </div>
        </div>
        <div className="ac-grid" style={{ gap: 10 }}>
          <div>
            <div className="ac-label">Rule validation state</div>
            <div>
              <Badge tone={evidence.ruleValidationState === "demonstration" ? "amber" : "green"}>
                {evidence.ruleValidationState}
              </Badge>
            </div>
          </div>
          <div>
            <div className="ac-label">Evidence profile</div>
            <div className="ac-chip-row">{evidence.profiles.map((s) => <span key={s} className="ac-chip">{s}</span>)}</div>
          </div>
          <div>
            <div className="ac-label">PII redaction manifest</div>
            <div className="ac-chip-row">{evidence.redactedFields.map((s) => <span key={s} className="ac-chip">{s}</span>)}</div>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function JurisdictionMatrix() {
  return (
    <Panel
      title="Jurisdiction Rule Presets"
      icon={<Landmark size={15} />}
      right={<Badge tone="amber">demonstration only — not legal advice</Badge>}
    >
      <p className="ac-muted" style={{ marginTop: 0 }}>
        These rule sets are fictional demonstrations of the shape of a state title rule pack.
        Real deployments must validate every preset with state counsel and the relevant DMV / ELT hub.
      </p>
      <table className="ac-table">
        <thead>
          <tr>
            <th>State</th>
            <th>ELT</th>
            <th>e-Sig</th>
            <th>Odometer</th>
            <th>VIN insp (out-of-state)</th>
            <th>Fraud threshold</th>
            <th>Min identity score</th>
            <th>Rule version</th>
          </tr>
        </thead>
        <tbody>
          {TITLE_JURISDICTION_PRESETS.map((row) => (
            <tr key={row.state}>
              <td>
                <div className="ac-row-title">{row.state}</div>
                <div className="ac-row-sub">{row.permittedTransactionTypes.length} transaction types permitted</div>
              </td>
              <td><Badge tone={row.supportsElt ? "green" : "slate"}>{row.supportsElt ? "yes" : "no"}</Badge></td>
              <td><Badge tone={row.supportsDigitalSignature ? "green" : "slate"}>{row.supportsDigitalSignature ? "yes" : "no"}</Badge></td>
              <td><Badge tone={row.requiresOdometerDisclosure ? "amber" : "slate"}>{row.requiresOdometerDisclosure ? "required" : "n/a"}</Badge></td>
              <td><Badge tone={row.requiresVinInspectionForOutOfState ? "amber" : "slate"}>{row.requiresVinInspectionForOutOfState ? "required" : "n/a"}</Badge></td>
              <td className="mono">{row.fraudEscalationThreshold.toFixed(2)}</td>
              <td className="mono">{row.minIdentityConfidenceScore.toFixed(2)}</td>
              <td className="mono">{row.ruleVersion}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function ScenarioMatrix() {
  return (
    <Panel
      title="Demonstration Scenarios"
      icon={<ClipboardCheck size={15} />}
      right={<Badge tone="cyan">covered by title.test.ts</Badge>}
    >
      <div className="ac-grid ac-cols-2">
        {TITLE_SCENARIOS.map((scenario) => (
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

export function TitleOpsConsole() {
  return (
    <div className="ac-grid" style={{ gridTemplateColumns: "1fr", gap: 14 }}>
      <Panel title="Vehicle Title Transaction Layer" icon={<FileText size={15} />} right={<Badge tone="amber">demonstration rule sets</Badge>}>
        <div className="ac-adoption-hero">
          <div>
            <div className="ac-label">Authority before title consequence</div>
            <h2>Govern title, lien, registration, and DMV-document workflows before the state, the lender, or the dealer system sees the action.</h2>
            <p>
              ELT lien release, title transfer, registration, ESIGN / UETA signatures, dealer and lender workflows,
              DMV submission, fraud / identity checks, and NMVTIS verification all pass through Wards, Authority Envelopes,
              jurisdiction rule presets, single-use Warrants, and signed Title Evidence Bundles.
            </p>
            <p className="ac-muted" style={{ marginTop: 8 }}>
              The MT, OR, CA, TX, and FL rule sets shown here are <strong>demonstrations only</strong> — they illustrate the shape
              of a state rule pack, not a legally validated rule. Real deployments require counsel review and the relevant DMV / ELT hub integration.
            </p>
          </div>
          <div className="ac-adoption-kpis">
            <Metric label="Ward" value="title-transaction-ops" tone="cyan" />
            <Metric label="Adapters" value={TITLE_ADAPTERS.length} tone="green" />
            <Metric label="Jurisdictions" value={TITLE_JURISDICTION_PRESETS.length} tone="amber" />
            <Metric label="Decision path" value="ALLOW / REFUSE / ESCALATE" sm />
          </div>
        </div>
      </Panel>

      <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 1.2fr) minmax(320px, 0.8fr)", alignItems: "start" }}>
        <WorkflowTitle />
        <Panel title="Title Commit Boundary" icon={<GitCommitHorizontal size={15} />} right={<Badge tone="cyan">warrant first</Badge>}>
          <div className="ac-identity-chain">
            {[
              ["Intent", <FileText size={14} />],
              ["Ward", <ShieldCheck size={14} />],
              ["Checks", <BadgeCheck size={14} />],
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
            AristotleOS does not replace Vitu, CVR, Dealertrack, DDI, Reynolds, the state DMV, or the ELT hub. It governs autonomous and
            automated title actions before those systems receive consequential submissions, then preserves bound, redacted evidence for
            replay, audit, and consumer-protection investigation.
          </p>
        </Panel>
      </div>

      <AdapterMatrix />
      <JurisdictionMatrix />
      <TitleSubmissionWalkthrough />
      <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", alignItems: "start" }}>
        <EvidenceExport />
        <ScenarioMatrix />
      </div>
      <Panel title="Title Boundary Rule" icon={<ScrollText size={15} />} right={<Badge tone="red">fail closed</Badge>}>
        <p className="ac-muted">
          Unauthorized signer, revoked envelope, expired or untrusted ESIGN intent, fraud score above the jurisdiction threshold,
          missing NMVTIS query, stale title state, suspended dealer or lender license, missing odometer disclosure where required,
          missing out-of-state VIN inspection where required, dual-control approval not yet recorded, or warrant reuse attempt — all
          block Warrant issuance before any DMV / ELT submission.
        </p>
        <div className="ac-chip-row">
          <span className="ac-chip"><FileText size={12} /> title</span>
          <span className="ac-chip"><Landmark size={12} /> dmv</span>
          <span className="ac-chip"><BadgeCheck size={12} /> identity</span>
          <span className="ac-chip"><ShieldCheck size={12} /> fraud</span>
        </div>
      </Panel>
    </div>
  );
}
