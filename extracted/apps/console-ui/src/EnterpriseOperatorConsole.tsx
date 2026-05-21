import React, { useEffect, useMemo, useState } from "react";
import {
  advanceMission,
  createMission,
  fetchGovernanceChainEvidence,
  fetchOperatorSnapshot,
  registerAgent,
  setGatewayKillSwitch,
  type AgentOSState,
  type OperatorSnapshot
} from "./gateway-client.js";

type ConsoleProps = {
  gatewayBaseUrl?: string;
  autoRefreshMs?: number;
};

type Mission = AgentOSState["missions"][number];
type Task = AgentOSState["executionTasks"][number];

const missionTemplates = [
  {
    id: "workspace",
    label: "Workspace",
    objective: "Coordinate enterprise AI agents under pre-execution governance.",
    authorities: ["mission.command"],
    tools: ["shell", "editor", "ledger"],
    metric: "mission completes without governance violations"
  },
  {
    id: "safety",
    label: "Safety",
    objective: "Validate a high-integrity safety intervention path under sovereign governance.",
    authorities: ["mission.command", "safety.council"],
    tools: ["shell", "editor", "ledger"],
    metric: "safety actuation remains admissible only under sovereign authority"
  },
  {
    id: "ledger",
    label: "Ledger",
    objective: "Audit evidence continuity and finality posture across the governance ledger.",
    authorities: ["mission.command", "evidence.steward"],
    tools: ["ledger", "replay", "audit"],
    metric: "evidence continuity and finality remain intact"
  }
] as const;

function compact(value?: string) {
  if (!value) return "none";
  return value.length > 22 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
}

function formatTime(value?: string) {
  if (!value) return "awaiting signal";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function confirmAction(title: string, details: string[]) {
  return window.confirm([title, "", ...details.filter(Boolean)].join("\n"));
}

function missionRank(mission: Mission) {
  if (mission.status === "active") return 0;
  if (mission.status === "planned") return 1;
  if (mission.status === "blocked") return 2;
  return 3;
}

function taskRank(task: Task) {
  if (task.status === "running") return 0;
  if (task.status === "queued" && task.coordination?.releaseReady) return 1;
  if (task.status === "queued") return 2;
  if (task.status === "blocked" || task.status === "cancelled") return 3;
  return 4;
}

function statusClass(status: string) {
  if (["ready", "deployable", "admissible", "approved", "insurable", "active", "verified", "passing"].includes(status)) return "good";
  if (["blocked", "halted", "fail-closed", "failing", "down", "revoked", "failed"].includes(status)) return "bad";
  return "warn";
}

export default function EnterpriseOperatorConsole({ gatewayBaseUrl, autoRefreshMs = 5000 }: ConsoleProps) {
  const [snapshot, setSnapshot] = useState<OperatorSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedMissionId, setSelectedMissionId] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [missionTitle, setMissionTitle] = useState("Governed enterprise deployment");
  const [missionTarget, setMissionTarget] = useState<(typeof missionTemplates)[number]["id"]>("workspace");
  const [agentName, setAgentName] = useState("Enterprise Operator");
  const [haltScope, setHaltScope] = useState<"global" | "mission" | "domain" | "agent" | "device">("mission");
  const [haltScopeRef, setHaltScopeRef] = useState("");

  const refresh = async () => {
    const next = await fetchOperatorSnapshot(gatewayBaseUrl);
    setSnapshot(next);
    setError(null);
    setLoading(false);
    return next;
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const next = await fetchOperatorSnapshot(gatewayBaseUrl);
        if (cancelled) return;
        setSnapshot(next);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "failed to load operator snapshot");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const interval = setInterval(() => void load(), autoRefreshMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [autoRefreshMs, gatewayBaseUrl]);

  const missions = useMemo(() => [...(snapshot?.osState.missions ?? [])].sort((a, b) => missionRank(a) - missionRank(b)), [snapshot]);
  const selectedMission = missions.find((mission) => mission.id === selectedMissionId) ?? missions[0] ?? null;
  const tasks = useMemo(
    () =>
      [...(snapshot?.osState.executionTasks ?? [])]
        .filter((task) => !selectedMission || task.missionId === selectedMission.id)
        .sort((a, b) => taskRank(a) - taskRank(b) || b.updatedAt.localeCompare(a.updatedAt)),
    [selectedMission, snapshot]
  );
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? tasks[0] ?? null;
  const readyTask = tasks.find((task) => task.status === "queued" && task.coordination?.releaseReady) ?? null;
  const template = missionTemplates.find((item) => item.id === missionTarget) ?? missionTemplates[0];

  const readiness = snapshot?.health.readiness;
  const deployment = snapshot?.deploymentPosture;
  const gatewayReady = readiness?.ok ?? snapshot?.health.ok ?? false;
  const failedCritical = readiness?.failedCritical ?? [];
  const activeHalt = readiness?.activeGovernanceHalt ?? false;
  const operatorBlocks = [
    loading ? "The operator snapshot is still loading." : "",
    error ? "The gateway snapshot is degraded." : "",
    snapshot && !gatewayReady ? "The gateway is fail-closed." : "",
    failedCritical.length ? `Critical service unavailable: ${failedCritical.join(", ")}.` : "",
    deployment?.preflight.ok === false ? "Enterprise preflight is failing." : "",
    deployment?.mode === "production" && !deployment.operatorAuthEnabled ? "Production operator auth is not enabled." : "",
    deployment?.mode === "production" && !deployment.operatorSessionEnforced ? "Production signed sessions are not enforced." : "",
    deployment?.mode === "production" && !deployment.roleEnforcementEnabled ? "Production RBAC is not enforced." : "",
    deployment?.mode === "production" && !deployment.durableStateConfigured ? "Production durable state is not configured." : "",
    deployment?.insecureProductionOverride ? "Insecure production override is active." : ""
  ].filter(Boolean);
  const missionErrors = [
    missionTitle.trim().length < 4 ? "Mission title is too short." : "",
    template.objective.length < 20 ? "Mission objective needs an auditable purpose." : ""
  ].filter(Boolean);
  const agentErrors = [agentName.trim().length < 3 ? "Agent name is too short." : ""].filter(Boolean);
  const canMutate = operatorBlocks.length === 0 && !busy;
  const commitPosture = activeHalt
    ? "halted"
    : selectedTask?.governance?.status === "approved"
      ? "admissible"
      : selectedTask?.governance?.status === "blocked"
        ? "blocked"
        : selectedTask
          ? "evaluating"
          : "standby";
  const authorityRefs = [
    selectedTask?.governance?.policyCompileId,
    selectedTask?.governance?.envelopeId,
    selectedTask?.governance?.warrantId,
    selectedTask?.governance?.commitDecisionId,
    selectedTask?.governance?.witnessReceiptId,
    selectedTask?.governance?.finalityCertificateId
  ].filter(Boolean);
  const derivedScopeRef =
    haltScope === "global"
      ? ""
      : haltScope === "mission"
        ? selectedMission?.id ?? ""
        : haltScope === "domain"
          ? selectedMission?.targetSystem ?? missionTarget
          : haltScope === "agent"
            ? selectedTask?.assignedAgentId ?? ""
            : selectedTask?.execution?.workspaceId ?? "";
  const effectiveScopeRef = haltScope === "global" ? "" : haltScopeRef.trim() || derivedScopeRef;

  const runAction = async (label: string, fn: () => Promise<void>) => {
    try {
      setBusy(true);
      setError(null);
      await fn();
      await refresh();
      setMessage(label);
    } catch (err) {
      setError(err instanceof Error ? err.message : "operator action failed");
    } finally {
      setBusy(false);
    }
  };

  const createGovernedMission = () => {
    if (!canMutate || missionErrors.length) {
      setError(operatorBlocks[0] ?? missionErrors[0] ?? "Mission creation is blocked.");
      return;
    }
    void runAction(`Mission created: ${missionTitle}`, () =>
      createMission(gatewayBaseUrl, {
        title: missionTitle.trim(),
        objective: template.objective,
        priority: missionTarget === "safety" ? "critical" : "high",
        riskLevel: missionTarget === "safety" ? "high" : "medium",
        governanceProfile: "supervised-build",
        targetSystem: missionTarget,
        requiredAuthorities: [...template.authorities],
        requiredTools: [...template.tools],
        successMetrics: [template.metric],
        requestedBy: "console-ui"
      }).then(() => undefined)
    );
  };

  const registerOperatorAgent = () => {
    if (!canMutate || agentErrors.length) {
      setError(operatorBlocks[0] ?? agentErrors[0] ?? "Agent registration is blocked.");
      return;
    }
    void runAction(`Agent registered: ${agentName}`, () =>
      registerAgent(gatewayBaseUrl, {
        name: agentName.trim(),
        role: "operator",
        model: "gpt-5.4",
        provider: "openai",
        specializations: ["operator coordination", "runtime supervision"],
        toolchains: ["gateway", "ledger", "shell"],
        trustTier: "privileged",
        maxConcurrency: 2,
        workspaceAffinity: "console"
      }).then(() => undefined)
    );
  };

  const advance = (action: "progress" | "execute" | "complete" | "halt") => {
    if (!selectedMission) return;
    if (action !== "halt" && !canMutate) {
      setError(operatorBlocks[0] ?? "Mission mutation is blocked.");
      return;
    }
    if (action === "execute" && (!readyTask || commitPosture === "blocked" || commitPosture === "halted")) {
      setError("Execution requires an admissible release-ready task.");
      return;
    }
    const confirmed = confirmAction(`Confirm mission ${action}?`, [
      `Mission: ${selectedMission.title}`,
      `Focused task: ${selectedTask?.title ?? "none"}`,
      `Commit posture: ${commitPosture}`,
      action === "halt"
        ? "This is a sovereign interruption and will be written to evidence."
        : "This advances runtime state and must remain admissible at the execution boundary."
    ]);
    if (!confirmed) return;
    void runAction(`Mission ${action} accepted`, () =>
      advanceMission(gatewayBaseUrl, selectedMission.id, { action, actor: "console-ui" }).then(() => undefined)
    );
  };

  const toggleHalt = (state: "active" | "inactive") => {
    if (haltScope !== "global" && !effectiveScopeRef) {
      setError(`Select a concrete ${haltScope} reference before changing halt state.`);
      return;
    }
    const confirmed = confirmAction(state === "active" ? "Engage sovereign halt?" : "Reset sovereign halt?", [
      `Scope: ${haltScope}${effectiveScopeRef ? `:${effectiveScopeRef}` : ""}`,
      state === "active"
        ? "Downstream governed actuation will be suppressed at the execution boundary."
        : "Governed execution may resume if every runtime gate allows it.",
      "This operation is committed to evidence."
    ]);
    if (!confirmed) return;
    void runAction(`Sovereign halt ${state}`, () =>
      setGatewayKillSwitch(gatewayBaseUrl, state, {
        scope: haltScope,
        scopeRef: haltScope === "global" ? undefined : effectiveScopeRef
      }).then(() => undefined)
    );
  };

  const exportEvidence = async () => {
    try {
      setBusy(true);
      setError(null);
      const evidence = await fetchGovernanceChainEvidence(gatewayBaseUrl);
      const blob = new Blob([`${JSON.stringify(evidence, null, 2)}\n`], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `aristotle-governance-evidence-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage("Governance evidence bundle exported.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "evidence export failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="enterprise-console">
      <header className="console-hero">
        <div>
          <div className="eyebrow">AristotleOS Enterprise Console</div>
          <h1>Governed Execution Control Plane</h1>
          <p>Operate missions, agents, warrants, evidence, and halt posture from one admissibility-first surface.</p>
        </div>
        <div className="hero-status">
          <span className={`pill ${statusClass(gatewayReady ? "ready" : "fail-closed")}`}>{gatewayReady ? "gateway ready" : "fail-closed"}</span>
          <span className={`pill ${statusClass(activeHalt ? "halted" : "ready")}`}>{activeHalt ? "halt active" : "execution open"}</span>
          <span className={`pill ${statusClass(deployment?.preflight.ok === false ? "failing" : "passing")}`}>
            preflight {deployment?.preflight.ok === false ? "failing" : "passing"}
          </span>
        </div>
      </header>

      {(error || message) && (
        <div className={`notice ${error ? "bad" : "good"}`}>
          {error ?? message}
        </div>
      )}

      <section className={`safety-panel ${operatorBlocks.length ? "blocked" : "clear"}`}>
        <div>
          <div className="eyebrow">Operator Safety Gate</div>
          <h2>{operatorBlocks.length ? "Mutating actions blocked" : "Mutating actions admissible"}</h2>
          <p>
            {operatorBlocks.length
              ? operatorBlocks.join(" ")
              : "Readiness, enterprise preflight, operator controls, and durable evidence posture are aligned."}
          </p>
        </div>
        <div className="safety-grid">
          <Metric label="Mode" value={deployment?.mode ?? "unknown"} tone={deployment?.mode === "production" ? "good" : "warn"} />
          <Metric label="Auth" value={deployment?.operatorAuthEnabled ? "enabled" : "open"} tone={deployment?.operatorAuthEnabled ? "good" : "warn"} />
          <Metric label="RBAC" value={deployment?.roleEnforcementEnabled ? "enforced" : "permissive"} tone={deployment?.roleEnforcementEnabled ? "good" : "warn"} />
          <Metric label="Evidence" value={deployment?.durableStateConfigured ? "durable" : "volatile"} tone={deployment?.durableStateConfigured ? "good" : "warn"} />
        </div>
      </section>

      <section className="kpi-grid">
        <Metric label="Active Missions" value={snapshot?.osState.posture.activeMissions ?? 0} tone="good" />
        <Metric label="Blocked Missions" value={snapshot?.osState.posture.blockedMissions ?? 0} tone={(snapshot?.osState.posture.blockedMissions ?? 0) > 0 ? "bad" : "good"} />
        <Metric label="Ready Agents" value={snapshot?.osState.posture.readyAgents ?? 0} tone="good" />
        <Metric label="Leased Tools" value={snapshot?.osState.posture.leasedTools ?? 0} tone="warn" />
        <Metric label="Ledger Events" value={snapshot?.ledger.committed.length ?? 0} tone="good" />
        <Metric label="Critical Down" value={failedCritical.length} tone={failedCritical.length ? "bad" : "good"} />
      </section>

      <section className="console-grid">
        <Panel title="Pilot Workflow" subtitle="Create, admit, export">
          <div className="workflow-rail">
            <div className={`workflow-step ${selectedMission ? "done" : "todo"}`}>
              <b>1. Create governed mission</b>
              <span>{selectedMission ? selectedMission.title : "Use Compose Mission below."}</span>
            </div>
            <div className={`workflow-step ${commitPosture === "admissible" ? "done" : commitPosture === "blocked" || commitPosture === "halted" ? "blocked" : "todo"}`}>
              <b>2. Admit at commit boundary</b>
              <span>{selectedTask ? `${selectedTask.title} is ${commitPosture}` : "Awaiting governed task."}</span>
            </div>
            <div className={`workflow-step ${(snapshot?.ledger.committed.length ?? 0) > 0 ? "done" : "todo"}`}>
              <b>3. Export evidence</b>
              <span>{snapshot?.ledger.committed.length ?? 0} ledger events available for audit.</span>
            </div>
          </div>
          <button className="primary wide" onClick={exportEvidence} disabled={busy || !snapshot}>
            Export Governance Evidence
          </button>
          <p className="hint">The exported bundle is the regulator/operator handoff: authority chain, GEL records, signatures, and replay validation material.</p>
        </Panel>

        <Panel title="Mission Command" subtitle="Execution lifecycle">
          <label className="field-label">Mission focus</label>
          <select className="field" value={selectedMission?.id ?? ""} onChange={(event) => setSelectedMissionId(event.target.value)}>
            {missions.length ? missions.map((mission) => (
              <option key={mission.id} value={mission.id}>{mission.title} | {mission.status}</option>
            )) : <option value="">No missions available</option>}
          </select>
          <div className="focus-card">
            <div className="card-title">{selectedMission?.title ?? "No mission selected"}</div>
            <p>{selectedMission?.objective ?? "Create a governed mission to engage the runtime."}</p>
            <div className="chips">
              <span>{selectedMission?.targetSystem ?? missionTarget}</span>
              <span>{selectedMission?.governanceProfile ?? "supervised-build"}</span>
              <span>{selectedMission?.priority ?? "high"} priority</span>
            </div>
          </div>
          <div className="button-row">
            <button onClick={() => advance("progress")} disabled={!selectedMission || !canMutate}>Progress</button>
            <button onClick={() => advance("execute")} disabled={!selectedMission || !canMutate || !readyTask || commitPosture !== "admissible"}>Execute</button>
            <button onClick={() => advance("complete")} disabled={!selectedMission || !canMutate}>Complete</button>
            <button className="danger" onClick={() => advance("halt")} disabled={!selectedMission || busy}>Halt</button>
          </div>
          <p className="hint">Execute is only enabled when a release-ready task is admissible at the commit boundary.</p>
        </Panel>

        <Panel title="Commit Boundary" subtitle="Wards, warrants, witnesses">
          <div className="boundary-status">
            <span className={`pill ${statusClass(commitPosture)}`}>{commitPosture}</span>
            <span>{selectedTask?.title ?? "No focused task"}</span>
          </div>
          <div className="detail-grid">
            <Metric label="Witness" value={selectedTask?.governance?.witnessStatus ?? "pending"} tone={selectedTask?.governance?.witnessStatus === "satisfied" ? "good" : "warn"} />
            <Metric label="Authority Refs" value={authorityRefs.length} tone={authorityRefs.length ? "good" : "warn"} />
            <Metric label="Task State" value={selectedTask?.status ?? "standby"} tone={statusClass(selectedTask?.status ?? "standby")} />
            <Metric label="Ready Task" value={readyTask ? "yes" : "no"} tone={readyTask ? "good" : "warn"} />
          </div>
          <div className="refs">
            {authorityRefs.length ? authorityRefs.map((ref) => <code key={ref}>{compact(ref)}</code>) : <span>No authority chain refs yet.</span>}
          </div>
        </Panel>

        <Panel title="Task Queue" subtitle="Sorted by operator relevance">
          <div className="task-list">
            {tasks.length ? tasks.slice(0, 8).map((task) => (
              <button
                key={task.id}
                className={`task-row ${task.id === selectedTask?.id ? "selected" : ""}`}
                onClick={() => setSelectedTaskId(task.id)}
              >
                <span>{task.title}</span>
                <small>{task.status} | {task.coordination?.phase ?? "phase"} | {task.governance?.status ?? "pending"}</small>
              </button>
            )) : <div className="empty">No execution tasks yet.</div>}
          </div>
        </Panel>

        <Panel title="Sovereign Halt" subtitle="Scoped interruption">
          <div className="two-col">
            <select className="field" value={haltScope} onChange={(event) => setHaltScope(event.target.value as typeof haltScope)}>
              <option value="global">global</option>
              <option value="mission">mission</option>
              <option value="domain">domain</option>
              <option value="agent">agent</option>
              <option value="device">device</option>
            </select>
            <input className="field" value={haltScope === "global" ? "" : haltScopeRef} disabled={haltScope === "global"} placeholder={effectiveScopeRef || "scope reference"} onChange={(event) => setHaltScopeRef(event.target.value)} />
          </div>
          <div className="button-row">
            <button className="danger" onClick={() => toggleHalt("active")} disabled={busy || (haltScope !== "global" && !effectiveScopeRef)}>Engage Halt</button>
            <button onClick={() => toggleHalt("inactive")} disabled={busy || (haltScope !== "global" && !effectiveScopeRef)}>Reset Halt</button>
          </div>
          <p className="hint">Halt changes are committed to evidence and enforced before downstream actuation.</p>
        </Panel>

        <Panel title="Compose Mission" subtitle="Guarded creation">
          <label className="field-label">Title</label>
          <input className="field" value={missionTitle} onChange={(event) => setMissionTitle(event.target.value)} />
          <label className="field-label">Governance lane</label>
          <select className="field" value={missionTarget} onChange={(event) => setMissionTarget(event.target.value as typeof missionTarget)}>
            {missionTemplates.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <div className="focus-card compact">
            <b>{template.objective}</b>
            <span>Authorities: {template.authorities.join(", ")}</span>
            <span>Tools: {template.tools.join(", ")}</span>
          </div>
          {(missionErrors.length > 0 || operatorBlocks.length > 0) && <p className="hint bad-text">{missionErrors[0] ?? operatorBlocks[0]}</p>}
          <button className="primary wide" onClick={createGovernedMission} disabled={!canMutate || missionErrors.length > 0}>Create Governed Mission</button>
        </Panel>

        <Panel title="Register Agent" subtitle="Operator identity">
          <label className="field-label">Agent name</label>
          <input className="field" value={agentName} onChange={(event) => setAgentName(event.target.value)} />
          {(agentErrors.length > 0 || operatorBlocks.length > 0) && <p className="hint bad-text">{agentErrors[0] ?? operatorBlocks[0]}</p>}
          <button className="primary wide" onClick={registerOperatorAgent} disabled={!canMutate || agentErrors.length > 0}>Register Operator Agent</button>
        </Panel>

        <Panel title="Evidence Ledger" subtitle="Execution accountability">
          <div className="event-list">
            {(snapshot?.ledger.committed ?? []).slice(-6).reverse().map((event) => (
              <div key={event.id} className="event-row">
                <span>{event.eventKind}</span>
                <small>{compact(event.traceId)} | {formatTime(event.timestamp)}</small>
              </div>
            ))}
            {!(snapshot?.ledger.committed.length ?? 0) && <div className="empty">No ledger events yet.</div>}
          </div>
        </Panel>

        <Panel title="Control Plane" subtitle="Critical services">
          <div className="service-list">
            {(readiness?.services ?? []).map((service) => (
              <div key={service.name} className="service-row">
                <span>{service.name}</span>
                <span className={`pill ${service.ok ? "good" : service.critical ? "bad" : "warn"}`}>{service.ok ? "ready" : "down"} | {service.latencyMs}ms</span>
              </div>
            ))}
            {!readiness?.services?.length && <div className="empty">Readiness details unavailable.</div>}
          </div>
        </Panel>
      </section>
    </main>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        <span>{subtitle}</span>
      </div>
      {children}
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: React.ReactNode; tone: "good" | "warn" | "bad" | string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong className={statusClass(tone)}>{value}</strong>
    </div>
  );
}
