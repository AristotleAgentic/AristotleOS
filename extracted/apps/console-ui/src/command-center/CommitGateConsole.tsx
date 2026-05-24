import { CheckCircle2, GitCommitHorizontal, ShieldX, AlertTriangle, FlaskConical, Lock } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import React from "react";
import { useCommandStore } from "./store.js";
import type { CommitDecision, CommitRequest } from "./types.js";
import { Badge, EmptyState, Panel, StatusDot, cx, decisionTone, relTime, riskTone } from "./primitives.js";

const DECISION_ICON: Record<CommitDecision, LucideIcon> = {
  allow: CheckCircle2,
  refuse: ShieldX,
  escalate: AlertTriangle,
  simulate: FlaskConical,
  "fail-closed": Lock
};

function DecisionPill({ d }: { d: CommitDecision }) {
  const Icon = DECISION_ICON[d];
  return (
    <span className={cx("ac-badge", `t-${decisionTone(d)}`)}>
      <Icon size={12} />
      {d.replace("-", " ")}
    </span>
  );
}

export function CommitGateConsole({ rows }: { rows?: number }) {
  const requests = useCommandStore((s) => s.requests);
  const selected = useCommandStore((s) => s.selectedRequestId);
  const select = useCommandStore((s) => s.selectRequest);
  const list = rows ? requests.slice(0, rows) : requests;

  return (
    <Panel
      title="Commit Gate Console"
      icon={<GitCommitHorizontal size={15} />}
      right={<span className="ac-label">authority before consequence</span>}
      flush
    >
      <div className="ac-scroll-y" style={{ maxHeight: rows ? undefined : "calc(100vh - 230px)" }}>
        {list.map((r: CommitRequest) => (
          <div
            key={r.id}
            className={cx("ac-row", selected === r.id && "is-selected")}
            style={{ gridTemplateColumns: "150px 1fr 90px 130px", alignItems: "center" }}
            onClick={() => select(r.id)}
          >
            <div className="ac-kv">
              <span className="k">{relTime(r.at)}</span>
              <span className="v">{r.agentCallsign}</span>
            </div>
            <div className="ac-kv">
              <span className="k">{r.ward.replace("ward-", "")} · {r.domain.replace("dom-", "")}</span>
              <span className="v mono">{r.action} <span className="ac-muted">→ {r.target}</span></span>
            </div>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <Badge tone={riskTone(r.risk)}>{r.risk}</Badge>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
              <DecisionPill d={r.decision} />
              <span className="ac-label" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <StatusDot tone={r.ledgerWritten ? "green" : "amber"} />
                {r.warrantId ? "warrant" : "no warrant"} · {r.latencyMs}ms
              </span>
            </div>
          </div>
        ))}
        {list.length === 0 && (
          <EmptyState
            icon={<GitCommitHorizontal size={22} />}
            title="No commit requests yet"
            hint="Governed actions appear here the moment an agent asks the Commit Gate for a decision. Nothing has been requested in this window."
          />
        )}
      </div>
    </Panel>
  );
}
