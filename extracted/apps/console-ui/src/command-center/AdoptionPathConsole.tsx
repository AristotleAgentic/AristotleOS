import { Braces, CheckCircle2, Download, FileCheck2, FlaskConical, Gauge, GitCompareArrows, KeyRound, PackageCheck, Route, ShieldCheck } from "lucide-react";
import React from "react";
import {
  EVIDENCE_PROFILE,
  MISSION_TEMPLATES,
  POLICY_HARNESS,
  POLICY_PROMOTION,
  RUNTIME_SLOS,
  TOOL_GATEWAYS
} from "./mockData.js";
import { Badge, Metric, Panel, StatusDot, decisionTone, cx } from "./primitives.js";
import { useCommandStore } from "./store.js";
import type { PromotionStageState } from "./types.js";

function stageTone(state: PromotionStageState) {
  switch (state) {
    case "complete": return "green";
    case "active": return "cyan";
    case "blocked": return "red";
    default: return "slate";
  }
}

function PromotionPipeline() {
  return (
    <Panel title="Policy Promotion Pipeline" icon={<GitCompareArrows size={15} />} right={<Badge tone="cyan">draft to enforced</Badge>}>
      <div className="ac-promotion">
        {POLICY_PROMOTION.map((stage, idx) => (
          <div key={stage.key} className={cx("ac-promo-stage", `is-${stage.state}`)}>
            <div className="ac-promo-top">
              <span className="ac-promo-index">{idx + 1}</span>
              <Badge tone={stageTone(stage.state)}>{stage.state}</Badge>
            </div>
            <div className="ac-promo-label">{stage.label}</div>
            <div className="ac-muted" style={{ fontSize: 12 }}>{stage.owner}</div>
            <div className="ac-promo-evidence">{stage.evidence}</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function MissionTemplates() {
  return (
    <Panel title="Mission Templates" icon={<PackageCheck size={15} />} right={<Badge tone="green">{MISSION_TEMPLATES.length} ready</Badge>}>
      <div className="ac-template-grid">
        {MISSION_TEMPLATES.map((tpl) => (
          <article key={tpl.id} className="ac-template-card">
            <div className="ac-template-head">
              <span className="ac-template-title">{tpl.name}</span>
              <Badge tone={decisionTone(tpl.defaultDecision)}>{tpl.defaultDecision}</Badge>
            </div>
            <div className="ac-detail-grid" style={{ gridTemplateColumns: "116px 1fr", gap: "6px 10px" }}>
              <dt>Ward</dt><dd className="mono">{tpl.ward}</dd>
              <dt>Domain</dt><dd>{tpl.domain}</dd>
              <dt>Consequence</dt><dd>{tpl.consequenceClass}</dd>
            </div>
            <div className="ac-template-value">{tpl.operatorValue}</div>
            <div className="ac-chip-row">
              {tpl.requiredEvidence.slice(0, 4).map((e) => <span className="ac-chip" key={e}>{e}</span>)}
            </div>
          </article>
        ))}
      </div>
    </Panel>
  );
}

function EvidenceStandard() {
  const exportEvidence = useCommandStore((s) => s.exportEvidence);
  return (
    <Panel title="Evidence Bundle Standard" icon={<FileCheck2 size={15} />} right={<button className="ac-btn" onClick={exportEvidence}><Download size={13} /> Export</button>}>
      <div className="ac-grid ac-cols-2">
        <div>
          <Metric label="Bundle format" value={EVIDENCE_PROFILE.formatVersion} sm />
          <div className="ac-divider" />
          <div className="ac-detail-grid" style={{ gridTemplateColumns: "100px 1fr" }}>
            <dt>Signing</dt><dd>{EVIDENCE_PROFILE.signing}</dd>
            <dt>Verifier</dt><dd className="mono">{EVIDENCE_PROFILE.verifier}</dd>
            <dt>Last hash</dt><dd className="mono">{EVIDENCE_PROFILE.lastExportHash}</dd>
          </div>
        </div>
        <div className="ac-chip-row">
          {EVIDENCE_PROFILE.contents.map((item) => <span className="ac-chip" key={item}>{item}</span>)}
        </div>
      </div>
    </Panel>
  );
}

function ToolGatewayMatrix() {
  return (
    <Panel title="Governed Tool Gateway" icon={<Route size={15} />} right={<Badge tone="cyan">front door for consequence</Badge>}>
      <table className="ac-table">
        <thead>
          <tr>
            <th>Adapter</th>
            <th>Target</th>
            <th>Boundary</th>
            <th>Sample</th>
            <th>Posture</th>
          </tr>
        </thead>
        <tbody>
          {TOOL_GATEWAYS.map((gw) => (
            <tr key={gw.id}>
              <td>{gw.label}</td>
              <td className="ac-mono">{gw.target}</td>
              <td>{gw.boundary}</td>
              <td className="ac-mono">{gw.sampleAction}</td>
              <td><Badge tone={gw.posture}><StatusDot tone={gw.posture} />{gw.posture}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function PolicyHarness() {
  const pass = POLICY_HARNESS.filter((c) => c.expected === c.actual).length;
  return (
    <Panel title="Policy Test Harness" icon={<FlaskConical size={15} />} right={<Badge tone={pass === POLICY_HARNESS.length ? "green" : "amber"}>{pass}/{POLICY_HARNESS.length} pass</Badge>}>
      <div className="ac-grid" style={{ gap: 8 }}>
        {POLICY_HARNESS.map((tc) => (
          <div key={tc.id} className="ac-harness-row">
            <span className="ac-mono">{tc.action}</span>
            <Badge tone={decisionTone(tc.actual)}>{tc.actual}</Badge>
            <span className="ac-muted">{tc.coverage}</span>
            <span className="ac-chip-row">{tc.reasonCodes.map((r) => <span className="ac-chip" key={r}>{r}</span>)}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function RuntimeSloPanel() {
  return (
    <Panel title="Runtime SLOs" icon={<Gauge size={15} />} right={<Badge tone="green">publishable numbers</Badge>}>
      <div className="ac-grid ac-cols-3">
        {RUNTIME_SLOS.map((slo) => (
          <div key={slo.id} className="ac-slo-card">
            <div className="ac-slo-head">
              <span>{slo.label}</span>
              <Badge tone={slo.posture}>{slo.posture}</Badge>
            </div>
            <div className="ac-slo-current">{slo.current}</div>
            <div className="ac-muted">Target {slo.target}</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function AdoptionPathConsole() {
  return (
    <div className="ac-grid" style={{ gridTemplateColumns: "1fr", gap: 14 }}>
      <Panel title="Commercial Adoption Path" icon={<ShieldCheck size={15} />} right={<Badge tone="green">pilot ready motion</Badge>}>
        <div className="ac-adoption-hero">
          <div>
            <div className="ac-label">Authority before consequence</div>
            <h2>Try, shadow, enforce, export, expand.</h2>
            <p>
              AristotleOS now presents a buyer-readable path from local sandbox to governed mission, policy promotion,
              admitted execution, and portable evidence export. This is the shape procurement, security, and operators can follow.
            </p>
          </div>
          <div className="ac-adoption-kpis">
            <Metric label="Promotion stages" value={POLICY_PROMOTION.length} tone="cyan" />
            <Metric label="Mission templates" value={MISSION_TEMPLATES.length} tone="green" />
            <Metric label="Gateway adapters" value={TOOL_GATEWAYS.length} tone="amber" />
          </div>
        </div>
      </Panel>
      <PromotionPipeline />
      <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 0.8fr)", alignItems: "start" }}>
        <MissionTemplates />
        <div className="ac-grid">
          <EvidenceStandard />
          <PolicyHarness />
        </div>
      </div>
      <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 1.15fr) minmax(0, 0.85fr)", alignItems: "start" }}>
        <ToolGatewayMatrix />
        <RuntimeSloPanel />
      </div>
      <Panel title="Identity Binding" icon={<KeyRound size={15} />} right={<Badge tone="cyan">no anonymous authority</Badge>}>
        <div className="ac-identity-chain">
          {["Operator OIDC", "Workload SPIFFE", "Authority Envelope", "Single-use Warrant", "GEL Evidence"].map((item, idx) => (
            <React.Fragment key={item}>
              <div className="ac-identity-node"><CheckCircle2 size={14} />{item}</div>
              {idx < 4 && <span className="ac-identity-arrow">{"->"}</span>}
            </React.Fragment>
          ))}
        </div>
        <div className="ac-muted" style={{ marginTop: 12 }}>
          Every consequential path should carry identity from human/operator to workload to authority to warrant to evidence.
          No standing machine power; no warrant without a reconstructable chain of cause.
        </div>
      </Panel>
      <Panel title="Hosted Trial Readiness" icon={<Braces size={15} />} right={<Badge tone="amber">next external milestone</Badge>}>
        <div className="ac-chip-row">
          <span className="ac-chip">public landing route</span>
          <span className="ac-chip">browser playground</span>
          <span className="ac-chip">sample payments mission</span>
          <span className="ac-chip">evidence export</span>
          <span className="ac-chip">Helm smoke path</span>
          <span className="ac-chip">needs hosted deployment target</span>
        </div>
      </Panel>
    </div>
  );
}
