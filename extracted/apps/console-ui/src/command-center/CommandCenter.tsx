import {
  Boxes,
  CheckCircle2,
  FlaskConical,
  Gauge,
  GitBranch,
  GitCommitHorizontal,
  History,
  Landmark,
  LayoutGrid,
  Network,
  Siren,
  TriangleAlert
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import React from "react";
import "./theme.css";
import { CommandHeader } from "./CommandHeader.js";
import { CommitGateConsole } from "./CommitGateConsole.js";
import { LedgerExplorer } from "./LedgerExplorer.js";
import { MeshNodeDetail, MeshView } from "./MeshView.js";
import { OperatorActionBar } from "./OperatorActionBar.js";
import { PhysicalInvariantPanel } from "./PhysicalInvariantPanel.js";
import { ReplayTimeMachine } from "./ReplayTimeMachine.js";
import { SimulationPanel } from "./SimulationPanel.js";
import { WardBrowser } from "./WardBrowser.js";
import { WarrantLifecycle } from "./WarrantLifecycle.js";
import { Drawer, cx } from "./primitives.js";
import { useCommandStore, type SectionId } from "./store.js";

const NAV: Array<{ id: SectionId; label: string; icon: LucideIcon }> = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
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
          <SectionBody section={section} />
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
