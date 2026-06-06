import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createApp, id, now } from "./lib.js";
import { createChainClient, type ChainCommitResult, type ChainMode } from "./governance-chain-client.js";
import { mountMissionsRoutes } from "./routes/missions.js";
import { fingerprint, createMissionSteps as buildMissionSteps } from "./lib/mission-helpers.js";
import {
  EdgeNode,
  type NodeId,
  type MeshMessage,
  type CommitRequest as MeshCommitRequest
} from "@aristotle/mesh-runtime";
import {
  evaluateCommitGate,
  type AuthorityEnvelope as SubstrateEnvelope,
  type CanonicalActionInput,
  type WardManifest
} from "@aristotle/execution-control-runtime";
import { ReadinessChecks, mountHealthEndpoints } from "@aristotle/service-runtime";
import type {
  AgentCapability,
  AgentOSSnapshot,
  AuthorityRoute,
  FinalityCertificate,
  ExecutionReceipt,
  ExecutionTask,
  GovernanceDecisionStatus,
  MemoryRecord,
  MissionStep,
  OperatingMission,
  ToolAction,
  ToolLease,
  WitnessReceipt,
  WorkspaceSession
} from "@aristotle/shared-types";

type AgentOSStateStore = {
  agents: AgentCapability[];
  missions: OperatingMission[];
  workspaces: WorkspaceSession[];
  toolLeases: ToolLease[];
  memory: Record<string, MemoryRecord[]>;
  executionTasks: ExecutionTask[];
  executionReceipts: ExecutionReceipt[];
  toolActions: ToolAction[];
};

const port = Number(process.env.PORT_AGENT_OS ?? 7009);
const app = createApp();
const statePath = resolve(process.cwd(), process.env.AGENT_OS_STATE_PATH ?? "./data/agent-os.json");
const serviceDiscoveryMode = process.env.SERVICE_DISCOVERY_MODE ?? "container";
const serviceOrigin = (serviceName: string, hostEnvKey: string, portValue: number) => {
  const configuredHost = process.env[hostEnvKey]?.trim();
  const host =
    configuredHost ||
    (serviceDiscoveryMode === "local" ? "127.0.0.1" : serviceName);
  return `http://${host}:${portValue}`;
};
const ledgerBase = serviceOrigin("evidence-ledger", "HOST_EVIDENCE_LEDGER", Number(process.env.PORT_EVIDENCE_LEDGER ?? 7003));
const governanceKernelBase = serviceOrigin("governance-kernel", "HOST_GOVERNANCE_KERNEL", Number(process.env.PORT_GOVERNANCE_KERNEL ?? 7001));
const policyCompilerBase = serviceOrigin("policy-compiler", "HOST_POLICY_COMPILER", Number(process.env.PORT_POLICY_COMPILER ?? 7002));
const authorityRouterBase = serviceOrigin("authority-router", "HOST_AUTHORITY_ROUTER", Number(process.env.PORT_AUTHORITY_ROUTER ?? 7006));
const simulationEngineBase = serviceOrigin("simulation-engine", "HOST_SIMULATION_ENGINE", Number(process.env.PORT_SIMULATION_ENGINE ?? 7005));
const witnessServiceBase = serviceOrigin("witness-service", "HOST_WITNESS_SERVICE", Number(process.env.PORT_WITNESS_SERVICE ?? 7007));
const executionGateBase = serviceOrigin("execution-gate", "HOST_EXECUTION_GATE", Number(process.env.PORT_EXECUTION_GATE ?? 7008));
const chainV2Enabled = (process.env.GOVERNANCE_CHAIN_V2 ?? "false").toLowerCase() === "true";
const chainV2Mode: ChainMode = chainV2Enabled ? ((process.env.GOVERNANCE_CHAIN_MODE ?? "shadow").toLowerCase() as ChainMode) : "off";
const governanceChainClient =
  chainV2Mode === "off"
    ? undefined
    : createChainClient({ kernelBase: governanceKernelBase, mode: chainV2Mode, keyId: process.env.GOVERNANCE_CHAIN_KEY_ID });
if (governanceChainClient) {
  console.log(`agent-os: GOVERNANCE_CHAIN_V2 ${chainV2Mode} — task acts routed through kernel /v2/commit`);
}
const heartbeatTimeoutMs = Number(process.env.AGENT_OS_HEARTBEAT_TIMEOUT_MS ?? 300000);
const leaseRenewalWindowMs = Number(process.env.AGENT_OS_LEASE_RENEWAL_WINDOW_MS ?? 900000);
const leaseExtensionMs = Number(process.env.AGENT_OS_LEASE_EXTENSION_MS ?? 1800000);
const taskMaxAttempts = Number(process.env.AGENT_OS_TASK_MAX_ATTEMPTS ?? 3);
const killSwitchCacheMs = Number(process.env.AGENT_OS_KILL_SWITCH_CACHE_MS ?? 1000);
const meshTelemetryCacheMs = Number(process.env.AGENT_OS_MESH_TELEMETRY_CACHE_MS ?? 2000);
const autonomyTickMs = Number(process.env.AGENT_OS_AUTONOMY_TICK_MS ?? 5000);

type GovernanceDecision = {
  status: GovernanceDecisionStatus;
  reasons: string[];
  evaluatedAt: string;
  policyCompileId?: string;
  envelopeId?: string;
  warrantId?: string;
  commitDecisionId?: string;
  witnessReceiptId?: string;
  decisionId?: string;
  finalityCertificateId?: string;
  witnessStatus?: "satisfied" | "unsatisfied" | "not-required";
  route?: AuthorityRoute;
  chain?: ChainCommitResult;
};

const defaultAgents: AgentCapability[] = [
  {
    id: "agent-planner",
    name: "Strategic Planner",
    role: "planner",
    status: "ready",
    model: "gpt-5.4",
    provider: "openai",
    specializations: ["mission decomposition", "risk discovery", "policy alignment"],
    toolchains: ["docs", "planning", "simulation"],
    trustTier: "delegated",
    maxConcurrency: 4,
    workspaceAffinity: "shared",
    deviceId: "device-planner-core",
    identityFingerprint: "agentfp-agent-planner",
    verificationStatus: "verified"
  },
  {
    id: "agent-executor",
    name: "Execution Worker",
    role: "executor",
    status: "ready",
    model: "gpt-5.4-mini",
    provider: "openai",
    specializations: ["implementation", "integration", "verification"],
    toolchains: ["shell", "editor", "gateway"],
    trustTier: "sandboxed",
    maxConcurrency: 6,
    workspaceAffinity: "repo",
    deviceId: "device-executor-core",
    identityFingerprint: "agentfp-agent-executor",
    verificationStatus: "verified"
  },
  {
    id: "agent-auditor",
    name: "Governance Auditor",
    role: "auditor",
    status: "ready",
    model: "gpt-5.4-mini",
    provider: "openai",
    specializations: ["compliance", "lineage", "evidence review"],
    toolchains: ["ledger", "policy", "witness"],
    trustTier: "privileged",
    maxConcurrency: 2,
    workspaceAffinity: "shared",
    deviceId: "device-auditor-core",
    identityFingerprint: "agentfp-agent-auditor",
    verificationStatus: "verified"
  }
];

const agents = new Map<string, AgentCapability>(defaultAgents.map((agent) => [agent.id, agent]));
const missions = new Map<string, OperatingMission>();
const workspaces = new Map<string, WorkspaceSession>();
const toolLeases = new Map<string, ToolLease>();
const memory = new Map<string, MemoryRecord[]>();
const executionTasks = new Map<string, ExecutionTask>();
const executionReceipts = new Map<string, ExecutionReceipt>();
const toolActions = new Map<string, ToolAction>();

// fingerprint() moved to ./lib/mission-helpers.ts in stage 12 (imported above).

const agentIdentityContext = (agentId: string) => {
  const agent = agents.get(agentId);
  return {
    agentId,
    agentFingerprint: agent?.identityFingerprint ?? fingerprint("agentfp", agentId),
    agentVerificationStatus: agent?.verificationStatus ?? "verified",
    agentModel: agent?.model ?? "unknown",
    agentProvider: agent?.provider ?? "unknown",
    agentTrustTier: agent?.trustTier ?? "sandboxed",
    deviceId: agent?.deviceId
  };
};

const workspaceIdentityContext = (workspaceId?: string) => {
  if (!workspaceId) return {};
  const workspace = workspaces.get(workspaceId);
  return {
    workspaceId,
    deviceId: workspaceId,
    deviceFingerprint: workspace?.deviceFingerprint ?? fingerprint("devicefp", workspaceId),
    deviceVerificationStatus: workspace?.verificationStatus ?? "verified",
    branchName: workspace?.branchName,
    memoryNamespace: workspace?.memoryNamespace
  };
};
const policyCompileCache = new Map<string, { compileId?: string; valid: boolean; errors: string[] }>();
const envelopeValidationCache = new Map<string, { allowed: boolean; reason?: string; envelopeId?: string }>();
const policyCompileInflight = new Map<string, Promise<{ compileId?: string; valid: boolean; errors: string[] }>>();
const envelopeValidationInflight = new Map<
  string,
  Promise<{ allowed: boolean; reason?: string; envelopeId?: string }>
>();
let killSwitchSnapshot: { state: "active" | "inactive"; checkedAt: number } = { state: "inactive", checkedAt: 0 };
let meshTelemetrySnapshot: { degradedNodes: string[]; checkedAt: number } = { degradedNodes: [], checkedAt: 0 };
let persistQueue = Promise.resolve();
let autonomyLoopRunning = false;

// createMissionSteps() moved to ./lib/mission-helpers.ts in stage 12 (imported as
// buildMissionSteps to avoid shadowing). Local wrapper preserves the prior
// (requiredTools) → MissionStep[] signature so existing call sites don't change.
const createMissionSteps = (requiredTools: string[]): MissionStep[] =>
  buildMissionSteps(id, requiredTools);

const ensureMissionMemory = (missionId: string) => {
  const records = memory.get(missionId);
  if (records) return records;
  const next: MemoryRecord[] = [];
  memory.set(missionId, next);
  return next;
};

const serializeState = (): AgentOSStateStore => ({
  agents: [...agents.values()],
  missions: [...missions.values()],
  workspaces: [...workspaces.values()],
  toolLeases: [...toolLeases.values()],
  memory: Object.fromEntries(memory.entries()),
  executionTasks: [...executionTasks.values()],
  executionReceipts: [...executionReceipts.values()],
  toolActions: [...toolActions.values()]
});

const schedulePersist = () => {
  persistQueue = persistQueue
    .then(async () => {
      await mkdir(dirname(statePath), { recursive: true });
      await writeFile(statePath, JSON.stringify(serializeState(), null, 2), "utf8");
    })
    .catch((error) => {
      console.error("agent-os persist failed", error);
    });
  return persistQueue;
};

const loadState = async () => {
  try {
    const raw = await readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<AgentOSStateStore>;

    agents.clear();
    for (const agent of parsed.agents ?? defaultAgents) {
      agents.set(agent.id, agent);
    }

    missions.clear();
    for (const mission of parsed.missions ?? []) {
      missions.set(mission.id, mission);
    }

    workspaces.clear();
    for (const workspace of parsed.workspaces ?? []) {
      workspaces.set(workspace.id, workspace);
    }

    toolLeases.clear();
    for (const lease of parsed.toolLeases ?? []) {
      toolLeases.set(lease.id, lease);
    }

    memory.clear();
    for (const [missionId, records] of Object.entries(parsed.memory ?? {})) {
      memory.set(missionId, records);
    }

    executionTasks.clear();
    for (const task of parsed.executionTasks ?? []) {
      executionTasks.set(task.id, task);
    }

    executionReceipts.clear();
    for (const receipt of parsed.executionReceipts ?? []) {
      executionReceipts.set(receipt.id, receipt);
    }

    toolActions.clear();
    for (const toolAction of parsed.toolActions ?? []) {
      toolActions.set(toolAction.id, toolAction);
    }
  } catch (error) {
    const missing = typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
    if (!missing) {
      console.error("agent-os load failed", error);
    }
  }
};

const summarizePosture = (): AgentOSSnapshot["posture"] => {
  const allMissions = [...missions.values()];
  const allLeases = [...toolLeases.values()];
  const allAgents = [...agents.values()];
  return {
    readyAgents: allAgents.filter((agent) => agent.status === "ready").length,
    activeMissions: allMissions.filter((mission) => mission.status === "active" || mission.status === "planned").length,
    blockedMissions: allMissions.filter((mission) => mission.status === "blocked" || mission.status === "halted").length,
    leasedTools: allLeases.filter((lease) => lease.state === "leased").length
  };
};

const snapshot = (): AgentOSSnapshot => ({
  generatedAt: now(),
  missions: [...missions.values()],
  agents: [...agents.values()],
  toolLeases: [...toolLeases.values()],
  workspaces: [...workspaces.values()],
  memory: [...memory.values()].flat(),
  executionTasks: [...executionTasks.values()],
  executionReceipts: [...executionReceipts.values()],
  toolActions: [...toolActions.values()],
  posture: summarizePosture()
});

const commitLedgerEvent = async (missionId: string, eventKind: string, payload: Record<string, unknown>) => {
  try {
    await fetch(`${ledgerBase}/events/commit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actor: "agent-os",
        eventKind,
        traceId: missionId,
        payload
      })
    });
  } catch (error) {
    console.error("agent-os ledger commit failed", error);
  }
};

const missionTasks = (missionId: string) =>
  [...executionTasks.values()]
    .filter((task) => task.missionId === missionId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

const missionToolLeases = (missionId: string) =>
  [...toolLeases.values()].filter((lease) => lease.missionId === missionId && lease.state === "leased");

const findMissionWorkspace = (missionId: string) =>
  [...workspaces.values()].find((workspace) => workspace.missionId === missionId);

const authorityMatchesTargetSystem = (authority: string, targetSystem: string) => {
  const normalizedAuthority = authority.toLowerCase();
  const normalizedTarget = targetSystem.toLowerCase();
  if (normalizedAuthority === normalizedTarget) return true;
  if (normalizedAuthority.startsWith(`${normalizedTarget}.`)) return true;
  if (normalizedAuthority.includes(normalizedTarget)) return true;
  if (normalizedTarget === "ledger" && /ledger|evidence/.test(normalizedAuthority)) return true;
  return false;
};

const selectMissionAuthorityAnchor = (mission: OperatingMission) =>
  mission.requiredAuthorities.find((authority) => authorityMatchesTargetSystem(authority, mission.targetSystem)) ??
  mission.requiredAuthorities[0] ??
  "mission.command";

const isoAfter = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

const parseTimestamp = (value?: string) => {
  if (!value) return Number.NaN;
  return new Date(value).getTime();
};

const buildTaskExecutionContext = (
  mission: OperatingMission,
  title: string,
  ownerRole: AgentCapability["role"],
  requiredTools: string[]
) => {
  const workspace = findMissionWorkspace(mission.id);
  const commandHints =
    ownerRole === "auditor"
      ? ["rg -n \"policy|governance|ledger|witness|finality\" .", "Get-ChildItem -Recurse docs,services,shared"]
      : /implementation|build|release/i.test(title)
        ? ["npm run build", "npm test", "rg -n \"TODO|FIXME|governance\" ."]
        : ["rg --files .", "Get-ChildItem -Force", "rg -n \"mission|workspace|agent\" ."];

  const fileHints = [
    workspace?.cwd,
    workspace?.branchName,
    mission.targetSystem,
    ...requiredTools.map((tool) => `tool:${tool}`)
  ].filter((value): value is string => Boolean(value));

  return {
    workspaceId: workspace?.id ?? mission.workspaceId,
    cwd: workspace?.cwd ?? "/workspace",
    branchName: workspace?.branchName,
    commandHints,
    fileHints,
    attemptCount: 0
  };
};

const buildMissionPolicyText = (mission: OperatingMission) =>
  [
    `profile:${mission.governanceProfile}`,
    `risk:${mission.riskLevel}`,
    `authorities:${mission.requiredAuthorities.join(",") || "mission.command"}`,
    `tools:${mission.requiredTools.join(",") || "shell,editor,ledger"}`,
    `success:${mission.successMetrics.join(" | ") || "mission completes without governance violations"}`
  ].join("\n");

const compilePolicyArtifact = async (policyName: string, policyText: string) => {
  const cacheKey = `${policyName}\n${policyText}`;
  const cached = policyCompileCache.get(cacheKey);
  if (cached) return cached;
  const inflight = policyCompileInflight.get(cacheKey);
  if (inflight) return inflight;

  const request = (async () => {
    const compileResponse = await fetch(`${policyCompilerBase}/compile`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ policyName, policyText })
    });
    const compile = (await compileResponse.json()) as { valid?: boolean; compileId?: string; errors?: string[] };
    const result = {
      compileId: compile.compileId,
      valid: Boolean(compileResponse.ok && compile.valid),
      errors: compile.errors?.length ? compile.errors : compileResponse.ok && compile.valid ? [] : ["Policy compile failed."]
    };
    if (result.valid && result.compileId) {
      policyCompileCache.set(cacheKey, result);
    }
    return result;
  })();

  policyCompileInflight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    policyCompileInflight.delete(cacheKey);
  }
};

const validateEnvelopeArtifact = async (payload: Record<string, unknown>) => {
  const cacheKey = JSON.stringify(payload);
  const cached = envelopeValidationCache.get(cacheKey);
  if (cached) return cached;
  const inflight = envelopeValidationInflight.get(cacheKey);
  if (inflight) return inflight;

  const request = (async () => {
    const envelopeResponse = await fetch(`${governanceKernelBase}/validate-envelope`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const envelopeResult = (await envelopeResponse.json()) as {
      allowed?: boolean;
      reason?: string;
      envelope?: { id?: string };
    };
    const result = {
      allowed: Boolean(envelopeResponse.ok && envelopeResult.allowed && envelopeResult.envelope?.id),
      reason: envelopeResult.reason,
      envelopeId: envelopeResult.envelope?.id
    };
    if (result.allowed && result.envelopeId) {
      envelopeValidationCache.set(cacheKey, result);
    }
    return result;
  })();

  envelopeValidationInflight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    envelopeValidationInflight.delete(cacheKey);
  }
};

const readKillSwitchState = async () => {
  if (Date.now() - killSwitchSnapshot.checkedAt < killSwitchCacheMs) {
    return killSwitchSnapshot.state;
  }

  try {
    const [kernelHealth, gateHealth] = await Promise.all([
      fetch(`${governanceKernelBase}/health`).then((response) => response.json() as Promise<{ killSwitchState?: "active" | "inactive" }>),
      fetch(`${executionGateBase}/health`).then((response) => response.json() as Promise<{ killSwitchState?: "active" | "inactive" }>)
    ]);
    const nextState =
      kernelHealth.killSwitchState === "active" || gateHealth.killSwitchState === "active" ? "active" : "inactive";
    killSwitchSnapshot = { state: nextState, checkedAt: Date.now() };
  } catch {
    killSwitchSnapshot = { ...killSwitchSnapshot, checkedAt: Date.now() };
  }

  return killSwitchSnapshot.state;
};

const prewarmTaskGovernanceArtifacts = (mission: OperatingMission, task: ExecutionTask, phase: "dispatch" | "completion" = "dispatch") => {
  const policyName = `${mission.governanceProfile}:${task.title}`;
  const policyText = buildMissionPolicyText(mission);
  const envelopePayload = {
    actor: "agent-os",
    issuer: selectMissionAuthorityAnchor(mission),
    domain: mission.targetSystem,
    subject: task.assignedAgentId,
    action: `${phase}:${task.title}`,
    permittedEffects: [`task.${phase}.${task.id}`],
    constraints: {
      missionId: mission.id,
      governanceProfile: mission.governanceProfile,
      riskLevel: mission.riskLevel,
      requiredAuthorities: mission.requiredAuthorities,
      requiredTools: task.requiredTools,
      ...agentIdentityContext(task.assignedAgentId),
      ...workspaceIdentityContext(task.execution?.workspaceId ?? mission.workspaceId)
    }
  };

  void Promise.allSettled([
    compilePolicyArtifact(policyName, policyText),
    validateEnvelopeArtifact(envelopePayload)
  ]);
};

const prewarmToolActionExecutionArtifacts = (mission: OperatingMission, task: ExecutionTask, action: ToolAction) => {
  const policyName = `${mission.governanceProfile}:${action.kind}:${action.toolId}`;
  const policyText = buildMissionPolicyText(mission);
  const envelopePayload = {
    actor: "agent-os",
    issuer: selectMissionAuthorityAnchor(mission),
    domain: mission.targetSystem,
    subject: action.agentId,
    action: `tool-action:${action.kind}:${action.toolId}`,
    permittedEffects: [`tool-action.execute.${action.id}`],
    constraints: {
      missionId: mission.id,
      taskId: task.id,
      actionId: action.id,
      governanceProfile: mission.governanceProfile,
      riskLevel: mission.riskLevel,
      toolId: action.toolId,
      actionKind: action.kind,
      ...agentIdentityContext(action.agentId),
      ...workspaceIdentityContext(task.execution?.workspaceId ?? mission.workspaceId)
    }
  };

  void Promise.allSettled([
    compilePolicyArtifact(policyName, policyText),
    validateEnvelopeArtifact(envelopePayload)
  ]);
};

const setAgentRuntimeStatus = (agentId: string, status: AgentCapability["status"]) => {
  const agent = agents.get(agentId);
  if (!agent) return;
  agents.set(agentId, { ...agent, status, lastHeartbeat: now() });
};

const countsTowardAgentCapacity = (task: ExecutionTask) => {
  if (task.status !== "queued" && task.status !== "running") return false;
  const mission = missions.get(task.missionId);
  if (!mission) return false;
  const missionStatus = deriveMissionStatusFromTasks(mission);
  if (missionStatus !== "active" && missionStatus !== "planned") return false;
  const workspace = findMissionWorkspace(mission.id);
  if (workspace?.state === "paused" || workspace?.state === "sealed") return false;
  return true;
};

const agentTaskLoad = (agentId: string) =>
  [...executionTasks.values()].filter((task) => task.assignedAgentId === agentId && countsTowardAgentCapacity(task)).length;

const allocateAgent = (mission: OperatingMission, fallbackRole: AgentCapability["role"] = "executor") => {
  const rankAgents = (pool: AgentCapability[]) =>
    [...pool].sort((left, right) => {
      const leftLoad = agentTaskLoad(left.id);
      const rightLoad = agentTaskLoad(right.id);
      const leftRolePenalty = left.role === fallbackRole ? 0 : 1;
      const rightRolePenalty = right.role === fallbackRole ? 0 : 1;

      return (
        leftRolePenalty - rightRolePenalty ||
        leftLoad - rightLoad ||
        left.name.localeCompare(right.name)
      );
    });

  const missionCandidates = mission.assignedAgents
    .map((agentId) => agents.get(agentId))
    .filter((agent): agent is AgentCapability => Boolean(agent))
    .filter((agent) => agent.status === "ready");

  const roleMatchedMissionCandidates = missionCandidates.filter((agent) => agent.role === fallbackRole);
  const roleMatchedGlobalCandidates = [...agents.values()].filter((agent) => agent.status === "ready" && agent.role === fallbackRole);

  const preferredRoleMatch =
    rankAgents(roleMatchedMissionCandidates)[0] ??
    rankAgents(roleMatchedGlobalCandidates)[0];

  if (preferredRoleMatch) return preferredRoleMatch;

  const preferred = rankAgents(missionCandidates)[0];

  if (preferred) return preferred;

  const globalCandidates = [...agents.values()].filter((agent) => agent.status === "ready");

  return rankAgents(globalCandidates)[0] ?? missionCandidates[0] ?? [...agents.values()][0];
};

const createExecutionTask = (
  mission: OperatingMission,
  title: string,
  ownerRole: AgentCapability["role"],
  requiredTools: string[],
  input: Record<string, unknown>,
  coordination?: ExecutionTask["coordination"]
) => {
  const timestamp = now();
  const assignedAgent = allocateAgent(mission, ownerRole);
  const task: ExecutionTask = {
    id: id("task"),
    missionId: mission.id,
    title,
    status: "queued",
    assignedAgentId: assignedAgent?.id ?? "unassigned",
    ownerRole,
    requiredTools,
    input,
    coordination,
    execution: buildTaskExecutionContext(mission, title, ownerRole, requiredTools),
    createdAt: timestamp,
    updatedAt: timestamp
  };
  executionTasks.set(task.id, task);
  return task;
};

const createExecutionReceipt = (
  missionId: string,
  taskId: string,
  agentId: string,
  summary: string,
  outcome: ExecutionReceipt["outcome"],
  evidenceRefs: string[],
  governanceRefs: string[] = []
) => {
  const receipt: ExecutionReceipt = {
    id: id("receipt"),
    missionId,
    taskId,
    agentId,
    summary,
    outcome,
    evidenceRefs,
    governanceRefs,
    createdAt: now()
  };
  executionReceipts.set(receipt.id, receipt);
  return receipt;
};

const hasReceiptForTask = (taskId: string, outcome?: ExecutionReceipt["outcome"]) =>
  [...executionReceipts.values()].some((receipt) => receipt.taskId === taskId && (outcome ? receipt.outcome === outcome : true));

const taskDependencyState = (task: ExecutionTask) => {
  const dependencyIds = task.coordination?.dependsOnTaskIds ?? [];
  const blockedByTaskIds = dependencyIds.filter((dependencyId) => {
    const dependency = executionTasks.get(dependencyId);
    return dependency?.status === "blocked" || dependency?.status === "cancelled";
  });
  const incompleteDependencyIds = dependencyIds.filter((dependencyId) => {
    const dependency = executionTasks.get(dependencyId);
    return dependency?.status !== "completed";
  });

  return {
    dependencyIds,
    blockedByTaskIds,
    incompleteDependencyIds,
    satisfied: blockedByTaskIds.length === 0 && incompleteDependencyIds.length === 0
  };
};

const updateTaskGovernance = (taskId: string, governance: GovernanceDecision) => {
  const task = executionTasks.get(taskId);
  if (!task) return;
  executionTasks.set(taskId, {
    ...task,
    governance,
    updatedAt: governance.evaluatedAt
  });
};

const normalizeGovernanceDecision = (
  governance: Exclude<ExecutionTask["governance"], undefined> | GovernanceDecision
): GovernanceDecision => ({
  status: governance.status,
  reasons: [...governance.reasons],
  evaluatedAt: governance.evaluatedAt ?? now(),
  policyCompileId: governance.policyCompileId,
  envelopeId: governance.envelopeId,
  warrantId: governance.warrantId,
  commitDecisionId: governance.commitDecisionId,
  witnessReceiptId: governance.witnessReceiptId,
  decisionId: governance.decisionId,
  finalityCertificateId: governance.finalityCertificateId,
  witnessStatus: governance.witnessStatus,
  route: governance.route
});

const isPotentiallyDestructivePayload = (payload: Record<string, unknown>) => {
  const payloadText = JSON.stringify(payload).toLowerCase();
  const commandText = typeof payload.command === "string" ? payload.command.toLowerCase() : "";

  if (/^\s*get-childitem\b/.test(commandText) || /^\s*ls\b/.test(commandText) || /^\s*dir\b/.test(commandText)) {
    return false;
  }

  return (
    /\b(rm|del|erase|rmdir|rd|delete|drop|truncate|overwrite)\b/.test(payloadText) ||
    /\bremove-item\b/.test(commandText) ||
    /\bcheckout\s+--\b/.test(commandText) ||
    /\breset\s+--hard\b/.test(commandText)
  );
};

const deriveDegradedNodes = (
  mission: OperatingMission,
  task?: ExecutionTask,
  action?: ToolAction
) => {
  const degradedNodes = new Set<string>();
  const assignedAgentId = action?.agentId ?? task?.assignedAgentId;
  const assignedAgent = assignedAgentId ? agents.get(assignedAgentId) : undefined;
  const workspace = workspaces.get(mission.workspaceId);

  if (assignedAgent?.status === "degraded" || assignedAgent?.status === "offline") {
    degradedNodes.add("mesh.alpha");
  }
  if (workspace?.state === "paused") {
    degradedNodes.add("mesh.beta");
  }
  if (mission.status === "blocked" || mission.status === "halted") {
    degradedNodes.add("mesh.gamma");
  }

  return [...degradedNodes];
};

const readMeshDegradedNodes = async () => {
  const checkedAt = Date.now();
  if (checkedAt - meshTelemetrySnapshot.checkedAt < meshTelemetryCacheMs) {
    return meshTelemetrySnapshot.degradedNodes;
  }

  try {
    const response = await fetch(`${simulationEngineBase}/telemetry`);
    const telemetry = (await response.json()) as {
      nodes?: Array<{ id?: string; status?: "healthy" | "degraded" }>;
    };
    const degradedNodes = (telemetry.nodes ?? [])
      .filter((node) => node.status === "degraded" && typeof node.id === "string")
      .map((node) => node.id as string);
    meshTelemetrySnapshot = { degradedNodes, checkedAt };
    return degradedNodes;
  } catch {
    return meshTelemetrySnapshot.degradedNodes;
  }
};

const resolveAuthorityRoute = async (
  mission: OperatingMission,
  options: {
    phase: "dispatch" | "tool-action" | "completion";
    subject: string;
    targetId: string;
    actionSummary?: string;
    task?: ExecutionTask;
    action?: ToolAction;
  }
) => {
  const degradedNodes = [...new Set([...(await readMeshDegradedNodes()), ...deriveDegradedNodes(mission, options.task, options.action)])];
  const source = selectMissionAuthorityAnchor(mission);
  const response = await fetch(`${authorityRouterBase}/route`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      source,
      target: mission.targetSystem,
      domain: mission.targetSystem,
      phase: options.phase,
      degradedNodes,
      riskLevel: mission.riskLevel,
      requiredAuthorities: mission.requiredAuthorities,
      targetId: options.targetId,
      subject: options.subject,
      actionSummary: options.actionSummary
    })
  });
  const route = (await response.json()) as AuthorityRoute & { error?: string };
  if (!response.ok || !route.selectedPath?.length) {
    throw new Error(route.error ?? route.continuityReasoning ?? route.failoverReasoning ?? "Authority routing unavailable.");
  }
  return route;
};

const claimTaskForAgent = (task: ExecutionTask, agentId: string, statusNote?: string) => {
  const timestamp = now();
  const claimedTask: ExecutionTask = {
    ...task,
    status: "running",
    updatedAt: timestamp,
    execution: {
      ...(task.execution ?? { commandHints: [], fileHints: [], attemptCount: 0 }),
      claimedBy: agentId,
      claimedAt: task.execution?.claimedAt ?? timestamp,
      heartbeatAt: timestamp,
      statusNote,
      attemptCount: (task.execution?.attemptCount ?? 0) + 1
    }
  };
  executionTasks.set(task.id, claimedTask);
  setAgentRuntimeStatus(agentId, "busy");
  return claimedTask;
};

const updateTaskHeartbeat = (task: ExecutionTask, agentId: string, statusNote?: string) => {
  const timestamp = now();
  const updatedTask: ExecutionTask = {
    ...task,
    updatedAt: timestamp,
    execution: {
      ...(task.execution ?? { commandHints: [], fileHints: [], attemptCount: 0 }),
      claimedBy: agentId,
      claimedAt: task.execution?.claimedAt ?? timestamp,
      heartbeatAt: timestamp,
      statusNote: statusNote ?? task.execution?.statusNote
    }
  };
  executionTasks.set(task.id, updatedTask);
  setAgentRuntimeStatus(agentId, "busy");
  return updatedTask;
};

const releaseTaskClaim = (task: ExecutionTask) => ({
  ...(task.execution ?? { commandHints: [], fileHints: [], attemptCount: 0 }),
  claimedBy: undefined,
  claimedAt: undefined,
  heartbeatAt: undefined,
  statusNote: undefined
});

const taskToolActions = (taskId: string) =>
  [...toolActions.values()]
    .filter((action) => action.taskId === taskId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

const renewMissionLeases = async (
  missionId: string,
  actor: string,
  reason: string,
  renewalWindowMs: number = leaseRenewalWindowMs,
  extensionMs: number = leaseExtensionMs
) => {
  const timestamp = now();
  const renewed: ToolLease[] = [];
  for (const lease of [...toolLeases.values()]) {
    if (lease.missionId !== missionId || lease.state !== "leased") continue;
    const expiresAtMs = parseTimestamp(lease.expiresAt);
    const missingExpiry = Number.isNaN(expiresAtMs);
    const withinWindow = !missingExpiry && expiresAtMs - Date.now() <= renewalWindowMs;
    if (missingExpiry || withinWindow) {
      const nextLease: ToolLease = {
        ...lease,
        expiresAt: isoAfter(extensionMs),
        renewedAt: timestamp
      };
      toolLeases.set(lease.id, nextLease);
      renewed.push(nextLease);
    }
  }

  if (renewed.length > 0) {
    await commitLedgerEvent(missionId, "agent-os.tool-lease.renewed", {
      missionId,
      actor,
      reason,
      leaseIds: renewed.map((lease) => lease.id),
      expiresAt: renewed.map((lease) => lease.expiresAt)
    });
  }

  return renewed;
};

const queueTaskRetry = async (task: ExecutionTask, actor: string, reason: string) => {
  const mission = missions.get(task.missionId);
  if (!mission) return { ok: false as const, error: "mission_not_found" };

  const attempts = task.execution?.attemptCount ?? 0;
  if (attempts >= taskMaxAttempts) {
    const blockedTask: ExecutionTask = {
      ...task,
      status: "blocked",
      updatedAt: now(),
      execution: {
        ...(task.execution ?? { commandHints: [], fileHints: [], attemptCount: attempts }),
        statusNote: `Retry limit reached: ${reason}`
      },
      output: {
        ...(task.output ?? {}),
        retryFailure: reason
      }
    };
    executionTasks.set(task.id, blockedTask);
    setAgentRuntimeStatus(task.assignedAgentId, "ready");
    ensureMissionMemory(mission.id).push({
      id: id("mem"),
      missionId: mission.id,
      kind: "risk",
      summary: `${task.title} exhausted retry budget and was blocked.`,
      tags: ["retry", "blocked"],
      createdAt: blockedTask.updatedAt,
      author: actor
    });
    await commitLedgerEvent(mission.id, "agent-os.execution.task.retry-exhausted", {
      missionId: mission.id,
      taskId: task.id,
      actor,
      attempts,
      reason
    });
    return { ok: false as const, error: "retry_exhausted", task: blockedTask };
  }

  const queuedTask: ExecutionTask = {
    ...task,
    status: "queued",
    updatedAt: now(),
    execution: {
      ...(task.execution ?? { commandHints: [], fileHints: [], attemptCount: attempts }),
      claimedBy: undefined,
      claimedAt: undefined,
      heartbeatAt: undefined,
      statusNote: `Queued for retry: ${reason}`
    },
    output: {
      ...(task.output ?? {}),
      retryReason: reason,
      continuityRecovery:
        task.governance?.route?.continuity === "degraded" || task.governance?.route?.continuity === "disconnected"
          ? {
              continuity: task.governance.route.continuity,
              delegatedAuthorityAnchor: task.governance.route.delegatedAuthorityAnchor,
              continuityReasoning: task.governance.route.continuityReasoning,
              delegationReasoning: task.governance.route.delegationReasoning
            }
          : undefined
    }
  };
  executionTasks.set(task.id, queuedTask);
  setAgentRuntimeStatus(task.assignedAgentId, "ready");
  ensureMissionMemory(mission.id).push({
    id: id("mem"),
    missionId: mission.id,
    kind: "decision",
    summary: `${task.title} queued for retry by ${actor}.`,
    tags: ["retry", "queued"],
    createdAt: queuedTask.updatedAt,
    author: actor
  });
  if (task.governance?.route?.continuity === "degraded" || task.governance?.route?.continuity === "disconnected") {
    ensureMissionMemory(mission.id).push({
      id: id("mem"),
      missionId: mission.id,
      kind: "handoff",
      summary: `${task.title} preserved ${task.governance.route.continuity} continuity under ${task.governance.route.delegatedAuthorityAnchor ?? task.governance.route.authorityAnchor} while awaiting retry.`,
      tags: ["continuity", "retry", task.governance.route.continuity],
      createdAt: queuedTask.updatedAt,
      author: "agent-os"
    });
  }
  await commitLedgerEvent(mission.id, "agent-os.execution.task.retry-queued", {
    missionId: mission.id,
    taskId: task.id,
    actor,
    attempts,
    reason,
    route: task.governance?.route,
    continuity: task.governance?.route?.continuity,
    delegatedAuthorityAnchor: task.governance?.route?.delegatedAuthorityAnchor
  });
  return { ok: true as const, task: queuedTask };
};

const assessToolActionProposal = (
  mission: OperatingMission,
  task: ExecutionTask,
  toolId: string,
  payload: Record<string, unknown>
) => {
  const evaluatedAt = now();
  const reasons: string[] = [];
  const matchingLease = missionToolLeases(mission.id).find((lease) => lease.toolId === toolId);
  const isPotentiallyDestructive = isPotentiallyDestructivePayload(payload);

  if (!task.requiredTools.includes(toolId)) {
    reasons.push(`Task is not authorized to use tool ${toolId}.`);
  }

  if (!matchingLease) {
    reasons.push(`Mission does not hold an active lease for tool ${toolId}.`);
  }

  const sensitiveConstraints = matchingLease?.constraints.filter((constraint) =>
    /destructive|manual approval|required/i.test(constraint)
  ) ?? [];
  if (isPotentiallyDestructive && sensitiveConstraints.length > 0) {
    reasons.push(`Tool action requires operator approval: ${sensitiveConstraints.join("; ")}.`);
  }

  return {
    status: reasons.length === 0 ? "approved" : "blocked",
    reasons: reasons.length === 0 ? [`Tool action approved for ${toolId}.`] : reasons,
    evaluatedAt
  } satisfies Pick<ToolAction, "governance">["governance"];
};

const assessToolActionExecutionGovernance = async (
  mission: OperatingMission,
  task: ExecutionTask,
  action: ToolAction
) => {
  const evaluatedAt = now();
  const reasons: string[] = [];
  const killSwitchState = await readKillSwitchState();
  const assignedAgent = agents.get(action.agentId);
  const matchingLease = missionToolLeases(mission.id).find((lease) => lease.toolId === action.toolId);
  const isPotentiallyDestructive = isPotentiallyDestructivePayload(action.payload);

  if (killSwitchState === "active") reasons.push("Kill switch active.");
  if (!assignedAgent) reasons.push("Tool action agent is unavailable.");
  if (!task.requiredTools.includes(action.toolId)) reasons.push(`Task is not authorized to use tool ${action.toolId}.`);
  if (!matchingLease) reasons.push(`Mission does not hold an active lease for tool ${action.toolId}.`);

  const sensitiveConstraints =
    matchingLease?.constraints.filter((constraint) => /destructive|manual approval|required/i.test(constraint)) ?? [];
  if (isPotentiallyDestructive && sensitiveConstraints.length > 0) {
    reasons.push(`Tool action requires operator approval: ${sensitiveConstraints.join("; ")}.`);
  }

  let policyCompileId: string | undefined;
  let envelopeId: string | undefined;
  let warrantId: string | undefined;
  let commitDecisionId: string | undefined;
  let route: AuthorityRoute | undefined;

  if (reasons.length === 0) {
    try {
      const policyName = `${mission.governanceProfile}:${action.kind}:${action.toolId}`;
      const policyText = buildMissionPolicyText(mission);
      const envelopePayload = {
        actor: "agent-os",
        issuer: selectMissionAuthorityAnchor(mission),
        domain: mission.targetSystem,
        subject: action.agentId,
        action: `tool-action:${action.kind}:${action.toolId}`,
        permittedEffects: [`tool-action.execute.${action.id}`],
        constraints: {
          missionId: mission.id,
          taskId: task.id,
          actionId: action.id,
          governanceProfile: mission.governanceProfile,
          riskLevel: mission.riskLevel,
          toolId: action.toolId,
          actionKind: action.kind
        }
      };
      const [compile, envelopeResult] = await Promise.all([
        compilePolicyArtifact(policyName, policyText),
        validateEnvelopeArtifact(envelopePayload)
      ]);
      policyCompileId = compile.compileId;
      envelopeId = envelopeResult.envelopeId;
      if (!compile.valid) {
        reasons.push(...(compile.errors.length ? compile.errors : ["Policy compile failed for tool action."]));
      }
      if (!envelopeResult.allowed || !envelopeId) {
        reasons.push(envelopeResult.reason ?? "Tool action envelope validation failed.");
      }
    } catch {
      reasons.push("Governance services unavailable during tool action artifact preparation.");
    }
  }

  if (reasons.length === 0 && envelopeId) {
    try {
      route = await resolveAuthorityRoute(mission, {
        phase: "tool-action",
        subject: action.agentId,
        targetId: action.id,
        actionSummary: action.summary,
        task,
        action
      });
    } catch (error) {
      reasons.push(error instanceof Error ? error.message : "Authority routing unavailable for tool action.");
    }
  }

  if (reasons.length === 0 && envelopeId) {
    try {
      const admissibilityResponse = await fetch(`${governanceKernelBase}/evaluate-admissibility`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          envelopeId,
          policyCompileId,
          missionId: mission.id,
          targetNode: mission.targetSystem,
          agentId: action.agentId,
          deviceId: task.execution?.workspaceId ?? mission.workspaceId
        })
      });
      const admissibility = (await admissibilityResponse.json()) as { admissible?: boolean; reasons?: string[] };
      if (!admissibilityResponse.ok || !admissibility.admissible) {
        reasons.push(...(admissibility.reasons?.length ? admissibility.reasons : ["Tool action is not admissible."]));
      }
    } catch {
      reasons.push("Governance kernel unavailable during tool action admissibility evaluation.");
    }
  }

  if (reasons.length === 0 && envelopeId) {
    try {
      const warrantResponse = await fetch(`${governanceKernelBase}/issue-warrant`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          envelopeId,
          missionId: mission.id,
          targetNode: mission.targetSystem,
          agentId: action.agentId,
          deviceId: task.execution?.workspaceId ?? mission.workspaceId,
          witnessRequired: false
        })
      });
      const warrant = (await warrantResponse.json()) as { id?: string; error?: string };
      warrantId = warrant.id;
      if (!warrantResponse.ok || !warrantId) {
        reasons.push(warrant.error ?? "Execution warrant issuance failed for tool action.");
      }
    } catch {
      reasons.push("Governance kernel unavailable during tool action warrant issuance.");
    }
  }

  if (reasons.length === 0 && envelopeId && warrantId) {
    try {
      const commitPointResponse = await fetch(`${executionGateBase}/commit-point`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          warrantId,
          envelopeId,
          witnessAccepted: true,
          witnessRequired: false,
          identityLegitimate: Boolean(assignedAgent),
          authorityApproved: true,
          telemetrySatisfied: true,
          phase: "tool-action",
          targetType: "tool-action",
          targetId: action.id,
          missionId: mission.id,
          domain: mission.targetSystem,
          targetNode: mission.targetSystem,
          agentId: action.agentId,
          deviceId: task.execution?.workspaceId ?? mission.workspaceId
        })
      });
      const commitDecision = (await commitPointResponse.json()) as {
        id?: string;
        decision?: "allow" | "deny" | "halt";
        reasons?: string[];
      };
      commitDecisionId = commitDecision.id;
      if (!commitPointResponse.ok || commitDecision.decision !== "allow" || !commitDecisionId) {
        reasons.push(...(commitDecision.reasons?.length ? commitDecision.reasons : ["Tool action commit point denied execution."]));
      }
    } catch {
      reasons.push("Execution gate unavailable during tool action commit point.");
    }
  }

  // GOVERNANCE_CHAIN_V2: route the tool action through the kernel's Commit Gate.
  // ToolAction.governance is a shared-types shape we deliberately do not modify,
  // so the chain verdict is surfaced via enforce-mode reasons + a ledger record
  // (cross-referencing the kernel GEL) rather than attached to the object.
  if (governanceChainClient && (governanceChainClient.mode === "shadow" || reasons.length === 0)) {
    const chain = await governanceChainClient.commitToolAct({
      mission,
      task,
      action,
      killSwitchActive: killSwitchState === "active"
    });
    if (governanceChainClient.mode === "enforce") {
      if (!chain.ran) {
        reasons.push(`Ward/Warrant chain unavailable (fail-closed): ${chain.error ?? "unknown"}.`);
      } else if (chain.decision !== "Allow") {
        reasons.push(...(chain.reasons?.length ? chain.reasons : [`Ward/Warrant chain returned ${chain.decision}.`]));
      }
    }
    await commitLedgerEvent(mission.id, "agent-os.tool-action.chain", {
      missionId: mission.id,
      taskId: task.id,
      actionId: action.id,
      toolId: action.toolId,
      kind: action.kind,
      chainMode: chain.mode,
      chainRan: chain.ran,
      chainDecision: chain.decision,
      chainWarrantId: chain.warrant_id,
      gelRecordId: chain.gel_record_id,
      wardId: chain.ward_id,
      reasons: chain.reasons
    });
  }

  return {
    status: reasons.length === 0 ? "approved" : "blocked",
    reasons: reasons.length === 0 ? [`Tool action approved at commit point for ${action.toolId}.`] : reasons,
    evaluatedAt,
    policyCompileId,
    envelopeId,
    warrantId,
    commitDecisionId,
    witnessStatus: "not-required" as const,
    route
  } satisfies Pick<ToolAction, "governance">["governance"];
};

const assessTaskGovernance = async (
  mission: OperatingMission,
  task: ExecutionTask,
  phase: "dispatch" | "completion"
): Promise<GovernanceDecision> => {
  const evaluatedAt = now();
  const reasons: string[] = [];
  const killSwitchState = await readKillSwitchState();
  const assignedAgent = agents.get(task.assignedAgentId);
  const activeLeases = missionToolLeases(mission.id);
  const missingLeaseTools = task.requiredTools.filter(
    (toolId) => !activeLeases.some((lease) => lease.toolId === toolId)
  );

  if (killSwitchState === "active") {
    reasons.push("Kill switch active.");
  }
  if (!assignedAgent) {
    reasons.push("Assigned agent is unavailable.");
  }

  if (!mission.requiredAuthorities.length) {
    reasons.push("Mission has no declared authority chain.");
  }

  if (missingLeaseTools.length > 0) {
    reasons.push(`Missing leased tools: ${missingLeaseTools.join(", ")}.`);
  }

  const constrainedLeases = activeLeases.filter((lease) => task.requiredTools.includes(lease.toolId));
  const violatedConstraints = constrainedLeases
    .flatMap((lease) =>
      lease.constraints
        .filter((constraint) => /destructive|manual approval|required/i.test(constraint))
        .map((constraint) => `${lease.toolId}: ${constraint}`)
    );
  const requiresOperatorApproval =
    Boolean(task.input.requiresOperatorApproval) ||
    (mission.riskLevel === "high" && /implementation|deploy|mutation|release/i.test(task.title));

  if (mission.riskLevel === "high" && assignedAgent?.trustTier === "sandboxed") {
    reasons.push("High-risk mission requires a delegated or privileged execution agent.");
  }

  if (phase === "completion" && task.status !== "running") {
    reasons.push("Only running tasks can be finalized.");
  }

  if (violatedConstraints.length > 0 && phase === "dispatch" && requiresOperatorApproval) {
    reasons.push(`Tool constraints require operator review before dispatch: ${violatedConstraints.join("; ")}.`);
  }

  let policyCompileId: string | undefined;
  let envelopeId: string | undefined;
  let warrantId: string | undefined;
  let commitDecisionId: string | undefined;
  let route: AuthorityRoute | undefined;

  if (reasons.length === 0) {
    try {
      const policyName = `${mission.governanceProfile}:${task.title}`;
      const policyText = buildMissionPolicyText(mission);
      const envelopePayload = {
        actor: "agent-os",
        issuer: selectMissionAuthorityAnchor(mission),
        domain: mission.targetSystem,
        subject: task.assignedAgentId,
        action: `${phase}:${task.title}`,
        permittedEffects: [`task.${phase}.${task.id}`],
        constraints: {
          missionId: mission.id,
          governanceProfile: mission.governanceProfile,
          riskLevel: mission.riskLevel,
          requiredAuthorities: mission.requiredAuthorities,
          requiredTools: task.requiredTools
        }
      };
      const [compile, envelopeResult] = await Promise.all([
        compilePolicyArtifact(policyName, policyText),
        validateEnvelopeArtifact(envelopePayload)
      ]);
      policyCompileId = compile.compileId;
      envelopeId = envelopeResult.envelopeId;
      if (!compile.valid) {
        reasons.push(...(compile.errors.length ? compile.errors : ["Policy compile failed."]));
      }
      if (!envelopeResult.allowed || !envelopeId) {
        reasons.push(envelopeResult.reason ?? "Authority envelope validation failed.");
      }
    } catch {
      reasons.push("Governance services unavailable during task artifact preparation.");
    }
  }

  if (reasons.length === 0 && envelopeId) {
    try {
      route = await resolveAuthorityRoute(mission, {
        phase,
        subject: task.assignedAgentId,
        targetId: task.id,
        actionSummary: task.title,
        task
      });
    } catch (error) {
      reasons.push(error instanceof Error ? error.message : "Authority routing unavailable.");
    }
  }

  if (reasons.length === 0 && envelopeId) {
    try {
      const admissibilityResponse = await fetch(`${governanceKernelBase}/evaluate-admissibility`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          envelopeId,
          policyCompileId,
          missionId: mission.id,
          targetNode: mission.targetSystem,
          agentId: task.assignedAgentId,
          deviceId: task.execution?.workspaceId ?? mission.workspaceId
        })
      });
      const admissibility = (await admissibilityResponse.json()) as { admissible?: boolean; reasons?: string[] };
      if (!admissibilityResponse.ok || !admissibility.admissible) {
        reasons.push(...(admissibility.reasons?.length ? admissibility.reasons : ["Execution is not admissible."]));
      }
    } catch {
      reasons.push("Governance kernel unavailable during admissibility check.");
    }
  }

  if (reasons.length === 0 && envelopeId) {
    try {
      const warrantResponse = await fetch(`${governanceKernelBase}/issue-warrant`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          envelopeId,
          missionId: mission.id,
          targetNode: mission.targetSystem,
          agentId: task.assignedAgentId,
          deviceId: task.execution?.workspaceId ?? mission.workspaceId,
          witnessRequired: mission.riskLevel === "high"
        })
      });
      const warrant = (await warrantResponse.json()) as { id?: string; error?: string };
      warrantId = warrant.id;
      if (!warrantResponse.ok || !warrantId) {
        reasons.push(warrant.error ?? "Execution warrant could not be issued.");
      }
    } catch {
      reasons.push("Governance kernel unavailable during warrant issuance.");
    }
  }

  if (reasons.length === 0 && envelopeId && warrantId) {
    try {
      const commitPointResponse = await fetch(`${executionGateBase}/commit-point`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          warrantId,
          envelopeId,
          witnessAccepted: true,
          witnessRequired: false,
          identityLegitimate: Boolean(assignedAgent),
          authorityApproved: true,
          telemetrySatisfied: missingLeaseTools.length === 0,
          telemetryReasons: missingLeaseTools.length > 0 ? [`Missing leased tools: ${missingLeaseTools.join(", ")}.`] : [],
          phase,
          targetType: "task",
          targetId: task.id,
          missionId: mission.id,
          domain: mission.targetSystem,
          targetNode: mission.targetSystem,
          agentId: task.assignedAgentId,
          deviceId: task.execution?.workspaceId ?? mission.workspaceId
        })
      });
      const commitDecision = (await commitPointResponse.json()) as {
        id?: string;
        decision?: "allow" | "deny" | "halt";
        reasons?: string[];
      };
      commitDecisionId = commitDecision.id;
      if (!commitPointResponse.ok || commitDecision.decision !== "allow") {
        reasons.push(...(commitDecision.reasons?.length ? commitDecision.reasons : ["Commit point execution gate denied action."]));
      }
    } catch {
      reasons.push("Execution gate unavailable during commit point validation.");
    }
  }

  // GOVERNANCE_CHAIN_V2: route the act through the kernel's Ward/Warrant Commit
  // Gate. In shadow mode the decision is recorded but never gates; in enforce
  // mode a non-Allow decision (or an unreachable chain) blocks the act fail-closed.
  let chain: ChainCommitResult | undefined;
  // Dispatch acts run through the chain here. Completion acts are committed in
  // finalizeGovernedCompletion AFTER witness verification, so the witness duty is
  // enforced against the real outcome. Dispatch never carries a witness obligation.
  if (governanceChainClient && phase === "dispatch" && (governanceChainClient.mode === "shadow" || reasons.length === 0)) {
    chain = await governanceChainClient.commitTaskAct({
      mission,
      task,
      phase,
      killSwitchActive: killSwitchState === "active",
      witnessRequired: false,
      witnessAccepted: true,
      missingLeaseTools
    });
    if (governanceChainClient.mode === "enforce") {
      if (!chain.ran) {
        reasons.push(`Ward/Warrant chain unavailable (fail-closed): ${chain.error ?? "unknown"}.`);
      } else if (chain.decision !== "Allow") {
        reasons.push(...(chain.reasons?.length ? chain.reasons : [`Ward/Warrant chain returned ${chain.decision}.`]));
      }
    }
  }

  return {
    status: reasons.length === 0 ? "approved" : "blocked",
    reasons: reasons.length === 0 ? [`Task ${phase} approved under governed admissibility.`] : reasons,
    evaluatedAt,
    policyCompileId,
    envelopeId,
    warrantId,
    commitDecisionId,
    route,
    chain
  };
};

const blockTaskForGovernance = async (
  mission: OperatingMission,
  task: ExecutionTask,
  governance: GovernanceDecision,
  phase: "dispatch" | "completion"
) => {
  const blockedTask: ExecutionTask = {
    ...task,
    status: "blocked",
    governance,
    updatedAt: governance.evaluatedAt,
    output: {
      summary: `${task.title} blocked during ${phase}.`,
      reasons: governance.reasons
    }
  };
  executionTasks.set(task.id, blockedTask);
  setAgentRuntimeStatus(task.assignedAgentId, "ready");
  ensureMissionMemory(mission.id).push({
    id: id("mem"),
    missionId: mission.id,
    kind: "risk",
    summary: `${task.title} blocked by governance: ${governance.reasons.join(" ")}`,
    tags: ["execution", "governance", "blocked"],
    createdAt: governance.evaluatedAt,
    author: "agent-os"
  });
  createExecutionReceipt(
    mission.id,
    task.id,
    task.assignedAgentId,
    `${task.title} blocked by governance review.`,
    "blocked",
    [task.id, mission.id],
    [
      governance.policyCompileId,
      governance.envelopeId,
      governance.warrantId,
      governance.commitDecisionId,
      governance.witnessReceiptId,
      governance.decisionId,
      governance.finalityCertificateId
    ].filter((value): value is string => Boolean(value))
  );
  await commitLedgerEvent(mission.id, "agent-os.execution.task.blocked", {
    missionId: mission.id,
    taskId: task.id,
    assignedAgentId: task.assignedAgentId,
    title: task.title,
    phase,
    reasons: governance.reasons,
    policyCompileId: governance.policyCompileId,
    envelopeId: governance.envelopeId,
    warrantId: governance.warrantId,
    route: governance.route
  });
};

const finalizeGovernedCompletion = async (
  mission: OperatingMission,
  task: ExecutionTask,
  governance: GovernanceDecision
): Promise<GovernanceDecision> => {
  if (!governance.warrantId || !governance.envelopeId) {
    return {
      ...governance,
      status: "blocked",
      reasons: [...governance.reasons, "Completion requires both a warrant and an authority envelope."],
      witnessStatus: "unsatisfied"
    };
  }

  const witnessRequired = mission.riskLevel === "high";
  let witnessReceipt: WitnessReceipt | null = null;

  if (witnessRequired) {
    try {
      const witnessResponse = await fetch(`${witnessServiceBase}/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          warrantId: governance.warrantId,
          envelopeId: governance.envelopeId
        })
      });
      witnessReceipt = (await witnessResponse.json()) as WitnessReceipt;
      if (!witnessResponse.ok || !witnessReceipt.accepted) {
        return {
          ...governance,
          status: "blocked",
          reasons: [...governance.reasons, "Witness quorum was not satisfied for completion."],
          witnessReceiptId: witnessReceipt.id,
          witnessStatus: witnessReceipt.accepted ? "satisfied" : "unsatisfied"
        };
      }
      await commitLedgerEvent(mission.id, "agent-os.execution.task.witnessed", {
        missionId: mission.id,
        taskId: task.id,
        witnessReceipt,
        route: governance.route
      });
    } catch {
      return {
        ...governance,
        status: "blocked",
        reasons: [...governance.reasons, "Witness service unavailable during completion."],
        witnessStatus: "unsatisfied"
      };
    }
  }

  try {
    const decisionResponse = await fetch(`${executionGateBase}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
        body: JSON.stringify({
          warrantId: governance.warrantId,
          envelopeId: governance.envelopeId,
          witnessAccepted: witnessReceipt ? witnessReceipt.accepted : true,
          witnessRequired,
          missionId: mission.id,
          domain: mission.targetSystem,
          targetNode: mission.targetSystem,
          agentId: task.assignedAgentId,
          deviceId: task.execution?.workspaceId ?? mission.workspaceId
        })
      });
    const decision = (await decisionResponse.json()) as {
      id: string;
      decision: "allow" | "deny" | "halt";
      reasons: string[];
      witnessStatus: "satisfied" | "unsatisfied" | "not-required";
    };
    await commitLedgerEvent(mission.id, "agent-os.execution.task.decided", {
      missionId: mission.id,
      taskId: task.id,
      decision
    });

    if (!decisionResponse.ok || decision.decision !== "allow") {
      return {
        ...governance,
        status: "blocked",
        reasons: [...governance.reasons, ...(decision.reasons ?? ["Execution gate denied completion."])],
        witnessReceiptId: witnessReceipt?.id,
        decisionId: decision.id,
        witnessStatus: decision.witnessStatus
      };
    }

    // GOVERNANCE_CHAIN_V2: completion runs through the chain HERE — after witness
    // verification — so the witness obligation is enforced with the real outcome.
    let chain: ChainCommitResult | undefined;
    if (governanceChainClient) {
      const killSwitchActive = (await readKillSwitchState()) === "active";
      chain = await governanceChainClient.commitTaskAct({
        mission,
        task,
        phase: "completion",
        killSwitchActive,
        witnessRequired,
        witnessAccepted: witnessReceipt ? witnessReceipt.accepted : true,
        missingLeaseTools: []
      });
      if (governanceChainClient.mode === "enforce" && (!chain.ran || chain.decision !== "Allow")) {
        return {
          ...governance,
          status: "blocked",
          reasons: [
            ...governance.reasons,
            ...(chain.ran
              ? chain.reasons?.length
                ? chain.reasons
                : [`Ward/Warrant chain returned ${chain.decision}.`]
              : [`Ward/Warrant chain unavailable (fail-closed): ${chain.error ?? "unknown"}.`])
          ],
          witnessReceiptId: witnessReceipt?.id,
          decisionId: decision.id,
          witnessStatus: decision.witnessStatus,
          chain
        };
      }
    }

    const finalityCertificate: FinalityCertificate = {
      id: id("fin"),
      artifactType: "finality-certificate",
      timestamp: now(),
      actor: "agent-os",
      decisionId: decision.id,
      warrantId: governance.warrantId,
      receiptIds: [witnessReceipt?.id].filter((value): value is string => Boolean(value)),
      ledgerCommitIndex: -1,
      verification: { status: "verified", verifier: "agent-os", reason: "Witness and execution gate approved completion." }
    };

    const finalityCommit = await fetch(`${ledgerBase}/events/commit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actor: "agent-os",
        eventKind: "agent-os.execution.task.finalized",
        traceId: mission.id,
        payload: {
          missionId: mission.id,
          taskId: task.id,
          finalityCertificate,
          route: governance.route
        }
      })
    }).then((response) => response.json() as Promise<{ index?: number }>).catch(() => ({ index: undefined }));
    finalityCertificate.ledgerCommitIndex = finalityCommit.index ?? -1;

    return {
      ...governance,
      reasons: [...governance.reasons, "Witness and finality obligations satisfied."],
      witnessReceiptId: witnessReceipt?.id,
      decisionId: decision.id,
      finalityCertificateId: finalityCertificate.id,
      witnessStatus: decision.witnessStatus,
      status: "approved",
      evaluatedAt: now(),
      chain
    };
  } catch {
    return {
      ...governance,
      status: "blocked",
      reasons: [...governance.reasons, "Execution gate unavailable during completion."],
      witnessReceiptId: witnessReceipt?.id,
      witnessStatus: witnessReceipt ? "satisfied" : "not-required"
    };
  }
};

const dispatchNextEligibleTask = async (
  mission: OperatingMission,
  dispatchReason = "Dispatched by agent-os execution loop.",
  selector?: (task: ExecutionTask) => boolean
) => {
  const timestamp = now();
  const nextQueued = selectNextQueuedTask(undefined, mission.id, selector)?.task;
  if (!nextQueued) {
    return undefined;
  }

  const governance = await assessTaskGovernance(mission, nextQueued, "dispatch");
  updateTaskGovernance(nextQueued.id, governance);
  if (governance.status === "blocked") {
    await blockTaskForGovernance(mission, nextQueued, governance, "dispatch");
    return executionTasks.get(nextQueued.id);
  }

  const claimedTask = claimTaskForAgent(
    {
      ...nextQueued,
      governance
    },
    nextQueued.assignedAgentId,
    dispatchReason
  );
  prewarmTaskGovernanceArtifacts(mission, claimedTask, "completion");
  ensureMissionMemory(mission.id).push({
    id: id("mem"),
    missionId: mission.id,
    kind: "handoff",
    summary: `Task ${nextQueued.title} dispatched to ${nextQueued.assignedAgentId}.`,
    tags: ["execution", "dispatch"],
    createdAt: timestamp,
    author: "agent-os"
  });
  await commitLedgerEvent(mission.id, "agent-os.execution.task.dispatched", {
    missionId: mission.id,
    taskId: nextQueued.id,
    assignedAgentId: nextQueued.assignedAgentId,
    title: nextQueued.title,
    policyCompileId: governance.policyCompileId,
    envelopeId: governance.envelopeId,
    warrantId: governance.warrantId,
    route: governance.route,
    wardId: governance.chain?.ward_id,
    chainWarrantId: governance.chain?.warrant_id,
    chainDecision: governance.chain?.decision,
    gelRecordId: governance.chain?.gel_record_id,
    ...agentIdentityContext(nextQueued.assignedAgentId),
    ...workspaceIdentityContext(nextQueued.execution?.workspaceId ?? mission.workspaceId)
  });
  return claimedTask;
};

const completeTaskWithGovernance = async (
  mission: OperatingMission,
  task: ExecutionTask,
  options?: {
    summary?: string;
    output?: Record<string, unknown>;
    evidenceRefs?: string[];
    actor?: string;
  }
) => {
  const timestamp = now();
  const queuedTaskReleaseState = new Map(
    missionTasks(mission.id)
      .filter((candidate) => candidate.status === "queued")
      .map((candidate) => [candidate.id, Boolean(candidate.coordination?.releaseReady)])
  );
  const completionGovernance = await assessTaskGovernance(mission, task, "completion");
  const finalizedGovernance =
    completionGovernance.status === "approved"
      ? await finalizeGovernedCompletion(mission, task, completionGovernance)
      : completionGovernance;

  updateTaskGovernance(task.id, finalizedGovernance);
  if (finalizedGovernance.status === "blocked") {
    await blockTaskForGovernance(mission, task, finalizedGovernance, "completion");
    return { ok: false as const, governance: finalizedGovernance, task: executionTasks.get(task.id) ?? task };
  }

  const completedTask: ExecutionTask = {
    ...task,
    status: "completed",
    updatedAt: timestamp,
    governance: finalizedGovernance,
    execution: releaseTaskClaim(task),
    output: {
      summary: options?.summary ?? `${task.title} completed under mission ${mission.title}.`,
      completionSignal: "execution_receipt_emitted",
      ...(options?.output ?? {})
    }
  };
  executionTasks.set(completedTask.id, completedTask);
  setAgentRuntimeStatus(completedTask.assignedAgentId, "ready");
  createExecutionReceipt(
    mission.id,
    completedTask.id,
    completedTask.assignedAgentId,
    options?.summary ?? `${completedTask.title} completed successfully.`,
    "success",
    options?.evidenceRefs ?? [completedTask.id, mission.id],
    [
      finalizedGovernance.policyCompileId,
      finalizedGovernance.envelopeId,
      finalizedGovernance.warrantId,
      finalizedGovernance.commitDecisionId,
      finalizedGovernance.witnessReceiptId,
      finalizedGovernance.decisionId,
      finalizedGovernance.finalityCertificateId
    ].filter((value): value is string => Boolean(value))
  );
  ensureMissionMemory(mission.id).push({
    id: id("mem"),
    missionId: mission.id,
    kind: "artifact",
    summary: options?.summary ?? `${completedTask.title} completed by ${options?.actor ?? completedTask.assignedAgentId}.`,
    tags: ["execution", "completion"],
    createdAt: timestamp,
    author: options?.actor ?? "agent-os"
  });
  await commitLedgerEvent(mission.id, "agent-os.execution.task.completed", {
    missionId: mission.id,
    taskId: completedTask.id,
    assignedAgentId: completedTask.assignedAgentId,
    title: completedTask.title,
    policyCompileId: finalizedGovernance.policyCompileId,
    envelopeId: finalizedGovernance.envelopeId,
    warrantId: finalizedGovernance.warrantId,
    commitDecisionId: finalizedGovernance.commitDecisionId,
    witnessReceiptId: finalizedGovernance.witnessReceiptId,
    decisionId: finalizedGovernance.decisionId,
    finalityCertificateId: finalizedGovernance.finalityCertificateId,
    actor: options?.actor,
    route: finalizedGovernance.route,
    ...agentIdentityContext(completedTask.assignedAgentId),
    ...workspaceIdentityContext(completedTask.execution?.workspaceId ?? mission.workspaceId)
  });
  const updatedMission = syncMissionDerivedState(mission.id);
  let dispatchedTask: ExecutionTask | undefined;
  if (updatedMission && (updatedMission.status === "active" || updatedMission.status === "planned")) {
    const queuedTasks = missionTasks(mission.id).filter((candidate) => candidate.status === "queued");
    const newlyReleasedTasks = queuedTasks.filter(
      (candidate) => candidate.coordination?.releaseReady && !queuedTaskReleaseState.get(candidate.id)
    );
    for (const releasedTask of newlyReleasedTasks) {
      ensureMissionMemory(mission.id).push({
        id: id("mem"),
        missionId: mission.id,
        kind: "handoff",
        summary: `${releasedTask.title} released for ${releasedTask.coordination?.phase ?? "execution"} after ${completedTask.title} satisfied ${releasedTask.coordination?.releaseCondition ?? "its dependency condition"}.`,
        tags: ["execution", "release", releasedTask.coordination?.phase ?? "unspecified"],
        createdAt: releasedTask.coordination?.readyAt ?? timestamp,
        author: "agent-os"
      });
    }
    for (const queuedTask of queuedTasks) {
      prewarmTaskGovernanceArtifacts(updatedMission, queuedTask, "dispatch");
    }
    for (const releasedTask of newlyReleasedTasks) {
      await commitLedgerEvent(mission.id, "agent-os.execution.task.released", {
        missionId: mission.id,
        taskId: releasedTask.id,
        releasedByTaskId: completedTask.id,
        phase: releasedTask.coordination?.phase,
        releaseCondition: releasedTask.coordination?.releaseCondition,
        readyAt: releasedTask.coordination?.readyAt
      });
    }
    dispatchedTask = await dispatchNextEligibleTask(updatedMission, "Dispatched after governed completion.");
  }
  return { ok: true as const, governance: finalizedGovernance, task: completedTask, dispatchedTask };
};

const deriveMissionStatusFromTasks = (mission: OperatingMission, tasks: ExecutionTask[] = missionTasks(mission.id)) => {
  if (mission.status === "halted") return "halted" as const;
  if (mission.status === "completed" && tasks.length === 0) return "completed" as const;
  const blockedTaskCount = tasks.filter((task) => task.status === "blocked" || task.status === "cancelled").length;
  const queuedTaskCount = tasks.filter((task) => task.status === "queued").length;
  const runningTaskCount = tasks.filter((task) => task.status === "running").length;

  if (blockedTaskCount > 0) return "blocked" as const;
  if (tasks.length > 0 && queuedTaskCount === 0 && runningTaskCount === 0) return "completed" as const;
  if (mission.status === "planned" && tasks.length === 0) return "planned" as const;
  return "active" as const;
};

const deriveMissionStepsFromTasks = (mission: OperatingMission, tasks: ExecutionTask[] = missionTasks(mission.id)) => {
  const prepareTasks = tasks.filter((task) => task.coordination?.phase === "prepare");
  const executeTasks = tasks.filter((task) => task.coordination?.phase === "execute");
  const auditTasks = tasks.filter((task) => task.coordination?.phase === "audit");
  type StepStatus = MissionStep["status"];

  const summarizePhase = (phaseTasks: ExecutionTask[], fallbackPending: StepStatus = "pending") => {
    if (phaseTasks.length === 0) return fallbackPending;
    if (phaseTasks.some((task) => task.status === "blocked" || task.status === "cancelled")) return "blocked" as StepStatus;
    if (phaseTasks.every((task) => task.status === "completed")) return "completed" as StepStatus;
    if (phaseTasks.some((task) => task.status === "running" || task.status === "completed")) return "in_progress" as StepStatus;
    return fallbackPending;
  };

  const prepareStatus: StepStatus = summarizePhase(prepareTasks, "in_progress");
  const executeStatus =
    prepareTasks.length > 0 && !prepareTasks.every((task) => task.status === "completed")
      ? ("pending" as StepStatus)
      : summarizePhase(executeTasks, mission.status === "planned" ? "pending" : "in_progress");
  const auditStatus =
    executeTasks.length > 0 && !executeTasks.every((task) => task.status === "completed")
      ? ("pending" as StepStatus)
      : summarizePhase(auditTasks, "pending");

  return mission.steps.map((step, index) => {
    if (index === 0) return { ...step, status: "completed" as const };
    if (index === 1) return { ...step, status: prepareStatus };
    if (index === 2) {
      const governanceStatus: StepStatus =
        auditStatus === "completed" ? "completed" : auditStatus === "in_progress" ? "in_progress" : "pending";
      return { ...step, status: governanceStatus };
    }
    if (index === 3) {
      const executionStatus: StepStatus =
        executeStatus === "completed" && auditStatus === "completed"
          ? "completed"
          : executeStatus === "blocked" || auditStatus === "blocked"
            ? "blocked"
            : executeStatus === "in_progress" || executeStatus === "completed"
              ? "in_progress"
              : "pending";
      return { ...step, status: executionStatus };
    }
    return step;
  });
};

const syncMissionDerivedState = (missionId: string) => {
  const mission = missions.get(missionId);
  if (!mission) return undefined;
  const tasks = missionTasks(missionId);

  for (const task of tasks) {
    const dependencyState = taskDependencyState(task);
    const coordination = task.coordination;
    if (!coordination) continue;

    const nextReadyAt =
      dependencyState.satisfied && task.status === "queued"
        ? coordination.readyAt ?? now()
        : undefined;
    const nextBlockedByTaskIds =
      dependencyState.blockedByTaskIds.length > 0
        ? dependencyState.blockedByTaskIds
        : dependencyState.incompleteDependencyIds.length > 0
          ? dependencyState.incompleteDependencyIds
          : [];

    executionTasks.set(task.id, {
      ...task,
      coordination: {
        ...coordination,
        blockedByTaskIds: nextBlockedByTaskIds,
        releaseReady: dependencyState.satisfied,
        readyAt: nextReadyAt
      }
    });
  }

  const refreshedTasks = missionTasks(missionId);
  const nextStatus = deriveMissionStatusFromTasks(mission, refreshedTasks);
  const nextSteps = deriveMissionStepsFromTasks(mission, refreshedTasks);
  const updatedMission: OperatingMission = {
    ...mission,
    status: nextStatus,
    steps: nextSteps,
    updatedAt: now()
  };
  missions.set(missionId, updatedMission);

  const workspace = findMissionWorkspace(missionId);
  if (workspace) {
    const nextWorkspaceState =
      nextStatus === "completed" ? "sealed" : nextStatus === "halted" || nextStatus === "blocked" ? "paused" : "active";
    workspaces.set(workspace.id, {
      ...workspace,
      state: nextWorkspaceState,
      lastActiveAt: updatedMission.updatedAt
    });
  }

  return updatedMission;
};

type TaskSelectionCandidate = {
  task: ExecutionTask;
  mission: OperatingMission;
  missionStatus: "planned" | "active" | "blocked" | "completed" | "halted";
  workspaceState?: WorkspaceSession["state"];
  missionUpdatedAt: number;
  taskCreatedAt: number;
};

type MissionSelectionContext = {
  mission: OperatingMission;
  missionStatus: TaskSelectionCandidate["missionStatus"];
  workspaceState?: WorkspaceSession["state"];
  missionUpdatedAt: number;
};

const evaluateTaskSelectionCandidate = (
  task: ExecutionTask,
  requestedAgentId?: string,
  selectionContext?: MissionSelectionContext
): TaskSelectionCandidate | undefined => {
  if (task.status !== "queued") return undefined;
  if (requestedAgentId && task.assignedAgentId !== requestedAgentId) return undefined;

  const mission = selectionContext?.mission ?? missions.get(task.missionId);
  if (!mission) return undefined;

  const missionStatus = selectionContext?.missionStatus ?? deriveMissionStatusFromTasks(mission);
  if (missionStatus !== "active" && missionStatus !== "planned") return undefined;

  const workspaceState = selectionContext?.workspaceState ?? findMissionWorkspace(mission.id)?.state;
  if (workspaceState === "paused" || workspaceState === "sealed") return undefined;

  const governanceStatus = task.governance ? normalizeGovernanceDecision(task.governance).status : undefined;
  if (governanceStatus === "blocked") return undefined;

  const dependencySatisfied =
    task.coordination?.releaseReady ?? taskDependencyState(task).satisfied;
  if (!dependencySatisfied) return undefined;

  const assignedAgent = agents.get(task.assignedAgentId);
  if (!assignedAgent || assignedAgent.status === "offline") return undefined;

  return {
    task,
    mission,
    missionStatus,
    workspaceState,
    missionUpdatedAt: selectionContext?.missionUpdatedAt ?? parseTimestamp(mission.updatedAt),
    taskCreatedAt: parseTimestamp(task.createdAt)
  };
};

const compareTaskSelectionCandidates = (left: TaskSelectionCandidate, right: TaskSelectionCandidate) => {
  const missionStatusWeight = (status: TaskSelectionCandidate["missionStatus"]) => (status === "active" ? 0 : 1);
  const workspaceStateWeight = (state?: WorkspaceSession["state"]) => (state === "active" ? 0 : 1);

  return (
    missionStatusWeight(left.missionStatus) - missionStatusWeight(right.missionStatus) ||
    workspaceStateWeight(left.workspaceState) - workspaceStateWeight(right.workspaceState) ||
    right.missionUpdatedAt - left.missionUpdatedAt ||
    left.taskCreatedAt - right.taskCreatedAt
  );
};

const selectNextQueuedTask = (
  requestedAgentId?: string,
  missionId?: string,
  selector?: (task: ExecutionTask) => boolean
) => {
  const selectionContexts = new Map<string, MissionSelectionContext>();

  return [...executionTasks.values()]
    .filter((task) => (missionId ? task.missionId === missionId : true))
    .filter((task) => (selector ? selector(task) : true))
    .map((task) => {
      let context = selectionContexts.get(task.missionId);
      if (!context) {
        const mission = missions.get(task.missionId);
        if (!mission) return undefined;
        context = {
          mission,
          missionStatus: deriveMissionStatusFromTasks(mission),
          workspaceState: findMissionWorkspace(mission.id)?.state,
          missionUpdatedAt: parseTimestamp(mission.updatedAt)
        };
        selectionContexts.set(task.missionId, context);
      }
      return evaluateTaskSelectionCandidate(task, requestedAgentId, context);
    })
    .filter((candidate): candidate is TaskSelectionCandidate => Boolean(candidate))
    .sort(compareTaskSelectionCandidates)[0];
};

const explainTaskIneligibility = (task: ExecutionTask, requestedAgentId?: string) => {
  const reasons: string[] = [];

  if (task.status !== "queued") reasons.push(`task status ${task.status} is not claimable`);
  if (requestedAgentId && task.assignedAgentId !== requestedAgentId) {
    reasons.push(`task is assigned to ${task.assignedAgentId}, not ${requestedAgentId}`);
  }

  const mission = missions.get(task.missionId);
  if (!mission) {
    reasons.push("mission not found");
    return reasons;
  }

  const missionStatus = deriveMissionStatusFromTasks(mission);
  if (missionStatus !== "active" && missionStatus !== "planned") {
    reasons.push(`mission status ${missionStatus} is not dispatchable`);
  }

  const workspace = findMissionWorkspace(mission.id);
  if (workspace?.state === "paused" || workspace?.state === "sealed") {
    reasons.push(`workspace state ${workspace.state} is not execution-ready`);
  }

  const governanceStatus = task.governance ? normalizeGovernanceDecision(task.governance).status : undefined;
  if (governanceStatus === "blocked") reasons.push("task already carries a blocked governance decision");

  const blockedByTaskIds = task.coordination?.blockedByTaskIds ?? [];
  const dependencyState = blockedByTaskIds.length === 0 && task.coordination?.releaseReady ? undefined : taskDependencyState(task);
  const blockedOrWaitingIds = blockedByTaskIds.length > 0 ? blockedByTaskIds : dependencyState?.incompleteDependencyIds ?? [];
  if (blockedByTaskIds.length > 0) {
    reasons.push(`release condition blocked by ${blockedByTaskIds.join(", ")}`);
  } else if ((task.coordination?.releaseReady ?? false) === false && blockedOrWaitingIds.length > 0) {
    reasons.push(`release condition waiting on ${blockedOrWaitingIds.join(", ")}`);
  }

  const assignedAgent = agents.get(requestedAgentId ?? task.assignedAgentId);
  if (!assignedAgent) {
    reasons.push("assigned agent not found");
  } else if (assignedAgent.status === "offline") {
    reasons.push(`agent ${assignedAgent.id} is offline`);
  }

  return reasons;
};

const reconcileRecoveredState = async () => {
  const timestamp = now();
  const touchedMissionIds = new Set<string>();
  const requeuedTaskIds: string[] = [];
  const revokedLeaseIds: string[] = [];

  for (const task of [...executionTasks.values()]) {
    if (task.status === "running") {
      const continuityRecovery =
        task.governance?.route?.continuity === "degraded" || task.governance?.route?.continuity === "disconnected"
          ? {
              continuity: task.governance.route.continuity,
              delegatedAuthorityAnchor: task.governance.route.delegatedAuthorityAnchor,
              continuityReasoning: task.governance.route.continuityReasoning,
              delegationReasoning: task.governance.route.delegationReasoning
            }
          : undefined;
      executionTasks.set(task.id, {
        ...task,
        status: "queued",
        updatedAt: timestamp,
        output: {
          ...(task.output ?? {}),
          recovery: "Task was re-queued after runtime restart reconciliation.",
          continuityRecovery
        }
      });
      requeuedTaskIds.push(task.id);
      touchedMissionIds.add(task.missionId);
      if (continuityRecovery) {
        ensureMissionMemory(task.missionId).push({
          id: id("mem"),
          missionId: task.missionId,
          kind: "handoff",
          summary: `${task.title} resumed in ${continuityRecovery.continuity} continuity under ${continuityRecovery.delegatedAuthorityAnchor ?? task.governance?.route?.authorityAnchor} after runtime recovery.`,
          tags: ["recovery", "continuity", continuityRecovery.continuity],
          createdAt: timestamp,
          author: "agent-os"
        });
      }
    }

    if (task.status === "completed" && !hasReceiptForTask(task.id, "success")) {
      createExecutionReceipt(
        task.missionId,
        task.id,
        task.assignedAgentId,
        `${task.title} recovered as completed from persisted state.`,
        "success",
        [task.id, task.missionId],
        task.governance
          ? [
              task.governance.policyCompileId,
              task.governance.envelopeId,
              task.governance.warrantId,
              task.governance.witnessReceiptId,
              task.governance.decisionId,
              task.governance.finalityCertificateId
            ].filter((value): value is string => Boolean(value))
          : []
      );
      touchedMissionIds.add(task.missionId);
    }
  }

  for (const mission of [...missions.values()]) {
    const missionStatus = deriveMissionStatusFromTasks(mission);
    const recoveredStepStatus = deriveMissionStepsFromTasks(mission);

    if (missionStatus !== mission.status || requeuedTaskIds.some((taskId) => executionTasks.get(taskId)?.missionId === mission.id)) {
      missions.set(mission.id, {
        ...mission,
        status: missionStatus,
        steps: recoveredStepStatus,
        updatedAt: timestamp
      });
      touchedMissionIds.add(mission.id);
    }

    const workspace = findMissionWorkspace(mission.id);
    if (workspace) {
      const nextWorkspaceState =
        missionStatus === "completed" ? "sealed" : missionStatus === "halted" || missionStatus === "blocked" ? "paused" : "active";
      if (workspace.state !== nextWorkspaceState) {
        workspaces.set(workspace.id, {
          ...workspace,
          state: nextWorkspaceState,
          lastActiveAt: timestamp
        });
      }
    }
  }

  for (const lease of [...toolLeases.values()]) {
    const mission = missions.get(lease.missionId);
    const expired = Boolean(lease.expiresAt && lease.expiresAt <= timestamp);
    const shouldRevoke = expired || mission?.status === "completed" || mission?.status === "halted";
    if (shouldRevoke && lease.state !== "revoked") {
      toolLeases.set(lease.id, {
        ...lease,
        state: "revoked"
      });
      revokedLeaseIds.push(lease.id);
      touchedMissionIds.add(lease.missionId);
    }
  }

  const runningTaskAgents = new Set(
    [...executionTasks.values()].filter((task) => task.status === "running").map((task) => task.assignedAgentId)
  );
  for (const agent of [...agents.values()]) {
    const nextStatus = runningTaskAgents.has(agent.id)
      ? "busy"
      : agent.status === "offline"
        ? "offline"
        : agent.status === "degraded"
          ? "degraded"
          : "ready";
    if (agent.status !== nextStatus || requeuedTaskIds.length > 0) {
      agents.set(agent.id, {
        ...agent,
        status: nextStatus,
        lastHeartbeat: timestamp
      });
    }
  }

  for (const missionId of touchedMissionIds) {
    ensureMissionMemory(missionId).push({
      id: id("mem"),
      missionId,
      kind: "decision",
      summary: `Runtime recovered persisted state on restart. Re-queued ${requeuedTaskIds.filter((taskId) => executionTasks.get(taskId)?.missionId === missionId).length} in-flight tasks and revoked ${revokedLeaseIds.filter((leaseId) => toolLeases.get(leaseId)?.missionId === missionId).length} leases.`,
      tags: ["recovery", "reconciliation"],
      createdAt: timestamp,
      author: "agent-os"
    });
  }

  if (touchedMissionIds.size > 0) {
    for (const missionId of touchedMissionIds) {
      await commitLedgerEvent(missionId, "agent-os.runtime.reconciled", {
        missionId,
        requeuedTaskIds: requeuedTaskIds.filter((taskId) => executionTasks.get(taskId)?.missionId === missionId),
        revokedLeaseIds: revokedLeaseIds.filter((leaseId) => toolLeases.get(leaseId)?.missionId === missionId),
        continuityRecoveredTaskIds: requeuedTaskIds.filter((taskId) => {
          const task = executionTasks.get(taskId);
          return Boolean(
            task?.missionId === missionId &&
              (task.output as { continuityRecovery?: unknown } | undefined)?.continuityRecovery
          );
        }),
        recoveredAt: timestamp
      });
    }
    await schedulePersist();
  }
};

const reconcileStaleRunningTasks = async () => {
  const timestamp = Date.now();
  for (const task of [...executionTasks.values()]) {
    if (task.status !== "running") continue;
    const heartbeatAt = parseTimestamp(task.execution?.heartbeatAt ?? task.updatedAt);
    if (Number.isNaN(heartbeatAt) || timestamp - heartbeatAt < heartbeatTimeoutMs) continue;
    await queueTaskRetry(
      task,
      "agent-os",
      `Worker heartbeat exceeded timeout window of ${Math.round(heartbeatTimeoutMs / 1000)}s.`
    );
  }
};

const autonomousSafeTools = new Set(["ledger", "policy", "witness", "simulation", "planning", "docs"]);

const isAutonomouslyDispatchableTask = (task: ExecutionTask) =>
  task.status === "queued" &&
  (task.ownerRole === "auditor" || task.ownerRole === "planner" || task.coordination?.phase === "audit") &&
  task.requiredTools.every((toolId) => autonomousSafeTools.has(toolId));

const isAutonomouslyCompletableTask = (task: ExecutionTask) =>
  task.status === "running" &&
  (task.ownerRole === "auditor" || task.ownerRole === "planner" || task.coordination?.phase === "audit") &&
  task.requiredTools.every((toolId) => autonomousSafeTools.has(toolId));

const runAutonomyTick = async () => {
  if (autonomyLoopRunning) return;
  autonomyLoopRunning = true;
  try {
    await reconcileStaleRunningTasks();
    for (const mission of [...missions.values()]) {
      if (mission.status !== "active" && mission.status !== "planned") continue;
      let runningTask = missionTasks(mission.id).find((task) => isAutonomouslyCompletableTask(task));
      if (!runningTask) {
        const anyRunningTask = missionTasks(mission.id).some((task) => task.status === "running");
        if (!anyRunningTask) {
          const dispatchedTask = await dispatchNextEligibleTask(
            mission,
            "Dispatched by autonomous governed continuity loop.",
            isAutonomouslyDispatchableTask
          );
          runningTask = dispatchedTask && isAutonomouslyCompletableTask(dispatchedTask) ? dispatchedTask : undefined;
        }
      }
      if (!runningTask) continue;

      await completeTaskWithGovernance(mission, runningTask, {
        actor: "agent-os.autonomy",
        summary: `${runningTask.title} completed by autonomous governed continuity loop.`,
        output: {
          completionSignal: "autonomy_tick",
          autonomyMode: "non-actuating"
        },
        evidenceRefs: [runningTask.id, `${runningTask.id}:autonomy`]
      });

      await commitLedgerEvent(mission.id, "agent-os.execution.task.autonomous-completed", {
        missionId: mission.id,
        taskId: runningTask.id,
        assignedAgentId: runningTask.assignedAgentId,
        phase: runningTask.coordination?.phase,
        route: runningTask.governance?.route,
        autonomyMode: "non-actuating"
      });
    }
    await schedulePersist();
  } finally {
    autonomyLoopRunning = false;
  }
};

const seedMissionExecutionTasks = async (mission: OperatingMission) => {
  const existing = missionTasks(mission.id);
  if (existing.length > 0) return existing;

  const contextTask = createExecutionTask(
    mission,
    "Assemble workspace context bundle",
    "executor",
    ["editor", "ledger"],
    { objective: mission.objective, workspaceId: mission.workspaceId },
    {
      phase: "prepare",
      dependsOnTaskIds: [],
      releaseCondition: "workspace context required before implementation"
    }
  );

  const implementationTask = createExecutionTask(
    mission,
    "Run governed implementation pass",
    "executor",
    mission.requiredTools,
    { targetSystem: mission.targetSystem, successMetrics: mission.successMetrics },
    {
      phase: "execute",
      dependsOnTaskIds: [contextTask.id],
      releaseCondition: `context bundle ${contextTask.id} must complete before implementation can dispatch`
    }
  );

  const auditTask = createExecutionTask(
    mission,
    "Audit evidence and release recommendation",
    "auditor",
    ["ledger", "policy"],
    { governanceProfile: mission.governanceProfile },
    {
      phase: "audit",
      dependsOnTaskIds: [implementationTask.id],
      releaseCondition: `implementation task ${implementationTask.id} must complete before audit can dispatch`
    }
  );

  const tasks = [contextTask, implementationTask, auditTask];

  ensureMissionMemory(mission.id).push({
    id: id("mem"),
    missionId: mission.id,
    kind: "artifact",
    summary: `Execution queue created with ${tasks.length} tasks.`,
    tags: ["execution", "queue"],
    createdAt: now(),
    author: "agent-os"
  });

  await commitLedgerEvent(mission.id, "agent-os.execution.queue.created", {
    missionId: mission.id,
    taskIds: tasks.map((task) => task.id),
    titles: tasks.map((task) => task.title),
    dependencyGraph: tasks.map((task) => ({
      taskId: task.id,
      phase: task.coordination?.phase,
      dependsOnTaskIds: task.coordination?.dependsOnTaskIds ?? [],
      releaseCondition: task.coordination?.releaseCondition
    }))
  });

  for (const task of tasks) {
    prewarmTaskGovernanceArtifacts(mission, task, "dispatch");
  }

  return tasks;
};

const progressExecutionLoop = async (mission: OperatingMission, action: string) => {
  const tasks = missionTasks(mission.id);

  if (action === "execute") {
    if (tasks.length === 0) {
      await seedMissionExecutionTasks(mission);
    }
    await dispatchNextEligibleTask(mission);
  }

  if (action === "progress" || action === "complete") {
    const running = tasks.find((task) => task.status === "running");
    if (running) {
      await completeTaskWithGovernance(mission, running);
    }

    if (!running && action !== "complete") {
      await dispatchNextEligibleTask(mission);
    }
  }

  if (action === "halt") {
    const timestamp = now();
    for (const task of missionTasks(mission.id)) {
      if (task.status === "queued" || task.status === "running") {
        executionTasks.set(task.id, { ...task, status: "cancelled", updatedAt: timestamp });
        setAgentRuntimeStatus(task.assignedAgentId, "ready");
        createExecutionReceipt(
          mission.id,
          task.id,
          task.assignedAgentId,
          `${task.title} halted by operator action.`,
          "halted",
          [task.id, mission.id]
        );
        await commitLedgerEvent(mission.id, "agent-os.execution.task.halted", {
          missionId: mission.id,
          taskId: task.id,
          assignedAgentId: task.assignedAgentId,
          title: task.title
        });
      }
    }
  }

  if (action === "complete") {
    for (const task of missionTasks(mission.id)) {
      if (task.status === "queued") {
        const dispatchGovernance = await assessTaskGovernance(mission, task, "dispatch");
        updateTaskGovernance(task.id, dispatchGovernance);
        if (dispatchGovernance.status === "blocked") {
          await blockTaskForGovernance(mission, task, dispatchGovernance, "dispatch");
          continue;
        }

        const runningTask = claimTaskForAgent(
          {
            ...task,
            governance: dispatchGovernance
          },
          task.assignedAgentId,
          "Mission completion sweep."
        );

        await completeTaskWithGovernance(mission, runningTask, {
          summary: `${task.title} auto-finalized during mission completion.`,
          output: {
            completionSignal: "mission_closed"
          }
        });
      }
    }
  }
};

await loadState();
await reconcileRecoveredState();
await reconcileStaleRunningTasks();
setInterval(() => {
  void runAutonomyTick().catch((error) => {
    console.error("agent-os autonomy tick failed", error);
  });
}, autonomyTickMs);

app.get("/health", (_req, res) =>
  res.json({
    ok: true,
    service: "agent-os",
    persistedStatePath: statePath,
    missions: missions.size,
    agents: agents.size,
    executionTasks: executionTasks.size,
    autonomyTickMs
  })
);
app.get("/state", (_req, res) => res.json(snapshot()));

// GET /missions + POST /missions are mounted from ./routes/missions.ts
// (stage 10 of prototype-hardening). /missions/:missionId/advance still
// lives inline because it depends on progressExecutionLoop +
// ~10 more helpers; deferred to a follow-on stage.
mountMissionsRoutes(app, {
  missions, workspaces, toolLeases,
  id, now, fingerprint, createMissionSteps,
  ensureMissionMemory, schedulePersist
});

app.get("/tasks/next", (req, res) => {
  const agentId = typeof req.query.agentId === "string" ? req.query.agentId : undefined;
  const task = selectNextQueuedTask(agentId)?.task;
  if (!task) return res.status(404).json({ error: "task_not_found" });
  res.json(task);
});
app.get("/tasks/:taskId/actions", (req, res) => {
  const task = executionTasks.get(req.params.taskId);
  if (!task) return res.status(404).json({ error: "task_not_found" });
  res.json({ items: taskToolActions(task.id) });
});
app.post("/tasks/:taskId/claim", async (req, res) => {
  const task = executionTasks.get(req.params.taskId);
  if (!task) return res.status(404).json({ error: "task_not_found" });

  const mission = missions.get(task.missionId);
  if (!mission) return res.status(404).json({ error: "mission_not_found" });

  const agentId = req.body.agentId ?? task.assignedAgentId;
  if (!agents.has(agentId)) return res.status(404).json({ error: "agent_not_found" });
  const ineligibilityReasons = explainTaskIneligibility(task, agentId);
  if (ineligibilityReasons.length > 0) {
    return res.status(409).json({ error: "task_not_eligible", reasons: ineligibilityReasons, task });
  }

  const governance = task.governance
    ? normalizeGovernanceDecision(task.governance)
    : await assessTaskGovernance(mission, task, "dispatch");
  updateTaskGovernance(task.id, governance);
  if (governance.status === "blocked") {
    await blockTaskForGovernance(mission, task, governance, "dispatch");
    return res.status(409).json({ error: "task_blocked", task: executionTasks.get(task.id) });
  }

  const claimedTask = claimTaskForAgent(
    {
      ...task,
      assignedAgentId: agentId,
      governance
    },
    agentId,
    req.body.statusNote ?? "Claimed by worker runtime."
  );
  prewarmTaskGovernanceArtifacts(mission, claimedTask, "completion");
  ensureMissionMemory(mission.id).push({
    id: id("mem"),
    missionId: mission.id,
    kind: "handoff",
    summary: `Task ${claimedTask.title} claimed by ${agentId}.`,
    tags: ["execution", "claim"],
    createdAt: claimedTask.updatedAt,
    author: agentId
  });
  await renewMissionLeases(mission.id, agentId, "task claimed for active execution");
  await commitLedgerEvent(mission.id, "agent-os.execution.task.claimed", {
    missionId: mission.id,
    taskId: claimedTask.id,
    ...agentIdentityContext(agentId),
    ...workspaceIdentityContext(claimedTask.execution?.workspaceId ?? mission.workspaceId)
  });
  await schedulePersist();
  res.json(claimedTask);
});
app.post("/tasks/:taskId/actions", async (req, res) => {
  const task = executionTasks.get(req.params.taskId);
  if (!task) return res.status(404).json({ error: "task_not_found" });

  const mission = missions.get(task.missionId);
  if (!mission) return res.status(404).json({ error: "mission_not_found" });

  const agentId = req.body.agentId ?? task.execution?.claimedBy ?? task.assignedAgentId;
  if (task.execution?.claimedBy && task.execution.claimedBy !== agentId) {
    return res.status(409).json({ error: "task_claim_owned_by_another_agent" });
  }

  const toolId = req.body.toolId ?? req.body.kind;
  const governance = assessToolActionProposal(mission, task, toolId, req.body.payload ?? {});
  const timestamp = now();
  const action: ToolAction = {
    id: req.body.id ?? id("toolact"),
    missionId: mission.id,
    taskId: task.id,
    agentId,
    kind: req.body.kind ?? "read",
    toolId,
    status: governance?.status === "approved" ? "approved" : "rejected",
    summary: req.body.summary ?? `${toolId} action proposed for ${task.title}.`,
    payload: req.body.payload ?? {},
    constraints:
      missionToolLeases(mission.id).find((lease) => lease.toolId === toolId)?.constraints ?? ["no explicit constraints recorded"],
    governance,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  toolActions.set(action.id, action);
  if (action.status === "approved") {
    prewarmToolActionExecutionArtifacts(mission, task, action);
  }
  ensureMissionMemory(mission.id).push({
    id: id("mem"),
    missionId: mission.id,
    kind: governance?.status === "approved" ? "artifact" : "risk",
    summary: `${action.summary} Governance: ${governance?.reasons.join(" ")}`,
    tags: ["tool-action", action.kind, action.status],
    createdAt: timestamp,
    author: agentId
  });
  await commitLedgerEvent(mission.id, "agent-os.execution.tool-action.proposed", {
    missionId: mission.id,
    taskId: task.id,
    action,
    ...agentIdentityContext(agentId),
    ...workspaceIdentityContext(task.execution?.workspaceId ?? mission.workspaceId)
  });
  await schedulePersist();
  res.status(action.status === "approved" ? 201 : 409).json(action);
});
app.post("/tasks/:taskId/actions/:actionId/execute", async (req, res) => {
  const task = executionTasks.get(req.params.taskId);
  if (!task) return res.status(404).json({ error: "task_not_found" });

  const action = toolActions.get(req.params.actionId);
  if (!action || action.taskId !== task.id) return res.status(404).json({ error: "tool_action_not_found" });
  if (action.status !== "approved") return res.status(409).json({ error: "tool_action_not_approved", action });

  const mission = missions.get(task.missionId);
  if (!mission) return res.status(404).json({ error: "mission_not_found" });

  const governance = await assessToolActionExecutionGovernance(mission, task, action);
  if (governance.status === "blocked") {
    const blockedAction: ToolAction = {
      ...action,
      status: "rejected",
      governance,
      updatedAt: governance.evaluatedAt ?? now()
    };
    toolActions.set(blockedAction.id, blockedAction);
    ensureMissionMemory(task.missionId).push({
      id: id("mem"),
      missionId: task.missionId,
      kind: "risk",
      summary: `${blockedAction.summary} blocked at commit point. ${governance.reasons.join(" ")}`,
      tags: ["tool-action", blockedAction.kind, "blocked"],
      createdAt: blockedAction.updatedAt,
      author: blockedAction.agentId
    });
  await commitLedgerEvent(task.missionId, "agent-os.execution.tool-action.blocked", {
    missionId: task.missionId,
    taskId: task.id,
    action: blockedAction,
    ...agentIdentityContext(blockedAction.agentId),
    ...workspaceIdentityContext(task.execution?.workspaceId ?? mission.workspaceId)
  });
    await schedulePersist();
    return res.status(409).json({ error: "tool_action_blocked", action: blockedAction });
  }

  const timestamp = now();
  const executedAction: ToolAction = {
    ...action,
    status: "executed",
    governance,
    updatedAt: timestamp,
    payload: {
      ...action.payload,
      executionResult: req.body.executionResult,
      evidenceRefs: req.body.evidenceRefs ?? []
    }
  };
  toolActions.set(executedAction.id, executedAction);
  ensureMissionMemory(task.missionId).push({
    id: id("mem"),
    missionId: task.missionId,
    kind: "artifact",
    summary: `${executedAction.summary} executed by ${executedAction.agentId}.`,
    tags: ["tool-action", executedAction.kind, "executed"],
    createdAt: timestamp,
    author: executedAction.agentId
  });
  await commitLedgerEvent(task.missionId, "agent-os.execution.tool-action.executed", {
    missionId: task.missionId,
    taskId: task.id,
    action: executedAction,
    ...agentIdentityContext(executedAction.agentId),
    ...workspaceIdentityContext(task.execution?.workspaceId ?? mission.workspaceId)
  });
  await schedulePersist();
  res.json(executedAction);
});
app.post("/tasks/:taskId/heartbeat", async (req, res) => {
  const task = executionTasks.get(req.params.taskId);
  if (!task) return res.status(404).json({ error: "task_not_found" });

  const agentId = req.body.agentId ?? task.execution?.claimedBy ?? task.assignedAgentId;
  if (task.execution?.claimedBy && task.execution.claimedBy !== agentId) {
    return res.status(409).json({ error: "task_claim_owned_by_another_agent" });
  }

  const updatedTask = updateTaskHeartbeat(task, agentId, req.body.statusNote);
  await renewMissionLeases(task.missionId, agentId, "task heartbeat");
  await schedulePersist();
  res.json(updatedTask);
});
app.post("/tasks/:taskId/complete", async (req, res) => {
  const task = executionTasks.get(req.params.taskId);
  if (!task) return res.status(404).json({ error: "task_not_found" });

  const mission = missions.get(task.missionId);
  if (!mission) return res.status(404).json({ error: "mission_not_found" });

  const agentId = req.body.agentId ?? task.execution?.claimedBy ?? task.assignedAgentId;
  if (task.execution?.claimedBy && task.execution.claimedBy !== agentId) {
    return res.status(409).json({ error: "task_claim_owned_by_another_agent" });
  }

  const runningTask =
    task.status === "running"
      ? updateTaskHeartbeat(task, agentId, req.body.statusNote ?? "Completion submitted by worker runtime.")
      : claimTaskForAgent(task, agentId, req.body.statusNote ?? "Completion submitted by worker runtime.");

  const result = await completeTaskWithGovernance(mission, runningTask, {
    summary: req.body.summary,
    output: req.body.output,
    evidenceRefs: req.body.evidenceRefs,
    actor: agentId
  });
  await schedulePersist();
  res.status(result.ok ? 200 : 409).json(result);
});
app.post("/reconcile", async (_req, res) => {
  await reconcileRecoveredState();
  await reconcileStaleRunningTasks();
  res.json({ ok: true, snapshot: snapshot() });
});
app.post("/autonomy/tick", async (_req, res) => {
  await runAutonomyTick();
  res.json({ ok: true, snapshot: snapshot() });
});
app.post("/tasks/:taskId/retry", async (req, res) => {
  const task = executionTasks.get(req.params.taskId);
  if (!task) return res.status(404).json({ error: "task_not_found" });

  const result = await queueTaskRetry(task, req.body.actor ?? "operator", req.body.reason ?? "manual retry requested");
  await schedulePersist();
  res.status(result.ok ? 200 : result.error === "retry_exhausted" ? 409 : 404).json(result);
});
app.post("/leases/:leaseId/renew", async (req, res) => {
  const lease = toolLeases.get(req.params.leaseId);
  if (!lease) return res.status(404).json({ error: "lease_not_found" });
  const renewed = await renewMissionLeases(
    lease.missionId,
    req.body.actor ?? lease.agentId,
    req.body.reason ?? `manual lease renewal for ${lease.toolId}`,
    365 * 24 * 60 * 60 * 1000,
    Number(req.body.extensionMs ?? leaseExtensionMs)
  );
  await schedulePersist();
  res.json({ renewed });
});

app.post("/agents/register", async (req, res) => {
  const timestamp = now();
  const agent: AgentCapability = {
    id: req.body.id ?? id("agent"),
    name: req.body.name ?? "Unnamed Agent",
    role: req.body.role ?? "executor",
    status: req.body.status ?? "ready",
    model: req.body.model ?? "unknown",
    provider: req.body.provider ?? "unknown",
    specializations: req.body.specializations ?? [],
    toolchains: req.body.toolchains ?? [],
    trustTier: req.body.trustTier ?? "sandboxed",
    maxConcurrency: req.body.maxConcurrency ?? 1,
    workspaceAffinity: req.body.workspaceAffinity,
    deviceId: req.body.deviceId,
    identityFingerprint: req.body.identityFingerprint ?? fingerprint("agentfp", req.body.id ?? "agent"),
    verificationStatus: req.body.verificationStatus ?? "verified",
    lastHeartbeat: timestamp
  };
  agents.set(agent.id, agent);
  await schedulePersist();
  res.status(201).json(agent);
});

app.post("/workspaces", async (req, res) => {
  const timestamp = now();
  const workspace: WorkspaceSession = {
    id: req.body.id ?? id("ws"),
    missionId: req.body.missionId ?? "unassigned",
    state: req.body.state ?? "prepared",
    cwd: req.body.cwd ?? "/workspace",
    branchName: req.body.branchName ?? `codex/${req.body.missionId ?? "mission"}`,
    memoryNamespace: req.body.memoryNamespace ?? `mission.${req.body.missionId ?? "shared"}`,
    attachedAgents: req.body.attachedAgents ?? [],
    deviceFingerprint: req.body.deviceFingerprint ?? fingerprint("devicefp", req.body.id ?? "workspace"),
    verificationStatus: req.body.verificationStatus ?? "verified",
    createdAt: timestamp,
    lastActiveAt: timestamp
  };
  workspaces.set(workspace.id, workspace);
  await schedulePersist();
  res.status(201).json(workspace);
});

// POST /missions moved to ./routes/missions.ts in stage 10 (mounted above).
// /missions/:missionId/advance stays inline — see comment by mountMissionsRoutes.
app.post("/missions/:missionId/advance", async (req, res) => {
  const mission = missions.get(req.params.missionId);
  if (!mission) return res.status(404).json({ error: "mission_not_found" });

  const timestamp = now();
  const action = req.body.action ?? "progress";

  await progressExecutionLoop(mission, action);

  const taskSummary = missionTasks(mission.id);
  const completedTaskCount = taskSummary.filter((task) => task.status === "completed").length;
  const blockedTaskCount = taskSummary.filter((task) => task.status === "blocked" || task.status === "cancelled").length;
  const queuedTaskCount = taskSummary.filter((task) => task.status === "queued").length;
  const runningTaskCount = taskSummary.filter((task) => task.status === "running").length;
  let updatedMission = syncMissionDerivedState(mission.id) ?? missions.get(mission.id) ?? mission;
  if (action === "halt" && updatedMission.status !== "halted") {
    updatedMission = {
      ...updatedMission,
      status: "halted",
      updatedAt: timestamp
    };
    missions.set(updatedMission.id, updatedMission);

    const workspace = findMissionWorkspace(mission.id);
    if (workspace) {
      workspaces.set(workspace.id, {
        ...workspace,
        state: "paused",
        lastActiveAt: timestamp
      });
    }
  }

  ensureMissionMemory(mission.id).push({
    id: id("mem"),
    missionId: mission.id,
    kind: action === "halt" ? "risk" : "handoff",
    summary: `Mission advanced via action ${action}. ${completedTaskCount} execution tasks are complete.`,
    tags: ["advance", action],
    createdAt: timestamp,
    author: req.body.actor ?? "operator"
  });

  await schedulePersist();

  res.json({
    mission: updatedMission,
    execution: {
      tasks: missionTasks(mission.id),
      receipts: [...executionReceipts.values()].filter((receipt) => receipt.missionId === mission.id)
    },
    suggestedNextActions:
      updatedMission.status === "completed"
        ? ["seal workspace", "emit final evidence bundle", "archive mission memory"]
        : updatedMission.status === "halted"
          ? ["trigger kill switch review", "revoke tool leases", "escalate to operator"]
          : blockedTaskCount > 0
            ? ["inspect blocked execution task", "reassign agent", "escalate governance posture"]
            : runningTaskCount > 0
              ? ["await governed completion evidence", "renew leases as needed", "review active task receipts"]
              : queuedTaskCount > 0
                ? ["dispatch next released task", "inspect release conditions", "review dependency graph"]
                : ["dispatch next executor task", "record progress to ledger", "review execution receipts"]
  });
});

// ---------------------------------------------------------------------------
// Substrate-backed EdgeNode + Commit Gate (mesh-runtime + execution-control-runtime)
//
// This service also acts as a mesh EDGE: it accepts envelope
// propagation + revocation gossip + Fluidity Token issuance from
// the root and witnesses, and can issue local Warrants under a
// Fluidity Token during partition. /v1/mesh/evaluate also exposes
// the in-process Commit Gate for direct action evaluation.
// ---------------------------------------------------------------------------

const meshSecret = process.env.MESH_SECRET ?? "aos-demo-mesh-secret";
const meshHost = process.env.HOST_AGENT_OS ?? "127.0.0.1";
const edge = new EdgeNode({
  id: process.env.MESH_EDGE_ID ?? "edge-aos",
  host: meshHost,
  port,
  secret: meshSecret,
  urlFor: (t: NodeId) => `http://${t.host}:${t.port}/mesh`,
  maxWarrantsWhileDisconnected: Number(process.env.MESH_EDGE_QUOTA ?? 100)
});

const peerSpec = process.env.MESH_PEERS ?? "root-mae:127.0.0.1:7004,witness-mae:127.0.0.1:7007";
const peers: NodeId[] = peerSpec
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((spec) => {
    const [pid, phost, pportStr] = spec.split(":");
    return {
      id: pid,
      role: pid.startsWith("witness")
        ? ("witness" as const)
        : pid.startsWith("edge")
          ? ("edge" as const)
          : ("root" as const),
      host: phost,
      port: Number(pportStr)
    };
  });
edge.setPeers(peers);

// /healthz + /readyz mounted via the shared service-runtime helper
// after the EdgeNode + peers are constructed so the readiness closure
// can reference them. mountLegacyHealth: false because the legacy
// /health handler above already surfaces extra fields
// (persistedStatePath, missions, agents, executionTasks, autonomyTickMs)
// the operator UI and other services rely on.
mountHealthEndpoints(app, {
  service: "agent-os",
  mountLegacyHealth: false,
  readiness: () => ReadinessChecks.start()
    .addTry("mesh_signer", () => typeof edge.getId() === "string")
    .addPeersConfiguredCheck(peers.length)
    .addDemoSecretCheck(meshSecret)
    .build()
});

app.post("/mesh", async (req, res) => {
  try {
    const msg = req.body as MeshMessage;
    if (msg.from && edge.partitions.has(msg.from)) {
      return res.status(504).json({ ok: false, reason: "partitioned" });
    }
    const out = await edge.direct(msg);
    res.json(out);
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// Disconnected commit gate — issues a Warrant locally when the edge
// holds a valid Fluidity Token for the referenced envelope.
app.post("/v1/mesh/evaluate-disconnected", async (req, res) => {
  try {
    const commitReq = req.body as MeshCommitRequest;
    const decision = await edge.evaluate(commitReq);
    res.json({
      ok: true,
      decision
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// Connected commit gate — direct invocation of evaluateCommitGate.
app.post("/v1/mesh/evaluate", (req, res) => {
  try {
    const { ward, authorityEnvelope, action } = req.body as {
      ward: WardManifest;
      authorityEnvelope: SubstrateEnvelope;
      action: CanonicalActionInput;
    };
    if (!ward || !authorityEnvelope || !action) {
      return res.status(400).json({ ok: false, error: "missing_required_fields" });
    }
    const decision = evaluateCommitGate({ ward, authorityEnvelope, action, now: now() });
    res.json({ ok: true, decision });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/v1/mesh/reconcile", async (_req, res) => {
  try {
    const conflicts = await edge.reconcile();
    res.json({
      ok: true,
      conflicts_count: conflicts.length,
      conflicts
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/v1/mesh/state", (_req, res) => {
  res.json({
    ok: true,
    role: "edge",
    node_id: edge.getId(),
    peers,
    cached_envelopes: edge.cachedEnvelopeCount(),
    cached_revocations: edge.cachedRevocationCount(),
    valid_fluidity_tokens: edge.validFluidityTokens().length,
    local_decisions: edge.localDecisionCount(),
    partitions: [...edge.partitions]
  });
});

app.listen(port, () => console.log(`agent-os on ${port} (substrate-wired: EdgeNode at /mesh, Commit Gate at /v1/mesh/*)`));
