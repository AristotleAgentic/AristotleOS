import { Archive, CheckCircle2, GitBranch, Inbox, RefreshCw, ShieldAlert, XCircle } from "lucide-react";
import React from "react";
import { CONFLICT_INBOX } from "./mockData.js";
import { Badge, Panel, clock, decisionTone } from "./primitives.js";
import { useCommandStore } from "./store.js";
import type { ConflictInboxItem } from "./types.js";

function conflictTone(kind: ConflictInboxItem["conflictKind"]) {
  switch (kind) {
    case "edge_more_permissive": return "red";
    case "edge_more_restrictive": return "amber";
    default: return "cyan";
  }
}

function ConflictCard({ item }: { item: ConflictInboxItem }) {
  const toast = useCommandStore((s) => s.toast);
  return (
    <article className="ac-conflict-card">
      <div className="ac-conflict-head">
        <div>
          <div className="ac-template-title">{item.action}</div>
          <div className="ac-muted">{item.wardId} · {clock(item.occurredAt)} · <span className="ac-mono">{item.gelRecordId}</span></div>
        </div>
        <Badge tone={conflictTone(item.conflictKind)}>{item.conflictKind.replace(/_/g, " ")}</Badge>
      </div>

      <div className="ac-conflict-compare">
        <div>
          <span className="ac-label">Offline edge reality</span>
          <Badge tone={decisionTone(item.edgeDecision)}>{item.edgeDecision}</Badge>
        </div>
        <div>
          <span className="ac-label">Central current state</span>
          <Badge tone={decisionTone(item.currentDecision)}>{item.currentDecision}</Badge>
        </div>
        <div>
          <span className="ac-label">Execution-time replay</span>
          <Badge tone={decisionTone(item.executionTimeDecision)}>{item.executionTimeDecision}</Badge>
        </div>
      </div>

      <div className="ac-muted" style={{ marginTop: 10 }}>{item.operatorNextStep}</div>

      <div className="ac-conflict-actions">
        <button className="ac-btn" onClick={() => toast(`${item.id}: edge evidence accepted for review.`, "green")}><CheckCircle2 size={13} /> Accept edge</button>
        <button className="ac-btn" onClick={() => toast(`${item.id}: rejection recorded; revert workflow required.`, "red")}><XCircle size={13} /> Reject</button>
        <button className="ac-btn" onClick={() => toast(`${item.id}: escalated to sovereign authority.`, "amber")}><ShieldAlert size={13} /> Escalate</button>
        <button className="ac-btn" onClick={() => toast(`${item.id}: evidence bundle export requested.`, "cyan")}><Archive size={13} /> Export</button>
      </div>
    </article>
  );
}

export function ConflictInboxConsole() {
  const forceReconcile = useCommandStore((s) => s.forceReconcile);
  const open = CONFLICT_INBOX.filter((c) => c.status === "open" || c.status === "escalated").length;
  const reconciled = CONFLICT_INBOX.filter((c) => c.status === "reconciled").length;

  return (
    <div className="ac-grid" style={{ gridTemplateColumns: "1fr", gap: 14 }}>
      <Panel title="Edge Conflict Inbox" icon={<Inbox size={15} />} right={<Badge tone={open ? "amber" : "green"}>{open} need review</Badge>}>
        <div className="ac-adoption-hero">
          <div>
            <div className="ac-label">Disconnected edge reconciliation</div>
            <h2>When the edge comes home, conflict becomes an operator inbox, not a spreadsheet.</h2>
            <p>
              Each item shows offline edge reality beside central current state and execution-time replay,
              preserving the Ward, Warrant, and GEL record needed to resolve without losing accountability.
            </p>
          </div>
          <div className="ac-adoption-kpis">
            <div className="ac-metric"><span className="ac-metric-label">Inbox items</span><span className="ac-metric-val">{CONFLICT_INBOX.length}</span></div>
            <div className="ac-metric"><span className="ac-metric-label">Open/escalated</span><span className="ac-metric-val" style={{ color: "var(--ac-amber)" }}>{open}</span></div>
            <div className="ac-metric"><span className="ac-metric-label">Reconciled</span><span className="ac-metric-val" style={{ color: "var(--ac-green)" }}>{reconciled}</span></div>
          </div>
        </div>
      </Panel>

      <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 1fr)", gap: 10 }}>
        {CONFLICT_INBOX.map((item) => <ConflictCard key={item.id} item={item} />)}
      </div>

      <Panel title="Reconnection Workflow" icon={<GitBranch size={15} />} right={<button className="ac-btn" onClick={forceReconcile}><RefreshCw size={13} /> Force reconcile</button>}>
        <div className="ac-chip-row">
          <span className="ac-chip">load edge GEL bundle</span>
          <span className="ac-chip">replay against current policy</span>
          <span className="ac-chip">replay against execution-time policy</span>
          <span className="ac-chip">classify divergence</span>
          <span className="ac-chip">operator resolution</span>
          <span className="ac-chip">commit reconciliation evidence</span>
        </div>
      </Panel>
    </div>
  );
}
