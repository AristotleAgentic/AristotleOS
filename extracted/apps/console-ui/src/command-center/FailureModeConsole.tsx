import { AlertTriangle, Archive, GitBranch, History, RadioTower, RefreshCw, ShieldAlert, Split, WifiOff } from "lucide-react";
import React from "react";
import { FAILURE_DRILLS } from "./mockData.js";
import { Badge, Metric, Panel, cx } from "./primitives.js";
import { useCommandStore } from "./store.js";
import type { FailureModeDrill, Posture } from "./types.js";

function stateTone(state: FailureModeDrill["state"]): Posture | "cyan" {
  switch (state) {
    case "resolved": return "green";
    case "contained": return "cyan";
    case "investigating": return "amber";
    case "requires-operator": return "red";
    default: return "amber";
  }
}

function modeIcon(mode: FailureModeDrill["mode"]) {
  switch (mode) {
    case "network-partition": return <WifiOff size={15} />;
    case "stale-authority": return <History size={15} />;
    case "revocation-lag": return <RadioTower size={15} />;
    case "witness-disagreement": return <Split size={15} />;
    case "replay-divergence": return <GitBranch size={15} />;
    case "degraded-edge": return <ShieldAlert size={15} />;
    default: return <AlertTriangle size={15} />;
  }
}

function FailureCard({ drill }: { drill: FailureModeDrill }) {
  const [open, setOpen] = React.useState(false);
  return (
    <article className={cx("ac-failure-card", drill.failClosed && "is-fail-closed")}>
      <button className="ac-failure-main" onClick={() => setOpen((v) => !v)}>
        <span className="ac-failure-icon">{modeIcon(drill.mode)}</span>
        <span className="ac-kv">
          <span className="v">{drill.mode.replace(/-/g, " ")}</span>
          <span className="k">{drill.ward}</span>
        </span>
        <Badge tone={stateTone(drill.state)}>{drill.state.replace(/-/g, " ")}</Badge>
        <Badge tone={drill.failClosed ? "red" : "green"}>{drill.failClosed ? "fail-closed" : "bounded"}</Badge>
      </button>
      {open && (
        <div className="ac-failure-detail">
          <div>{drill.consequence}</div>
          <div className="ac-detail-grid" style={{ gridTemplateColumns: "120px 1fr", marginTop: 10 }}>
            <dt>Evidence</dt><dd className="mono">{drill.evidenceHash}</dd>
            <dt>Next step</dt><dd>{drill.operatorNextStep}</dd>
          </div>
        </div>
      )}
    </article>
  );
}

export function FailureModeConsole() {
  const setMode = useCommandStore((s) => s.setMode);
  const forceReconcile = useCommandStore((s) => s.forceReconcile);
  const exportEvidence = useCommandStore((s) => s.exportEvidence);
  const contained = FAILURE_DRILLS.filter((f) => f.failClosed || f.state === "resolved").length;
  const operatorRequired = FAILURE_DRILLS.filter((f) => f.state === "requires-operator").length;

  return (
    <div className="ac-grid" style={{ gridTemplateColumns: "1fr", gap: 14 }}>
      <Panel title="Failure Mode Console" icon={<ShieldAlert size={15} />} right={<Badge tone="amber">predictable under stress</Badge>}>
        <div className="ac-adoption-hero">
          <div>
            <div className="ac-label">Governance where the network ends</div>
            <h2>Partitions, stale authority, witness disagreement, and replay divergence are operator states, not surprises.</h2>
            <p>
              This console turns failure semantics into an inspectable workflow: detect the failed assumption,
              preserve the evidence, decide whether execution can continue, and reconcile when connectivity returns.
            </p>
          </div>
          <div className="ac-adoption-kpis">
            <Metric label="Drills tracked" value={FAILURE_DRILLS.length} tone="cyan" />
            <Metric label="Contained" value={contained} tone="green" />
            <Metric label="Need operator" value={operatorRequired} tone={operatorRequired ? "red" : "green"} />
          </div>
        </div>
      </Panel>

      <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 0.9fr)", alignItems: "start" }}>
        <Panel title="Active Failure Drills" icon={<AlertTriangle size={15} />} right={<Badge tone="red">fail closed first</Badge>}>
          <div className="ac-grid" style={{ gap: 10 }}>
            {FAILURE_DRILLS.map((drill) => <FailureCard key={drill.id} drill={drill} />)}
          </div>
        </Panel>

        <div className="ac-grid">
          <Panel title="Operator Playbook" icon={<RefreshCw size={15} />}>
            <div className="ac-playbook">
              {[
                "Freeze irreversible execution when authority freshness cannot be proven.",
                "Prefer cached bounded authority only inside Ward, warrant TTL, and physical invariant limits.",
                "Replay against the policy active at execution time before replaying against current policy.",
                "Reconcile edge evidence into GEL before accepting central state mutation.",
                "Escalate when witness quorum, revocation, or runtime registers disagree."
              ].map((item, idx) => (
                <div className="ac-playbook-step" key={item}>
                  <span>{idx + 1}</span>
                  <p>{item}</p>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Failure Controls" icon={<Archive size={15} />}>
            <div className="ac-grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <button className="ac-btn is-primary" onClick={() => setMode("partitioned")}><WifiOff size={13} /> Simulate partition</button>
              <button className="ac-btn" onClick={forceReconcile}><RefreshCw size={13} /> Force reconcile</button>
              <button className="ac-btn" onClick={exportEvidence}><Archive size={13} /> Export bundle</button>
              <button className="ac-btn" onClick={() => setMode("normal")}><ShieldAlert size={13} /> Restore normal</button>
            </div>
            <div className="ac-muted" style={{ marginTop: 12 }}>
              These controls exercise operator workflow and ledger events; production mutation still belongs behind authenticated gateway routes.
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
