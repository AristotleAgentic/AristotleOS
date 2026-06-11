import React from "react";
import { Boxes, Cpu, Database, Eye, Network, ShieldHalf, Radio } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { MESH_LINKS, MESH_NODES } from "./mockData.js";
import type { MeshNode, MeshNodeKind } from "./types.js";
import { Panel, StateBadge, StatusDot, cx, stateTone } from "./primitives.js";
import { useCommandStore } from "./store.js";

const W = 1000;
const H = 560;

const KIND_META: Record<MeshNodeKind, { r: number; label: string; icon: LucideIcon }> = {
  ledger: { r: 34, label: "Evidence Ledger", icon: Database },
  ward: { r: 26, label: "Ward", icon: ShieldHalf },
  "commit-gate": { r: 18, label: "Commit Gate", icon: Network },
  agent: { r: 14, label: "Agent", icon: Cpu },
  witness: { r: 20, label: "Witness", icon: Eye },
  revocation: { r: 20, label: "Revocation", icon: Radio },
  "authority-domain": { r: 16, label: "Authority Domain", icon: Boxes }
};

function color(tone: string) {
  return `var(--ac-${tone})`;
}

export function MeshView({ compact }: { compact?: boolean }) {
  const selectMeshNode = useCommandStore((s) => s.selectMeshNode);
  const selected = useCommandStore((s) => s.selectedMeshNodeId);
  const [hover, setHover] = React.useState<{ node: MeshNode; x: number; y: number } | null>(null);

  const pos = (n: MeshNode) => ({ x: 40 + n.x * (W - 80), y: 30 + n.y * (H - 60) });
  const byId = React.useMemo(() => Object.fromEntries(MESH_NODES.map((n) => [n.id, n])), []);

  return (
    <Panel
      title="Governance Mesh"
      icon={<Network size={15} />}
      right={
        <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {(["active", "degraded", "escalated", "revoked"] as const).map((s) => (
            <span key={s} className="ac-label" style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--ac-text-3)" }}>
              <StatusDot tone={stateTone(s)} />{s}
            </span>
          ))}
        </span>
      }
      flush
      className="ac-mesh"
      style={compact ? undefined : { minHeight: 0 }}
    >
      <div style={{ position: "relative" }}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Live governance mesh">
          {/* links */}
          {MESH_LINKS.map((l, i) => {
            const a = byId[l.from];
            const b = byId[l.to];
            if (!a || !b) return null;
            const pa = pos(a);
            const pb = pos(b);
            const tone = stateTone(l.state);
            const dim = l.state === "revoked" || l.state === "fail-closed";
            return (
              <line
                key={i}
                x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
                stroke={color(tone)}
                strokeWidth={l.to === "ledger-core" || l.from === "ledger-core" ? 1.6 : 1.1}
                strokeOpacity={dim ? 0.35 : 0.5}
                strokeDasharray={l.state === "awaiting-warrant" ? "4 4" : dim ? "2 5" : undefined}
              />
            );
          })}

          {/* nodes */}
          {MESH_NODES.map((n) => {
            const p = pos(n);
            const meta = KIND_META[n.kind];
            const tone = stateTone(n.state);
            const isSel = selected === n.id;
            const Icon = meta.icon;
            return (
              <g
                key={n.id}
                className="ac-mesh-node"
                transform={`translate(${p.x} ${p.y})`}
                onMouseEnter={() => setHover({ node: n, x: p.x, y: p.y })}
                onMouseLeave={() => setHover(null)}
                onClick={() => selectMeshNode(n.id)}
              >
                {/* status ring */}
                <circle r={meta.r + 6} fill="none" stroke={color(tone)} strokeOpacity={isSel ? 0.9 : 0.5} strokeWidth={isSel ? 2 : 1.2} strokeDasharray={n.state === "escalated" || n.state === "awaiting-warrant" ? "3 4" : undefined} />
                <circle r={meta.r} fill="var(--ac-panel)" stroke={color(tone)} strokeWidth={1.6} />
                <circle r={meta.r} fill={color(tone)} fillOpacity={0.1} />
                <foreignObject x={-9} y={-9} width={18} height={18} style={{ pointerEvents: "none" }}>
                  <div style={{ color: color(tone), display: "grid", placeItems: "center", height: 18 }}><Icon size={n.kind === "agent" ? 12 : 15} /></div>
                </foreignObject>
                <text y={meta.r + 15} textAnchor="middle" fontSize={n.kind === "agent" || n.kind === "commit-gate" ? 10 : 11.5} fontFamily="var(--ac-sans)" fill="var(--ac-text-2)" fontWeight={600}>
                  {n.label}
                </text>
              </g>
            );
          })}
        </svg>

        {hover && (
          <div
            className="ac-hovercard"
            style={{
              left: Math.min((hover.x / W) * 100, 72) + "%",
              top: (hover.y / H) * 100 + "%",
              transform: "translate(12px, -50%)"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <strong style={{ fontSize: 13 }}>{hover.node.label}</strong>
            </div>
            <div className="ac-label" style={{ marginBottom: 8 }}>{KIND_META[hover.node.kind].label}</div>
            <StateBadge state={hover.node.state} />
            {hover.node.detail && <div className="ac-muted" style={{ marginTop: 8, fontSize: 12 }}>{hover.node.detail}</div>}
            <div className="ac-muted" style={{ marginTop: 6, fontSize: 11 }}>Click to inspect</div>
          </div>
        )}
      </div>
    </Panel>
  );
}

/** Compact node detail used in drawers / side rails */
export function MeshNodeDetail({ id }: { id: string }) {
  const node = MESH_NODES.find((n) => n.id === id);
  if (!node) return null;
  return (
    <div className={cx("ac-kv")} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <strong style={{ fontSize: 15 }}>{node.label}</strong>
      <StateBadge state={node.state} />
      {node.detail && <span className="ac-muted">{node.detail}</span>}
    </div>
  );
}
