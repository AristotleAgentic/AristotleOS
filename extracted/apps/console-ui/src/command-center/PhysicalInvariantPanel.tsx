import { Cpu, Gauge, ShieldCheck, TriangleAlert } from "lucide-react";
import React from "react";
import { INTERLOCK_EVENTS, PHYSICAL_CHANNELS } from "./mockData.js";
import type { PhysicalChannel } from "./types.js";
import { Badge, Panel, cx, relTime } from "./primitives.js";

function channelTone(c: PhysicalChannel) {
  return c.state === "interlock" ? "red" : c.state === "warning" ? "amber" : "green";
}
function fillPct(c: PhysicalChannel) {
  // geofence margin: more is better; others: value/limit
  if (c.id === "ch-geo") return Math.min(1, c.value / 400);
  if (c.id === "ch-bat") return Math.min(1, c.value / 100);
  return Math.min(1, c.value / c.limit);
}

export function PhysicalInvariantPanel({ compact }: { compact?: boolean }) {
  return (
    <div className="ac-grid" style={{ gridTemplateColumns: compact ? "1fr" : "minmax(0, 1.4fr) minmax(0, 1fr)", alignItems: "start" }}>
      <Panel
        title="Physical Invariant Gater"
        icon={<Gauge size={15} />}
        right={<span className="ac-badge t-green"><ShieldCheck size={12} /> hardware armed</span>}
      >
        <div className="ac-grid ac-cols-3">
          {PHYSICAL_CHANNELS.map((c) => {
            const tone = channelTone(c);
            const pct = fillPct(c);
            return (
              <div key={c.id} style={{ border: "1px solid var(--ac-line)", borderRadius: 10, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span className="ac-label">{c.label}</span>
                  <Badge tone={tone}>{c.state}</Badge>
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                  <span className="ac-num" style={{ fontSize: 22, fontWeight: 600 }}>{c.value}</span>
                  <span className="ac-metric-unit">{c.unit}</span>
                  <span className="ac-muted" style={{ marginLeft: "auto", fontSize: 11 }}>
                    {c.id === "ch-geo" || c.id === "ch-bat" ? "floor" : "limit"} {c.limit}{c.id === "ch-bat" || c.id === "ch-geo" ? "" : c.unit === "%" ? "%" : ""}
                  </span>
                </div>
                <div className="ac-bar" style={{ marginTop: 9 }}>
                  <span style={{ width: `${pct * 100}%`, background: `var(--ac-${tone})` }} />
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <div className="ac-grid" style={{ gridTemplateColumns: "1fr", gap: 14 }}>
        <Panel title="Software ↔ Physical Agreement" icon={<Cpu size={15} />}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: "var(--ac-cyan)" }} /> Software governance
                <Badge tone="green">allow</Badge>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: "var(--ac-green)" }} /> Physical containment
                <Badge tone="green">within limits</Badge>
              </div>
            </div>
            <div style={{ textAlign: "center" }}>
              <ShieldCheck size={30} color="var(--ac-green)" />
              <div className="ac-label" style={{ marginTop: 4, color: "var(--ac-green)" }}>IN AGREEMENT</div>
            </div>
          </div>
          <div className="ac-muted" style={{ marginTop: 12, fontSize: 12 }}>
            The Physical Invariant Gater holds independently of software authority. If the two ever disagree, the boundary fails closed and asserts physical containment.
          </div>
        </Panel>

        <Panel title="Interlock Events" icon={<TriangleAlert size={15} />} flush>
          <div className="ac-panel-body" style={{ paddingTop: 6 }}>
            {INTERLOCK_EVENTS.map((e, i) => (
              <div key={i} style={{ display: "flex", gap: 10, padding: "9px 0", borderBottom: i < INTERLOCK_EVENTS.length - 1 ? "1px solid var(--ac-line)" : 0 }}>
                <TriangleAlert size={15} color="var(--ac-amber)" style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <div style={{ fontSize: 12.5 }}>{e.detail}</div>
                  <div className="ac-muted" style={{ fontSize: 11, marginTop: 2 }}>
                    {e.channel} · {relTime(e.at)} · {e.agreed ? <span style={{ color: "var(--ac-green)" }}>software agreed</span> : <span style={{ color: "var(--ac-red)" }}>disagreement</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
