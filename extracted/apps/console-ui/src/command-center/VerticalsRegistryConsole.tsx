import {
  Anchor,
  BadgeAlert,
  BookOpenCheck,
  Car,
  ChevronRight,
  Construction,
  Database,
  Droplets,
  FileText,
  HardHat,
  Hospital,
  Landmark,
  Layers,
  LayoutGrid,
  Network,
  Plane,
  Radar,
  Rocket,
  ShieldAlert,
  Stethoscope,
  Train,
  Truck,
  Zap,
  Wrench,
  Workflow
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import React from "react";
import { Badge, Metric, Panel, cx } from "./primitives.js";
import { useCommandStore } from "./store.js";
import { VERTICAL_ORDER, VERTICAL_REGISTRY, type VerticalConfig, type VerticalId } from "./verticals/registry.js";

const ICONS: Record<VerticalId, LucideIcon> = {
  automotive: Car,
  aviation: Plane,
  grid: Zap,
  healthcare: Stethoscope,
  logistics: Truck,
  mining: HardHat,
  pipeline: Workflow,
  port: Anchor,
  rail: Train,
  robotics: Wrench,
  space: Rocket,
  swarm: Radar,
  telecom: Network,
  title: FileText,
  water: Droplets
};

function VerticalCard({ vertical }: { vertical: VerticalConfig }) {
  const Icon = ICONS[vertical.id];
  const setSection = useCommandStore((s) => s.setSection);
  const selectVertical = useCommandStore((s) => s.selectVertical);
  const onOpen = () => {
    if (vertical.dedicatedSectionId) {
      setSection(vertical.dedicatedSectionId);
    } else {
      selectVertical(vertical.id);
      setSection("vertical-detail");
    }
  };
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cx("ac-vertical-card")}
      style={{
        textAlign: "left",
        cursor: "pointer",
        background: "var(--ac-panel)",
        border: "1px solid var(--ac-border)",
        borderRadius: 10,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        color: "inherit"
      }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <Icon size={18} />
        <div style={{ fontWeight: 600 }}>{vertical.name}</div>
        <span style={{ marginLeft: "auto" }}>
          <Badge tone={vertical.hasDedicatedConsole ? "cyan" : "slate"}>
            {vertical.hasDedicatedConsole ? "console" : "overview"}
          </Badge>
        </span>
      </div>
      <div className="ac-muted" style={{ fontSize: 12 }}>{vertical.framing}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
        <Badge tone="green">{vertical.adapters.length} adapters</Badge>
        <Badge tone="red">{vertical.hardInterlocks.length} interlocks</Badge>
        <Badge tone="amber">{vertical.presets.states.length} presets</Badge>
      </div>
      <div style={{ display: "flex", alignItems: "center", marginTop: 4, fontSize: 12 }}>
        <span className="ac-muted">{vertical.presets.label}</span>
        <span style={{ marginLeft: "auto" }}><ChevronRight size={14} /></span>
      </div>
    </button>
  );
}

export function VerticalsRegistryConsole() {
  const ordered = VERTICAL_ORDER.map((id) => VERTICAL_REGISTRY[id]);
  const dedicated = ordered.filter((v) => v.hasDedicatedConsole).length;
  const overview = ordered.length - dedicated;
  return (
    <div className="ac-grid" style={{ gridTemplateColumns: "1fr", gap: 14 }}>
      <Panel
        title="Industry Verticals"
        icon={<LayoutGrid size={15} />}
        right={<Badge tone="amber">demonstration material throughout</Badge>}
      >
        <div className="ac-adoption-hero">
          <div>
            <div className="ac-label">Per-vertical authority + invariants + evidence</div>
            <h2>{ordered.length} industry verticals on this branch, each citing real regulation in code.</h2>
            <p>
              Each vertical compiles to a typed adapter catalog, a runtime snapshot the gate reads,
              a per-jurisdiction / per-site rule preset bundle, action types that route through
              the Commit Gate with named hard interlocks, dual-control rules for high-consequence
              acts, and a hash-bound Evidence Bundle on every decision.
            </p>
            <p className="ac-muted" style={{ marginTop: 8 }}>
              All shipped rule presets are <strong>demonstration material</strong> — they
              illustrate the shape of a deployable rule pack, not legally-validated rules. Real
              deployments require counsel review + per-regulator coordination before promotion
              past <code>rule_validation_state: "demonstration"</code>.
            </p>
          </div>
          <div className="ac-adoption-kpis">
            <Metric label="Verticals" value={ordered.length} tone="cyan" />
            <Metric label="Dedicated consoles" value={dedicated} tone="green" />
            <Metric label="Overview-only" value={overview} tone="amber" />
            <Metric label="Decision path" value="ALLOW / REFUSE / ESCALATE" sm />
          </div>
        </div>
      </Panel>

      <Panel
        title="All verticals"
        icon={<Layers size={15} />}
        right={<Badge tone="cyan">click to open</Badge>}
      >
        <div
          className="ac-grid"
          style={{
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 10
          }}
        >
          {ordered.map((v) => (
            <VerticalCard key={v.id} vertical={v} />
          ))}
        </div>
      </Panel>

      <Panel
        title="What every vertical guarantees"
        icon={<BookOpenCheck size={15} />}
        right={<Badge tone="green">structural</Badge>}
      >
        <div className="ac-grid ac-cols-2">
          <div>
            <div className="ac-label" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <Database size={13} /> Typed adapter catalog
            </div>
            <p>Each adapter family is a documented boundary: action types, required runtime registers, source-of-truth system it sits in front of.</p>
            <div className="ac-divider" />
            <div className="ac-label" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <ShieldAlert size={13} /> Hard interlocks
            </div>
            <p>Action types the Commit Gate REFUSES regardless of envelope policy — proven by per-vertical interlock tests.</p>
          </div>
          <div>
            <div className="ac-label" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <BadgeAlert size={13} /> Demonstration presets
            </div>
            <p>Per-jurisdiction or per-site rule packs flagged <code>demonstration_only: true</code>. Real deployments must promote past demo state before relying on them.</p>
            <div className="ac-divider" />
            <div className="ac-label" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <Construction size={13} /> Hash-bound Evidence Bundles
            </div>
            <p>Per-vertical <code>export*EvidenceBundle()</code> + <code>verify*EvidenceBundle()</code> with tamper detection; mutating any field after export fails verification.</p>
          </div>
        </div>
      </Panel>

      <Panel title="Pre-coordination disclaimer" icon={<Landmark size={15} />} right={<Badge tone="red">read before deploy</Badge>}>
        <p className="ac-muted">
          AristotleOS does not replace regulators, operators, or safety organizations. The verticals
          here govern the actions an autonomous system or AI assistant takes <em>through</em> existing
          regulated workflows — they do not certify the workflow itself. Every jurisdiction / site
          rule preset shipped on this branch must be validated with the relevant regulator (FAA AST,
          FDA, MSHA, USSF Space Launch Delta, NASA range safety, state DMV, state insurance
          commissioner, NERC, FERC, EPA, etc.) and the operator's compliance counsel before
          production use.
        </p>
      </Panel>
    </div>
  );
}
