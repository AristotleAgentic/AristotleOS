export type ArtifactType = "meta-authority-artifact" | "authority-envelope" | "execution-warrant" | "witness-receipt" | "finality-certificate" | "lineage-certificate" | "execution-decision" | "kill-switch-event" | "recovery-plan" | "identity-attestation" | "autonomy-attestation" | "assurance-attestation" | "replay-event" | "counterfactual-branch";
export interface BaseArtifact {
    id: string;
    artifactType: ArtifactType;
    timestamp: string;
    actor: string;
    issuer?: string;
    digest?: string;
    signatureAlgorithm?: "hmac-sha256" | "ed25519";
    signature?: string;
    traceId?: string;
    chainId?: string;
    verification?: {
        status: "verified" | "unverified" | "failed";
        verifier?: string;
        reason?: string;
    };
}
export interface MetaAuthorityArtifact extends BaseArtifact {
    artifactType: "meta-authority-artifact";
    subject: string;
    domains: string[];
    delegationClass: string;
    parentAuthorityId?: string;
    constraints: Record<string, unknown>;
}
export interface AuthorityEnvelope extends BaseArtifact {
    artifactType: "authority-envelope";
    issuerChain: string[];
    domain: string;
    subject: string;
    action: string;
    validFrom: string;
    validUntil: string;
    permittedEffects: string[];
    constraints: Record<string, unknown>;
    metaAuthorityRef: string;
}
export interface ExecutionWarrant extends BaseArtifact {
    artifactType: "execution-warrant";
    envelopeId: string;
    admissibilityHash: string;
    missionId: string;
    targetNode: string;
    obligations: {
        witnessRequired: boolean;
        minQuorum?: number;
    };
}
export interface WitnessReceipt extends BaseArtifact {
    artifactType: "witness-receipt";
    warrantId: string;
    envelopeId: string;
    quorumRequired: number;
    quorumReached: number;
    witnesses: string[];
    accepted: boolean;
}
export interface FinalityCertificate extends BaseArtifact {
    artifactType: "finality-certificate";
    decisionId: string;
    warrantId: string;
    receiptIds: string[];
    ledgerCommitIndex: number;
}
export interface LineageCertificate extends BaseArtifact {
    artifactType: "lineage-certificate";
    modelId: string;
    version: string;
    parents: string[];
    trainingSources: string[];
    certificationStatus: "certified" | "revoked" | "pending";
}
export interface ExecutionDecision extends BaseArtifact {
    artifactType: "execution-decision";
    warrantId: string;
    envelopeId: string;
    phase?: "dispatch" | "tool-action" | "completion";
    targetType?: "task" | "tool-action" | "mission";
    targetId?: string;
    decision: "allow" | "deny" | "halt";
    reasons: string[];
    killSwitchState: "active" | "inactive";
    witnessStatus: "satisfied" | "unsatisfied" | "not-required";
}
export interface KillSwitchEvent extends BaseArtifact {
    artifactType: "kill-switch-event";
    state: "active" | "inactive";
    reason: string;
    scope: "global" | "mission" | "domain" | "agent" | "device";
    scopeRef?: string;
}
export interface RecoveryPlanArtifact extends BaseArtifact {
    artifactType: "recovery-plan";
    label: string;
    mode: "resume" | "reroute" | "delegate" | "escalate";
    summary: string;
    scope?: "global" | "mission" | "domain" | "agent" | "device";
    scopeRef?: string;
    branchRef?: string;
}
export interface IdentityAttestationArtifact extends BaseArtifact {
    artifactType: "identity-attestation";
    subjectType: "agent" | "device";
    subjectId: string;
    fingerprint: string;
    issuerRef: string;
    status: "verified" | "degraded" | "revoked";
    attributes: Record<string, unknown>;
}
export interface AutonomyAttestationArtifact extends BaseArtifact {
    artifactType: "autonomy-attestation";
    missionId: string;
    taskId?: string;
    autonomyMode: "non-actuating" | "recovery" | "scheduled";
    continuity?: "stable" | "degraded" | "disconnected";
    delegatedAuthorityAnchor?: string;
    summary: string;
}
export interface AssuranceAttestationArtifact extends BaseArtifact {
    artifactType: "assurance-attestation";
    reportScope: "system" | "mission";
    missionId?: string;
    systemPosture: "insurable" | "conditional" | "halted";
    assurancePosture?: "insurable" | "conditional" | "blocked" | "halted";
    targetSystem?: string;
    reasons: string[];
    attestedBy: string;
    summary: string;
}
export interface ReplayEvent extends BaseArtifact {
    artifactType: "replay-event";
    eventKind: string;
    committed: boolean;
    branchId?: string;
    payload: Record<string, unknown>;
}
export interface CounterfactualBranch extends BaseArtifact {
    artifactType: "counterfactual-branch";
    parentTraceId: string;
    label: string;
    status: "open" | "closed";
    hypothetical: true;
}
export type AgentRole = "planner" | "executor" | "reviewer" | "auditor" | "operator";
export type AgentStatus = "ready" | "busy" | "degraded" | "offline";
export type ToolLeaseState = "available" | "leased" | "revoked";
export type WorkspaceState = "prepared" | "active" | "paused" | "sealed";
export type MissionStatus = "draft" | "planned" | "active" | "blocked" | "completed" | "halted";
export type ExecutionTaskStatus = "queued" | "running" | "completed" | "blocked" | "cancelled";
export type GovernanceDecisionStatus = "pending" | "approved" | "blocked";
export type ToolActionKind = "read" | "shell" | "edit" | "write";
export type ToolActionStatus = "proposed" | "approved" | "executed" | "rejected";
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
export interface AgentCapability {
    id: string;
    name: string;
    role: AgentRole;
    status: AgentStatus;
    model: string;
    provider: string;
    specializations: string[];
    toolchains: string[];
    trustTier: "sandboxed" | "delegated" | "privileged";
    maxConcurrency: number;
    workspaceAffinity?: string;
    deviceId?: string;
    identityFingerprint?: string;
    verificationStatus?: "verified" | "degraded" | "revoked";
    lastHeartbeat?: string;
}
export interface ToolLease {
    id: string;
    toolId: string;
    missionId: string;
    agentId: string;
    state: ToolLeaseState;
    scope: string;
    grantedAt: string;
    expiresAt?: string;
    renewedAt?: string;
    constraints: string[];
}
export interface WorkspaceSession {
    id: string;
    missionId: string;
    state: WorkspaceState;
    cwd: string;
    branchName: string;
    memoryNamespace: string;
    attachedAgents: string[];
    deviceFingerprint?: string;
    verificationStatus?: "verified" | "degraded" | "revoked";
    createdAt: string;
    lastActiveAt: string;
}
export interface MemoryRecord {
    id: string;
    missionId: string;
    kind: "objective" | "decision" | "artifact" | "risk" | "handoff";
    summary: string;
    tags: string[];
    createdAt: string;
    author: string;
}
export interface MissionStep {
    id: string;
    title: string;
    status: "pending" | "in_progress" | "completed" | "blocked";
    ownerRole: AgentRole;
    requiredTools: string[];
    completionSignal: string;
}
export interface OperatingMission {
    id: string;
    title: string;
    objective: string;
    status: MissionStatus;
    priority: "low" | "medium" | "high" | "critical";
    riskLevel: "low" | "medium" | "high";
    requestedBy: string;
    targetSystem: string;
    governanceProfile: string;
    assignedAgents: string[];
    workspaceId: string;
    requiredAuthorities: string[];
    requiredTools: string[];
    successMetrics: string[];
    steps: MissionStep[];
    createdAt: string;
    updatedAt: string;
}
export interface ExecutionTask {
    id: string;
    missionId: string;
    title: string;
    status: ExecutionTaskStatus;
    assignedAgentId: string;
    ownerRole: AgentRole;
    requiredTools: string[];
    input: Record<string, unknown>;
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
        status: GovernanceDecisionStatus;
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
        route?: AuthorityRoute;
        agentIdentityRef?: string;
        deviceIdentityRef?: string;
    };
    createdAt: string;
    updatedAt: string;
}
export interface ExecutionReceipt {
    id: string;
    missionId: string;
    taskId: string;
    agentId: string;
    summary: string;
    outcome: "success" | "halted" | "blocked";
    evidenceRefs: string[];
    governanceRefs?: string[];
    createdAt: string;
}
export interface ToolAction {
    id: string;
    missionId: string;
    taskId: string;
    agentId: string;
    kind: ToolActionKind;
    toolId: string;
    status: ToolActionStatus;
    summary: string;
    payload: Record<string, unknown>;
    constraints: string[];
    governance?: {
        status: GovernanceDecisionStatus;
        reasons: string[];
        evaluatedAt?: string;
        policyCompileId?: string;
        envelopeId?: string;
        warrantId?: string;
        commitDecisionId?: string;
        witnessStatus?: "satisfied" | "unsatisfied" | "not-required";
        route?: AuthorityRoute;
        agentIdentityRef?: string;
        deviceIdentityRef?: string;
    };
    createdAt: string;
    updatedAt: string;
}
export interface AgentOSSnapshot {
    generatedAt: string;
    missions: OperatingMission[];
    agents: AgentCapability[];
    toolLeases: ToolLease[];
    workspaces: WorkspaceSession[];
    memory: MemoryRecord[];
    executionTasks: ExecutionTask[];
    executionReceipts: ExecutionReceipt[];
    toolActions: ToolAction[];
    posture: {
        readyAgents: number;
        activeMissions: number;
        blockedMissions: number;
        leasedTools: number;
    };
}
