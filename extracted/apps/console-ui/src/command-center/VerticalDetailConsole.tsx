import { ArrowLeft, BadgeAlert, Database, FileCheck2, Landmark, ShieldAlert } from "lucide-react";
import React from "react";
import { Badge, Metric, Panel, cx } from "./primitives.js";
import { useCommandStore } from "./store.js";
import { VERTICAL_REGISTRY, type VerticalAdapterRow, type VerticalId } from "./verticals/registry.js";

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

      <Panel title="Adapter boundaries" icon={<Database size={15} />} right={<Badge tone="green">typed</Badge>}>
        <table className="ac-table">
          <thead>
            <tr>
              <th>Adapter</th>
              <th>Action types (sample)</th>
              <th>Boundary</th>
            </tr>
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

      <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", alignItems: "start" }}>
        <Panel title="Hard interlocks (gate-level)" icon={<ShieldAlert size={15} />} right={<Badge tone="red">always REFUSE</Badge>}>
          <p className="ac-muted">
            These action types are refused by the Commit Gate <strong>regardless of envelope policy</strong>.
            Proven by per-vertical interlock tests.
          </p>
          <div className="ac-chip-row" style={{ marginTop: 8 }}>
            {v.hardInterlocks.map((t: string) => <span key={t} className="ac-chip" style={{ borderColor: "var(--ac-red)" }}>{t}</span>)}
          </div>
        </Panel>

        <Panel title={v.presets.label + " (demo)"} icon={<BadgeAlert size={15} />} right={<Badge tone="amber">demo only</Badge>}>
          <p className="ac-muted">
            Per-jurisdiction or per-site rule packs shipped with this vertical, all flagged
            <code> demonstration_only: true</code>.
          </p>
          <div className="ac-chip-row" style={{ marginTop: 8 }}>
            {v.presets.states.map((s: string) => <span key={s} className="ac-chip">{s}</span>)}
          </div>
        </Panel>
      </div>

      <Panel title="Evidence + tests" icon={<FileCheck2 size={15} />} right={<Badge tone="green">hash-chained</Badge>}>
        <div className="ac-grid ac-cols-2">
          <div>
            <div className="ac-label">Evidence bundle</div>
            <p>
              The vertical exports a typed Evidence Bundle wrapping the signed execution-control
              bundle. Tampering with any field post-export breaks <code>verify*EvidenceBundle()</code>.
              Bundle context fields are hashed into the bundle hash.
            </p>
          </div>
          <div>
            <div className="ac-label">Test surface</div>
            <p>
              {v.testSurface.tests} tests in <code>{v.testSurface.suite}</code>. Covers the ALLOW path,
              named REFUSE paths per bound, dual-control ESCALATE paths, hard-interlock refusals, and
              an Evidence Bundle tamper-detection round-trip.
            </p>
          </div>
        </div>
      </Panel>
    </div>
  );
}
