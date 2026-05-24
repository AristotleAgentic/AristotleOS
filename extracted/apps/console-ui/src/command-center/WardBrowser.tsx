import { ChevronRight, Crown, FileKey, Landmark, ShieldHalf } from "lucide-react";
import React from "react";
import { AUTHORITY_DOMAINS, ENVELOPES, META_AUTHORITY, WARDS } from "./mockData.js";
import { Badge, DetailGrid, Panel, StateBadge, cx, relTime, truncHash } from "./primitives.js";

export function WardBrowser() {
  const [openWard, setOpenWard] = React.useState<string | null>(WARDS[0]?.id ?? null);
  const [sel, setSel] = React.useState<{ kind: "ward" | "envelope"; id: string } | null>({ kind: "ward", id: WARDS[0]?.id });

  const selectedWard = sel?.kind === "ward" ? WARDS.find((w) => w.id === sel.id) : undefined;
  const selectedEnv = sel?.kind === "envelope" ? ENVELOPES.find((e) => e.id === sel.id) : undefined;

  return (
    <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, 1fr)", alignItems: "start" }}>
      <Panel title="Authority Structure" icon={<Landmark size={15} />} flush>
        <div className="ac-panel-body" style={{ paddingTop: 12 }}>
          {/* Meta Authority Envelope — constitutional root */}
          <div style={{ border: "1px solid var(--ac-violet-dim)", borderRadius: 10, padding: "12px 14px", background: "rgba(157,123,245,0.06)", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Crown size={16} color="var(--ac-violet)" />
              <div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{META_AUTHORITY.title}</div>
                <div className="ac-muted" style={{ fontSize: 11.5 }}>{META_AUTHORITY.constitution}</div>
              </div>
              <span style={{ marginLeft: "auto" }}><Badge tone="violet">root</Badge></span>
            </div>
            <div className="ac-hashid" style={{ marginTop: 8 }}>policy_hash {truncHash(META_AUTHORITY.policyHash, 16)}</div>
          </div>

          {WARDS.map((ward) => {
            const open = openWard === ward.id;
            const domains = AUTHORITY_DOMAINS.filter((d) => d.wardId === ward.id);
            const envs = ENVELOPES.filter((e) => e.wardId === ward.id);
            return (
              <div key={ward.id} style={{ marginBottom: 8 }}>
                <div
                  className={cx("ac-row", sel?.kind === "ward" && sel.id === ward.id && "is-selected")}
                  style={{ gridTemplateColumns: "20px 1fr auto", borderRadius: 8, border: "1px solid var(--ac-line)" }}
                  onClick={() => { setOpenWard(open ? null : ward.id); setSel({ kind: "ward", id: ward.id }); }}
                >
                  <ChevronRight size={15} style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s", color: "var(--ac-text-3)" }} />
                  <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                    <ShieldHalf size={15} color="var(--ac-cyan)" />
                    <div className="ac-kv">
                      <span className="v">{ward.name}</span>
                      <span className="k">{ward.sovereignty}</span>
                    </div>
                  </div>
                  <StateBadge state={ward.state} />
                </div>

                {open && (
                  <div style={{ marginLeft: 18, marginTop: 6, borderLeft: "1px solid var(--ac-line)", paddingLeft: 12 }}>
                    {domains.map((d) => (
                      <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 4px" }}>
                        <Landmark size={13} color="var(--ac-text-3)" />
                        <span style={{ fontSize: 12.5 }}>{d.name}</span>
                        <span className="ac-muted ac-mono" style={{ fontSize: 11 }}>{d.enforcementScope}</span>
                        <span style={{ marginLeft: "auto" }} className="ac-label">{d.compiledInvariants} invariants</span>
                      </div>
                    ))}
                    {envs.map((e) => (
                      <div
                        key={e.id}
                        className={cx("ac-row", sel?.kind === "envelope" && sel.id === e.id && "is-selected")}
                        style={{ gridTemplateColumns: "16px 1fr auto", padding: "7px 6px", borderRadius: 6 }}
                        onClick={(ev) => { ev.stopPropagation(); setSel({ kind: "envelope", id: e.id }); }}
                      >
                        <FileKey size={13} color={e.revoked ? "var(--ac-red)" : "var(--ac-green)"} />
                        <div className="ac-kv">
                          <span className="v ac-mono" style={{ fontSize: 12 }}>{e.id}</span>
                          <span className="k">{e.subject}</span>
                        </div>
                        {e.revoked ? <Badge tone="red">revoked</Badge> : <Badge tone="green">valid</Badge>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title={selectedEnv ? "Authority Envelope" : "Ward Detail"} icon={selectedEnv ? <FileKey size={15} /> : <ShieldHalf size={15} />}>
        {selectedWard && (
          <DetailGrid
            rows={[
              ["Ward", selectedWard.name],
              ["State", <StateBadge state={selectedWard.state} />],
              ["Sovereignty", selectedWard.sovereignty],
              ["Responsible", selectedWard.responsibleParty],
              ["Legal basis", selectedWard.legalBasis],
              ["Authority domains", String(selectedWard.authorityDomains)],
              ["Active agents", String(selectedWard.agents)],
              ["Open requests", String(selectedWard.openRequests)],
              ["Policy hash", truncHash(selectedWard.policyHash, 16), true]
            ]}
          />
        )}
        {selectedEnv && (
          <DetailGrid
            rows={[
              ["Envelope", selectedEnv.id, true],
              ["Status", selectedEnv.revoked ? <Badge tone="red">revoked</Badge> : <Badge tone="green">valid</Badge>],
              ["Subject", selectedEnv.subject, true],
              ["Scope", selectedEnv.scope.map((s) => <Badge key={s} tone="cyan">{s}</Badge>)],
              ["Issued", `${relTime(selectedEnv.issuedAt)}`],
              ["Expires", new Date(selectedEnv.expiresAt).toLocaleString()],
              ["Responsible", selectedEnv.responsibleParty],
              ["Basis", selectedEnv.basis]
            ]}
          />
        )}
        {!selectedWard && !selectedEnv && <div className="ac-empty">Select a ward or authority envelope.</div>}
      </Panel>
    </div>
  );
}
