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
import { Badge, Metric, Panel, cx, type Tone } from "./primitives.js";
import { useCommandStore } from "./store.js";
import { VERTICAL_ORDER, VERTICAL_REGISTRY, type VerticalConfig, type VerticalId } from "./verticals/registry.js";

type VerticalCategory = "all" | "critical" | "mobility" | "autonomy" | "enterprise";

const CATEGORIES: Array<{ id: VerticalCategory; label: string; description: string }> = [
  { id: "all", label: "All industries", description: "Complete governed-execution catalog" },
  { id: "critical", label: "Critical infrastructure", description: "Grid, water, telecom, rail, ports, pipelines" },
  { id: "mobility", label: "Mobility", description: "Cars, aviation, freight, title workflows" },
  { id: "autonomy", label: "Field autonomy", description: "Robotics, swarms, space, mining" },
  { id: "enterprise", label: "Enterprise operations", description: "Healthcare and regulated workflow control" }
];

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

const INDUSTRY_PRESENTATION: Record<VerticalId, {
  category: Exclude<VerticalCategory, "all">;
  tone: Tone;
  avatar: string;
  doctrine: string;
  explanation: string;
}> = {
  automotive: {
    category: "mobility",
    tone: "cyan",
    avatar: "AV",
    doctrine: "No vehicle consequence without mission authority.",
    explanation: "Fleet dispatch, teleop, drive-by-wire, OTA, and incident actions are gated before they touch a vehicle or fleet system."
  },
  aviation: {
    category: "mobility",
    tone: "violet",
    avatar: "AIR",
    doctrine: "Airspace authority before aircraft action.",
    explanation: "Flight, UTM, DAA, Remote ID, C2-link, waiver, and emergency actions pass through a warrant-backed boundary."
  },
  grid: {
    category: "critical",
    tone: "amber",
    avatar: "MW",
    doctrine: "Switching authority before field state changes.",
    explanation: "Breaker, DERMS, relay, substation, load-shed, and topology changes refuse unless the live grid register is admissible."
  },
  healthcare: {
    category: "enterprise",
    tone: "green",
    avatar: "HX",
    doctrine: "Clinical authority before patient-record consequence.",
    explanation: "EHR, PHI, medication, claims, device, and care-workflow actions produce traceable evidence before execution."
  },
  logistics: {
    category: "mobility",
    tone: "cyan",
    avatar: "FT",
    doctrine: "Freight authority before cargo, route, or payment action.",
    explanation: "Dispatch, tender, HOS, cargo release, route deviation, fuel, and payment actions are bound to operator authority."
  },
  mining: {
    category: "autonomy",
    tone: "amber",
    avatar: "MN",
    doctrine: "Mine-site invariants before autonomous equipment action.",
    explanation: "Haul, blast-zone, tailings, ventilation, slope, and equipment commands run through hard site-safety interlocks."
  },
  pipeline: {
    category: "critical",
    tone: "amber",
    avatar: "PL",
    doctrine: "Segment authority before valve or pressure consequence.",
    explanation: "Pipeline control actions are evaluated against pressure, leak, corrosion, SCADA, and operator qualification state."
  },
  port: {
    category: "critical",
    tone: "cyan",
    avatar: "PT",
    doctrine: "Terminal authority before port operations move.",
    explanation: "Crane, gate, VTS, customs, reefer, shore-power, and yard actions produce admissibility and evidence before consequence."
  },
  rail: {
    category: "critical",
    tone: "red",
    avatar: "RR",
    doctrine: "Movement authority before rail consequence.",
    explanation: "Dispatch, PTC, switch, wayside, route, consist, speed, and worker-protection actions fail closed when state is unsafe."
  },
  robotics: {
    category: "autonomy",
    tone: "violet",
    avatar: "BOT",
    doctrine: "Workcell authority before robot motion.",
    explanation: "Humanoid, industrial, warehouse, and field-robot actions require live zone, human-presence, and payload invariants."
  },
  space: {
    category: "autonomy",
    tone: "violet",
    avatar: "ORB",
    doctrine: "Mission authority before launch or orbital consequence.",
    explanation: "Launch, range, TT&C, orbit maneuver, RF, payload, RPO, and deorbit actions are governed at the commit boundary."
  },
  swarm: {
    category: "autonomy",
    tone: "cyan",
    avatar: "SW",
    doctrine: "Collective authority before coordinated autonomy.",
    explanation: "Multi-agent maneuvers, geofence, formation, mission reassignment, and kill-switch behavior stay warrant-bound."
  },
  telecom: {
    category: "critical",
    tone: "green",
    avatar: "5G",
    doctrine: "Network authority before autonomous NOC change.",
    explanation: "RAN, core, OSS/BSS, slice, NETCONF, gNMI, O-RAN, and customer-impacting actions are admitted before execution."
  },
  title: {
    category: "mobility",
    tone: "slate",
    avatar: "TTL",
    doctrine: "Institutional authority before title consequence.",
    explanation: "DMV, dealer, lender, ELT, NMVTIS, fraud, lien, registration, and ESIGN workflows preserve warrant and evidence."
  },
  water: {
    category: "critical",
    tone: "cyan",
    avatar: "H2O",
    doctrine: "Utility authority before water-system consequence.",
    explanation: "SCADA, PLC, valve, pump, dosing, discharge, lab, and public-health actions are gated before physical mutation."
  }
};

function VerticalCard({ vertical }: { vertical: VerticalConfig }) {
  const Icon = ICONS[vertical.id];
  const presentation = INDUSTRY_PRESENTATION[vertical.id];
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
    <button type="button" onClick={onOpen} className="ac-industry-card">
      <span className={cx("ac-industry-avatar", `tone-${presentation.tone}`)}>
        <Icon size={22} />
        <span>{presentation.avatar}</span>
      </span>
      <span className="ac-industry-card-body">
        <span className="ac-industry-card-head">
          <span>
            <span className="ac-industry-name">{vertical.name}</span>
            <span className="ac-industry-doctrine">{presentation.doctrine}</span>
          </span>
          <Badge tone={vertical.hasDedicatedConsole ? "cyan" : "slate"}>
            {vertical.hasDedicatedConsole ? "console" : "overview"}
          </Badge>
        </span>
        <span className="ac-industry-explain">{presentation.explanation}</span>
        <span className="ac-industry-frame">{vertical.framing}</span>
        <span className="ac-industry-meta">
          <Badge tone="green">{vertical.adapters.length} adapters</Badge>
          <Badge tone="red">{vertical.hardInterlocks.length} interlocks</Badge>
          <Badge tone="amber">{vertical.presets.states.length} presets</Badge>
          <span className="ac-industry-open">
            {vertical.hasDedicatedConsole ? "Open console" : "Open overview"} <ChevronRight size={14} />
          </span>
        </span>
      </span>
    </button>
  );
}

function CategoryTabs({
  active,
  onChange,
  counts
}: {
  active: VerticalCategory;
  onChange: (category: VerticalCategory) => void;
  counts: Record<VerticalCategory, number>;
}) {
  return (
    <div className="ac-industry-tabs" role="tablist" aria-label="Industry vertical categories">
      {CATEGORIES.map((category) => (
        <button
          key={category.id}
          type="button"
          role="tab"
          aria-selected={active === category.id}
          className={cx("ac-industry-tab", active === category.id && "is-active")}
          onClick={() => onChange(category.id)}
        >
          <span className="ac-industry-tab-top">
            <span>{category.label}</span>
            <span className="ac-industry-tab-count">{counts[category.id]}</span>
          </span>
          <span>{category.description}</span>
        </button>
      ))}
    </div>
  );
}

export function VerticalsRegistryConsole() {
  const ordered = VERTICAL_ORDER.map((id) => VERTICAL_REGISTRY[id]);
  const [category, setCategory] = React.useState<VerticalCategory>("all");
  const dedicated = ordered.filter((v) => v.hasDedicatedConsole).length;
  const overview = ordered.length - dedicated;
  const counts = React.useMemo<Record<VerticalCategory, number>>(() => {
    const base: Record<VerticalCategory, number> = { all: ordered.length, critical: 0, mobility: 0, autonomy: 0, enterprise: 0 };
    for (const vertical of ordered) base[INDUSTRY_PRESENTATION[vertical.id].category] += 1;
    return base;
  }, [ordered]);
  const visible = category === "all"
    ? ordered
    : ordered.filter((v) => INDUSTRY_PRESENTATION[v.id].category === category);

  return (
    <div className="ac-grid" style={{ gridTemplateColumns: "1fr", gap: 14 }}>
      <Panel
        title="Industry Verticals"
        icon={<LayoutGrid size={15} />}
        right={<Badge tone="amber">demonstration material throughout</Badge>}
      >
        <div className="ac-industry-hero">
          <div>
            <div className="ac-label">Vertical access hub</div>
            <h2>Pick the operating domain first. AristotleOS keeps the same execution boundary underneath.</h2>
            <p>
              Every industry module stays faithful to the same doctrine: authority before consequence,
              Warrant before execution, evidence after every decision. The cards below route to the
              dedicated console when one exists, or to the vertical overview when the module is still
              represented by shared runtime surfaces.
            </p>
          </div>
          <div className="ac-adoption-kpis">
            <Metric label="Verticals" value={ordered.length} tone="cyan" />
            <Metric label="Dedicated consoles" value={dedicated} tone="green" />
            <Metric label="Overview modules" value={overview} tone="amber" />
            <Metric label="Boundary" value="Commit Gate" tone="violet" sm />
          </div>
        </div>
      </Panel>

      <Panel
        title="Choose an industry"
        icon={<Layers size={15} />}
        right={<Badge tone="cyan">click an avatar</Badge>}
      >
        <CategoryTabs active={category} onChange={setCategory} counts={counts} />
        <div className="ac-industry-grid">
          {visible.map((v) => (
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
            <p>Action types the Commit Gate REFUSES regardless of envelope policy - proven by per-vertical interlock tests.</p>
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

      <Panel title="Pre-coordination disclaimer" icon={<Layers size={15} />} right={<Badge tone="red">read before deploy</Badge>}>
        <p className="ac-muted">
          AristotleOS does not replace regulators, operators, or safety organizations. The verticals
          here govern the actions an autonomous system or AI assistant takes <em>through</em> existing
          regulated workflows - they do not certify the workflow itself. Every jurisdiction / site
          rule preset shipped on this branch must be validated with the relevant regulator and the
          operator's compliance counsel before production use.
        </p>
      </Panel>
    </div>
  );
}
