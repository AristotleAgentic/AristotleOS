import { Anchor, Boxes, Link2, ShieldCheck } from "lucide-react";
import React from "react";
import { useCommandStore } from "./store.js";
import { Badge, DetailGrid, EmptyState, Panel, cx, clock, decisionTone, truncHash } from "./primitives.js";

export function LedgerExplorer() {
  const ledger = useCommandStore((s) => s.ledger);
  const selectedSeq = useCommandStore((s) => s.selectedLedgerSeq);
  const select = useCommandStore((s) => s.selectLedger);
  const rec = ledger.find((r) => r.seq === selectedSeq) ?? ledger[0];

  return (
    <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 1.5fr) minmax(0, 1fr)", alignItems: "start" }}>
      <Panel
        title="Governance Evidence Ledger"
        icon={<Boxes size={15} />}
        right={<span className="ac-badge t-green"><ShieldCheck size={12} /> chain intact</span>}
        flush
      >
        <div className="ac-scroll-y" style={{ maxHeight: "calc(100vh - 230px)" }}>
          {ledger.length === 0 ? (
            <EmptyState
              icon={<Boxes size={22} />}
              title="No ledger records yet"
              hint="Every Commit Gate decision is appended here as a hash-linked, signed record. The chain is empty until the first governed action is evaluated."
            />
          ) : (
          <table className="ac-table">
            <thead>
              <tr>
                <th>Seq</th><th>Time</th><th>Event</th><th>Ward</th><th>Decision</th><th>Record hash</th><th>Anchor</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((r) => (
                <tr key={r.seq} className={cx(rec?.seq === r.seq && "is-selected")} onClick={() => select(r.seq)}>
                  <td className="ac-mono ac-muted">{r.seq}</td>
                  <td className="ac-mono" style={{ fontSize: 11.5 }}>{clock(r.timestamp)}</td>
                  <td className="ac-mono" style={{ fontSize: 11.5 }}>{r.eventType}</td>
                  <td style={{ fontSize: 11.5 }}>{r.ward.replace("ward-", "")}</td>
                  <td><Badge tone={decisionTone(r.decision)}>{r.decision}</Badge></td>
                  <td className="ac-hashid">{truncHash(r.recordHash, 10)}</td>
                  <td>{r.anchored ? <Anchor size={13} color="var(--ac-cyan)" /> : <span className="ac-muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
        </div>
      </Panel>

      <div className="ac-grid" style={{ gridTemplateColumns: "1fr" }}>
        <Panel title="Record Detail" icon={<Link2 size={15} />}>
          {rec ? (
            <DetailGrid
              rows={[
                ["Sequence", String(rec.seq), true],
                ["Timestamp", new Date(rec.timestamp).toLocaleString()],
                ["Event", rec.eventType, true],
                ["Agent", rec.agent, true],
                ["Ward", rec.ward],
                ["Decision", <Badge tone={decisionTone(rec.decision)}>{rec.decision}</Badge>],
                ["Warrant", rec.warrantId ? truncHash(rec.warrantId, 16) : <span className="ac-muted">—</span>, true],
                ["Policy hash", truncHash(rec.policyHash, 14), true],
                ["Register hash", truncHash(rec.registerHash, 14), true],
                ["Previous hash", rec.previousHash === "GENESIS" ? "GENESIS" : truncHash(rec.previousHash, 14), true],
                ["Record hash", truncHash(rec.recordHash, 14), true],
                ["Integrity", rec.intact ? <Badge tone="green">verified</Badge> : <Badge tone="red">broken</Badge>],
                ["External anchor", rec.anchored ? <Badge tone="cyan">anchored</Badge> : <Badge tone="slate">local-only</Badge>]
              ]}
            />
          ) : (
            <div className="ac-empty">Select a ledger record.</div>
          )}
        </Panel>

        <Panel title="Hash Chain" icon={<Link2 size={15} />} flush>
          <div className="ac-panel-body">
            <div className="ac-chain">
              {ledger.slice(0, 8).map((r, i, arr) => (
                <div key={r.seq} className="ac-chain-item">
                  <div className="ac-chain-rail">
                    <div className={cx("ac-chain-dot", !r.intact && "broken")} />
                    {i < arr.length - 1 && <div className="ac-chain-link" />}
                  </div>
                  <div className="ac-chain-card">
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span className="ac-mono" style={{ fontSize: 12 }}>#{r.seq} {r.eventType}</span>
                      <span className="ac-hashid">{truncHash(r.recordHash, 8)}</span>
                    </div>
                    <div className="ac-hashid" style={{ marginTop: 2 }}>prev {r.previousHash === "GENESIS" ? "GENESIS" : truncHash(r.previousHash, 8)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
