import {
  Activity,
  ArrowLeft,
  BadgeAlert,
  BadgeCheck,
  ClipboardCheck,
  Database,
  Download,
  FileCheck2,
  GitCommitHorizontal,
  Landmark,
  ShieldAlert,
  ShieldCheck,
  Workflow
} from "lucide-react";
import React from "react";
import { Badge, Metric, Panel, cx } from "./primitives.js";
import { useCommandStore } from "./store.js";
import {
  VERTICAL_REGISTRY,
  type VerticalAdapterRow,
  type VerticalConfig,
  type VerticalId,
  type VerticalSafetyDrill,
  type VerticalScenario,
  type VerticalWorkflowStep
} from "./verticals/registry.js";
import { WorkflowRunner } from "./WorkflowRunner.js";

// ---------------------------------------------------------------------------
// Tone helpers
// ---------------------------------------------------------------------------

const stepTone: Record<VerticalWorkflowStep["state"], "green" | "cyan" | "red" | "slate"> = {
  complete: "green",
  active: "cyan",
  blocked: "red",
  pending: "slate"
};

const postureTone: Record<VerticalSafetyDrill["posture"], "green" | "amber" | "red"> = {
  green: "green",
  amber: "amber",
  red: "red"
};

const expectedTone: Record<VerticalScenario["expected"], "green" | "amber" | "red"> = {
  ALLOW: "green",
  ESCALATE: "amber",
  REFUSE: "red"
};

// ---------------------------------------------------------------------------
// Sub-panels (conditional on optional config fields)
// ---------------------------------------------------------------------------

function WorkflowPanel({ v }: { v: VerticalConfig }) {
  if (!v.workflow?.length) return null;
  return (
    <Panel title={`${v.name} Workflow`} icon={<Workflow size={15} />} right={<Badge tone="cyan">intent to bound evidence</Badge>}>
      <div className="ac-timeline">
        {v.workflow.map((step, index) => (
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

function BoundaryChainPanel({ v }: { v: VerticalConfig }) {
  const labels = v.boundaryChainLabels;
  if (!labels?.length) return null;
  const ICONS = [
    <Activity size={14} key="i0" />,
    <ShieldCheck size={14} key="i1" />,
    <BadgeCheck size={14} key="i2" />,
    <Database size={14} key="i3" />,
    <FileCheck2 size={14} key="i4" />,
    <ClipboardCheck size={14} key="i5" />,
    <ShieldAlert size={14} key="i6" />
  ];
  return (
    <Panel title="Commit Boundary" icon={<GitCommitHorizontal size={15} />} right={<Badge tone="cyan">warrant first</Badge>}>
      <div className="ac-identity-chain">
        {labels.map((label, idx) => (
          <React.Fragment key={label}>
            <div className="ac-identity-node">{ICONS[idx % ICONS.length]}{label}</div>
            {idx < labels.length - 1 && <span className="ac-identity-arrow">{"->"}</span>}
          </React.Fragment>
        ))}
      </div>
      <p className="ac-muted" style={{ marginTop: 12 }}>
        AristotleOS does not replace this vertical's operating systems. It governs autonomous and
        automated actions <em>before</em> those systems receive consequential commands, then preserves
        bound, redacted evidence for replay, audit, and incident reconstruction.
      </p>
    </Panel>
  );
}

function AdapterMatrix({ v }: { v: VerticalConfig }) {
  return (
    <Panel title="Adapter boundaries" icon={<Database size={15} />} right={<Badge tone="green">typed</Badge>}>
      <table className="ac-table">
        <thead>
          <tr><th>Adapter</th><th>Action types (sample)</th><th>Boundary</th></tr>
        </thead>
        <tbody>
          {v.adapters.map((a: VerticalAdapterRow) => (
            <tr key={a.id}>
              <td><div className="ac-row-title">{a.label}</div></td>
              <td>{a.actionTypes.map((t: string) => <span key={t} className="ac-chip">{t}</span>)}</td>
              <td className="ac-muted">{a.boundary}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function HardInterlocksPanel({ v }: { v: VerticalConfig }) {
  return (
    <Panel title="Hard interlocks (gate-level)" icon={<ShieldAlert size={15} />} right={<Badge tone="red">always REFUSE</Badge>}>
      <p className="ac-muted">
        These action types are refused by the Commit Gate <strong>regardless of envelope policy</strong>.
        Proven by per-vertical interlock tests.
      </p>
      <div className="ac-chip-row" style={{ marginTop: 8 }}>
        {v.hardInterlocks.map((t: string) => (
          <span key={t} className="ac-chip" style={{ borderColor: "var(--ac-red)" }}>{t}</span>
        ))}
      </div>
    </Panel>
  );
}

function PresetsPanel({ v }: { v: VerticalConfig }) {
  return (
    <Panel title={v.presets.label + " (demo)"} icon={<BadgeAlert size={15} />} right={<Badge tone="amber">demo only</Badge>}>
      <p className="ac-muted">
        Per-jurisdiction or per-site rule packs shipped with this vertical, all flagged
        <code> demonstration_only: true</code>.
      </p>
      <div className="ac-chip-row" style={{ marginTop: 8 }}>
        {v.presets.states.map((s: string) => <span key={s} className="ac-chip">{s}</span>)}
      </div>
    </Panel>
  );
}

function EvidenceSamplePanel({ v }: { v: VerticalConfig }) {
  const exportEvidence = useCommandStore((s) => s.exportEvidence);
  const e = v.evidenceSample;
  if (!e) return null;
  return (
    <Panel
      title={`${v.name} Evidence Bundle`}
      icon={<FileCheck2 size={15} />}
      right={<button className="ac-btn" onClick={exportEvidence}><Download size={13} /> Export</button>}
    >
      <div className="ac-grid ac-cols-2">
        <div>
          <Metric label="Bundle" value={e.bundleVersion} sm />
          <Metric label="Verification" value={e.verification} tone={e.verification === "ok" ? "green" : "red"} />
          <div className="ac-divider" />
          <div className="ac-detail-grid" style={{ gridTemplateColumns: "138px 1fr" }}>
            {e.fields.map(({ k, v, mono }) => (
              <React.Fragment key={k}>
                <dt>{k}</dt>
                <dd className={mono ? "mono" : undefined}>{v}</dd>
              </React.Fragment>
            ))}
          </div>
        </div>
        <div className="ac-grid" style={{ gap: 10 }}>
          <div>
            <div className="ac-label">Evidence profile</div>
            <div className="ac-chip-row">{e.profile.map((s: string) => <span key={s} className="ac-chip">{s}</span>)}</div>
          </div>
          <div>
            <div className="ac-label">PII redaction manifest</div>
            <div className="ac-chip-row">{e.redactedFields.map((s: string) => <span key={s} className="ac-chip">{s}</span>)}</div>
          </div>
          <div>
            <div className="ac-label">Bundle hash</div>
            <div className="mono">{e.bundleHash}</div>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function SafetyDrillsPanel({ v }: { v: VerticalConfig }) {
  if (!v.safetyDrills?.length) return null;
  return (
    <Panel title="Safety / invariant cards" icon={<ShieldCheck size={15} />} right={<Badge tone="amber">live bounds</Badge>}>
      <div className="ac-grid ac-cols-2">
        {v.safetyDrills.map((drill) => (
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

function ScenariosPanel({ v }: { v: VerticalConfig }) {
  if (!v.scenarios?.length) return null;
  return (
    <Panel title="Demonstration scenarios" icon={<ClipboardCheck size={15} />} right={<Badge tone="cyan">test surface</Badge>}>
      <div className="ac-grid ac-cols-2">
        {v.scenarios.map((scenario) => (
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

function FailClosedPanel({ v }: { v: VerticalConfig }) {
  const rule = v.failClosedRule;
  if (!rule) return null;
  return (
    <Panel title="Fail-closed boundary rule" icon={<ShieldAlert size={15} />} right={<Badge tone="red">fail closed</Badge>}>
      <p className="ac-muted">{rule.description}</p>
      <div className="ac-chip-row" style={{ marginTop: 8 }}>
        {rule.chips.map((c) => <span key={c} className="ac-chip">{c}</span>)}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Top-level
// ---------------------------------------------------------------------------

export function VerticalDetailConsole() {
  const verticalId = useCommandStore((s) => s.selectedVerticalId);
  const setSection = useCommandStore((s) => s.setSection);
  const selectVertical = useCommandStore((s) => s.selectVertical);

  if (!verticalId) {
    return (
      <Panel title="No vertical selected" icon={<BadgeAlert size={15} />}>
        <p className="ac-muted">Open a vertical from the Verticals registry.</p>
      </Panel>
    );
  }

  const v = VERTICAL_REGISTRY[verticalId as VerticalId];
  if (!v) {
    return (
      <Panel title="Unknown vertical" icon={<BadgeAlert size={15} />}>
        <p className="ac-muted">No vertical config for id <code>{String(verticalId)}</code>.</p>
      </Panel>
    );
  }

  const back = () => {
    selectVertical(null);
    setSection("verticals");
  };

  return (
    <div className="ac-grid" style={{ gridTemplateColumns: "1fr", gap: 14 }}>
      <Panel
        title={v.name}
        icon={<Landmark size={15} />}
        right={<Badge tone="amber">demonstration material</Badge>}
      >
        <div className="ac-adoption-hero">
          <div>
            <div className="ac-label">
              <button
                type="button"
                onClick={back}
                className={cx("ac-btn-link")}
                style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, padding: 0, fontSize: 12 }}
              >
                <ArrowLeft size={13} /> Back to Verticals
              </button>
            </div>
            <h2>{v.purpose}</h2>
            <p className="ac-muted" style={{ marginTop: 6 }}>{v.framing}</p>
            <div className="ac-chip-row" style={{ marginTop: 10 }}>
              {v.regulatory.map((r: string) => <span key={r} className="ac-chip">{r}</span>)}
            </div>
            <p className="ac-muted" style={{ marginTop: 12 }}>
              All shipped jurisdiction / site / state rule presets for this vertical are
              <strong> demonstration material</strong>. Real deployments require counsel review
              and per-regulator coordination before promotion past
              <code> rule_validation_state: "demonstration"</code>.
            </p>
          </div>
          <div className="ac-adoption-kpis">
            <Metric label="Adapters" value={v.adapters.length} tone="cyan" />
            <Metric label="Hard interlocks" value={v.hardInterlocks.length} tone="red" />
            <Metric label="Presets (DEMO)" value={v.presets.states.length} tone="amber" />
            <Metric label="Test suite" value={v.testSurface.tests} sm />
          </div>
        </div>
      </Panel>

      {v.workflow?.length ? (
        <>
          <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 1.2fr) minmax(320px, 0.8fr)", alignItems: "start" }}>
            <WorkflowPanel v={v} />
            <BoundaryChainPanel v={v} />
          </div>
          <WorkflowRunner vertical={v} />
        </>
      ) : null}

      <AdapterMatrix v={v} />

      <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", alignItems: "start" }}>
        <HardInterlocksPanel v={v} />
        <PresetsPanel v={v} />
      </div>

      {v.evidenceSample ? (
        <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", alignItems: "start" }}>
          <EvidenceSamplePanel v={v} />
          <SafetyDrillsPanel v={v} />
        </div>
      ) : (
        <SafetyDrillsPanel v={v} />
      )}

      <ScenariosPanel v={v} />

      <FailClosedPanel v={v} />
    </div>
  );
}
