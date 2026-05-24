import { Activity, ChevronDown, Hexagon, ShieldCheck, ShieldAlert, Power } from "lucide-react";
import React from "react";
import { useCommandStore } from "./store.js";
import type { OperationalMode } from "./types.js";
import { Sparkline, StatusDot, cx } from "./primitives.js";

const MODES: OperationalMode[] = ["normal", "degraded", "partitioned", "emergency", "simulation", "replay"];

function HStat({ k, value, tone }: { k: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="ac-hstat">
      <span className="v" style={tone ? { color: `var(--ac-${tone})` } : undefined}>{value}</span>
      <span className="k">{k}</span>
    </div>
  );
}

export function CommandHeader() {
  const snapshot = useCommandStore((s) => s.snapshot);
  const pipeline = useCommandStore((s) => s.pipeline);
  const setMode = useCommandStore((s) => s.setMode);
  const [modeOpen, setModeOpen] = React.useState(false);

  const postureClass = `p-${snapshot.posture}`;
  const PostureIcon = snapshot.posture === "green" ? ShieldCheck : ShieldAlert;
  const latency = pipeline.slice(-30).map((p) => p.latencyMs);

  return (
    <header className="ac-header">
      <div className="ac-brand">
        <span className="ac-brand-mark"><Hexagon size={18} strokeWidth={2.2} /></span>
        <span>
          <div className="ac-brand-name">AristotleOS</div>
          <div className="ac-brand-sub">Governance Command</div>
        </span>
        <span
          title={snapshot.source === "live" ? "Connected to a live execution-control boundary" : "No boundary connected — showing sample data"}
          style={{
            marginLeft: 8,
            alignSelf: "center",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: 0.6,
            padding: "2px 6px",
            borderRadius: 5,
            border: "1px solid",
            borderColor: snapshot.source === "live" ? "rgba(52,211,153,0.5)" : "rgba(148,163,184,0.35)",
            color: snapshot.source === "live" ? "var(--ac-green)" : "var(--ac-text-3)",
            background: snapshot.source === "live" ? "rgba(52,211,153,0.10)" : "transparent"
          }}
        >
          {snapshot.source === "live" ? "LIVE" : "SAMPLE"}
        </span>
      </div>

      <div className="ac-posture">
        <div style={{ position: "relative" }}>
          <button className="ac-mode" onClick={() => setModeOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={modeOpen}>
            <StatusDot tone={snapshot.posture} pulse={snapshot.posture !== "green"} />
            {snapshot.mode}
            <ChevronDown size={13} />
          </button>
          {modeOpen && (
            <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 30, background: "rgba(8,12,22,0.98)", border: "1px solid var(--ac-line)", borderRadius: 8, padding: 6, minWidth: 170, boxShadow: "0 16px 40px rgba(0,0,0,0.5)" }} role="listbox">
              {MODES.map((m) => (
                <button
                  key={m}
                  role="option"
                  aria-selected={snapshot.mode === m}
                  className={cx("ac-rail-btn")}
                  style={{ flexDirection: "row", justifyContent: "flex-start", gap: 8, width: "100%", margin: 0, textTransform: "uppercase", fontSize: 11 }}
                  onClick={() => { setMode(m); setModeOpen(false); }}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className={cx("ac-posture-chip", postureClass)}>
          <PostureIcon size={16} />
          {snapshot.posture === "green" ? "GOVERNED" : snapshot.posture === "amber" ? "GUARDED" : "FAIL-CLOSED"}
        </div>
      </div>

      <div className="ac-header-stats">
        <HStat k="Active Wards" value={snapshot.activeWards} />
        <HStat k="Active Agents" value={snapshot.activeAgents} />
        <HStat k="Open Commits" value={snapshot.openRequests} tone={snapshot.openRequests > 4 ? "amber" : undefined} />
        <HStat k="Warrants · 24h" value={snapshot.warrantsToday.toLocaleString()} tone="green" />
        <HStat k="Refused · 24h" value={snapshot.refusalsToday} tone="red" />
        <HStat k="Escalated · 24h" value={snapshot.escalationsToday} tone="violet" />
        <HStat
          k="Ledger Integrity"
          value={<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><StatusDot tone={snapshot.ledgerIntact ? "green" : "red"} />{snapshot.ledgerIntact ? "INTACT" : "BROKEN"}</span>}
        />
        <HStat
          k="Kill Switch"
          value={<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Power size={14} color={snapshot.killSwitchArmed ? "var(--ac-red)" : "var(--ac-text-3)"} />{snapshot.killSwitchArmed ? "ARMED" : "SAFE"}</span>}
          tone={snapshot.killSwitchArmed ? "red" : undefined}
        />
        <div className="ac-hstat" style={{ minWidth: 170, flex: 1 }}>
          <span className="v" style={{ gap: 8 }}>
            <Activity size={14} color="var(--ac-cyan)" />
            {snapshot.gateLatencyMs.toFixed(1)}<span className="ac-metric-unit">ms</span>
          </span>
          <span className="k">Gate Pipeline Latency</span>
          <div style={{ marginTop: 4 }}><Sparkline data={latency} width={170} height={22} tone={snapshot.gateLatencyMs > 14 ? "amber" : "cyan"} /></div>
        </div>
      </div>
    </header>
  );
}
