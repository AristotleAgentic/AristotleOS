import { CheckCircle2, ShieldCheck, ShieldX, UserCheck, Users, XCircle } from "lucide-react";
import React from "react";
import { APPROVAL_QUEUE } from "./mockData.js";
import { Badge, Panel, clock } from "./primitives.js";
import { useCommandStore } from "./store.js";
import type { ApprovalItem } from "./types.js";

const statusTone: Record<ApprovalItem["status"], "amber" | "green" | "red" | "cyan"> = {
  pending: "amber",
  approved: "green",
  rejected: "red",
  expired: "cyan"
};

function ApprovalCard({ item }: { item: ApprovalItem }) {
  const decideApproval = useCommandStore((s) => s.decideApproval);
  const open = item.status === "pending";
  return (
    <article className="ac-conflict-card">
      <div className="ac-conflict-head">
        <div>
          <div className="ac-template-title">{item.actionType}</div>
          <div className="ac-muted">{item.wardId} · requested by <span className="ac-mono">{item.subject}</span> · {clock(item.createdAt)}</div>
        </div>
        <Badge tone={statusTone[item.status]}>{item.status}</Badge>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
        <Users size={15} color="var(--ac-cyan)" />
        <span className="ac-mono">{item.approvals}/{item.required} approvals</span>
        <div className="ac-bar" style={{ flex: 1, maxWidth: 220 }}>
          <span style={{ width: `${Math.min(100, Math.round((item.approvals / Math.max(1, item.required)) * 100))}%`, background: item.status === "approved" ? "var(--ac-green)" : "var(--ac-cyan)" }} />
        </div>
      </div>

      {item.votes.length > 0 && (
        <div className="ac-muted" style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {item.votes.map((v, i) => (
            <span key={`${v.by}-${i}`} className="ac-chip">
              {v.decision === "approve" ? <CheckCircle2 size={12} /> : <XCircle size={12} />} {v.by}
            </span>
          ))}
        </div>
      )}

      <div className="ac-conflict-actions">
        <button className="ac-btn is-primary" disabled={!open} onClick={() => void decideApproval(item.id, "approve", "approved from console")}><ShieldCheck size={13} /> Approve</button>
        <button className="ac-btn is-danger" disabled={!open} onClick={() => void decideApproval(item.id, "reject", "rejected from console")}><ShieldX size={13} /> Reject</button>
      </div>
    </article>
  );
}

export function ApprovalsConsole() {
  const liveApprovals = useCommandStore((s) => s.approvals);
  const loadApprovals = useCommandStore((s) => s.loadApprovals);
  const items = liveApprovals ?? APPROVAL_QUEUE;
  const pending = items.filter((a) => a.status === "pending").length;
  const approved = items.filter((a) => a.status === "approved").length;

  return (
    <div className="ac-grid" style={{ gridTemplateColumns: "1fr", gap: 14 }}>
      <Panel title="Dual-Control Approvals" icon={<UserCheck size={15} />} right={<Badge tone={pending ? "amber" : "green"}>{pending} awaiting review</Badge>}>
        <div className="ac-adoption-hero">
          <div>
            <div className="ac-label">Authority before consequence — made plural</div>
            <h2>The gravest actions need more than one set of eyes.</h2>
            <p>
              Actions under M-of-N control do not receive a Warrant on their own ALLOW. The Commit Gate
              escalates and opens a request keyed to the exact action; the Warrant issues only once the
              required number of distinct operators approve. No one approves their own action; every vote
              is recorded.
            </p>
          </div>
          <div className="ac-adoption-kpis">
            <div className="ac-metric"><span className="ac-metric-label">Awaiting review</span><span className="ac-metric-val" style={{ color: "var(--ac-amber)" }}>{pending}</span></div>
            <div className="ac-metric"><span className="ac-metric-label">Approved</span><span className="ac-metric-val" style={{ color: "var(--ac-green)" }}>{approved}</span></div>
            <div className="ac-metric"><span className="ac-metric-label">Queue</span><span className="ac-metric-val">{items.length}</span></div>
          </div>
        </div>
      </Panel>

      {items.length === 0 ? (
        <Panel title="Queue" icon={<ShieldCheck size={15} />}>
          <div className="ac-muted">No approval requests. Dual-controlled actions appear here when an agent attempts one.</div>
        </Panel>
      ) : (
        <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 1fr)", gap: 10 }}>
          {items.map((item) => <ApprovalCard key={item.id} item={item} />)}
        </div>
      )}

      <Panel title="Separation of Duties" icon={<Users size={15} />} right={<Badge tone="red">no self-approval</Badge>}>
        <div className="ac-muted">
          The requesting subject can never approve its own action, each approver votes once, and any
          rejection settles the request. Approvals are attributed and replayable — plural authority,
          fully evidenced. Refresh pulls the live queue from the boundary.
        </div>
        <div style={{ marginTop: 12 }}>
          <button className="ac-btn" onClick={() => void loadApprovals()}><UserCheck size={13} /> Refresh queue</button>
        </div>
      </Panel>
    </div>
  );
}
