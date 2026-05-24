import { Check, GitBranch, Minus, ScrollText, X } from "lucide-react";
import React from "react";
import { useCommandStore } from "./store.js";
import type { WarrantStep } from "./types.js";
import { Badge, Panel, cx, clock, decisionTone, truncHash } from "./primitives.js";

function StepNode({ status }: { status: WarrantStep["status"] }) {
  if (status === "done") return <span className="ac-tl-node done"><Check size={11} /></span>;
  if (status === "active") return <span className="ac-tl-node active" />;
  if (status === "refuse") return <span className="ac-tl-node refuse"><X size={11} /></span>;
  return <span className="ac-tl-node pending"><Minus size={10} /></span>;
}

export function WarrantLifecycle() {
  const requests = useCommandStore((s) => s.requests);
  const selectedId = useCommandStore((s) => s.selectedRequestId);
  const req = requests.find((r) => r.id === selectedId) ?? requests[0];
  const [openStep, setOpenStep] = React.useState<string | null>(null);

  if (!req) {
    return (
      <Panel title="Warrant Lifecycle" icon={<GitBranch size={15} />}>
        <div className="ac-empty">Select a commit request to inspect its warrant lifecycle.</div>
      </Panel>
    );
  }

  return (
    <Panel
      title="Warrant Lifecycle"
      icon={<GitBranch size={15} />}
      right={<Badge tone={decisionTone(req.decision)}>{req.decision.replace("-", " ")}</Badge>}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="ac-detail-grid" style={{ gridTemplateColumns: "110px 1fr" }}>
          <dt>Request</dt><dd className="mono">{req.id}</dd>
          <dt>Agent</dt><dd>{req.agentCallsign} <span className="ac-muted">· {req.agentId}</span></dd>
          <dt>Action</dt><dd className="mono">{req.action} → {req.target}</dd>
          <dt>Warrant</dt><dd className="mono">{req.warrantId ? truncHash(req.warrantId, 18) : <span className="ac-muted">not issued</span>}</dd>
          <dt>Reason</dt><dd>{req.reasonCodes.map((c) => <Badge key={c} tone={req.decision === "allow" ? "green" : "red"}>{c}</Badge>)}</dd>
        </div>

        <div className="ac-timeline">
          {req.steps.map((step, i) => {
            const last = i === req.steps.length - 1;
            const open = openStep === step.key;
            return (
              <div key={step.key} className={cx("ac-tl-step", open && "is-open")} onClick={() => setOpenStep(open ? null : step.key)}>
                <div className="ac-tl-rail">
                  <StepNode status={step.status} />
                  {!last && <span className={cx("ac-tl-line", step.status === "done" && "done")} />}
                </div>
                <div className="ac-tl-body">
                  <div className="ac-tl-title">{step.title}</div>
                  <div className="ac-tl-meta">{step.at ? clock(step.at) : "—"} · {step.status}</div>
                  {open && <div className="ac-muted" style={{ marginTop: 6, fontSize: 12.5 }}>{step.detail}</div>}
                </div>
              </div>
            );
          })}
        </div>

        <div className="ac-grid ac-cols-2">
          <div>
            <div className="ac-label" style={{ marginBottom: 8 }}>Runtime Register Snapshot</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {req.registers.map((reg) => (
                <div key={reg.name} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
                  <span className="ac-mono ac-muted">{reg.name}</span>
                  <span className="ac-mono" style={{ color: reg.ok ? "var(--ac-text)" : "var(--ac-red)" }}>{reg.value}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="ac-label" style={{ marginBottom: 8 }}>Governance Invariants</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {req.invariants.map((inv) => (
                <div key={inv.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
                  <span className="ac-muted" title={inv.expression}>{inv.name}</span>
                  <Badge tone={inv.result === "pass" ? "green" : inv.result === "fail" ? "red" : "slate"}>{inv.result}</Badge>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="ac-muted" style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12 }}>
          <ScrollText size={13} /> {req.ledgerWritten ? "Decision recorded in the Governance Evidence Ledger." : "Pending ledger write."}
        </div>
      </div>
    </Panel>
  );
}
