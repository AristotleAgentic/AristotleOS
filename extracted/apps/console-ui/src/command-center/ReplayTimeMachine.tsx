import { History, Pause, Play, Radio, Rewind } from "lucide-react";
import React from "react";
import { useCommandStore } from "./store.js";
import { AGENTS, ENVELOPES } from "./mockData.js";
import { Badge, Metric, Panel, StatusDot, cx } from "./primitives.js";

export function ReplayTimeMachine() {
  const replayT = useCommandStore((s) => s.replayT);
  const setReplayT = useCommandStore((s) => s.setReplayT);
  const mode = useCommandStore((s) => s.snapshot.mode);
  const setMode = useCommandStore((s) => s.setMode);
  const ledger = useCommandStore((s) => s.ledger);

  const isLive = replayT >= 100 && mode !== "replay";
  const atTime = new Date(Date.now() - (1 - replayT / 100) * 1000 * 60 * 45);

  // derive a historical view from the scrub position
  const activeAgents = AGENTS.filter((a) => (replayT > 30 ? true : a.state === "active")).slice(0, Math.max(1, Math.round((replayT / 100) * AGENTS.length)));
  const validEnvelopes = ENVELOPES.filter((e) => !e.revoked || replayT < 60);
  const revocationPropagated = replayT >= 60;
  const partitionActive = replayT > 40 && replayT < 70;
  const warrantsByT = Math.round((replayT / 100) * 1284);
  const decisionsByT = Math.round((replayT / 100) * 1330);
  const evidenceByT = Math.round((replayT / 100) * (ledger[0]?.seq ?? 128402));

  const scrub = (v: number) => {
    if (v < 100 && mode !== "replay") setMode("replay");
    setReplayT(v);
  };

  return (
    <div className="ac-grid" style={{ gridTemplateColumns: "1fr", gap: 14 }}>
      <Panel
        title="Replay · Time Machine"
        icon={<History size={15} />}
        right={
          isLive ? (
            <span className="ac-badge t-green"><StatusDot tone="green" pulse /> LIVE</span>
          ) : (
            <button className="ac-btn is-primary" onClick={() => { setReplayT(100); setMode("normal"); }}>
              <Radio size={13} /> Return to live
            </button>
          )
        }
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 6 }}>
          <Rewind size={16} color="var(--ac-text-3)" />
          <input
            className="ac-slider"
            type="range"
            min={0}
            max={100}
            step={0.5}
            value={replayT}
            onChange={(e) => scrub(Number(e.target.value))}
          />
          {isLive ? <Play size={16} color="var(--ac-green)" /> : <Pause size={16} color="var(--ac-amber)" />}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }} className="ac-mono ac-muted">
          <span>−45m</span>
          <span style={{ color: "var(--ac-cyan)" }}>{isLive ? "NOW" : atTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}</span>
          <span>now</span>
        </div>
      </Panel>

      <div className="ac-grid ac-cols-4">
        <Panel title="State at T"><Metric label="Active agents" value={activeAgents.length} tone="cyan" /></Panel>
        <Panel title="Warrants issued"><Metric label="cumulative" value={warrantsByT.toLocaleString()} tone="green" /></Panel>
        <Panel title="Commit decisions"><Metric label="cumulative" value={decisionsByT.toLocaleString()} /></Panel>
        <Panel title="Evidence height"><Metric label="ledger seq" value={evidenceByT.toLocaleString()} /></Panel>
      </div>

      <div className="ac-grid ac-cols-3">
        <Panel title="Authority Validity" icon={<History size={14} />}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {ENVELOPES.map((e) => {
              const valid = validEnvelopes.includes(e);
              return (
                <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                  <StatusDot tone={valid ? "green" : "red"} />
                  <span className="ac-mono">{e.id}</span>
                  <span style={{ marginLeft: "auto" }}><Badge tone={valid ? "green" : "red"}>{valid ? "valid" : "revoked"}</Badge></span>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel title="Propagation & Partition">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <StatusDot tone={revocationPropagated ? "green" : "amber"} pulse={!revocationPropagated} />
              <span style={{ fontSize: 12.5 }}>Revocation propagation</span>
              <span style={{ marginLeft: "auto" }}><Badge tone={revocationPropagated ? "green" : "amber"}>{revocationPropagated ? "converged" : "in flight"}</Badge></span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <StatusDot tone={partitionActive ? "red" : "green"} pulse={partitionActive} />
              <span style={{ fontSize: 12.5 }}>Network partition</span>
              <span style={{ marginLeft: "auto" }}><Badge tone={partitionActive ? "red" : "green"}>{partitionActive ? "partitioned" : "whole"}</Badge></span>
            </div>
            <div className="ac-muted" style={{ fontSize: 12 }}>
              {partitionActive
                ? "Under partition, affected gates operated fail-closed on cached authority."
                : "All gates operated on fresh authority at this point in the trace."}
            </div>
          </div>
        </Panel>

        <Panel title="Active Agents at T">
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {activeAgents.map((a) => (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                <StatusDot tone="cyan" />
                <span>{a.callsign}</span>
                <span className="ac-muted ac-mono" style={{ marginLeft: "auto", fontSize: 11 }}>{a.lastAction}</span>
              </div>
            ))}
            {activeAgents.length === 0 && <div className="ac-empty">No agents active at this time.</div>}
          </div>
        </Panel>
      </div>
    </div>
  );
}
