import { AlertOctagon, ArrowUpRight, Download, FlaskConical, History, PauseOctagon, Power, RefreshCw, ShieldOff, Siren } from "lucide-react";
import React from "react";
import { WARDS, ENVELOPES } from "./mockData.js";
import { useCommandStore } from "./store.js";
import { ConfirmAction, Drawer, cx } from "./primitives.js";

export function OperatorActionBar() {
  const close = () => setOpsOpen(false);
  const setOpsOpen = useCommandStore((s) => s.setOpsOpen);
  const setSection = useCommandStore((s) => s.setSection);
  const pauseWard = useCommandStore((s) => s.pauseWard);
  const revokeEnvelope = useCommandStore((s) => s.revokeEnvelope);
  const forceReconcile = useCommandStore((s) => s.forceReconcile);
  const setMode = useCommandStore((s) => s.setMode);
  const triggerKillSwitch = useCommandStore((s) => s.triggerKillSwitch);
  const exportEvidence = useCommandStore((s) => s.exportEvidence);
  const escalate = useCommandStore((s) => s.escalate);

  const [wardId, setWardId] = React.useState(WARDS[0]?.id ?? "");
  const [envId, setEnvId] = React.useState(ENVELOPES.find((e) => !e.revoked)?.id ?? ENVELOPES[0]?.id ?? "");

  return (
    <Drawer title="Operator Actions" icon={<Siren size={16} />} onClose={close}>
      <p className="ac-muted" style={{ marginTop: 0, fontSize: 12.5 }}>
        Operator commands act on live governance. Dangerous actions require confirmation and are recorded to the evidence ledger.
      </p>

      {/* Standard actions */}
      <div className="ac-label" style={{ margin: "16px 0 8px" }}>Routine</div>
      <div className="ac-ops-grid">
        <button className="ac-ops-btn" onClick={() => { exportEvidence(); }}>
          <span className="ic"><Download size={15} /></span>
          <span><span className="t">Export evidence bundle</span><span className="d">Portable, offline-verifiable proof</span></span>
        </button>
        <button className="ac-ops-btn" onClick={() => { setSection("replay"); close(); }}>
          <span className="ic"><History size={15} /></span>
          <span><span className="t">Open replay</span><span className="d">Scrub governance history</span></span>
        </button>
        <button className="ac-ops-btn" onClick={() => { setSection("simulation"); close(); }}>
          <span className="ic"><FlaskConical size={15} /></span>
          <span><span className="t">Run simulation</span><span className="d">Counterfactual outcomes</span></span>
        </button>
        <button className="ac-ops-btn" onClick={() => { forceReconcile(); }}>
          <span className="ic"><RefreshCw size={15} /></span>
          <span><span className="t">Force reconciliation</span><span className="d">Re-align runtime with evidence</span></span>
        </button>
      </div>

      {/* Scoped controls */}
      <div className="ac-label" style={{ margin: "18px 0 8px" }}>Scoped controls</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="ac-ops-btn" style={{ flexDirection: "column", gap: 9, cursor: "default" }}>
          <span className="t" style={{ display: "flex", alignItems: "center", gap: 8 }}><PauseOctagon size={15} color="var(--ac-amber)" /> Pause ward</span>
          <select className="ac-btn" style={{ width: "100%" }} value={wardId} onChange={(e) => setWardId(e.target.value)}>
            {WARDS.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <ConfirmAction label="Pause ward" description="Commit gate fails closed for this ward" icon={<PauseOctagon size={15} />} onConfirm={() => pauseWard(wardId)} />
        </div>

        <div className="ac-ops-btn" style={{ flexDirection: "column", gap: 9, cursor: "default" }}>
          <span className="t" style={{ display: "flex", alignItems: "center", gap: 8 }}><ShieldOff size={15} color="var(--ac-red)" /> Revoke authority envelope</span>
          <select className="ac-btn" style={{ width: "100%" }} value={envId} onChange={(e) => setEnvId(e.target.value)}>
            {ENVELOPES.map((e) => <option key={e.id} value={e.id}>{e.id} · {e.subject}</option>)}
          </select>
          <ConfirmAction danger label="Revoke envelope" description="Invalidate delegated authority now" icon={<ShieldOff size={15} />} onConfirm={() => revokeEnvelope(envId)} />
        </div>
      </div>

      {/* Dangerous / posture */}
      <div className="ac-label" style={{ margin: "18px 0 8px", color: "var(--ac-red)" }}>Posture & emergency</div>
      <div className="ac-ops-grid">
        <ConfirmAction label="Enter degraded mode" description="Tighten gates, widen escalation" icon={<AlertOctagon size={15} />} onConfirm={() => setMode("degraded")} />
        <ConfirmAction label="Escalate to human authority" description="Hand decision to sovereign operator" icon={<ArrowUpRight size={15} />} onConfirm={escalate} />
        <div style={{ gridColumn: "1 / -1" }}>
          <ConfirmAction danger label="Trigger kill switch" description="Global fail-closed — all gates refuse until released" icon={<Power size={16} />} onConfirm={triggerKillSwitch} />
        </div>
      </div>
    </Drawer>
  );
}
