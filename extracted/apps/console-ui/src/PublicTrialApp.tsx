import React from "react";
import {
  PAYMENTS_GOVERNANCE_SOURCE,
  TRIAL_SCENARIOS,
  evaluateTrialAction,
  planGovernanceChange,
  validateGovernanceSource,
  type TrialActionIntent,
  type TrialDecisionState,
  type TrialEvaluation,
  type TrialScenario
} from "@aristotle/trial-engine";

type PublicView = "landing" | "playground";

const decisionTone: Record<TrialDecisionState, string> = {
  PERMIT: "permit",
  DENY: "deny",
  DEFER: "defer",
  REVOKED: "deny",
  FAIL_CLOSED: "fail"
};

const codeBlock = `npm install -g @aristotle/os-cli
aristotle init
aristotle check
aristotle plan
aristotle dev
aristotle audit tail`;

function TerminalPreview() {
  return (
    <div className="trial-terminal" aria-label="AristotleOS quickstart terminal">
      <div className="terminal-bar"><span /> <span /> <span /></div>
      <pre>{`$ aristotle demo payments
Governance Plane online
Ward resolved: enterprise-payments
Authority Envelope: refund-authority
Commit Gate: DEFER operator approval required
Warrant: not issued
GEL: gel-4f9d21c8 committed

$ aristotle approve def-4f9d21c8
Warrant issued: wrn-93bb0a41 single_use=true
Execution admitted at commit boundary`}</pre>
    </div>
  );
}

function ArchitecturePath() {
  const nodes = ["Agent Intent", "Declared Action", "Ward Context", "Authority Envelope", "Policy Compilation", "Commit Gate", "Warrant", "Execution", "GEL Commit", "Replay / Audit"];
  return (
    <div className="architecture-path">
      {nodes.map((node, index) => (
        <React.Fragment key={node}>
          <div className="path-node">{node}</div>
          {index < nodes.length - 1 ? <div className="path-arrow">→</div> : null}
        </React.Fragment>
      ))}
    </div>
  );
}

function Landing({ onNavigate }: { onNavigate: (view: PublicView) => void }) {
  const preview = evaluateTrialAction({
    source: PAYMENTS_GOVERNANCE_SOURCE,
    intent: TRIAL_SCENARIOS[0].intent,
    now: "2026-05-20T00:00:00.000Z"
  });
  return (
    <main className="trial-page">
      <section className="trial-hero">
        <div className="hero-copy">
          <p className="eyebrow">Governed execution for autonomous systems</p>
          <h1>Runtime governance for autonomous execution.</h1>
          <p className="hero-subhead">
            AristotleOS places a deterministic Governance Plane between agent intent and real-world action. Every consequential action must pass authority resolution, policy compilation, Commit Gate admissibility, warrant issuance, and evidence finalization before execution.
          </p>
          <div className="hero-actions">
            <button onClick={() => onNavigate("playground")}>Try AristotleOS</button>
            <a href="#quickstart">Quickstart</a>
            <a href="https://github.com/" target="_blank" rel="noreferrer">View GitHub</a>
          </div>
        </div>
        <TerminalPreview />
      </section>

      <section className="trial-band problem-grid">
        <div>
          <p className="eyebrow">The problem</p>
          <h2>Agents can now cause consequences.</h2>
        </div>
        <div className="statement-grid">
          {["Prompting is not governance.", "Observability is not control.", "Audit after the fact is too late.", "Governance must bind before consequence."].map((line) => (
            <div className="statement-card" key={line}>{line}</div>
          ))}
        </div>
      </section>

      <section className="trial-band answer-grid">
        <div>
          <p className="eyebrow">The AristotleOS answer</p>
          <h2>Authority before action. No standing machine power.</h2>
          <p>
            The Governance Plane sits between intent and execution. Wards preserve institutional context, Authority Envelopes bind scoped power, Warrants make action time-bound and single-use, Commit Gates enforce admissibility, and GEL preserves replayable evidence.
          </p>
        </div>
        <ArchitecturePath />
      </section>

      <section className="trial-band preview-grid">
        <div>
          <p className="eyebrow">Interactive preview</p>
          <h2>See the commit boundary work.</h2>
          <p>The flagship trial starts with a payments agent attempting an $8,000 refund. Autonomous authority ends at $500, so the action defers before warrant issuance.</p>
          <button onClick={() => onNavigate("playground")}>Open Playground</button>
        </div>
        <DecisionSummary evaluation={preview} compact />
      </section>

      <section id="quickstart" className="trial-band quickstart-grid">
        <div>
          <p className="eyebrow">Developer quickstart</p>
          <h2>One local path from policy to evidence.</h2>
          <p>Initialize a governed project, validate the governance file, plan runtime artifacts, start the sandbox, and watch GEL records stream.</p>
        </div>
        <pre className="code-panel">{codeBlock}</pre>
      </section>

      <section className="trial-band usecase-grid">
        {["AI agents with production tools", "Financial operations", "Kubernetes changes", "Drone and robotics operations", "Critical infrastructure", "Enterprise workflow automation", "Compliance and audit"].map((useCase) => (
          <div className="usecase-card" key={useCase}>{useCase}</div>
        ))}
      </section>

      <section className="trial-band trust-grid">
        {["Deterministic decision path", "No LLM in the enforcement path", "Signed warrants", "Hash-chained evidence", "Replayable decisions", "Fail-closed semantics"].map((item) => (
          <div key={item}>
            <strong>{item}</strong>
            <span>Execution-boundary authorization stays inspectable and operational.</span>
          </div>
        ))}
      </section>

      <section className="trial-final">
        <h2>Try the governance operating system.</h2>
        <div className="hero-actions">
          <button onClick={() => onNavigate("playground")}>Try in browser</button>
          <a href="#quickstart">Run locally</a>
          <a href="/docs/quickstart.md">Read docs</a>
        </div>
      </section>
    </main>
  );
}

function ScenarioSelector({ scenario, onScenario }: { scenario: TrialScenario; onScenario: (scenario: TrialScenario) => void }) {
  return (
    <div className="trial-panel">
      <div className="panel-title">Scenario</div>
      <select value={scenario.id} onChange={(event) => onScenario(TRIAL_SCENARIOS.find((item) => item.id === event.target.value) ?? TRIAL_SCENARIOS[0])}>
        {TRIAL_SCENARIOS.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select>
      <p>{scenario.summary}</p>
    </div>
  );
}

function IntentPanel({ intent }: { intent: TrialActionIntent }) {
  return (
    <div className="trial-panel">
      <div className="panel-title">Agent Intent</div>
      <dl className="intent-grid">
        <dt>Agent</dt><dd>{intent.agentId}</dd>
        <dt>Mission</dt><dd>{intent.missionId}</dd>
        <dt>Action</dt><dd>{intent.requestedAction}</dd>
        <dt>Target</dt><dd>{intent.target}</dd>
        <dt>Consequence</dt><dd>{intent.consequenceClass}</dd>
        <dt>Risk</dt><dd>{intent.riskLevel}</dd>
      </dl>
      <pre className="mini-json">{JSON.stringify(intent.parameters, null, 2)}</pre>
    </div>
  );
}

function PolicyEditor({ source, onSource }: { source: string; onSource: (source: string) => void }) {
  const validation = validateGovernanceSource(source);
  const plan = planGovernanceChange(source);
  return (
    <div className="trial-panel policy-editor">
      <div className="panel-title">governance.aristotle</div>
      <textarea value={source} spellCheck={false} onChange={(event) => onSource(event.target.value)} />
      <div className={`policy-status ${validation.ok ? "permit" : "deny"}`}>
        {validation.ok ? `valid policy ${validation.policy?.policyHash}` : validation.errors.map((error) => error.message).join("; ")}
      </div>
      {plan.changes.length ? <div className="policy-plan">{plan.changes.join(" · ")}</div> : null}
    </div>
  );
}

function Pipeline({ evaluation }: { evaluation: TrialEvaluation }) {
  return (
    <div className="trial-panel">
      <div className="panel-title">Evaluation Pipeline</div>
      <div className="pipeline-list">
        {evaluation.pipeline.map((step) => (
          <div className={`pipeline-step ${step.status}`} key={step.id}>
            <span>{step.label}</span>
            <small>{step.detail}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function DecisionSummary({ evaluation, compact = false }: { evaluation: TrialEvaluation; compact?: boolean }) {
  return (
    <div className={`trial-panel decision-card ${compact ? "compact" : ""}`}>
      <div className="panel-title">Decision</div>
      <div className={`decision-badge ${decisionTone[evaluation.decision]}`}>{evaluation.decision}</div>
      <strong>{evaluation.decisionCode}</strong>
      <p>{evaluation.explanation}</p>
      <span className="rule">Rule: {evaluation.controllingRule}</span>
    </div>
  );
}

function WarrantPanel({ evaluation }: { evaluation: TrialEvaluation }) {
  return (
    <div className="trial-panel">
      <div className="panel-title">Execution Warrant</div>
      {evaluation.warrant ? (
        <dl className="intent-grid">
          <dt>ID</dt><dd>{evaluation.warrant.id}</dd>
          <dt>Action hash</dt><dd>{evaluation.warrant.actionHash}</dd>
          <dt>Authority hash</dt><dd>{evaluation.warrant.authorityHash}</dd>
          <dt>Policy hash</dt><dd>{evaluation.warrant.policyHash}</dd>
          <dt>Ward</dt><dd>{evaluation.warrant.wardId}</dd>
          <dt>Issued</dt><dd>{evaluation.warrant.issuedAt}</dd>
          <dt>Expires</dt><dd>{evaluation.warrant.expiresAt}</dd>
          <dt>Single use</dt><dd>{String(evaluation.warrant.singleUse)}</dd>
          <dt>Signature</dt><dd>{evaluation.warrant.signature}</dd>
        </dl>
      ) : (
        <p>No warrant issued. AristotleOS does not grant standing machine power.</p>
      )}
    </div>
  );
}

function GelPanel({ evaluation }: { evaluation: TrialEvaluation }) {
  const record = evaluation.gelRecord;
  return (
    <div className="trial-panel">
      <div className="panel-title">Governance Evidence Ledger</div>
      <dl className="intent-grid">
        <dt>Record</dt><dd>{record.recordId}</dd>
        <dt>Previous hash</dt><dd>{record.previousHash}</dd>
        <dt>Current hash</dt><dd>{record.currentHash}</dd>
        <dt>Action hash</dt><dd>{record.actionHash}</dd>
        <dt>Policy hash</dt><dd>{record.policyHash}</dd>
        <dt>Authority hash</dt><dd>{record.authorityHash}</dd>
        <dt>Decision</dt><dd>{record.decision}</dd>
        <dt>Witnesses</dt><dd>{record.witnessSet.join(", ")}</dd>
        <dt>Replayable</dt><dd>{String(record.replayable)}</dd>
      </dl>
    </div>
  );
}

function Playground() {
  const [scenario, setScenario] = React.useState(TRIAL_SCENARIOS[0]);
  const [source, setSource] = React.useState(PAYMENTS_GOVERNANCE_SOURCE);
  const [approval, setApproval] = React.useState<"none" | "approve" | "deny" | "more_info" | "reduced_authority">("none");
  const [replayPolicy, setReplayPolicy] = React.useState<"same" | "modified">("same");
  const [replay, setReplay] = React.useState<TrialEvaluation | null>(null);
  const evaluation = React.useMemo(() => evaluateTrialAction({
    source,
    intent: scenario.intent,
    approval: approval === "none" || approval === "more_info" ? undefined : approval,
    now: "2026-05-20T00:00:00.000Z"
  }), [source, scenario, approval]);

  const runReplay = () => {
    const policy = replayPolicy === "modified" ? source.replace("defer_if amount >= 500", "defer_if amount >= 9000") : source;
    setReplay(evaluateTrialAction({ source: policy, intent: scenario.intent, now: "2026-05-20T00:00:00.000Z" }));
  };

  return (
    <main className="trial-page playground-page">
      <section className="playground-header">
        <div>
          <p className="eyebrow">Try AristotleOS</p>
          <h1>Governed mission execution, in the browser.</h1>
          <p>Edit policy, evaluate intent, defer to an operator, issue a one-time warrant, and inspect the GEL record.</p>
        </div>
        <DecisionSummary evaluation={evaluation} compact />
      </section>
      <section className="playground-grid">
        <div className="playground-left">
          <ScenarioSelector scenario={scenario} onScenario={(next) => { setScenario(next); setApproval("none"); setReplay(null); }} />
          <IntentPanel intent={scenario.intent} />
          <PolicyEditor source={source} onSource={(next) => { setSource(next); setReplay(null); }} />
        </div>
        <div className="playground-right">
          <Pipeline evaluation={evaluation} />
          <DecisionSummary evaluation={evaluation} />
          {evaluation.decision === "DEFER" ? (
            <div className="trial-panel approver-flow">
              <div className="panel-title">Approver Flow</div>
              <button onClick={() => setApproval("approve")}>Approve with one-time warrant</button>
              <button onClick={() => setApproval("reduced_authority")}>Approve with reduced authority</button>
              <button onClick={() => setApproval("deny")}>Deny</button>
              <button onClick={() => setApproval("more_info")}>Request more info</button>
              <span>Defer token: {evaluation.deferToken}</span>
            </div>
          ) : null}
          <WarrantPanel evaluation={evaluation} />
          <GelPanel evaluation={evaluation} />
          <div className="trial-panel">
            <div className="panel-title">Replay / Explain</div>
            <p>{evaluation.explanation} Evidence preserved: policy hash, authority hash, ward context, telemetry, operator decision, and witness set.</p>
            <div className="replay-row">
              <select value={replayPolicy} onChange={(event) => setReplayPolicy(event.target.value as "same" | "modified")}>
                <option value="same">Replay against same policy</option>
                <option value="modified">Replay against modified policy</option>
              </select>
              <button onClick={runReplay}>Replay</button>
            </div>
            {replay ? <div className={`policy-status ${decisionTone[replay.decision]}`}>Replay decision: {replay.decision} · {replay.decisionCode}</div> : null}
          </div>
        </div>
      </section>
    </main>
  );
}

export default function PublicTrialApp({ initialView = "landing" }: { initialView?: PublicView }) {
  const [view, setView] = React.useState<PublicView>(initialView);
  return view === "landing" ? <Landing onNavigate={setView} /> : <Playground />;
}
