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
  /** Boundary degradation (from GET /degradation): true when a condition is active. */
  degraded?: boolean;
  /** Active degradation conditions reported by the boundary's detectors. */
  degradedConditions?: string[];
  /** The fail action those conditions imply for the boundary's Ward criticality. */
  degradedFailAction?: string;
}

export interface SimulationOutcome {
  decision: CommitDecision;
  rationale: string;
  reasonCodes: string[];
  invariants: GovernanceInvariant[];
}

export type PromotionStageKey = "draft" | "shadow" | "staged" | "enforced" | "retired";
export type PromotionStageState = "complete" | "active" | "blocked" | "pending";

export interface PolicyPromotionStage {
  key: PromotionStageKey;
  label: string;
  state: PromotionStageState;
  owner: string;
  evidence: string;
}

export interface GovernanceMissionTemplate {
  id: string;
  name: string;
  ward: string;
  domain: string;
  consequenceClass: string;
  defaultDecision: CommitDecision;
  requiredEvidence: string[];
  operatorValue: string;
}

export interface ToolGatewayAdapter {
  id: string;
  label: string;
  target: string;
  posture: Posture;
  boundary: string;
  sampleAction: string;
}

export interface PolicyHarnessCase {
  id: string;
  action: string;
  expected: CommitDecision;
  actual: CommitDecision;
  reasonCodes: string[];
  coverage: string;
}

export interface EvidenceBundleProfile {
  formatVersion: string;
  signing: string;
  verifier: string;
  contents: string[];
  lastExportHash: string;
}

export interface RuntimeSlo {
  id: string;
  label: string;
  target: string;
  current: string;
  posture: Posture;
}

export interface FailureModeDrill {
  id: string;
  mode: "network-partition" | "stale-authority" | "revocation-lag" | "witness-disagreement" | "replay-divergence" | "degraded-edge";
  ward: string;
  state: "contained" | "investigating" | "requires-operator" | "resolved";
  consequence: string;
  failClosed: boolean;
  evidenceHash: string;
  operatorNextStep: string;
}

export interface BuilderPreview {
  wardId: string;
  wardName: string;
  sovereignty: string;
  subject: string;
  allowedActions: string[];
  refusedActions: string[];
  requiredRegisters: string[];
  warrantTtlSeconds: number;
  manifestHash: string;
  weakeningDiffs: Array<{ path: string; before: string; after: string; note: string }>;
  sampleOutcomes: Array<{ action: string; decision: CommitDecision; reasonCodes: string[] }>;
}

export interface ShadowProfileSummary {
  wardId: string;
  envelopeId: string;
  evaluatedActions: number;
  wouldAllow: number;
  wouldRefuse: number;
  wouldEscalate: number;
  rolloutReady: boolean;
  allowRate: number;
  findings: Array<{ kind: "missing-register" | "near-miss" | "revoked-authority"; actionId: string; detail: string }>;
}

export interface ConflictInboxItem {
  id: string;
  wardId: string;
  action: string;
  edgeDecision: CommitDecision;
  currentDecision: CommitDecision;
  executionTimeDecision: CommitDecision;
  conflictKind: "edge_more_permissive" | "edge_more_restrictive" | "reason_divergence";
  status: "open" | "accepted" | "rejected" | "escalated" | "reconciled";
  gelRecordId: string;
  occurredAt: string;
  operatorNextStep: string;
}

export interface ApprovalItem {
  id: string;
  actionType: string;
  subject: string;
  wardId: string;
  required: number;
  approvals: number;
  status: "pending" | "approved" | "rejected" | "expired";
  votes: Array<{ by: string; decision: "approve" | "reject"; reason?: string }>;
  createdAt: string;
  expiresAt?: string;
}

export interface TelecomNocStep {
  id: string;
  label: string;
  owner: string;
  state: "complete" | "active" | "blocked" | "pending";
  evidence: string;
}

export interface TelecomAdapterSurface {
  id: string;
  label: string;
  standard: "TMF" | "NETCONF" | "gNMI/gNOI" | "O-RAN";
  actionTypes: string[];
  requiredRegisters: string[];
  boundary: string;
  posture: Posture;
}

export interface TelecomEvidenceExport {
  bundleVersion: string;
  changeTicket: string;
  networkScope: string;
  nocOperator: string;
  impactedServices: string[];
  standardsProfile: string[];
  redactedFields: string[];
  bundleHash: string;
  verification: "ok" | "blocked";
}

export interface TelecomScaleDrill {
  id: string;
  label: string;
  command: string;
  target: string;
  current: string;
  posture: Posture;
  evidence: string;
}

export interface AutomotiveFleetStep {
  id: string;
  label: string;
  owner: string;
  state: "complete" | "active" | "blocked" | "pending";
  evidence: string;
}

export interface AutomotiveAdapterSurface {
  id: string;
  label: string;
  standard: "ROS 2/DDS" | "AUTOSAR" | "OTA" | "Map" | "Remote Assist" | "Fleet" | "Simulation";
  actionTypes: string[];
  requiredRegisters: string[];
  boundary: string;
  posture: Posture;
}

export interface AutomotiveEvidenceExport {
  bundleVersion: string;
  fleetId: string;
  vehicleId: string;
  safetyOperator: string;
  operationalScope: string;
  oddId: string;
  standardsProfile: string[];
  redactedFields: string[];
  bundleHash: string;
  verification: "ok" | "blocked";
}

export interface AutomotiveSafetyDrill {
  id: string;
  label: string;
  invariant: string;
  current: string;
  posture: Posture;
  evidence: string;
}

export interface GridControlStep {
  id: string;
  label: string;
  owner: string;
  state: "complete" | "active" | "blocked" | "pending";
  evidence: string;
}

export interface GridAdapterSurface {
  id: string;
  label: string;
  standard: "IEC 61850" | "DNP3" | "Modbus" | "OPC UA" | "SCADA/EMS/ADMS" | "DERMS" | "Relay" | "Firmware" | "Historian";
  actionTypes: string[];
  requiredRegisters: string[];
  boundary: string;
  posture: Posture;
}

export interface GridEvidenceExport {
  bundleVersion: string;
  utilityId: string;
  controlCenter: string;
  assetId: string;
  operationalScope: string;
  topologyModel: string;
  switchingOrder: string;
  profiles: string[];
  redactedFields: string[];
  bundleHash: string;
  verification: "ok" | "blocked";
}

export interface GridSafetyDrill {
  id: string;
  label: string;
  invariant: string;
  current: string;
  posture: Posture;
  evidence: string;
}

export interface RailOpsStep {
  id: string;
  label: string;
  owner: string;
  state: "complete" | "active" | "blocked" | "pending";
  evidence: string;
}

export interface RailAdapterSurface {
  id: string;
  label: string;
  standard: "Dispatch/CAD" | "PTC" | "Wayside" | "Switch" | "Crossing" | "Locomotive" | "Crew" | "Consist" | "MOW" | "Yard";
  actionTypes: string[];
  requiredRegisters: string[];
  boundary: string;
  posture: Posture;
}

export interface RailEvidenceExport {
  bundleVersion: string;
  railroadId: string;
  operationsCenter: string;
  trainId: string;
  trainSymbol: string;
  locomotiveId: string;
  territory: string;
  subdivision: string;
  movementAuthority: string;
  profiles: string[];
  redactedFields: string[];
  bundleHash: string;
  verification: "ok" | "blocked";
}

export interface RailSafetyDrill {
  id: string;
  label: string;
  invariant: string;
  current: string;
  posture: Posture;
  evidence: string;
}

export interface WardMarshalFinding {
  id: string;
  subject: string;
  wardId: string;
  status: "governed" | "shadow" | "rogue" | "orphaned" | "contained";
  riskScore: number;
  riskBand: "low" | "medium" | "high" | "critical";
  owner: string;
  observedLocations: string[];
  observedTools: string[];
  credentialRefs: string[];
  signals: Array<{ code: string; weight: number; detail: string }>;
  recommendedDisposition: "bind_to_ward" | "shadow_profile" | "request_authority_review" | "quarantine" | "revoke_credentials" | "terminate_execution";
  evidenceHash: string;
  lastSeen: string;
}
