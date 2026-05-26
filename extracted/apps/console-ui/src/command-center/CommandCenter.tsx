import {
  Anchor,
  Boxes,
  Car,
  CheckCircle2,
  ClipboardCheck,
  Construction,
  Crosshair,
  Droplets,
  FileText,
  FlaskConical,
  Gauge,
  GitBranch,
  GitCommitHorizontal,
  History,
  Hospital,
  Landmark,
  LayoutGrid,
  Network,
  Radar,
  RadioTower,
  Siren,
  ShieldAlert,
  Truck,
  UserCheck,
  Workflow,
  TriangleAlert,
  Zap
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import React from "react";
import "./theme.css";
import { AdoptionPathConsole } from "./AdoptionPathConsole.js";
import { AutomotiveFleetConsole } from "./AutomotiveFleetConsole.js";
import { CommandHeader } from "./CommandHeader.js";
import { CommitGateConsole } from "./CommitGateConsole.js";
import { ConflictInboxConsole } from "./ConflictInboxConsole.js";
import { FailureModeConsole } from "./FailureModeConsole.js";
import { GovernanceBuilderConsole } from "./GovernanceBuilderConsole.js";
import { GridControlConsole } from "./GridControlConsole.js";
import { HealthcareOpsConsole } from "./HealthcareOpsConsole.js";
import { LedgerExplorer } from "./LedgerExplorer.js";
import { LogisticsOpsConsole } from "./LogisticsOpsConsole.js";
import { MeshNodeDetail, MeshView } from "./MeshView.js";
import { OperatorActionBar } from "./OperatorActionBar.js";
import { PhysicalInvariantPanel } from "./PhysicalInvariantPanel.js";
import { PortOpsConsole } from "./PortOpsConsole.js";
import { RailOpsConsole } from "./RailOpsConsole.js";
import { ReplayTimeMachine } from "./ReplayTimeMachine.js";
import { SimulationPanel } from "./SimulationPanel.js";
import { ShadowModeConsole } from "./ShadowModeConsole.js";
import { ApprovalsConsole } from "./ApprovalsConsole.js";
import { TelecomNocConsole } from "./TelecomNocConsole.js";
import { TitleOpsConsole } from "./TitleOpsConsole.js";
import { WaterOpsConsole } from "./WaterOpsConsole.js";
import { WardBrowser } from "./WardBrowser.js";
import { WardMarshalConsole } from "./WardMarshalConsole.js";
import { WarrantLifecycle } from "./WarrantLifecycle.js";
import { Drawer, SectionErrorBoundary, cx } from "./primitives.js";
import { useCommandStore, type SectionId } from "./store.js";

const NAV: Array<{ id: SectionId; label: string; icon: LucideIcon }> = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
  { id: "builder", label: "Builder", icon: Construction },
  { id: "shadow", label: "Shadow", icon: Radar },
  { id: "conflicts", label: "Conflicts", icon: Workflow },
  { id: "approvals", label: "Approvals", icon: UserCheck },
  { id: "noc", label: "NOC", icon: RadioTower },
  { id: "fleet", label: "Fleet", icon: Car },
  { id: "grid", label: "Grid", icon: Zap },
  { id: "rail", label: "Rail", icon: Landmark },
  { id: "port", label: "Port", icon: Anchor },
  { id: "water", label: "Water", icon: Droplets },
  { id: "logistics", label: "Freight", icon: Truck },
  { id: "healthcare", label: "Clinical", icon: Hospital },
  { id: "title", label: "Title", icon: FileText },
  { id: "adoption", label: "Adopt", icon: ClipboardCheck },
  { id: "failure", label: "Failure", icon: ShieldAlert },
  { id: "marshal", label: "Marshal", icon: Crosshair },
  { id: "mesh", label: "Mesh", icon: Network },
  { id: "commit", label: "Commits", icon: GitCommitHorizontal },
  { id: "warrants", label: "Warrants", icon: GitBranch },
  { id: "wards", label: "Wards", icon: Landmark },
  { id: "ledger", label: "Ledger", icon: Boxes },
  { id: "replay", label: "Replay", icon: History },
  { id: "simulation", label: "Sim", icon: FlaskConical },
  { id: "safety", label: "Safety", icon: Gauge }
];

const SECTION_META: Record<SectionId, { title: string; sub: string }> = {
  overview: { title: "Command Overview", sub: "Live governance posture across every ward and gate" },
  builder: { title: "Visual Governance Builder", sub: "Compile Ward and Authority artifacts without weakening governance silently" },
  shadow: { title: "Shadow Mode Profiling", sub: "Observe would-ALLOW / REFUSE / ESCALATE before live enforcement" },
  conflicts: { title: "Edge Conflict Inbox", sub: "Resolve disconnected edge reality against central governance" },
  approvals: { title: "Dual-Control Approvals", sub: "M-of-N approval for the gravest actions — plural authority, fully evidenced" },
  noc: { title: "Telecom NOC Workflow", sub: "Govern autonomous network changes from mission to admitted execution to evidence export" },
  fleet: { title: "Autonomous Vehicle Fleet", sub: "Govern vehicle actions from mission to admitted execution to safety evidence export" },
  grid: { title: "Electric Grid Control", sub: "Govern switching, DERMS, relay, and substation actions before field consequence" },
  rail: { title: "Railroad Operations", sub: "Govern dispatch, PTC, wayside, switch, and movement authority before rail consequence" },
  port: { title: "Maritime Port Operations", sub: "Govern terminal, gate, crane, VTS, customs, and shore-power actions before port consequence" },
  water: { title: "Water Infrastructure", sub: "Govern SCADA, PLC, pump, valve, dosing, and discharge actions before utility consequence" },
  logistics: { title: "Trucking and Logistics", sub: "Govern dispatch, tender, HOS, route, cargo release, fuel, and payment before freight consequence" },
  healthcare: { title: "Healthcare Clinical Operations", sub: "Govern EHR, pharmacy, PHI, device, claims, and patient workflows before clinical consequence" },
  title: { title: "Vehicle Title Transaction Layer", sub: "Govern ELT, title, registration, ESIGN, dealer, lender, DMV, fraud, and NMVTIS workflows before title consequence — demonstration rule sets only" },
  adoption: { title: "Commercial Adoption Path", sub: "From sandbox to shadow to enforcement to evidence export" },
  failure: { title: "Failure Mode Console", sub: "Partitions, stale authority, witness disagreement, and replay divergence" },
  marshal: { title: "Ward Marshal", sub: "Rogue-agent census and warrant-backed interdiction" },
  mesh: { title: "Governance Mesh", sub: "Distributed runtime enforcement fabric" },
  commit: { title: "Commit Gate Console", sub: "Authority is decided before action becomes consequence" },
  warrants: { title: "Warrant Lifecycle", sub: "Request → authority → invariants → gate → warrant → evidence" },
  wards: { title: "Ward & Authority Browser", sub: "Sovereign command structure and delegated authority" },
  ledger: { title: "Governance Evidence Ledger", sub: "Hash-linked, signed, tamper-evident decision history" },
  replay: { title: "Replay · Time Machine", sub: "Flight-data replay for governed autonomy" },
  simulation: { title: "Simulation · Counterfactual", sub: "Ask what governance would decide" },
  safety: { title: "Physical Invariant Gater", sub: "Hard interlocks independent of software authority" }
};

function SectionBody({ section }: { section: SectionId }) {
  switch (section) {
    case "overview":
      return (
        <div className="ac-grid" style={{ gridTemplateColumns: "1fr", gap: 14 }}>
          <div style={{ minHeight: 420 }}><MeshView /></div>
          <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 1.25fr) minmax(0, 1fr)", alignItems: "start" }}>
            <CommitGateConsole rows={7} />
            <WarrantLifecycle />
          </div>
          <PhysicalInvariantPanel compact />
        </div>
      );
    case "builder":
      return <GovernanceBuilderConsole />;
    case "shadow":
      return <ShadowModeConsole />;
    case "approvals":
      return <ApprovalsConsole />;
    case "noc":
      return <TelecomNocConsole />;
    case "fleet":
      return <AutomotiveFleetConsole />;
    case "grid":
      return <GridControlConsole />;
    case "rail":
      return <RailOpsConsole />;
    case "port":
      return <PortOpsConsole />;
    case "water":
      return <WaterOpsConsole />;
    case "logistics":
      return <LogisticsOpsConsole />;
    case "healthcare":
      return <HealthcareOpsConsole />;
    case "title":
      return <TitleOpsConsole />;
    case "conflicts":
      return <ConflictInboxConsole />;
    case "adoption":
      return <AdoptionPathConsole />;
    case "failure":
      return <FailureModeConsole />;
    case "marshal":
      return <WardMarshalConsole />;
    case "mesh":
      return <div style={{ minHeight: 560 }}><MeshView /></div>;
    case "commit":
      return (
        <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 1.25fr) minmax(0, 1fr)", alignItems: "start" }}>
          <CommitGateConsole />
          <WarrantLifecycle />
        </div>
      );
    case "warrants":
      return (
        <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, 1fr)", alignItems: "start" }}>
          <WarrantLifecycle />
          <CommitGateConsole rows={12} />
        </div>
      );
    case "wards":
      return <WardBrowser />;
    case "ledger":
      return <LedgerExplorer />;
    case "replay":
      return <ReplayTimeMachine />;
    case "simulation":
      return <SimulationPanel />;
    case "safety":
      return <PhysicalInvariantPanel />;
    default:
      return null;
  }
}

function Toasts() {
  const toasts = useCommandStore((s) => s.toasts);
  return (
    <div className="ac-toasts">
      {toasts.map((t) => (
        <div key={t.id} className={cx("ac-toast", `t-${t.tone}`)}>
          {t.tone === "red" ? <TriangleAlert size={15} color="var(--ac-red)" /> : <CheckCircle2 size={15} color={`var(--ac-${t.tone})`} />}
          {t.message}
        </div>
      ))}
    </div>
  );
}

export default function CommandCenter() {
  const section = useCommandStore((s) => s.section);
  const setSection = useCommandStore((s) => s.setSection);
  const opsOpen = useCommandStore((s) => s.opsOpen);
  const setOpsOpen = useCommandStore((s) => s.setOpsOpen);
  const meshNode = useCommandStore((s) => s.selectedMeshNodeId);
  const selectMeshNode = useCommandStore((s) => s.selectMeshNode);
  const tick = useCommandStore((s) => s.tick);
  const hydrate = useCommandStore((s) => s.hydrate);
  const meta = SECTION_META[section];

  React.useEffect(() => {
    void hydrate();
    const id = window.setInterval(() => tick(), 2000);
    return () => window.clearInterval(id);
  }, [hydrate, tick]);

  return (
    <div className="ac-root">
      <CommandHeader />
      <div className="ac-body">
        <nav className="ac-rail" aria-label="Sections">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={cx("ac-rail-btn", section === item.id && "is-active")} onClick={() => setSection(item.id)} aria-current={section === item.id}>
                <Icon size={19} />
                {item.label}
              </button>
            );
          })}
          <span className="ac-rail-spacer" />
          <button className="ac-rail-btn is-danger" onClick={() => setOpsOpen(true)}>
            <Siren size={19} />
            Actions
          </button>
        </nav>

        <main className="ac-main">
          <div className="ac-section-head">
            <h1 className="ac-section-title">{meta.title}</h1>
            <span className="ac-section-sub">{meta.sub}</span>
          </div>
          <SectionErrorBoundary section={section}>
            <SectionBody section={section} />
          </SectionErrorBoundary>
        </main>
      </div>

      {opsOpen && <OperatorActionBar />}
      {meshNode && (
        <Drawer title="Mesh Node" icon={<Network size={16} />} onClose={() => selectMeshNode(null)}>
          <MeshNodeDetail id={meshNode} />
        </Drawer>
      )}
      <Toasts />
    </div>
  );
}
