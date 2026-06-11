import { Activity, AlertTriangle, Eye, FileCheck2, Gauge, PlayCircle, ShieldCheck } from "lucide-react";
import React from "react";
import { SHADOW_PROFILE } from "./mockData.js";
import { Badge, Metric, Panel } from "./primitives.js";
import { useCommandStore } from "./store.js";

function findingTone(kind: string) {
  if (kind === "revoked-authority") return "red";
  if (kind === "missing-register") return "amber";
  return "cyan";
}

export function ShadowModeConsole() {
  const toast = useCommandStore((s) => s.toast);
  const liveProfile = useCommandStore((s) => s.shadowProfile);
  const runShadowProfile = useCommandStore((s) => s.runShadowProfile);
  const profile = liveProfile ?? SHADOW_PROFILE;
  const allowPct = Math.round(profile.allowRate * 100);

  return (
    <div className="ac-grid" style={{ gridTemplateColumns: "1fr", gap: 14 }}>
      <Panel title="Shadow Mode Profiling" icon={<Eye size={15} />} right={<Badge tone="cyan">observe only</Badge>}>
        <div className="ac-adoption-hero">
          <div>
            <div className="ac-label">What would AristotleOS have done?</div>
            <h2>Profile live-shaped action batches before enforcement blocks production.</h2>
            <p>
              Shadow Mode evaluates through the real Commit Gate using ephemeral GEL-compatible evidence.
              It reports would-ALLOW, would-REFUSE, and would-ESCALATE without weakening policy or touching live state.
            </p>
          </div>
          <div className="ac-adoption-kpis">
            <Metric label="Would allow" value={profile.wouldAllow} tone="green" />
            <Metric label="Would refuse" value={profile.wouldRefuse} tone="red" />
            <Metric label="Would escalate" value={profile.wouldEscalate} tone="amber" />
          </div>
        </div>
      </Panel>

      <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 0.75fr) minmax(0, 1.25fr)", alignItems: "start" }}>
        <Panel title="Rollout Readiness" icon={<Gauge size={15} />} right={<Badge tone={profile.rolloutReady ? "green" : "amber"}>{profile.rolloutReady ? "ready" : "not ready"}</Badge>}>
          <Metric label="Actions evaluated" value={profile.evaluatedActions} tone="cyan" />
          <div className="ac-divider" />
          <Metric label="Allow rate" value={`${allowPct}%`} tone={allowPct > 80 ? "green" : "amber"} />
          <div className="ac-bar" style={{ marginTop: 10 }}><span style={{ width: `${allowPct}%`, background: "var(--ac-cyan)" }} /></div>
          <div className="ac-divider" />
          <div className="ac-detail-grid" style={{ gridTemplateColumns: "120px 1fr" }}>
            <dt>Ward</dt><dd className="mono">{profile.wardId}</dd>
            <dt>Envelope</dt><dd className="mono">{profile.envelopeId}</dd>
            <dt>Evidence</dt><dd>Ephemeral signed GEL chain · replayable traces</dd>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button className="ac-btn is-primary" onClick={() => void runShadowProfile()}><PlayCircle size={13} /> Run profile</button>
            <button className="ac-btn" onClick={() => toast("Shadow report exported for promotion review.", "green")}><FileCheck2 size={13} /> Export report</button>
          </div>
        </Panel>

        <Panel title="Findings" icon={<AlertTriangle size={15} />} right={<Badge tone="amber">{profile.findings.length} blockers</Badge>}>
          <div className="ac-grid" style={{ gap: 10 }}>
            {profile.findings.map((finding) => (
              <div key={`${finding.kind}-${finding.actionId}`} className="ac-warning-row">
                <Activity size={15} />
                <div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <Badge tone={findingTone(finding.kind)}>{finding.kind}</Badge>
                    <span className="ac-mono">{finding.actionId}</span>
                  </div>
                  <div className="ac-muted" style={{ marginTop: 4 }}>{finding.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="Promotion Rule" icon={<ShieldCheck size={15} />} right={<Badge tone="red">no automatic weakening</Badge>}>
        <div className="ac-muted">
          Shadow findings can generate reviewed governance diffs, but AristotleOS does not auto-expand authority.
          Promotion to enforcement requires explicit operator approval, manifest hashing, replay evidence, and rollback material.
        </div>
      </Panel>
    </div>
  );
}
