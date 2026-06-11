import { Braces, ClipboardCheck, Download, FileWarning, GitCompareArrows, ShieldCheck } from "lucide-react";
import React from "react";
import { BUILDER_PREVIEW } from "./mockData.js";
import { Badge, Metric, Panel, decisionTone } from "./primitives.js";
import { useCommandStore } from "./store.js";

export function GovernanceBuilderConsole() {
  const exportEvidence = useCommandStore((s) => s.exportEvidence);
  const compileGovernance = useCommandStore((s) => s.compileGovernance);
  return (
    <div className="ac-grid" style={{ gridTemplateColumns: "1fr", gap: 14 }}>
      <Panel title="Visual Governance Builder" icon={<ClipboardCheck size={15} />} right={<Badge tone="cyan">preview · live via /governance/compile</Badge>}>
        <div className="ac-adoption-hero">
          <div>
            <div className="ac-label">Visual artifact, real enforcement shape</div>
            <h2>Build Ward and Authority policy without turning AristotleOS into a workflow toy.</h2>
            <p>
              This surface drives the real builder backend (<span className="mono">builder.ts</span>, exposed at
              <span className="mono"> POST /v1/execution-control/governance/compile · /diff · /explain</span>): compile a Ward
              Manifest and Authority Envelope, preview the manifest hash, inspect weakening diffs, and test sample Commit
              Gate outcomes before promotion. Compile attempts the live gateway and falls back to a deterministic local
              preview when none is connected.
            </p>
          </div>
          <div className="ac-adoption-kpis">
            <Metric label="Manifest hash" value={BUILDER_PREVIEW.manifestHash.slice(0, 8)} tone="cyan" />
            <Metric label="Allowed actions" value={BUILDER_PREVIEW.allowedActions.length} tone="green" />
            <Metric label="Review diffs" value={BUILDER_PREVIEW.weakeningDiffs.length} tone="amber" />
          </div>
        </div>
      </Panel>

      <div className="ac-grid" style={{ gridTemplateColumns: "minmax(0, 0.9fr) minmax(0, 1.1fr)", alignItems: "start" }}>
        <Panel title="Artifact Preview" icon={<Braces size={15} />} right={<Badge tone="green">exportable manifest</Badge>}>
          <div className="ac-detail-grid">
            <dt>Ward</dt><dd>{BUILDER_PREVIEW.wardName}</dd>
            <dt>Ward id</dt><dd className="mono">{BUILDER_PREVIEW.wardId}</dd>
            <dt>Sovereignty</dt><dd>{BUILDER_PREVIEW.sovereignty}</dd>
            <dt>Subject</dt><dd className="mono">{BUILDER_PREVIEW.subject}</dd>
            <dt>Warrant TTL</dt><dd>{BUILDER_PREVIEW.warrantTtlSeconds}s · single use</dd>
            <dt>Manifest hash</dt><dd className="mono">{BUILDER_PREVIEW.manifestHash}</dd>
          </div>
          <div className="ac-divider" />
          <div className="ac-chip-row">
            {BUILDER_PREVIEW.requiredRegisters.map((r) => <span className="ac-chip" key={r}>{r}</span>)}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button className="ac-btn is-primary" onClick={() => void compileGovernance()}><ShieldCheck size={13} /> Compile</button>
            <button className="ac-btn" onClick={exportEvidence}><Download size={13} /> Export</button>
          </div>
        </Panel>

        <Panel title="Weakening Diff Review" icon={<GitCompareArrows size={15} />} right={<Badge tone="amber">operator approval required</Badge>}>
          <div className="ac-grid" style={{ gap: 10 }}>
            {BUILDER_PREVIEW.weakeningDiffs.map((diff) => (
              <div key={diff.path} className="ac-warning-row">
                <FileWarning size={15} />
                <div>
                  <div className="ac-mono">{diff.path}</div>
                  <div className="ac-muted">{diff.before} {"->"} {diff.after}</div>
                  <div>{diff.note}</div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="Commit Gate Sample Outcomes" icon={<ShieldCheck size={15} />} right={<Badge tone="cyan">explainPolicy samples</Badge>}>
        <table className="ac-table">
          <thead>
            <tr><th>Action</th><th>Decision</th><th>Reason codes</th></tr>
          </thead>
          <tbody>
            {BUILDER_PREVIEW.sampleOutcomes.map((sample) => (
              <tr key={sample.action}>
                <td className="ac-mono">{sample.action}</td>
                <td><Badge tone={decisionTone(sample.decision)}>{sample.decision}</Badge></td>
                <td><span className="ac-chip-row">{sample.reasonCodes.map((r) => <span className="ac-chip" key={r}>{r}</span>)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
