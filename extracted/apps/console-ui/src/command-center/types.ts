/**
 * AristotleOS Command Center — domain model.
 * These types mirror the governance primitives so mock data and (later) real
 * `/operator/*` responses share one shape. Keep them the single source of truth.
 */

export type Posture = "green" | "amber" | "red";
export type OperationalMode = "normal" | "degraded" | "partitioned" | "emergency" | "simulation" | "replay";

export type NodeState =
  | "active"
  | "degraded"
  | "revoked"
  | "awaiting-warrant"
  | "partitioned"
  | "escalated"
  | "fail-closed";

export type CommitDecision = "allow" | "refuse" | "escalate" | "simulate" | "fail-closed";
export type RiskLevel = "routine" | "elevated" | "high" | "critical";

export type MeshNodeKind =
  | "ward"
  | "authority-domain"
  | "agent"
  | "commit-gate"
  | "ledger"
  | "witness"
  | "revocation";

export interface MeshNode {
  id: string;
  label: string;
  kind: MeshNodeKind;
  state: NodeState;
  /** normalized 0..1 layout coordinates */
  x: number;
  y: number;
  detail?: string;
  ward?: string;
}

export interface MeshLink {
  from: string;
  to: string;
  state: NodeState;
}

export interface Ward {
  id: string;
  name: string;
  sovereignty: string;
  state: NodeState;
  authorityDomains: number;
  agents: number;
  openRequests: number;
  responsibleParty: string;
  legalBasis: string;
  policyHash: string;
}

export interface AuthorityDomain {
  id: string;
  wardId: string;
  name: string;
  enforcementScope: string;
  state: NodeState;
  compiledInvariants: number;
}

export interface AuthorityEnvelope {
  id: string;
  wardId: string;
  domainId: string;
  subject: string;
  scope: string[];
  issuedAt: string;
  expiresAt: string;
  revoked: boolean;
  responsibleParty: string;
  basis: string;
}

export interface GovernanceInvariant {
  id: string;
  name: string;
  expression: string;
  result: "pass" | "fail" | "n/a";
}

export interface Agent {
  id: string;
  callsign: string;
  ward: string;
  domain: string;
  kind: "aerial" | "ground" | "infra" | "robotics" | "cyber" | "workflow" | "maritime";
  state: NodeState;
  authorityHeld: string;
  lastAction: string;
}

export type WarrantStepKey =
  | "request"
  | "envelope"
  | "registers"
  | "invariants"
  | "commit-gate"
  | "warrant"
  | "execution"
  | "evidence"
  | "reconciliation";

export interface WarrantStep {
  key: WarrantStepKey;
  title: string;
  status: "done" | "active" | "pending" | "refuse";
  at?: string;
  detail: string;
}

export interface RuntimeRegister {
  name: string;
  value: string;
  ok: boolean;
}

export interface CommitRequest {
  id: string;
  at: string;
  agentId: string;
  agentCallsign: string;
  ward: string;
  domain: string;
  action: string;
  target: string;
  risk: RiskLevel;
  requiredAuthority: string;
  envelopeId: string;
  decision: CommitDecision;
  reasonCodes: string[];
  warrantId?: string;
  ledgerWritten: boolean;
  latencyMs: number;
  registers: RuntimeRegister[];
  invariants: GovernanceInvariant[];
  steps: WarrantStep[];
}

export interface LedgerRecord {
  seq: number;
  timestamp: string;
  eventType: string;
  agent: string;
  ward: string;
  domain: string;
  decision: CommitDecision;
  warrantId?: string;
  policyHash: string;
  registerHash: string;
  recordHash: string;
  previousHash: string;
  intact: boolean;
  anchored: boolean;
}

export interface PhysicalChannel {
  id: string;
  label: string;
  unit: string;
  value: number;
  limit: number;
  state: "nominal" | "warning" | "interlock";
}

export interface InterlockEvent {
  at: string;
  channel: string;
  detail: string;
  agreed: boolean;
}

export interface GatePipelineSample {
  t: number;
  latencyMs: number;
  throughput: number;
}

export interface SystemSnapshot {
  mode: OperationalMode;
  posture: Posture;
  activeWards: number;
  activeAgents: number;
  openRequests: number;
  warrantsToday: number;
  refusalsToday: number;
  escalationsToday: number;
  ledgerIntact: boolean;
  ledgerHeight: number;
  killSwitchArmed: boolean;
  gateLatencyMs: number;
  source: "live" | "mock";
}

export interface SimulationOutcome {
  decision: CommitDecision;
  rationale: string;
  reasonCodes: string[];
  invariants: GovernanceInvariant[];
}
