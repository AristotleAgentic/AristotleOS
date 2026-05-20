import { gatewayContract } from "./gateway-contract.js";

const operatorApiKey =
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_OPERATOR_API_KEY?.trim() ?? "";
const operatorActor =
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_OPERATOR_ACTOR?.trim() ?? "";
const operatorRole =
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_OPERATOR_ROLE?.trim() ?? "";
let operatorSessionToken = "";
let operatorSessionExpiresAt = 0;

export type HealthServiceResult =
  | {
      status: "fulfilled";
      value: {
        ok?: boolean;
        service?: string;
        tick?: number;
        autonomyTickMs?: number;
        killSwitchState?: "active" | "inactive";
        activeKillScopes?: Array<{
          state?: "active" | "inactive";
          scope?: "global" | "mission" | "domain" | "agent" | "device";
          scopeRef?: string;
        }>;
      };
    }
  | { status: "rejected"; reason: unknown };

export interface GatewayHealth {
  ok: boolean;
  services: HealthServiceResult[];
}

export interface SimulationTelemetry {
  tick: number;
  nodes: Array<{ id: string; status: "healthy" | "degraded"; load: number }>;
  missionTimeline: Array<{ tick: number; label: string; timestamp: string }>;
}

export interface LedgerTimeline {
  committed: Array<{
    id: string;
    eventKind: string;
    committed: boolean;
    payload: Record<string, unknown>;
    traceId?: string;
    timestamp: string;
    actor: string;
  }>;
  branches: Array<{
    id: string;
    label: string;
    status: "open" | "closed";
    timestamp: string;
  }>;
}

export interface LedgerArtifactList {
  items: Array<{
    id: string;
    artifactType:
      | "authority-envelope"
      | "execution-warrant"
      | "witness-receipt"
      | "execution-decision"
      | "finality-certificate"
      | "kill-switch-event"
      | "identity-attestation"
      | "autonomy-attestation"
      | "assurance-attestation"
      | "recovery-plan";
    timestamp: string;
    actor: string;
    missionId?: string;
    envelopeId?: string;
    warrantId?: string;
    decisionId?: string;
    subjectType?: "agent" | "device";
    subjectId?: string;
    issuerRef?: string;
    scope?: string;
    scopeRef?: string;
    autonomyMode?: "non-actuating" | "recovery" | "scheduled";
    continuity?: "stable" | "degraded" | "disconnected";
    delegatedAuthorityAnchor?: string;
    reportScope?: "system" | "mission";
    assurancePosture?: "insurable" | "conditional" | "blocked" | "halted";
    systemPosture?: "insurable" | "conditional" | "halted";
    reasons?: string[];
    attestedBy?: string;
    summary?: string;
    digest?: string;
    signatureAlgorithm?: "hmac-sha256" | "ed25519";
    signature?: string;
    verification?: {
      status: "verified" | "unverified" | "failed";
      verifier?: string;
      reason?: string;
    };
  }>;
}

export interface MetaAuthorityList {
  items: Array<{
    id: string;
    subject: string;
    domains: string[];
    delegationClass: string;
    verification?: { status: "verified" | "unverified" | "failed" };
  }>;
}

export interface AssuranceReport {
  generatedAt: string;
  systemPosture: "insurable" | "conditional" | "halted";
  systemReasons: string[];
  missions: Array<{
    missionId: string;
    title: string;
    status: string;
    targetSystem: string;
    blockedTasks: number;
    autonomyAttestations: number;
    finalityCertificates: number;
    agentVerified: boolean;
    deviceVerified: boolean;
    activeKillSwitch: boolean;
    activeKillScopes: Array<{
      scope?: "global" | "mission" | "domain" | "agent" | "device";
      scopeRef?: string;
    }>;
    assurancePosture: "insurable" | "conditional" | "blocked" | "halted";
    reasons: string[];
  }>;
}

export interface DeploymentPosture {
  generatedAt: string;
  mode: "development" | "production";
  operatorAuthEnabled: boolean;
  operatorSessionEnabled?: boolean;
  operatorSessionEnforced?: boolean;
  operatorSessionTtlMs?: number;
  roleEnforcementEnabled: boolean;
  defaultRole: string;
  readRoles: string[];
  mutationRoles: string[];
  readActors: string[];
  mutationActors: string[];
  serviceDiscoveryMode: string;
  serviceBases?: Record<string, string>;
  durableStateConfigured: boolean;
  insecureProductionOverride: boolean;
  preflight: {
    ok: boolean;
    mode: "development" | "production";
    checks: Array<{
      name: string;
      status: "pass" | "warn" | "fail";
      detail: string;
    }>;
  };
}

interface OperatorSessionResponse {
  token: string;
  tokenType: "Bearer";
  actor: string;
  role: string;
  issuedAt: string;
  expiresAt: string;
  sessionId: string;
}

export interface DeployableProfileCatalog {
  generatedAt: string;
  items: Array<{
    id: string;
    label: string;
    preferredTarget: string;
    authorityLane: string;
    actuationBoundary: string;
    objective: string;
    assuranceFocus: string;
  }>;
}

export interface EnvelopeList {
  items: Array<{
    id: string;
    issuer?: string;
    subject: string;
    domain: string;
    action: string;
    traceId?: string;
    verification?: {
      status: "verified" | "unverified" | "failed";
      reason?: string;
    };
  }>;
}

export interface AuthorityRoute {
  source: string;
  target: string;
  domain: string;
  phase: "dispatch" | "tool-action" | "completion";
  authorityAnchor: string;
  alternateAuthorityAnchor?: string;
  delegatedAuthorityAnchor?: string;
  selectedPath: string[];
  rejectedPath: string[];
  degradedNodes: string[];
  failoverReasoning: string;
  delegationReasoning: string;
  continuity: "stable" | "degraded" | "disconnected";
  continuityReasoning: string;
  recoverable: boolean;
  mode: "nominal" | "degraded" | "disconnected";
}

export interface AgentOSState {
  generatedAt: string;
  missions: Array<{
    id: string;
    title: string;
    objective: string;
    status: "draft" | "planned" | "active" | "blocked" | "completed" | "halted";
    priority: "low" | "medium" | "high" | "critical";
    riskLevel: "low" | "medium" | "high";
    targetSystem: string;
    governanceProfile: string;
    assignedAgents: string[];
    requiredTools: string[];
    requiredAuthorities: string[];
    successMetrics: string[];
    steps: Array<{
      id: string;
      title: string;
      status: "pending" | "in_progress" | "completed" | "blocked";
      ownerRole: "planner" | "executor" | "reviewer" | "auditor" | "operator";
      requiredTools: string[];
      completionSignal: string;
    }>;
    createdAt: string;
    updatedAt: string;
  }>;
  agents: Array<{
    id: string;
    name: string;
    role: "planner" | "executor" | "reviewer" | "auditor" | "operator";
    status: "ready" | "busy" | "degraded" | "offline";
    model: string;
    specializations: string[];
    toolchains: string[];
    trustTier: "sandboxed" | "delegated" | "privileged";
    deviceId?: string;
    identityFingerprint?: string;
    verificationStatus?: "verified" | "degraded" | "revoked";
  }>;
  toolLeases: Array<{
    id: string;
    toolId: string;
    missionId: string;
    agentId: string;
    state: "available" | "leased" | "revoked";
    constraints: string[];
  }>;
  workspaces: Array<{
    id: string;
    missionId: string;
    state: "prepared" | "active" | "paused" | "sealed";
    cwd: string;
    branchName: string;
    attachedAgents: string[];
    deviceFingerprint?: string;
    verificationStatus?: "verified" | "degraded" | "revoked";
  }>;
  memory: Array<{
    id: string;
    missionId: string;
    kind: "objective" | "decision" | "artifact" | "risk" | "handoff";
    summary: string;
    tags: string[];
    createdAt: string;
    author: string;
  }>;
  executionTasks: Array<{
    id: string;
    missionId: string;
    title: string;
    status: "queued" | "running" | "completed" | "blocked" | "cancelled";
    assignedAgentId: string;
    ownerRole: "planner" | "executor" | "reviewer" | "auditor" | "operator";
    requiredTools: string[];
    createdAt: string;
    updatedAt: string;
    output?: Record<string, unknown>;
    coordination?: {
      phase: "prepare" | "execute" | "audit";
      dependsOnTaskIds: string[];
      releaseCondition: string;
      blockedByTaskIds?: string[];
      releaseReady?: boolean;
      readyAt?: string;
    };
    execution?: {
      workspaceId?: string;
      cwd?: string;
      branchName?: string;
      commandHints: string[];
      fileHints: string[];
      claimedBy?: string;
      claimedAt?: string;
      heartbeatAt?: string;
      statusNote?: string;
      attemptCount: number;
    };
    governance?: {
      status: "pending" | "approved" | "blocked";
      reasons: string[];
      evaluatedAt?: string;
      policyCompileId?: string;
      envelopeId?: string;
      warrantId?: string;
      commitDecisionId?: string;
      witnessReceiptId?: string;
      decisionId?: string;
      finalityCertificateId?: string;
      witnessStatus?: "satisfied" | "unsatisfied" | "not-required";
      agentIdentityRef?: string;
      deviceIdentityRef?: string;
      route?: AuthorityRoute;
    };
  }>;
  executionReceipts: Array<{
    id: string;
    missionId: string;
    taskId: string;
    agentId: string;
    summary: string;
    outcome: "success" | "halted" | "blocked";
    evidenceRefs: string[];
    governanceRefs?: string[];
    createdAt: string;
  }>;
  toolActions: Array<{
    id: string;
    missionId: string;
    taskId: string;
    agentId: string;
    kind: "read" | "shell" | "edit" | "write";
    toolId: string;
    status: "proposed" | "approved" | "executed" | "rejected";
    summary: string;
    payload: Record<string, unknown>;
    constraints: string[];
    governance?: {
      status: "pending" | "approved" | "blocked";
      reasons: string[];
      evaluatedAt?: string;
      policyCompileId?: string;
      envelopeId?: string;
      warrantId?: string;
      commitDecisionId?: string;
      witnessStatus?: "satisfied" | "unsatisfied" | "not-required";
      agentIdentityRef?: string;
      deviceIdentityRef?: string;
      route?: AuthorityRoute;
    };
    createdAt: string;
    updatedAt: string;
  }>;
  posture: {
    readyAgents: number;
    activeMissions: number;
    blockedMissions: number;
    leasedTools: number;
  };
}

export interface OperatorSnapshot {
  health: GatewayHealth;
  mesh: SimulationTelemetry;
  ledger: LedgerTimeline;
  ledgerArtifacts: LedgerArtifactList;
  deployableProfiles: DeployableProfileCatalog;
  deploymentPosture: DeploymentPosture;
  assuranceReport: AssuranceReport;
  metaAuthority: MetaAuthorityList;
  envelopes: EnvelopeList;
  osState: AgentOSState;
}

export interface RegisterAgentInput {
  name: string;
  role: "planner" | "executor" | "reviewer" | "auditor" | "operator";
  model: string;
  provider: string;
  specializations: string[];
  toolchains: string[];
  trustTier: "sandboxed" | "delegated" | "privileged";
  maxConcurrency: number;
  workspaceAffinity?: string;
}

export interface CreateMissionInput {
  title: string;
  objective: string;
  priority: "low" | "medium" | "high" | "critical";
  riskLevel: "low" | "medium" | "high";
  governanceProfile: string;
  targetSystem: string;
  requiredAuthorities: string[];
  requiredTools: string[];
  successMetrics: string[];
  requestedBy?: string;
}

export interface AdvanceMissionInput {
  action: "progress" | "execute" | "complete" | "halt";
  actor?: string;
}

export interface LedgerQueryInput {
  traceId?: string;
  branchId?: string;
  relatedId?: string;
  artifactType?: LedgerArtifactList["items"][number]["artifactType"];
}

export interface CounterfactualProjection {
  branch: {
    id: string;
    label: string;
    status: "open" | "closed";
    timestamp: string;
  };
  projection: {
    branchSeed?: string;
    hypothetical: boolean;
    scenario: Record<string, unknown>;
    projectedOutcome: string;
    projectedRoute?: AuthorityRoute;
    projectedRecoveryPaths?: Array<{
      label: string;
      mode: "resume" | "reroute" | "delegate" | "escalate";
      scope?: string;
      scopeRef?: string;
      summary: string;
    }>;
  };
  hypothetical: {
    id: string;
    eventKind: string;
    committed: boolean;
    branchId?: string;
    payload: Record<string, unknown>;
  };
}

const toUrl = (gatewayBaseUrl: string | undefined, path: string) => {
  if (!gatewayBaseUrl) return path;
  const base = gatewayBaseUrl.endsWith("/") ? gatewayBaseUrl.slice(0, -1) : gatewayBaseUrl;
  return `${base}${path}`;
};

const ensureOperatorSession = async (gatewayBaseUrl: string | undefined): Promise<string> => {
  if (!operatorApiKey || !operatorActor || !operatorRole) {
    return "";
  }
  if (operatorSessionToken && operatorSessionExpiresAt > Date.now() + 30_000) {
    return operatorSessionToken;
  }
  const headers = new Headers();
  headers.set("x-operator-key", operatorApiKey);
  headers.set("x-operator-actor", operatorActor);
  headers.set("x-operator-role", operatorRole);
  const response = await fetch(toUrl(gatewayBaseUrl, "/operator/auth/session"), {
    method: "POST",
    headers
  });
  if (!response.ok) {
    throw new Error(`gateway session request failed with status ${response.status}`);
  }
  const session = (await response.json()) as OperatorSessionResponse;
  operatorSessionToken = session.token;
  operatorSessionExpiresAt = Date.parse(session.expiresAt) || 0;
  return operatorSessionToken;
};

const getJson = async <T>(gatewayBaseUrl: string | undefined, path: string, init?: RequestInit): Promise<T> => {
  const headers = new Headers(init?.headers);
  const sessionToken = await ensureOperatorSession(gatewayBaseUrl);
  if (sessionToken) {
    headers.set("authorization", `Bearer ${sessionToken}`);
    headers.set("x-operator-actor", operatorActor);
    headers.set("x-operator-role", operatorRole);
  } else {
    if (operatorApiKey) {
      headers.set("x-operator-key", operatorApiKey);
    }
    if (operatorActor) {
      headers.set("x-operator-actor", operatorActor);
    }
    if (operatorRole) {
      headers.set("x-operator-role", operatorRole);
    }
  }
  const response = await fetch(toUrl(gatewayBaseUrl, path), {
    ...init,
    headers
  });
  if (!response.ok) {
    throw new Error(`gateway request failed for ${path} with status ${response.status}`);
  }
  return response.json() as Promise<T>;
};

export const fetchOperatorSnapshot = async (gatewayBaseUrl?: string): Promise<OperatorSnapshot> => {
  const [health, mesh, ledger, ledgerArtifacts, deployableProfiles, deploymentPosture, assuranceReport, metaAuthority, envelopes, osState] = await Promise.all([
    getJson<GatewayHealth>(gatewayBaseUrl, gatewayContract.health),
    getJson<SimulationTelemetry>(gatewayBaseUrl, gatewayContract.mesh),
    getJson<LedgerTimeline>(gatewayBaseUrl, gatewayContract.ledger),
    getJson<LedgerArtifactList>(gatewayBaseUrl, gatewayContract.ledgerArtifacts),
    getJson<DeployableProfileCatalog>(gatewayBaseUrl, gatewayContract.deployables),
    getJson<DeploymentPosture>(gatewayBaseUrl, gatewayContract.deploymentPosture),
    getJson<AssuranceReport>(gatewayBaseUrl, gatewayContract.assuranceReport),
    getJson<MetaAuthorityList>(gatewayBaseUrl, gatewayContract.metaAuthority),
    getJson<EnvelopeList>(gatewayBaseUrl, gatewayContract.envelopes),
    getJson<AgentOSState>(gatewayBaseUrl, gatewayContract.osState)
  ]);

  return { health, mesh, ledger, ledgerArtifacts, deployableProfiles, deploymentPosture, assuranceReport, metaAuthority, envelopes, osState };
};

export const setGatewayKillSwitch = async (
  gatewayBaseUrl: string | undefined,
  state: "active" | "inactive",
  options: { scope?: "global" | "mission" | "domain" | "agent" | "device"; scopeRef?: string } = {}
) => {
  return getJson<{ state: "active" | "inactive"; reason: string }>(gatewayBaseUrl, gatewayContract.killSwitch, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      actor: "console-ui",
      reason: state === "active" ? "operator console halt requested" : "operator console reset requested",
      scope: options.scope ?? "global",
      scopeRef: options.scopeRef,
      state
    })
  });
};

export const registerAgent = async (gatewayBaseUrl: string | undefined, input: RegisterAgentInput) => {
  return getJson(gatewayBaseUrl, gatewayContract.registerAgent, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
};

export const createMission = async (gatewayBaseUrl: string | undefined, input: CreateMissionInput) => {
  return getJson(gatewayBaseUrl, gatewayContract.osMissions, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
};

export const advanceMission = async (
  gatewayBaseUrl: string | undefined,
  missionId: string,
  input: AdvanceMissionInput
) => {
  return getJson(gatewayBaseUrl, gatewayContract.advanceMission(missionId), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
};

export const triggerAutonomyTick = async (gatewayBaseUrl: string | undefined) => {
  return getJson<{ ok: boolean; snapshot: OperatorSnapshot }>(gatewayBaseUrl, gatewayContract.autonomyTick, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });
};

export const attestAssuranceReport = async (
  gatewayBaseUrl: string | undefined,
  input: { missionId?: string; actor?: string } = {}
) => {
  return getJson<{
    report: AssuranceReport;
    mission?: AssuranceReport["missions"][number];
    reportScope: "system" | "mission";
    committed: { id?: string; eventKind?: string };
  }>(gatewayBaseUrl, gatewayContract.assuranceAttest, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
};

export const fetchLedgerTimeline = async (gatewayBaseUrl: string | undefined, input: LedgerQueryInput = {}) => {
  const params = new URLSearchParams();
  if (input.traceId) params.set("traceId", input.traceId);
  if (input.branchId) params.set("branchId", input.branchId);
  if (input.relatedId) params.set("relatedId", input.relatedId);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return getJson<LedgerTimeline>(gatewayBaseUrl, `${gatewayContract.ledger}${suffix}`);
};

export const fetchLedgerArtifacts = async (gatewayBaseUrl: string | undefined, input: LedgerQueryInput = {}) => {
  const params = new URLSearchParams();
  if (input.traceId) params.set("traceId", input.traceId);
  if (input.branchId) params.set("branchId", input.branchId);
  if (input.relatedId) params.set("relatedId", input.relatedId);
  if (input.artifactType) params.set("artifactType", input.artifactType);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return getJson<LedgerArtifactList>(gatewayBaseUrl, `${gatewayContract.ledgerArtifacts}${suffix}`);
};

export const fetchLedgerArtifact = async (gatewayBaseUrl: string | undefined, artifactId: string) => {
  return getJson<LedgerArtifactList["items"][number]>(gatewayBaseUrl, gatewayContract.ledgerArtifact(artifactId));
};

export const projectCounterfactual = async (
  gatewayBaseUrl: string | undefined,
  input: Record<string, unknown>
) => {
  return getJson<CounterfactualProjection>(gatewayBaseUrl, gatewayContract.counterfactual, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
};

// --- GOVERNANCE_CHAIN_V2: the Ward/Warrant chain (additive; for comparison) ----

export interface GelRecordView {
  gel_record_id: string;
  sequence: number;
  previous_gel_hash: string;
  gel_record_hash: string;
  mae_id?: string;
  ward_id?: string;
  authority_envelope_id?: string;
  warrant_id?: string;
  commit_gate_id?: string;
  actor: string;
  action: string;
  decision: "Allow" | "Deny" | "Escalate" | "FailClosed";
  decision_reason: string;
  record_kind: "admissibility" | "execution";
  warrant_consumption_proof?: {
    warrant_id: string;
    nonce: string;
    consumed_at: string;
    prior_state: string;
    new_state: string;
  };
  timestamp: string;
}

export interface GovernanceChainLedger {
  /** False when GOVERNANCE_CHAIN_V2 is off (gateway returns 501) or unreachable. */
  enabled: boolean;
  count?: number;
  integrity?: { ok: boolean; violations?: Array<{ invariant: string; detail: string }> };
  records?: GelRecordView[];
  reason?: string;
}

/**
 * Read the kernel's hash-chained GEL ledger through the gateway. Resolves to
 * `{ enabled: false, reason }` rather than throwing when the chain is disabled or
 * unreachable, so the comparison view can render a clear "off" state.
 */
export const fetchGovernanceChainLedger = async (gatewayBaseUrl?: string): Promise<GovernanceChainLedger> => {
  try {
    const data = await getJson<{
      count: number;
      integrity: { ok: boolean; violations?: Array<{ invariant: string; detail: string }> };
      records: GelRecordView[];
    }>(gatewayBaseUrl, gatewayContract.governanceChainGel);
    return { enabled: true, count: data.count, integrity: data.integrity, records: data.records };
  } catch (e) {
    return { enabled: false, reason: e instanceof Error ? e.message : String(e) };
  }
};
