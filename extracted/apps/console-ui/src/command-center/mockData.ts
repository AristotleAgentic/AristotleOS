import type {
  Agent,
  AutomotiveAdapterSurface,
  AutomotiveEvidenceExport,
  AutomotiveFleetStep,
  AutomotiveSafetyDrill,
  AuthorityDomain,
  ApprovalItem,
  AuthorityEnvelope,
  BuilderPreview,
  CommitRequest,
  ConflictInboxItem,
  GatePipelineSample,
  GridAdapterSurface,
  GridControlStep,
  GridEvidenceExport,
  GridSafetyDrill,
  HealthcareAdapterSurface,
  HealthcareEvidenceExport,
  HealthcareOpsStep,
  HealthcareSafetyDrill,
  EvidenceBundleProfile,
  FailureModeDrill,
  GovernanceInvariant,
  GovernanceMissionTemplate,
  InterlockEvent,
  LedgerRecord,
  LogisticsAdapterSurface,
  LogisticsEvidenceExport,
  LogisticsOpsStep,
  LogisticsSafetyDrill,
  MeshLink,
  MeshNode,
  PhysicalChannel,
  PolicyHarnessCase,
  PolicyPromotionStage,
  PortAdapterSurface,
  PortEvidenceExport,
  PortOpsStep,
  PortSafetyDrill,
  RuntimeRegister,
  RuntimeSlo,
  RailAdapterSurface,
  RailEvidenceExport,
  RailOpsStep,
  RailSafetyDrill,
  ShadowProfileSummary,
  TelecomAdapterSurface,
  TelecomEvidenceExport,
  TelecomNocStep,
  TelecomScaleDrill,
  ToolGatewayAdapter,
  WaterAdapterSurface,
  WaterEvidenceExport,
  WaterOpsStep,
  WaterSafetyDrill,
  WardMarshalFinding,
  Ward,
  WarrantStep
} from "./types.js";

/** Deterministic short hashes so the UI looks real without a crypto dependency. */
export function shortHash(seed: string, len = 12): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let out = "";
  let x = h >>> 0;
  const alphabet = "0123456789abcdef";
  for (let i = 0; i < len; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out += alphabet[x & 15];
  }
  return out;
}

export const META_AUTHORITY = {
  id: "mae-aristotle-root",
  title: "Meta Authority Envelope",
  constitution: "AristotleOS Constitutional Root v0.1",
  custodians: ["Sovereign Operations Board", "Independent Witness Quorum (3-of-5)"],
  policyHash: shortHash("mae-root", 16),
  ratifiedAt: "2026-01-04T00:00:00Z"
};

export const WARDS: Ward[] = [
  { id: "ward-montana-range", name: "Montana Drone Test Range", sovereignty: "US-MT · private airspace", state: "active", authorityDomains: 3, agents: 6, openRequests: 2, responsibleParty: "Range Safety Authority", legalBasis: "FAA COA 2026-114 · landowner consent", policyHash: shortHash("ward-mt") },
  { id: "ward-payments", name: "Enterprise Payments", sovereignty: "Global · PCI-DSS scope", state: "active", authorityDomains: 2, agents: 4, openRequests: 1, responsibleParty: "Treasury Risk", legalBasis: "Board treasury mandate · SOX controls", policyHash: shortHash("ward-pay") },
  { id: "ward-grid", name: "Regional Grid Infrastructure", sovereignty: "US-WEST · NERC CIP", state: "degraded", authorityDomains: 4, agents: 9, openRequests: 3, responsibleParty: "Grid Control Authority", legalBasis: "NERC CIP-013 · ISO operating agreement", policyHash: shortHash("ward-grid") },
  { id: "ward-cyber", name: "Cyber Response Cell", sovereignty: "Corp · SOC jurisdiction", state: "escalated", authorityDomains: 2, agents: 5, openRequests: 2, responsibleParty: "CISO Authority", legalBasis: "Incident response charter", policyHash: shortHash("ward-cyber") }
];

export const AUTHORITY_DOMAINS: AuthorityDomain[] = [
  { id: "dom-mt-flight", wardId: "ward-montana-range", name: "Flight Operations", enforcementScope: "drone.*", state: "active", compiledInvariants: 14 },
  { id: "dom-mt-ground", wardId: "ward-montana-range", name: "Ground Systems", enforcementScope: "vehicle.*", state: "active", compiledInvariants: 9 },
  { id: "dom-mt-geo", wardId: "ward-montana-range", name: "Geofence Containment", enforcementScope: "boundary.*", state: "active", compiledInvariants: 6 },
  { id: "dom-pay-refund", wardId: "ward-payments", name: "Refund Authority", enforcementScope: "stripe.refund", state: "active", compiledInvariants: 11 },
  { id: "dom-pay-payout", wardId: "ward-payments", name: "Payout Authority", enforcementScope: "stripe.payout", state: "active", compiledInvariants: 12 },
  { id: "dom-grid-switch", wardId: "ward-grid", name: "Switching Authority", enforcementScope: "breaker.*", state: "degraded", compiledInvariants: 18 },
  { id: "dom-grid-load", wardId: "ward-grid", name: "Load Shed Authority", enforcementScope: "load.shed", state: "active", compiledInvariants: 8 },
  { id: "dom-cyber-contain", wardId: "ward-cyber", name: "Containment Authority", enforcementScope: "host.isolate", state: "escalated", compiledInvariants: 10 }
];

export const ENVELOPES: AuthorityEnvelope[] = [
  { id: "ae-survey-001", wardId: "ward-montana-range", domainId: "dom-mt-flight", subject: "agent:survey-planner", scope: ["drone.takeoff", "drone.scan_area", "drone.return_home"], issuedAt: "2026-05-23T12:00:00Z", expiresAt: "2026-12-31T23:59:59Z", revoked: false, responsibleParty: "Range Safety Authority", basis: "Survey mission tasking #MT-7741" },
  { id: "ae-refund-114", wardId: "ward-payments", domainId: "dom-pay-refund", subject: "agent:remediation", scope: ["stripe.refund"], issuedAt: "2026-05-23T08:30:00Z", expiresAt: "2026-05-24T08:30:00Z", revoked: false, responsibleParty: "Treasury Risk", basis: "Dispute remediation batch" },
  { id: "ae-switch-22", wardId: "ward-grid", domainId: "dom-grid-switch", subject: "agent:grid-balancer", scope: ["breaker.open", "breaker.close"], issuedAt: "2026-05-22T00:00:00Z", expiresAt: "2026-05-29T00:00:00Z", revoked: false, responsibleParty: "Grid Control Authority", basis: "Maintenance window WO-5521" },
  { id: "ae-contain-09", wardId: "ward-cyber", domainId: "dom-cyber-contain", subject: "agent:ir-bot", scope: ["host.isolate"], issuedAt: "2026-05-23T14:10:00Z", expiresAt: "2026-05-23T20:10:00Z", revoked: true, responsibleParty: "CISO Authority", basis: "Incident INC-2231 — revoked pending review" }
];

export const AGENTS: Agent[] = [
  { id: "agent:survey-planner", callsign: "SURVEYOR-7", ward: "ward-montana-range", domain: "dom-mt-flight", kind: "aerial", state: "active", authorityHeld: "ae-survey-001", lastAction: "drone.scan_area" },
  { id: "agent:ground-7", callsign: "MULE-3", ward: "ward-montana-range", domain: "dom-mt-ground", kind: "ground", state: "awaiting-warrant", authorityHeld: "ae-survey-001", lastAction: "vehicle.relocate" },
  { id: "agent:remediation", callsign: "LEDGER-OPS", ward: "ward-payments", domain: "dom-pay-refund", kind: "workflow", state: "active", authorityHeld: "ae-refund-114", lastAction: "stripe.refund" },
  { id: "agent:grid-balancer", callsign: "GRID-BAL-1", ward: "ward-grid", domain: "dom-grid-switch", kind: "infra", state: "degraded", authorityHeld: "ae-switch-22", lastAction: "breaker.close" },
  { id: "agent:ir-bot", callsign: "IR-SENTRY", ward: "ward-cyber", domain: "dom-cyber-contain", kind: "cyber", state: "revoked", authorityHeld: "ae-contain-09", lastAction: "host.isolate" },
  { id: "agent:robotics-2", callsign: "ARM-2", ward: "ward-grid", domain: "dom-grid-load", kind: "robotics", state: "active", authorityHeld: "—", lastAction: "load.shed" }
];

export const WARD_MARSHAL_FINDINGS: WardMarshalFinding[] = [
  {
    id: "wmf-shadow-refund",
    subject: "agent:shadow-refund-runner",
    wardId: "ward-payments",
    status: "rogue",
    riskScore: 95,
    riskBand: "critical",
    owner: "unknown",
    observedLocations: ["workstation/finance-17/process/4421"],
    observedTools: ["stripe.refunds.write", "crm.customer.update", "secrets.vault.read"],
    credentialRefs: ["oauth:finance-user", "vault:stripe-prod"],
    signals: [
      { code: "UNREGISTERED_AGENT", weight: 30, detail: "No approved registry entry exists for this subject." },
      { code: "CREDENTIAL_ACCESS", weight: 20, detail: "Production payment credentials observed." },
      { code: "CONSEQUENTIAL_TOOL_ACCESS", weight: 20, detail: "The tool surface can mutate money and customer records." },
      { code: "UNKNOWN_OWNER", weight: 10, detail: "No accountable owner is declared." }
    ],
    recommendedDisposition: "revoke_credentials",
    evidenceHash: shortHash("wmf-shadow-refund", 24),
    lastSeen: new Date(Date.now() - 4 * 60_000).toISOString()
  },
  {
    id: "wmf-prod-shell",
    subject: "agent:unclaimed:prod-shell",
    wardId: "ward-cyber",
    status: "rogue",
    riskScore: 100,
    riskBand: "critical",
    owner: "unknown",
    observedLocations: ["mcp/server/prod-shell"],
    observedTools: ["shell.exec", "kubectl.production.deploy", "firewall.rules.write"],
    credentialRefs: ["kubeconfig:prod-admin"],
    signals: [
      { code: "PRIVILEGED_IDENTITY", weight: 20, detail: "Privileged service account observed." },
      { code: "SENSITIVE_TARGET", weight: 15, detail: "Production infrastructure target detected." },
      { code: "CONSEQUENTIAL_TOOL_ACCESS", weight: 20, detail: "Can mutate cluster and network state." },
      { code: "UNREGISTERED_AGENT", weight: 30, detail: "No approved registry entry exists." }
    ],
    recommendedDisposition: "terminate_execution",
    evidenceHash: shortHash("wmf-prod-shell", 24),
    lastSeen: new Date(Date.now() - 90_000).toISOString()
  },
  {
    id: "wmf-release-planner",
    subject: "agent:k8s-release-planner",
    wardId: "ward-cyber",
    status: "shadow",
    riskScore: 35,
    riskBand: "medium",
    owner: "platform",
    observedLocations: ["cluster/staging/ns/release/deploy/planner"],
    observedTools: ["kubernetes.plan", "incident.ticket.create"],
    credentialRefs: ["spiffe://enterprise/platform/release-planner"],
    signals: [
      { code: "LLM_EGRESS", weight: 10, detail: "Approved model endpoint observed under shadow rollout." },
      { code: "AGENT_RUNTIME_SIGNATURE", weight: 10, detail: "Autonomous planning runtime observed." }
    ],
    recommendedDisposition: "shadow_profile",
    evidenceHash: shortHash("wmf-release-planner", 24),
    lastSeen: new Date(Date.now() - 11 * 60_000).toISOString()
  },
  {
    id: "wmf-payments-approved",
    subject: "agent:payments-remediation",
    wardId: "ward-payments",
    status: "governed",
    riskScore: 20,
    riskBand: "low",
    owner: "finance-automation",
    observedLocations: ["cluster/prod/ns/payments/deploy/remediation-agent"],
    observedTools: ["stripe.refunds.write", "crm.customer.update"],
    credentialRefs: ["spiffe://enterprise/payments/remediation"],
    signals: [
      { code: "LLM_EGRESS", weight: 10, detail: "Approved model endpoint observed under Authority Envelope." }
    ],
    recommendedDisposition: "shadow_profile",
    evidenceHash: shortHash("wmf-payments-approved", 24),
    lastSeen: new Date(Date.now() - 40_000).toISOString()
  }
];

/**
 * Representative discovery seed for the Ward Marshal census. When the live
 * boundary is reachable, these observations are scored by the *real* census
 * engine (POST /v1/execution-control/marshal/census) and the console renders the
 * engine's findings — proving the risk scoring is server-computed, not hardcoded.
 * Mirrors WARD_MARSHAL_FINDINGS so the layout is identical whether live or sample.
 */
export const MARSHAL_CENSUS_SEED = {
  registry: {
    registry_version: "console-seed.1",
    agents: [
      { agent_id: "agent-release-planner", subject: "agent:k8s-release-planner", ward_id: "ward-cyber", owner: "platform", approved_tools: ["kubernetes.plan", "incident.ticket.create"], credential_refs: ["spiffe://enterprise/platform/release-planner"], status: "shadow" },
      { agent_id: "agent-payments-remediation", subject: "agent:payments-remediation", ward_id: "ward-payments", owner: "finance-automation", approved_tools: ["stripe.refunds.write", "crm.customer.update"], credential_refs: ["spiffe://enterprise/payments/remediation"], status: "approved" }
    ]
  },
  observations: [
    { observation_id: "obs-refund", source: "developer-workstation", observed_at: new Date(Date.now() - 4 * 60_000).toISOString(), location: "workstation/finance-17/process/4421", process_name: "langgraph-worker", command_line: "node refund-workflow.js --agent", outbound_hosts: ["api.openai.com", "crm.internal"], llm_endpoints: ["https://api.openai.com/v1/responses"], tool_targets: ["stripe.refunds.write", "crm.customer.update", "secrets.vault.read"], credential_refs: ["oauth:finance-user", "vault:stripe-prod"], ward_id: "ward-payments", labels: { subject: "agent:shadow-refund-runner" } },
    { observation_id: "obs-prod-shell", source: "mcp", observed_at: new Date(Date.now() - 90_000).toISOString(), location: "mcp/server/prod-shell", process_name: "mcp-tool-server", service_account: "cluster-admin-agent", ward_id: "ward-cyber", tool_targets: ["shell.exec", "kubectl.production.deploy", "firewall.rules.write"], credential_refs: ["kubeconfig:prod-admin"] },
    { observation_id: "obs-release-planner", source: "kubernetes", observed_at: new Date(Date.now() - 11 * 60_000).toISOString(), location: "cluster/staging/ns/release/deploy/planner", declared_agent_id: "agent-release-planner", owner: "platform", ward_id: "ward-cyber", llm_endpoints: ["https://api.openai.com/v1/responses"], tool_targets: ["kubernetes.plan", "incident.ticket.create"], credential_refs: ["spiffe://enterprise/platform/release-planner"], labels: { subject: "agent:k8s-release-planner" } },
    { observation_id: "obs-payments-remediation", source: "kubernetes", observed_at: new Date(Date.now() - 40_000).toISOString(), location: "cluster/prod/ns/payments/deploy/remediation-agent", declared_agent_id: "agent-payments-remediation", owner: "finance-automation", ward_id: "ward-payments", llm_endpoints: ["https://api.openai.com/v1/responses"], tool_targets: ["stripe.refunds.write", "crm.customer.update"], credential_refs: ["spiffe://enterprise/payments/remediation"], labels: { subject: "agent:payments-remediation" } }
  ]
};

/**
 * Representative edge-record seed for the Conflict Inbox. When the live boundary
 * is reachable, these reconnecting-edge decisions are re-evaluated through the
 * real Commit Gate (POST /conflicts/ingest) and the console renders the engine's
 * classified, resolvable inbox — proving the reconciliation is server-computed.
 * Evaluated against the boundary's configured Ward + Authority.
 */
export const CONFLICT_EDGE_SEED = {
  records: [
    // Edge ALLOWED a now-denied action → edge_more_permissive (open conflict).
    { action: { action_id: "edge-disable-geofence", ward_id: "montana-drone-test-range", subject: "agent:survey-planner", action_type: "drone.disable_geofence", target: "drone-swarm/unit-7", params: { boundary_id: "ranch-test-grid-a" }, requested_at: new Date(Date.now() - 52 * 60_000).toISOString(), telemetry: { gps_lock: true } }, edge_decision: "ALLOW", edge_policy_version: "0.0.9", occurred_at: new Date(Date.now() - 52 * 60_000).toISOString() },
    // Edge ALLOWED an in-bounds takeoff that central also allows → agreement (reconciled).
    { action: { action_id: "edge-takeoff", ward_id: "montana-drone-test-range", subject: "agent:survey-planner", action_type: "drone.takeoff", target: "drone-swarm/unit-7", params: { boundary_id: "ranch-test-grid-a", altitude_m: 80, battery_pct: 87 }, requested_at: new Date(Date.now() - 47 * 60_000).toISOString(), telemetry: { gps_lock: true } }, edge_decision: "ALLOW", occurred_at: new Date(Date.now() - 47 * 60_000).toISOString() },
    // Edge REFUSED a scan central now allows → edge_more_restrictive (open conflict).
    { action: { action_id: "edge-scan-restrictive", ward_id: "montana-drone-test-range", subject: "agent:survey-planner", action_type: "drone.scan_area", target: "drone-swarm/unit-7", params: { boundary_id: "ranch-test-grid-a", altitude_m: 90 }, requested_at: new Date(Date.now() - 33 * 60_000).toISOString(), telemetry: { gps_lock: true } }, edge_decision: "REFUSE", occurred_at: new Date(Date.now() - 33 * 60_000).toISOString() },
    // Edge ALLOWED a scan with missing telemetry central would escalate → edge_more_permissive (open).
    { action: { action_id: "edge-scan-noreg", ward_id: "montana-drone-test-range", subject: "agent:survey-planner", action_type: "drone.scan_area", target: "drone-swarm/unit-7", params: { boundary_id: "ranch-test-grid-a", altitude_m: 95 }, requested_at: new Date(Date.now() - 18 * 60_000).toISOString() }, edge_decision: "ALLOW", occurred_at: new Date(Date.now() - 18 * 60_000).toISOString() }
  ]
};

const registersFor = (gps = true): RuntimeRegister[] => [
  { name: "telemetry.gps_lock", value: gps ? "true" : "missing", ok: gps },
  { name: "registers.battery_pct", value: "87", ok: true },
  { name: "registers.policy_version", value: "0.1.0", ok: true },
  { name: "telemetry.link_quality", value: "0.94", ok: true }
];

const invariantsBase: GovernanceInvariant[] = [
  { id: "inv-altitude", name: "Altitude ceiling", expression: "altitude_m ≤ 120", result: "pass" },
  { id: "inv-boundary", name: "Geofence containment", expression: "boundary_id ∈ permitted", result: "pass" },
  { id: "inv-battery", name: "Battery floor", expression: "battery_pct ≥ 20", result: "pass" },
  { id: "inv-human", name: "Human-origin authenticity", expression: "origin.signed = true", result: "pass" }
];

const stepsFor = (decision: CommitRequest["decision"]): WarrantStep[] => {
  const at = (m: number) => new Date(Date.now() - m * 1000).toISOString();
  const refused = decision === "refuse" || decision === "fail-closed";
  const escalated = decision === "escalate";
  return [
    { key: "request", title: "Request formed", status: "done", at: at(9), detail: "Canonical Governed Action constructed and hashed." },
    { key: "envelope", title: "Authority envelope checked", status: "done", at: at(8), detail: "Subject in ward, scope match, not expired." },
    { key: "registers", title: "Runtime registers evaluated", status: refused && decision === "fail-closed" ? "refuse" : "done", at: at(7), detail: "Runtime register snapshot captured and validated." },
    { key: "invariants", title: "Invariants compiled & evaluated", status: refused && decision !== "fail-closed" ? "refuse" : "done", at: at(6), detail: "Compiled deterministic constraints evaluated." },
    { key: "commit-gate", title: "Commit gate decision", status: refused ? "refuse" : escalated ? "active" : "done", at: at(5), detail: `Decision: ${decision.toUpperCase()}` },
    { key: "warrant", title: "Warrant issued", status: refused || escalated ? "pending" : "done", at: refused || escalated ? undefined : at(4), detail: refused ? "No warrant — action refused." : escalated ? "Awaiting human authority." : "Single-use Ed25519 warrant minted." },
    { key: "execution", title: "Action executed", status: refused || escalated ? "pending" : "done", at: refused || escalated ? undefined : at(3), detail: refused ? "Execution blocked at boundary." : "Downstream action dispatched under warrant." },
    { key: "evidence", title: "Evidence written", status: "done", at: at(2), detail: "Hash-linked record appended to the Governance Evidence Ledger." },
    { key: "reconciliation", title: "Reconciliation completed", status: refused || escalated ? "pending" : "done", at: refused || escalated ? undefined : at(1), detail: "Runtime state reconciled with committed evidence." }
  ];
};

let reqSeq = 4821;
export function makeCommitRequest(overrides: Partial<CommitRequest> = {}): CommitRequest {
  const id = `cr-${(reqSeq++).toString(16)}`;
  const base: CommitRequest = {
    id,
    at: new Date().toISOString(),
    agentId: "agent:survey-planner",
    agentCallsign: "SURVEYOR-7",
    ward: "ward-montana-range",
    domain: "dom-mt-flight",
    action: "drone.takeoff",
    target: "drone-swarm/unit-7",
    risk: "elevated",
    requiredAuthority: "drone.takeoff",
    envelopeId: "ae-survey-001",
    decision: "allow",
    reasonCodes: ["ALLOWED"],
    warrantId: `wrn-${shortHash(id, 18)}`,
    ledgerWritten: true,
    latencyMs: 7,
    registers: registersFor(true),
    invariants: invariantsBase,
    steps: stepsFor("allow"),
    ...overrides
  };
  base.steps = overrides.steps ?? stepsFor(base.decision);
  return base;
}

export const INITIAL_REQUESTS: CommitRequest[] = [
  makeCommitRequest({ id: "cr-allow-1", agentId: "agent:survey-planner", agentCallsign: "SURVEYOR-7", action: "drone.scan_area", risk: "routine", decision: "allow", reasonCodes: ["ALLOWED"], latencyMs: 6 }),
  makeCommitRequest({
    id: "cr-escalate-1", agentId: "agent:grid-balancer", agentCallsign: "GRID-BAL-1", ward: "ward-grid", domain: "dom-grid-switch",
    action: "breaker.open", target: "substation-12/feeder-3", risk: "critical", requiredAuthority: "breaker.open", envelopeId: "ae-switch-22",
    decision: "escalate", reasonCodes: ["RUNTIME_STATE_MISSING"], warrantId: undefined, ledgerWritten: true, latencyMs: 11,
    registers: registersFor(true).map((r) => (r.name === "telemetry.link_quality" ? { ...r, value: "0.41", ok: false } : r)),
    invariants: invariantsBase.map((i) => (i.id === "inv-human" ? { ...i, result: "n/a" } : i))
  }),
  makeCommitRequest({
    id: "cr-refuse-1", agentId: "agent:survey-planner", agentCallsign: "SURVEYOR-7",
    action: "drone.disable_geofence", target: "drone-swarm/unit-7", risk: "critical", requiredAuthority: "—", envelopeId: "ae-survey-001",
    decision: "refuse", reasonCodes: ["ACTION_DENIED", "PHYSICAL_INVARIANT_FAILED"], warrantId: undefined, ledgerWritten: true, latencyMs: 5,
    invariants: invariantsBase.map((i) => (i.id === "inv-boundary" ? { ...i, result: "fail" } : i))
  }),
  makeCommitRequest({
    id: "cr-revoked-1", agentId: "agent:ir-bot", agentCallsign: "IR-SENTRY", ward: "ward-cyber", domain: "dom-cyber-contain",
    action: "host.isolate", target: "host/db-prod-3", risk: "high", requiredAuthority: "host.isolate", envelopeId: "ae-contain-09",
    decision: "refuse", reasonCodes: ["AUTHORITY_REVOKED"], warrantId: undefined, ledgerWritten: true, latencyMs: 4
  }),
  makeCommitRequest({ id: "cr-allow-2", agentId: "agent:remediation", agentCallsign: "LEDGER-OPS", ward: "ward-payments", domain: "dom-pay-refund", action: "stripe.refund", target: "ch_3Pz…/refund", risk: "elevated", requiredAuthority: "stripe.refund", envelopeId: "ae-refund-114", decision: "allow", reasonCodes: ["ALLOWED"], latencyMs: 8 })
];

/* ---------- mesh ---------- */
export const MESH_NODES: MeshNode[] = [
  { id: "ledger-core", label: "Evidence Ledger", kind: "ledger", state: "active", x: 0.5, y: 0.5, detail: "Hash-linked · 128,402 records" },
  { id: "witness-q", label: "Witness Quorum", kind: "witness", state: "active", x: 0.5, y: 0.12, detail: "3-of-5 attesting" },
  { id: "revoke-bus", label: "Revocation Bus", kind: "revocation", state: "active", x: 0.5, y: 0.88, detail: "Propagation < 800ms" },
  { id: "ward-montana-range", label: "Montana Range", kind: "ward", state: "active", x: 0.16, y: 0.28, ward: "ward-montana-range" },
  { id: "ward-payments", label: "Payments", kind: "ward", state: "active", x: 0.16, y: 0.72, ward: "ward-payments" },
  { id: "ward-grid", label: "Grid Infra", kind: "ward", state: "degraded", x: 0.84, y: 0.28, ward: "ward-grid" },
  { id: "ward-cyber", label: "Cyber Cell", kind: "ward", state: "escalated", x: 0.84, y: 0.72, ward: "ward-cyber" },
  { id: "gate-mt", label: "Commit Gate", kind: "commit-gate", state: "active", x: 0.33, y: 0.36 },
  { id: "gate-pay", label: "Commit Gate", kind: "commit-gate", state: "active", x: 0.33, y: 0.64 },
  { id: "gate-grid", label: "Commit Gate", kind: "commit-gate", state: "degraded", x: 0.67, y: 0.36 },
  { id: "gate-cyber", label: "Commit Gate", kind: "commit-gate", state: "fail-closed", x: 0.67, y: 0.64 },
  { id: "agent:survey-planner", label: "SURVEYOR-7", kind: "agent", state: "active", x: 0.06, y: 0.2, ward: "ward-montana-range" },
  { id: "agent:ground-7", label: "MULE-3", kind: "agent", state: "awaiting-warrant", x: 0.06, y: 0.38, ward: "ward-montana-range" },
  { id: "agent:remediation", label: "LEDGER-OPS", kind: "agent", state: "active", x: 0.06, y: 0.7, ward: "ward-payments" },
  { id: "agent:grid-balancer", label: "GRID-BAL-1", kind: "agent", state: "degraded", x: 0.94, y: 0.2, ward: "ward-grid" },
  { id: "agent:ir-bot", label: "IR-SENTRY", kind: "agent", state: "revoked", x: 0.94, y: 0.7, ward: "ward-cyber" }
];

export const MESH_LINKS: MeshLink[] = [
  { from: "agent:survey-planner", to: "gate-mt", state: "active" },
  { from: "agent:ground-7", to: "gate-mt", state: "awaiting-warrant" },
  { from: "gate-mt", to: "ward-montana-range", state: "active" },
  { from: "agent:remediation", to: "gate-pay", state: "active" },
  { from: "gate-pay", to: "ward-payments", state: "active" },
  { from: "agent:grid-balancer", to: "gate-grid", state: "degraded" },
  { from: "gate-grid", to: "ward-grid", state: "degraded" },
  { from: "agent:ir-bot", to: "gate-cyber", state: "revoked" },
  { from: "gate-cyber", to: "ward-cyber", state: "fail-closed" },
  { from: "ward-montana-range", to: "ledger-core", state: "active" },
  { from: "ward-payments", to: "ledger-core", state: "active" },
  { from: "ward-grid", to: "ledger-core", state: "degraded" },
  { from: "ward-cyber", to: "ledger-core", state: "escalated" },
  { from: "witness-q", to: "ledger-core", state: "active" },
  { from: "revoke-bus", to: "ledger-core", state: "active" },
  { from: "revoke-bus", to: "agent:ir-bot", state: "revoked" }
];

/* ---------- ledger (hash chain) ---------- */
export function buildLedger(count = 24): LedgerRecord[] {
  const events = ["commit.allow", "commit.refuse", "commit.escalate", "warrant.issued", "envelope.revoked", "reconcile.complete", "kill-switch.armed"];
  const wards = ["ward-montana-range", "ward-payments", "ward-grid", "ward-cyber"];
  const agents = ["agent:survey-planner", "agent:remediation", "agent:grid-balancer", "agent:ir-bot"];
  const decisions: LedgerRecord["decision"][] = ["allow", "refuse", "escalate", "allow", "allow"];
  const out: LedgerRecord[] = [];
  let prev = "GENESIS";
  const baseSeq = 128402 - count + 1;
  for (let i = 0; i < count; i++) {
    const seq = baseSeq + i;
    const ev = events[i % events.length];
    const decision = decisions[i % decisions.length];
    const recordHash = shortHash(`rec-${seq}-${prev}`);
    const rec: LedgerRecord = {
      seq,
      timestamp: new Date(Date.now() - (count - i) * 47000).toISOString(),
      eventType: ev,
      agent: agents[i % agents.length],
      ward: wards[i % wards.length],
      domain: "—",
      decision,
      warrantId: decision === "allow" ? `wrn-${shortHash(`w-${seq}`, 18)}` : undefined,
      policyHash: shortHash(`pol-${wards[i % wards.length]}`),
      registerHash: shortHash(`reg-${seq}`),
      recordHash,
      previousHash: prev,
      intact: true,
      anchored: i % 6 === 0
    };
    prev = recordHash;
    out.push(rec);
  }
  return out.reverse();
}

/* ---------- physical safety ---------- */
export const PHYSICAL_CHANNELS: PhysicalChannel[] = [
  { id: "ch-alt", label: "Altitude", unit: "m", value: 78, limit: 120, state: "nominal" },
  { id: "ch-bat", label: "Battery", unit: "%", value: 87, limit: 20, state: "nominal" },
  { id: "ch-torque", label: "Arm Torque", unit: "N·m", value: 41, limit: 60, state: "nominal" },
  { id: "ch-volt", label: "Bus Voltage", unit: "V", value: 402, limit: 420, state: "warning" },
  { id: "ch-thermal", label: "Thermal", unit: "°C", value: 64, limit: 85, state: "nominal" },
  { id: "ch-geo", label: "Geofence", unit: "m margin", value: 312, limit: 0, state: "nominal" }
];

export const INTERLOCK_EVENTS: InterlockEvent[] = [
  { at: new Date(Date.now() - 182000).toISOString(), channel: "Geofence", detail: "Boundary approach on unit-7 — soft limit asserted", agreed: true },
  { at: new Date(Date.now() - 920000).toISOString(), channel: "Bus Voltage", detail: "Feeder-3 over-voltage trend — switching authority degraded", agreed: true },
  { at: new Date(Date.now() - 3600000).toISOString(), channel: "Arm Torque", detail: "ARM-2 torque ceiling hold during load shed", agreed: true }
];

/* ---------- gate pipeline telemetry ---------- */
export function seedPipeline(n = 60): GatePipelineSample[] {
  const out: GatePipelineSample[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ t: i, latencyMs: 6 + Math.sin(i / 5) * 2 + Math.random() * 2.5, throughput: 40 + Math.sin(i / 8) * 14 + Math.random() * 8 });
  }
  return out;
}

/* ---------- commercial adoption path ---------- */
export const POLICY_PROMOTION: PolicyPromotionStage[] = [
  { key: "draft", label: "Draft", state: "complete", owner: "Policy engineer", evidence: "Ward manifest validated; authority references resolve." },
  { key: "shadow", label: "Shadow", state: "active", owner: "Runtime operator", evidence: "72h would-block report attached; no irreversible blocking." },
  { key: "staged", label: "Staged", state: "pending", owner: "Security approver", evidence: "Policy diff and mission impact require review." },
  { key: "enforced", label: "Enforced", state: "pending", owner: "Sovereign operator", evidence: "Promotion waits for signed approval and rollback marker." },
  { key: "retired", label: "Retired", state: "pending", owner: "Auditor", evidence: "Superseded policy keeps replay material and evidence chain." }
];

export const MISSION_TEMPLATES: GovernanceMissionTemplate[] = [
  {
    id: "tpl-payments-refund",
    name: "Payments remediation",
    ward: "ward-payments",
    domain: "Refund Authority",
    consequenceClass: "Money movement",
    defaultDecision: "escalate",
    requiredEvidence: ["policy_hash", "authority_hash", "operator_identity", "warrant", "ledger_record"],
    operatorValue: "Proves large refunds are deferred, warranted, and reconstructable."
  },
  {
    id: "tpl-k8s-prod-deploy",
    name: "Kubernetes production deployment",
    ward: "ward-grid",
    domain: "Infrastructure mutation",
    consequenceClass: "Production change",
    defaultDecision: "escalate",
    requiredEvidence: ["deployment_diff", "approver", "image_digest", "runtime_registers"],
    operatorValue: "Puts Aristotle in front of cluster mutations before they hit the API server."
  },
  {
    id: "tpl-edge-drone-patrol",
    name: "Disconnected drone patrol",
    ward: "ward-montana-range",
    domain: "Flight Operations",
    consequenceClass: "Physical motion",
    defaultDecision: "allow",
    requiredEvidence: ["physical_invariants", "cached_authority", "edge_clock", "replay_bundle"],
    operatorValue: "Shows offline authority bounded by Wards, Warrants, and physical invariant checks."
  },
  {
    id: "tpl-health-record",
    name: "Healthcare record correction",
    ward: "ward-cyber",
    domain: "Protected record mutation",
    consequenceClass: "Regulated data",
    defaultDecision: "refuse",
    requiredEvidence: ["patient_scope", "human_approval", "policy_version", "audit_export"],
    operatorValue: "Demonstrates refusal when subject scope and evidence are incomplete."
  }
];

export const TOOL_GATEWAYS: ToolGatewayAdapter[] = [
  { id: "gw-http", label: "HTTP API Gateway", target: "POST /external/*", posture: "green", boundary: "Commit Gate before outbound mutation", sampleAction: "stripe.refund" },
  { id: "gw-k8s", label: "Kubernetes Mutator", target: "apps/v1.Deployment", posture: "amber", boundary: "Admission-style warrant check", sampleAction: "k8s.deployment.rollout" },
  { id: "gw-shell", label: "Shell Command Broker", target: "allowlisted process", posture: "green", boundary: "Sandbox receipt tied to warrant", sampleAction: "shell.run" },
  { id: "gw-robotics", label: "Robotics Bus Bridge", target: "ROS command topic", posture: "amber", boundary: "Physical Invariant Gater plus warrant", sampleAction: "drone.takeoff" }
];

export const TELECOM_NOC_WORKFLOW: TelecomNocStep[] = [
  { id: "noc-mission", label: "Create governed network mission", owner: "NOC engineer", state: "complete", evidence: "Ward ward-ran-region-west and Authority Envelope ae-telecom-noc-change-001 selected." },
  { id: "noc-context", label: "Bind runtime registers", owner: "Change manager", state: "complete", evidence: "CHG-2026-0517, maintenance window, NOC operator, and precheck snapshot attached." },
  { id: "noc-shadow", label: "Profile in Shadow Mode", owner: "Network assurance", state: "complete", evidence: "No customer-impacting action blocked unexpectedly; cell shutdown remains REFUSE." },
  { id: "noc-approval", label: "Dual-control approval", owner: "Regional operations", state: "active", evidence: "NETCONF and O-RAN mutations require 2-of-N authority before Warrant issuance." },
  { id: "noc-gate", label: "Commit Gate and Warrant", owner: "Governance kernel", state: "pending", evidence: "ALLOW mints a single-use Warrant scoped to the canonical network action hash." },
  { id: "noc-execute", label: "Execute adapter", owner: "Adapter boundary", state: "pending", evidence: "TMF / NETCONF / gNMI / O-RAN clients execute only after Warrant verification." },
  { id: "noc-export", label: "Export telecom evidence", owner: "Audit / compliance", state: "pending", evidence: "Telecom Evidence Bundle includes change ticket, NOC context, GEL record, Warrant, and redaction manifest." }
];

export const TELECOM_ADAPTERS: TelecomAdapterSurface[] = [
  {
    id: "tmf-open-api",
    label: "TM Forum Open API",
    standard: "TMF",
    actionTypes: ["tmf.service-order.patch", "tmf.trouble-ticket.update", "tmf.resource-inventory.patch"],
    requiredRegisters: ["change_ticket", "noc_operator", "maintenance_window"],
    boundary: "OSS/BSS mutations become Canonical Governed Actions before the API call leaves AristotleOS.",
    posture: "green"
  },
  {
    id: "netconf-yang",
    label: "NETCONF / YANG",
    standard: "NETCONF",
    actionTypes: ["netconf.edit-config", "netconf.commit-confirmed"],
    requiredRegisters: ["change_ticket", "device_lock", "rollback_plan"],
    boundary: "Candidate and running datastore edits require Authority Envelope scope and dual-control approval.",
    posture: "amber"
  },
  {
    id: "gnmi-gnoi",
    label: "gNMI / gNOI",
    standard: "gNMI/gNOI",
    actionTypes: ["gnmi.set", "gnoi.certificate.rotate"],
    requiredRegisters: ["telemetry_fresh", "device_identity", "change_ticket"],
    boundary: "Telemetry-sensitive set operations are authorized against fresh runtime registers.",
    posture: "green"
  },
  {
    id: "oran-a1-r1",
    label: "O-RAN A1 / R1",
    standard: "O-RAN",
    actionTypes: ["oran.a1.policy.put", "oran.r1.model.deploy"],
    requiredRegisters: ["ric_policy_type", "impact_assessment", "change_ticket"],
    boundary: "RAN optimization policy and model deployment are warranted before they affect cells.",
    posture: "amber"
  }
];

export const TELECOM_EVIDENCE_EXPORT: TelecomEvidenceExport = {
  bundleVersion: "aristotle.telecom-evidence.v1",
  changeTicket: "CHG-2026-0517",
  networkScope: "ran-market-west",
  nocOperator: "operator:netops-west",
  impactedServices: ["mobile-broadband", "emergency-calling-observed"],
  standardsProfile: ["TMF_OPEN_API", "NETCONF_YANG", "GNMI_GNOI", "ORAN_A1_R1"],
  redactedFields: ["imsi", "msisdn", "subscriber_id"],
  bundleHash: shortHash("telecom-evidence-bundle-ran-west", 24),
  verification: "ok"
};

export const TELECOM_SCALE_DRILLS: TelecomScaleDrill[] = [
  { id: "bench", label: "Carrier-scale benchmark", command: "npm run bench:telecom", target: ">= 1k decisions", current: "p95 tracked", posture: "green", evidence: "Commit Gate latency, Warrant issuance, and GEL append remain measured together." },
  { id: "storm", label: "Reconnect storm", command: "npm run soak:telecom", target: "edge records replayed", current: "conflicts classified", posture: "amber", evidence: "Disconnected edge decisions are re-evaluated and routed to Conflict Inbox." },
  { id: "ha", label: "Multi-region ledger soak", command: "npm run soak:telecom", target: "east/central/west", current: "hash chain verified", posture: "green", evidence: "Region-tagged decisions append to a verifiable GEL chain." },
  { id: "pilot", label: "CSP pilot export", command: "aristotle telecom evidence export", target: "audit-ready", current: "bundle verifies", posture: "green", evidence: "NOC, policy, authority, Warrant, and ledger material are sealed for audit." }
];

export const AUTOMOTIVE_FLEET_WORKFLOW: AutomotiveFleetStep[] = [
  { id: "fleet-mission", label: "Create governed fleet mission", owner: "Fleet safety", state: "complete", evidence: "Ward ward-av-fleet-west binds ODD, speed, perception, localization, map, and MRC invariants." },
  { id: "fleet-context", label: "Bind vehicle runtime registers", owner: "Safety case owner", state: "complete", evidence: "Vehicle, ODD, road class, software, map, localization, perception, and MRC snapshot attached." },
  { id: "fleet-shadow", label: "Profile in Shadow Mode", owner: "Autonomy validation", state: "complete", evidence: "Vehicle hold admits; disable safety envelope and speed violations remain REFUSE." },
  { id: "fleet-approval", label: "Dual-control approval", owner: "Fleet operations", state: "active", evidence: "OTA, map activation, and remote-assist commands require 2-of-N approval before Warrant issuance." },
  { id: "fleet-gate", label: "Vehicle Commit Gate", owner: "Governance kernel", state: "pending", evidence: "ALLOW mints a single-use Warrant scoped to the canonical vehicle action hash." },
  { id: "fleet-execute", label: "Execute adapter", owner: "Vehicle boundary", state: "pending", evidence: "ROS 2, AUTOSAR, OTA, map, fleet, and remote-assist adapters execute only after Warrant verification." },
  { id: "fleet-export", label: "Export automotive evidence", owner: "Safety / compliance", state: "pending", evidence: "Automotive Evidence Bundle includes safety case, GEL record, Warrant, ODD, and redaction manifest." }
];

export const AUTOMOTIVE_ADAPTERS: AutomotiveAdapterSurface[] = [
  {
    id: "ros2-dds",
    label: "ROS 2 / DDS",
    standard: "ROS 2/DDS",
    actionTypes: ["ros2.command.publish", "vehicle.behavior.request"],
    requiredRegisters: ["vehicle_id", "odd_id", "mrc_available"],
    boundary: "Command topics are canonicalized and warranted before the vehicle command bridge publishes.",
    posture: "amber"
  },
  {
    id: "autosar-adaptive",
    label: "AUTOSAR Adaptive",
    standard: "AUTOSAR",
    actionTypes: ["autosar.service.invoke", "vehicle.diagnostics.request"],
    requiredRegisters: ["drive_state", "safety_case_id", "vehicle_id"],
    boundary: "Service invocations become governed actions before touching platform services.",
    posture: "green"
  },
  {
    id: "ota-campaign",
    label: "OTA Campaign",
    standard: "OTA",
    actionTypes: ["ota.campaign.stage", "ota.campaign.activate", "ota.campaign.rollback"],
    requiredRegisters: ["drive_state", "ota_image_digest", "vehicle_id"],
    boundary: "Software rollout waves require plural authority and a vehicle-state snapshot.",
    posture: "amber"
  },
  {
    id: "map-update",
    label: "HD Map Update",
    standard: "Map",
    actionTypes: ["map.update.activate", "map.update.rollback"],
    requiredRegisters: ["map_version", "map_confidence", "odd_id"],
    boundary: "Map activation is admitted only inside the declared ODD and evidence bundle.",
    posture: "green"
  },
  {
    id: "remote-assist",
    label: "Remote Assist",
    standard: "Remote Assist",
    actionTypes: ["remote_assist.command", "fleet.vehicle.hold"],
    requiredRegisters: ["remote_assist_session_id", "operator_id", "mrc_available"],
    boundary: "Human-assisted commands require session identity, MRC availability, and dual control for consequential maneuvers.",
    posture: "amber"
  },
  {
    id: "simulation",
    label: "Simulation / Replay",
    standard: "Simulation",
    actionTypes: ["simulation.scenario.run", "simulation.replay.verify"],
    requiredRegisters: ["scenario_id", "safety_case_id"],
    boundary: "Counterfactual replay and validation runs produce evidence against the same policy material.",
    posture: "green"
  }
];

export const AUTOMOTIVE_EVIDENCE_EXPORT: AutomotiveEvidenceExport = {
  bundleVersion: "aristotle.automotive-evidence.v1",
  fleetId: "fleet-west",
  vehicleId: "AV-1042",
  safetyOperator: "operator:fleet-safety-west",
  operationalScope: "sf-soma-odd",
  oddId: "sf-soma-daylight",
  standardsProfile: ["ISO_26262", "ISO_21448", "ISO_21434", "UNECE_R155", "UNECE_R156"],
  redactedFields: ["vin", "passenger_id", "precise_route"],
  bundleHash: shortHash("automotive-evidence-bundle-fleet-west", 24),
  verification: "ok"
};

export const AUTOMOTIVE_SAFETY_DRILLS: AutomotiveSafetyDrill[] = [
  { id: "odd", label: "ODD boundary", invariant: "odd_id == sf-soma-daylight", current: "bound", posture: "green", evidence: "Actions outside the declared ODD fail before Warrant issuance." },
  { id: "speed", label: "Speed envelope", invariant: "speed_mps <= 13.4", current: "8.1 m/s", posture: "green", evidence: "Over-speed requests return PHYSICAL_INVARIANT_FAILED and no Warrant." },
  { id: "mrc", label: "Minimum-risk condition", invariant: "mrc_available == true", current: "available", posture: "green", evidence: "Remote-assist and fleet commands fail closed when MRC is unavailable." },
  { id: "perception", label: "Sensor confidence", invariant: "map/localization/perception >= thresholds", current: "above threshold", posture: "green", evidence: "Low-confidence actions are refused at the physical invariant gate." },
  { id: "ota", label: "OTA plural authority", invariant: "2-of-N approval before Warrant", current: "pending", posture: "amber", evidence: "OTA staging cannot mint a Warrant without dual-control approval." }
];

export const GRID_CONTROL_WORKFLOW: GridControlStep[] = [
  { id: "grid-mission", label: "Create governed switching mission", owner: "Control center", state: "complete", evidence: "Ward ward-grid-transmission-west binds topology, voltage/frequency, clearance, protection, and fallback invariants." },
  { id: "grid-context", label: "Bind grid runtime registers", owner: "Switching authority", state: "complete", evidence: "Asset, topology model, switching order, crew clearance, SCADA freshness, protection state, and operator identity attached." },
  { id: "grid-shadow", label: "Profile in Shadow Mode", owner: "Reliability engineering", state: "complete", evidence: "Breaker open admits; live crew clearance, DER over-cap, and protection disable remain REFUSE." },
  { id: "grid-approval", label: "Dual-control approval", owner: "Operations supervisor", state: "active", evidence: "Breaker close, relay setting, firmware campaign, and DER export cap require 2-of-N approval before Warrant issuance." },
  { id: "grid-gate", label: "Grid Commit Gate", owner: "Governance kernel", state: "pending", evidence: "ALLOW mints a single-use Warrant scoped to the canonical grid action hash." },
  { id: "grid-execute", label: "Execute utility adapter", owner: "OT boundary", state: "pending", evidence: "IEC 61850, DNP3, Modbus, OPC UA, SCADA, DERMS, and relay adapters execute only after Warrant verification." },
  { id: "grid-export", label: "Export utility evidence", owner: "Reliability / compliance", state: "pending", evidence: "Grid Evidence Bundle includes switching order, asset, topology, GEL record, Warrant, and redaction manifest." }
];

export const GRID_ADAPTERS: GridAdapterSurface[] = [
  {
    id: "iec61850",
    label: "IEC 61850",
    standard: "IEC 61850",
    actionTypes: ["iec61850.control.operate", "iec61850.dataset.update"],
    requiredRegisters: ["asset_id", "switching_order_id", "protection_state_known"],
    boundary: "Substation control operations are admitted only against Ward topology and protection state.",
    posture: "amber"
  },
  {
    id: "dnp3",
    label: "DNP3",
    standard: "DNP3",
    actionTypes: ["dnp3.control.operate", "dnp3.analog-output.write"],
    requiredRegisters: ["asset_id", "scada_fresh", "switching_order_id"],
    boundary: "RTU operations require fresh telemetry and switching authority before output control.",
    posture: "amber"
  },
  {
    id: "modbus",
    label: "Modbus",
    standard: "Modbus",
    actionTypes: ["modbus.register.write"],
    requiredRegisters: ["asset_id", "manual_fallback_ready"],
    boundary: "Register writes are governed as OT consequences, not generic data writes.",
    posture: "red"
  },
  {
    id: "scada",
    label: "SCADA / EMS / ADMS",
    standard: "SCADA/EMS/ADMS",
    actionTypes: ["scada.breaker.open", "scada.breaker.close", "adms.switching-order.execute"],
    requiredRegisters: ["switching_order_id", "crew_clearance_released", "scada_fresh"],
    boundary: "Switching commands require topology, clearance, protection, and Warrant verification.",
    posture: "green"
  },
  {
    id: "derms",
    label: "DERMS",
    standard: "DERMS",
    actionTypes: ["derms.dispatch.set", "derms.export-cap.set"],
    requiredRegisters: ["der_export_mw", "grid_state", "topology_model_id"],
    boundary: "Distributed-energy dispatch is capped by Ward export and topology invariants.",
    posture: "green"
  },
  {
    id: "relay",
    label: "Relay Settings",
    standard: "Relay",
    actionTypes: ["relay.setting.update", "relay.group.activate"],
    requiredRegisters: ["relay_setting_version", "protection_state_known", "switching_order_id"],
    boundary: "Protection package changes require plural authority and evidence export.",
    posture: "amber"
  }
];

export const GRID_EVIDENCE_EXPORT: GridEvidenceExport = {
  bundleVersion: "aristotle.grid-evidence.v1",
  utilityId: "utility-west",
  controlCenter: "west-cc",
  assetId: "BRK-230-17",
  operationalScope: "transmission-west",
  topologyModel: "topo-west-2026-05-25",
  switchingOrder: "SWO-2026-0525-17",
  profiles: ["CIP_002", "CIP_005", "CIP_010", "NERC_OPS", "LOCAL_SWITCHING_ORDER"],
  redactedFields: ["facility_exact_address", "operator_phone", "substation_gps"],
  bundleHash: shortHash("grid-evidence-bundle-transmission-west", 24),
  verification: "ok"
};

export const GRID_SAFETY_DRILLS: GridSafetyDrill[] = [
  { id: "clearance", label: "Crew clearance", invariant: "crew_clearance_released == true", current: "released", posture: "green", evidence: "Breaker close refuses while a live clearance remains active." },
  { id: "protection", label: "Protection interlock", invariant: "grid.disable_protection => REFUSE", current: "armed", posture: "green", evidence: "Protection disable is a hard physical invariant failure, even if mistakenly allowed." },
  { id: "topology", label: "Topology model", invariant: "topology_model_id == topo-west-2026-05-25", current: "bound", posture: "green", evidence: "Actions outside the active topology model fail before Warrant issuance." },
  { id: "telemetry", label: "SCADA freshness", invariant: "scada_fresh && telemetry_age_ms <= 5000", current: "1200 ms", posture: "green", evidence: "Stale telemetry blocks field commands at the Commit Gate." },
  { id: "der", label: "DER export cap", invariant: "der_export_mw <= 50", current: "32 MW", posture: "green", evidence: "Over-cap DERMS dispatch returns PHYSICAL_INVARIANT_FAILED and no Warrant." },
  { id: "relay", label: "Relay plural authority", invariant: "2-of-N approval before Warrant", current: "pending", posture: "amber", evidence: "Relay package updates cannot mint a Warrant without dual-control approval." }
];

export const RAIL_OPS_WORKFLOW: RailOpsStep[] = [
  { id: "rail-mission", label: "Create governed movement mission", owner: "Rail operations center", state: "complete", evidence: "Ward ward-rail-subdivision-west binds territory, subdivision, PTC, signal, work-zone, train, and crew invariants." },
  { id: "rail-context", label: "Bind rail runtime registers", owner: "Dispatcher desk", state: "complete", evidence: "Movement authority, dispatcher, train, consist, PTC state, signal aspect, switch proof, bulletin, crew acknowledgement, and crossing state attached." },
  { id: "rail-shadow", label: "Profile dispatch path", owner: "Safety engineering", state: "complete", evidence: "Movement authority admits; conflicting authority, unproven switch, and PTC disable remain REFUSE." },
  { id: "rail-approval", label: "Dual-control route approval", owner: "Chief dispatcher / signal supervisor", state: "active", evidence: "Route lineup, signal clear, switch align, PTC restriction, and hazmat routing require 2-of-N approval before Warrant issuance." },
  { id: "rail-gate", label: "Rail Commit Gate", owner: "Governance kernel", state: "pending", evidence: "ALLOW mints a single-use Warrant scoped to the canonical rail action hash." },
  { id: "rail-execute", label: "Execute rail adapter", owner: "Dispatch / PTC boundary", state: "pending", evidence: "CAD, PTC, wayside, switch, crew, consist, and yard adapters execute only after Warrant verification." },
  { id: "rail-export", label: "Export rail evidence", owner: "Safety / regulatory", state: "pending", evidence: "Rail Evidence Bundle includes movement authority, train, consist, PTC state, GEL record, Warrant, and redaction manifest." }
];

export const RAIL_ADAPTERS: RailAdapterSurface[] = [
  {
    id: "dispatch-cad",
    label: "Dispatch / CAD",
    standard: "Dispatch/CAD",
    actionTypes: ["rail.movement.authority.issue", "rail.route.lineup.authorize"],
    requiredRegisters: ["territory_id", "dispatcher_id", "movement_authority_id", "ptc_active"],
    boundary: "Movement authorities are admitted only against territory, train, signal, PTC, and conflict invariants.",
    posture: "green"
  },
  {
    id: "ptc-back-office",
    label: "PTC Back Office",
    standard: "PTC",
    actionTypes: ["ptc.restriction.update", "ptc.authority.sync"],
    requiredRegisters: ["ptc_active", "ptc_telemetry_age_ms", "host_railroad_id"],
    boundary: "PTC authority material and restrictions are governed before synchronization to rail systems.",
    posture: "green"
  },
  {
    id: "wayside-signal",
    label: "Wayside Signal",
    standard: "Wayside",
    actionTypes: ["signal.aspect.request", "signal.route.clear"],
    requiredRegisters: ["signal_aspect", "switch_position_proven", "conflicting_authority_present"],
    boundary: "Signal requests require switch proof, route authority, and no conflicting authority.",
    posture: "amber"
  },
  {
    id: "switch-machine",
    label: "Switch Machine",
    standard: "Switch",
    actionTypes: ["switch.align.request", "switch.lock.release"],
    requiredRegisters: ["switch_id", "switch_position_proven", "route_id"],
    boundary: "Remote switch alignment cannot proceed without proven position and plural authority.",
    posture: "amber"
  },
  {
    id: "consist-hazmat",
    label: "Consist / Hazmat",
    standard: "Consist",
    actionTypes: ["consist.route.validate", "hazmat.routing.authorize"],
    requiredRegisters: ["consist_hash", "hazmat_classes", "route_class"],
    boundary: "Hazmat and train make-up decisions preserve route authority and audit evidence.",
    posture: "amber"
  },
  {
    id: "mow",
    label: "Maintenance-of-Way",
    standard: "MOW",
    actionTypes: ["mow.work-zone.release", "track.speed-restriction.update"],
    requiredRegisters: ["work_zone_id", "work_zone_released", "track_bulletin_ack"],
    boundary: "Work-zone release and speed restrictions are governed before dispatcher or onboard state changes.",
    posture: "green"
  }
];

export const RAIL_EVIDENCE_EXPORT: RailEvidenceExport = {
  bundleVersion: "aristotle.rail-evidence.v1",
  railroadId: "northstar-rail",
  operationsCenter: "west-dispatch",
  trainId: "NSR-4521",
  trainSymbol: "M-WEST-4521",
  locomotiveId: "NSR-8842",
  territory: "west-subdivision",
  subdivision: "West Subdivision",
  movementAuthority: "MA-2026-0525-019",
  profiles: ["FRA_PTC", "FRA_SIGNAL_TRAIN_CONTROL", "TSA_RAIL_CYBER", "DISPATCH_LOG", "EVENT_RECORDER"],
  redactedFields: ["crew_phone", "facility_access_code", "exact_signal_house_location"],
  bundleHash: shortHash("rail-evidence-bundle-west-subdivision", 24),
  verification: "ok"
};

export const RAIL_SAFETY_DRILLS: RailSafetyDrill[] = [
  { id: "ptc", label: "PTC active", invariant: "ptc_active && ptc_telemetry_age_ms <= 5000", current: "1100 ms", posture: "green", evidence: "Missing or stale PTC state escalates or refuses before movement authority is issued." },
  { id: "conflict", label: "No conflicting authority", invariant: "conflicting_authority_present == false", current: "clear", posture: "green", evidence: "Conflicting movement authority returns PHYSICAL_INVARIANT_FAILED and no Warrant." },
  { id: "switch", label: "Switch proven", invariant: "switch_position_proven == true", current: "normal/proven", posture: "green", evidence: "Unproven switch state blocks route lineups and switch alignments." },
  { id: "work-zone", label: "Work-zone release", invariant: "work_zone_released && track_bulletin_ack", current: "released", posture: "green", evidence: "Active work zones or missing bulletin acknowledgement fail closed." },
  { id: "crossing", label: "Crossing protection", invariant: "grade_crossing_protected == true", current: "protected", posture: "green", evidence: "Crossing protection must be proven before movement over protected limits." },
  { id: "dual", label: "Route plural authority", invariant: "2-of-N approval before Warrant", current: "pending", posture: "amber", evidence: "Route clear, switch align, PTC restriction, and hazmat routing require dual control." }
];

export const PORT_OPS_WORKFLOW: PortOpsStep[] = [
  { id: "port-mission", label: "Create governed terminal mission", owner: "Terminal control", state: "complete", evidence: "Ward ward-port-terminal-alpha binds terminal, berth, yard, gate, cargo, vessel, and OT invariants." },
  { id: "port-context", label: "Bind port runtime registers", owner: "TOS / port OT gateway", state: "complete", evidence: "TOS transaction, customs/security holds, VGM, PNT/AIS, crane exclusion zone, driver identity, and operator identity attached." },
  { id: "port-shadow", label: "Profile release path", owner: "Cyber / terminal operations", state: "complete", evidence: "Clean release admits; customs hold, unsafe crane, missing PNT, and force-gate paths remain REFUSE or ESCALATE." },
  { id: "port-approval", label: "Dual-control heavy action", owner: "Terminal supervisor / safety officer", state: "active", evidence: "Crane, VTS, shore-power, customs-release, and hazmat actions require 2-of-N approval before Warrant issuance." },
  { id: "port-gate", label: "Port Commit Gate", owner: "Governance kernel", state: "pending", evidence: "ALLOW mints a single-use Warrant scoped to the canonical terminal action hash." },
  { id: "port-execute", label: "Execute port adapter", owner: "TOS / gate / crane / VTS boundary", state: "pending", evidence: "Adapters execute only after Warrant verification and append a terminal execution receipt." },
  { id: "port-export", label: "Export port evidence", owner: "Port security / compliance", state: "pending", evidence: "Port Evidence Bundle includes cargo, vessel, terminal, GEL record, Warrant, and redaction manifest." }
];

export const PORT_ADAPTERS: PortAdapterSurface[] = [
  {
    id: "tos",
    label: "Terminal Operating System",
    standard: "TOS",
    actionTypes: ["tos.container.release", "tos.yard-move.authorize"],
    requiredRegisters: ["terminal_id", "tos_transaction_id", "customs_hold", "security_hold"],
    boundary: "Cargo release and yard mutations require hold status, VGM, gate, and operator context before Warrant issuance.",
    posture: "green"
  },
  {
    id: "pcs",
    label: "Port Community / EDI",
    standard: "PCS/EDI",
    actionTypes: ["edi.manifest.submit", "pcs.release-notice.publish"],
    requiredRegisters: ["booking_id", "bill_of_lading", "operator_id"],
    boundary: "Carrier and community data writes become evidenced governance events instead of unbounded workflow updates.",
    posture: "green"
  },
  {
    id: "customs",
    label: "Customs / Holds",
    standard: "Customs",
    actionTypes: ["customs.hold.release", "security.hold.release"],
    requiredRegisters: ["customs_hold", "security_hold", "release_order_id"],
    boundary: "Release under customs, security, or inspection hold is refused; true hold release requires plural authority.",
    posture: "amber"
  },
  {
    id: "vts",
    label: "VTS / AIS / PNT",
    standard: "VTS/AIS/PNT",
    actionTypes: ["vts.berth.clearance", "ais.track.attest"],
    requiredRegisters: ["vessel_imo", "pnt_confidence", "ais_track_age_ms", "berth_conflict_present"],
    boundary: "Berth clearance must bind PNT confidence, AIS freshness, tide/weather window, and berth conflict state.",
    posture: "amber"
  },
  {
    id: "crane",
    label: "Crane Automation",
    standard: "Crane",
    actionTypes: ["crane.move.request", "crane.job.assign"],
    requiredRegisters: ["equipment_id", "crane_exclusion_zone_clear", "spreader_locked"],
    boundary: "Crane moves cannot proceed while exclusion zones are unclear or equipment interlocks are bypassed.",
    posture: "red"
  },
  {
    id: "gate",
    label: "Gate OCR / Access",
    standard: "Gate",
    actionTypes: ["gate.access.grant", "gate.appointment.update"],
    requiredRegisters: ["gate_id", "truck_appointment_valid", "driver_identity_verified"],
    boundary: "Gate access binds appointment, driver identity, release status, and evidence before perimeter consequence.",
    posture: "green"
  },
  {
    id: "reefer",
    label: "Reefer / Cold Chain",
    standard: "Reefer",
    actionTypes: ["reefer.setpoint.update", "reefer.alarm.ack"],
    requiredRegisters: ["container_id", "reefer_temperature_c", "cold_chain_valid"],
    boundary: "Cold-chain changes require valid temperature evidence and a replayable Warrant-bound decision.",
    posture: "green"
  },
  {
    id: "shore-power",
    label: "Shore Power",
    standard: "Shore Power",
    actionTypes: ["shore-power.energize.request", "shore-power.isolate.request"],
    requiredRegisters: ["shore_power_lockout_released", "shore_power_isolated", "fire_watch_ready"],
    boundary: "High-energy berth operations require lockout, isolation, fire-watch, and plural authority.",
    posture: "amber"
  }
];

export const PORT_EVIDENCE_EXPORT: PortEvidenceExport = {
  bundleVersion: "aristotle.port-evidence.v1",
  portId: "port-of-aristotle",
  terminalId: "terminal-alpha",
  operationsCenter: "terminal-control-alpha",
  berthId: "berth-7",
  yardBlock: "A12",
  gateId: "gate-3",
  containerId: "MSCU1234567",
  vesselImo: "IMO9876543",
  releaseOrder: "REL-2026-0525-001",
  profiles: ["USCG_MTSA_CYBER", "IMO_MSC_FAL", "CISA_MTS_RESILIENCE", "ISPS", "NIST_CSF"],
  redactedFields: ["driver_license", "gate_camera_uri", "exact_container_contents"],
  bundleHash: shortHash("port-evidence-bundle-terminal-alpha", 24),
  verification: "ok"
};

export const PORT_SAFETY_DRILLS: PortSafetyDrill[] = [
  { id: "holds", label: "Cargo holds", invariant: "customs_hold == false && security_hold == false", current: "clear", posture: "green", evidence: "Container release refuses while customs, security, or inspection holds remain active." },
  { id: "crane", label: "Crane exclusion zone", invariant: "crane_exclusion_zone_clear == true", current: "clear", posture: "green", evidence: "Unsafe crane movement returns PHYSICAL_INVARIANT_FAILED and no Warrant." },
  { id: "pnt", label: "PNT / AIS confidence", invariant: "pnt_confidence >= 0.97 && ais_track_age_ms <= 5000", current: "0.992 / 1400 ms", posture: "green", evidence: "Missing PNT state escalates berth clearance before vessel-side consequence." },
  { id: "gate", label: "Gate authority", invariant: "truck_appointment_valid && driver_identity_verified", current: "verified", posture: "green", evidence: "Forced gate opening is a hard interlock violation, even if mistakenly allowed." },
  { id: "shore-power", label: "Shore power", invariant: "lockout_released && isolated && fire_watch_ready", current: "ready", posture: "amber", evidence: "Energization requires dual-control approval and verified high-energy work state." },
  { id: "vendor", label: "Vendor remote session", invariant: "vendor_remote_session == false", current: "none", posture: "green", evidence: "Port OT actions fail closed when a forbidden vendor remote session is active." }
];

export const WATER_OPS_WORKFLOW: WaterOpsStep[] = [
  { id: "water-mission", label: "Create governed treatment mission", owner: "Water operations", state: "complete", evidence: "Ward ward-water-plant-west binds utility, system, facility, pressure zone, process area, and safety chemistry invariants." },
  { id: "water-registers", label: "Bind water runtime registers", owner: "SCADA / historian / lab", state: "complete", evidence: "Chlorine residual, pH, turbidity, pressure, tank level, sensor age, backflow, disinfection, pump, and valve state attached." },
  { id: "water-shadow", label: "Profile in Shadow Mode", owner: "Cyber / plant operations", state: "complete", evidence: "Safe pump action admits; overfeed, backflow, missing turbidity, and disinfection-disable paths remain REFUSE or ESCALATE." },
  { id: "water-approval", label: "Dual-control treatment action", owner: "Shift supervisor / water quality lead", state: "active", evidence: "Chemical dose, PLC write, valve position, disinfection release, and discharge actions require 2-of-N approval before Warrant issuance." },
  { id: "water-gate", label: "Water Commit Gate", owner: "Governance kernel", state: "pending", evidence: "ALLOW mints a single-use Warrant scoped to the canonical water action hash." },
  { id: "water-execute", label: "Execute water adapter", owner: "SCADA / PLC / plant boundary", state: "pending", evidence: "Pump, valve, dosing, lab, historian, tank, UV, and discharge adapters execute only after Warrant verification." },
  { id: "water-export", label: "Export water evidence", owner: "Utility compliance / engineering", state: "pending", evidence: "Water Evidence Bundle includes treatment context, process snapshot, GEL record, Warrant, and redaction manifest." }
];

export const WATER_ADAPTERS: WaterAdapterSurface[] = [
  {
    id: "scada",
    label: "SCADA / Plant Control",
    standard: "SCADA",
    actionTypes: ["scada.process.setpoint", "scada.alarm.ack"],
    requiredRegisters: ["facility_id", "scada_fresh", "operator_id"],
    boundary: "Treatment setpoints and control-room mutations require Ward, Authority Envelope, runtime registers, and GEL evidence.",
    posture: "green"
  },
  {
    id: "plc-rtu",
    label: "PLC / RTU",
    standard: "PLC/RTU",
    actionTypes: ["plc.register.write", "rtu.output.operate"],
    requiredRegisters: ["asset_id", "sensor_age_ms", "manual_fallback_ready"],
    boundary: "Field-controller writes are held at the Commit Gate before they can mutate pumps, valves, or process equipment.",
    posture: "amber"
  },
  {
    id: "pump",
    label: "Pump Station",
    standard: "Pump",
    actionTypes: ["pump.speed.set", "pump.start.request"],
    requiredRegisters: ["pump_available", "pressure_psi", "tank_level_pct"],
    boundary: "Pump operations bind pressure, tank level, availability, and failover state before consequence.",
    posture: "green"
  },
  {
    id: "valve",
    label: "Valve / Pressure Zone",
    standard: "Valve",
    actionTypes: ["valve.position.set", "zone.pressure.adjust"],
    requiredRegisters: ["backflow_risk_clear", "valve_interlock_clear", "pressure_zone_id"],
    boundary: "Valve motions and pressure-zone changes fail closed on backflow risk or interlock uncertainty.",
    posture: "amber"
  },
  {
    id: "chemical",
    label: "Chemical Dosing",
    standard: "Chemical",
    actionTypes: ["chemical.dose.adjust", "chlorine.feed.set"],
    requiredRegisters: ["chlorine_residual_mg_l", "ph", "turbidity_ntu", "chemical_inventory_ok"],
    boundary: "Chemical feed changes require bounded chemistry and plural authority before a Warrant is minted.",
    posture: "red"
  },
  {
    id: "lab",
    label: "Lab / LIMS",
    standard: "Lab/LIMS",
    actionTypes: ["lims.sample.accept", "compliance.result.publish"],
    requiredRegisters: ["lab_sample_age_min", "operator_id"],
    boundary: "Sample and compliance result actions preserve replayable water-quality evidence.",
    posture: "green"
  },
  {
    id: "historian",
    label: "Historian / Compliance",
    standard: "Historian",
    actionTypes: ["historian.record.write", "compliance.marker.append"],
    requiredRegisters: ["asset_id", "operator_id"],
    boundary: "Compliance-relevant writes become governed evidence records rather than unbounded annotations.",
    posture: "green"
  },
  {
    id: "discharge",
    label: "UV / Wastewater Discharge",
    standard: "Wastewater",
    actionTypes: ["disinfection.release.authorize", "discharge.release.authorize"],
    requiredRegisters: ["uv_intensity_pct", "disinfection_active", "discharge_permit_window_open"],
    boundary: "Treatment release and outfall discharge require disinfection, permit window, no bypass, and evidence export.",
    posture: "amber"
  }
];

export const WATER_EVIDENCE_EXPORT: WaterEvidenceExport = {
  bundleVersion: "aristotle.water-evidence.v1",
  utilityId: "west-municipal-water",
  waterSystemId: "west-water-system",
  facilityId: "west-treatment-plant",
  operationsCenter: "west-water-control",
  assetId: "PUMP-WEST-2",
  assetType: "pump",
  processArea: "distribution",
  workOrder: "WO-WATER-0525-11",
  permitId: "NPDES-WEST-001",
  profiles: ["EPA_WATER_CYBER", "CISA_WWS_CPG", "AWWA_CYBER", "AWIA_RRA", "NIST_CSF"],
  redactedFields: ["customer_id", "exact_pipe_segment", "sample_chain_of_custody_contact"],
  bundleHash: shortHash("water-evidence-bundle-west-plant", 24),
  verification: "ok"
};

export const WATER_SAFETY_DRILLS: WaterSafetyDrill[] = [
  { id: "chlorine", label: "Chlorine bounds", invariant: "0.2 <= residual && dose_mg_l <= 4.0", current: "0.8 / 1.7 mg/L", posture: "green", evidence: "Overfeed attempts return PHYSICAL_INVARIANT_FAILED and no Warrant." },
  { id: "turbidity", label: "Turbidity / sample freshness", invariant: "turbidity_ntu <= 0.3 && lab_sample_age_min <= 240", current: "0.08 NTU / 45 min", posture: "green", evidence: "Missing turbidity state escalates before filter or release consequence." },
  { id: "pressure", label: "Pressure / tank level", invariant: "35 <= pressure_psi <= 120 && 20 <= tank_level_pct <= 92", current: "62 psi / 66%", posture: "green", evidence: "Pump and tank actions refuse outside pressure and storage bounds." },
  { id: "backflow", label: "Backflow clear", invariant: "backflow_risk_clear == true", current: "clear", posture: "green", evidence: "Backflow-sensitive valve movement fails closed before distribution consequence." },
  { id: "disinfection", label: "Disinfection active", invariant: "disinfection_active && uv_intensity_pct >= 85", current: "active / 91%", posture: "green", evidence: "Disable-disinfection is a hard interlock violation even if mistakenly allowed." },
  { id: "dual", label: "Dual-control chemistry", invariant: "2-of-N approval before Warrant", current: "pending", posture: "amber", evidence: "Chemical, PLC, valve, disinfection, and discharge changes require plural approval." }
];

export const LOGISTICS_OPS_WORKFLOW: LogisticsOpsStep[] = [
  { id: "logistics-mission", label: "Create governed load mission", owner: "Dispatch operations", state: "complete", evidence: "Ward ward-logistics-network-west binds network, carrier, driver, facilities, route, cargo, HOS, and payment authority." },
  { id: "logistics-registers", label: "Bind logistics runtime registers", owner: "TMS / ELD / telematics / WMS", state: "complete", evidence: "HOS, ELD age, carrier authority, insurance, driver qualification, route, seal, temperature, fraud, and double-broker posture attached." },
  { id: "logistics-shadow", label: "Profile dispatch in Shadow Mode", owner: "Safety / operations", state: "complete", evidence: "Safe dispatch admits; HOS overrun, double-broker risk, missing ELD, and payment force-release remain REFUSE or ESCALATE." },
  { id: "logistics-approval", label: "Dual-control money and tender", owner: "Dispatch supervisor / carrier pay", state: "active", evidence: "Fuel, accessorial, tender, carrier payment, hazmat, and cold-chain changes require 2-of-N approval before Warrant issuance." },
  { id: "logistics-gate", label: "Logistics Commit Gate", owner: "Governance kernel", state: "pending", evidence: "ALLOW mints a single-use Warrant scoped to the canonical load action hash." },
  { id: "logistics-execute", label: "Execute logistics adapter", owner: "TMS / WMS / YMS / payment boundary", state: "pending", evidence: "Dispatch, tender, release, fuel, payment, route, cold-chain, and DVIR adapters execute only after Warrant verification." },
  { id: "logistics-export", label: "Export logistics evidence", owner: "Compliance / claims / finance", state: "pending", evidence: "Logistics Evidence Bundle includes load context, HOS/ELD, carrier, route, cargo, GEL record, Warrant, and redaction manifest." }
];

export const LOGISTICS_ADAPTERS: LogisticsAdapterSurface[] = [
  {
    id: "tms",
    label: "TMS Dispatch",
    standard: "TMS",
    actionTypes: ["tms.load.dispatch", "tms.trip.assign"],
    requiredRegisters: ["load_id", "driver_id", "remaining_drive_minutes", "eld_event_age_ms"],
    boundary: "Load dispatch cannot proceed until HOS, ELD freshness, equipment, route, and cargo registers are bound.",
    posture: "green"
  },
  {
    id: "broker",
    label: "Broker / Carrier Tender",
    standard: "Broker",
    actionTypes: ["broker.load.tender", "carrier.load.accept"],
    requiredRegisters: ["carrier_authority_active", "carrier_insurance_valid", "double_broker_risk_score"],
    boundary: "Freight tendering binds carrier identity, insurance, fraud posture, and double-broker risk before rate confirmation.",
    posture: "amber"
  },
  {
    id: "eld",
    label: "ELD / HOS",
    standard: "ELD/HOS",
    actionTypes: ["eld.hos.attest", "hos.dispatch.clear"],
    requiredRegisters: ["hos_available", "remaining_drive_minutes", "remaining_duty_minutes", "eld_fresh"],
    boundary: "HOS state is an execution prerequisite, not a post-dispatch compliance note.",
    posture: "red"
  },
  {
    id: "telematics",
    label: "Telematics / Route",
    standard: "Telematics",
    actionTypes: ["route.reroute.authorize", "telematics.location.attest"],
    requiredRegisters: ["route_id", "route_permitted", "restricted_area_clear", "telematics_age_ms"],
    boundary: "Reroute and geofence decisions bind route permission, freshness, and restricted-area clearance.",
    posture: "green"
  },
  {
    id: "wms-yms",
    label: "WMS / YMS Release",
    standard: "WMS",
    actionTypes: ["wms.cargo.release", "yms.dock.assign", "yard.gate.release"],
    requiredRegisters: ["shipment_id", "trailer_seal_intact", "appointment_valid", "dock_available"],
    boundary: "Cargo release, dock assignment, and yard gate movement require appointment, seal, securement, and facility state.",
    posture: "green"
  },
  {
    id: "money",
    label: "Fuel / Accessorial / Payment",
    standard: "Payment",
    actionTypes: ["fuel.advance.authorize", "accessorial.approve", "payment.carrier.release"],
    requiredRegisters: ["fuel_card_active", "fraud_score", "pod_verified"],
    boundary: "Cash-equivalent actions require bounded amounts, fraud posture, and plural authority.",
    posture: "amber"
  },
  {
    id: "cold-hazmat",
    label: "Cold Chain / Hazmat",
    standard: "Cold Chain",
    actionTypes: ["coldchain.setpoint.update", "hazmat.route.authorize"],
    requiredRegisters: ["cargo_temperature_c", "temperature_in_range", "hazmat_endorsement_valid"],
    boundary: "Food, pharma, reefer, and hazmat changes bind temperature, route, endorsement, and restricted-area evidence.",
    posture: "amber"
  },
  {
    id: "dvir-customs",
    label: "DVIR / Cross-Border",
    standard: "DVIR",
    actionTypes: ["dvir.vehicle.release", "customs.entry.submit"],
    requiredRegisters: ["dvir_clear", "vehicle_maintenance_clear", "customs_clearance_present"],
    boundary: "Vehicle release and border movement preserve maintenance, customs, and route authority before consequence.",
    posture: "green"
  }
];

export const LOGISTICS_EVIDENCE_EXPORT: LogisticsEvidenceExport = {
  bundleVersion: "aristotle.logistics-evidence.v1",
  networkId: "west-freight-network",
  operationsCenter: "west-dispatch",
  loadId: "LOAD-8821",
  shipmentId: "SHP-5521",
  tripId: "TRIP-2026-0525-77",
  carrierId: "carrier:clearline",
  driverId: "driver:diaz",
  tractorId: "TRAC-4482",
  trailerId: "TRL-9012",
  routeId: "route-i70-west-safe",
  profiles: ["FMCSA_HOS", "ELD", "DOT_SAFETY", "FSMA_SANITARY_TRANSPORT", "NIST_CSF"],
  redactedFields: ["driver_phone", "customer_contract", "exact_customer_location"],
  bundleHash: shortHash("logistics-evidence-bundle-load-8821", 24),
  verification: "ok"
};

export const LOGISTICS_SAFETY_DRILLS: LogisticsSafetyDrill[] = [
  { id: "hos", label: "HOS / ELD", invariant: "required_drive_minutes <= remaining_drive_minutes && eld_event_age_ms <= 300000", current: "180 <= 420 / 900 ms", posture: "green", evidence: "HOS overrun returns PHYSICAL_INVARIANT_FAILED and no Warrant." },
  { id: "carrier", label: "Carrier authority", invariant: "authority_active && insurance_valid", current: "active / valid", posture: "green", evidence: "Unverified carrier handoff refuses before tender or dispatch consequence." },
  { id: "double-broker", label: "Double-broker risk", invariant: "risk_score <= 0.2 && double_broker_flag == false", current: "0.04 / clear", posture: "green", evidence: "Double-broker flagged loads are refused before tender or payment." },
  { id: "route", label: "Route and geofence", invariant: "route_permitted && route_deviation_km <= 5", current: "permitted / 1.1 km", posture: "green", evidence: "Reroute outside Ward routes fails closed before telematics or TMS mutation." },
  { id: "cold", label: "Cold-chain integrity", invariant: "-25 <= cargo_temperature_c <= 8 && temperature_in_range", current: "-18 C / in range", posture: "green", evidence: "Temperature alarm override is a hard interlock violation." },
  { id: "money", label: "Money controls", invariant: "fuel <= 750 && accessorial <= 1200 && 2-of-N approval", current: "pending", posture: "amber", evidence: "Fuel, accessorial, and payment actions require plural approval before Warrant issuance." }
];

export const HEALTHCARE_OPS_WORKFLOW: HealthcareOpsStep[] = [
  { id: "healthcare-mission", label: "Create governed clinical mission", owner: "Clinical operations", state: "complete", evidence: "Ward ward-healthcare-clinical-ops binds facility, unit, patient-context hash, clinician privilege, PHI purpose, and clinical authority." },
  { id: "healthcare-registers", label: "Bind clinical runtime registers", owner: "EHR / FHIR / pharmacy / device gateways", state: "complete", evidence: "Patient context, consent/TPO basis, privilege, allergy, medication interaction, chart lock, device safety, PHI count, and audit context attached." },
  { id: "healthcare-shadow", label: "Profile clinical automation in Shadow Mode", owner: "CMIO / privacy / pharmacy", state: "complete", evidence: "Prior auth admits; allergy override, missing patient context, identified research export, and device alarm disable remain REFUSE or ESCALATE." },
  { id: "healthcare-approval", label: "Dual-control clinical consequence", owner: "Clinician / pharmacist / privacy officer", state: "active", evidence: "Medication-list update, dispense request, PHI export, device setting update, and research export require plural approval before Warrant issuance." },
  { id: "healthcare-gate", label: "Healthcare Commit Gate", owner: "Governance kernel", state: "pending", evidence: "ALLOW mints a single-use Warrant scoped to the canonical patient-context action hash." },
  { id: "healthcare-execute", label: "Execute clinical adapter", owner: "FHIR / EHR / pharmacy / device boundary", state: "pending", evidence: "EHR, HL7, pharmacy, claims, imaging, device, messaging, and research adapters execute only after Warrant verification." },
  { id: "healthcare-export", label: "Export healthcare evidence", owner: "Compliance / privacy / quality", state: "pending", evidence: "Healthcare Evidence Bundle includes patient-context hash, authority, Warrant, GEL record, redaction manifest, and replay material without raw PHI." }
];

export const HEALTHCARE_ADAPTERS: HealthcareAdapterSurface[] = [
  {
    id: "fhir",
    label: "FHIR Resource",
    standard: "FHIR",
    actionTypes: ["fhir.resource.write", "phi.export"],
    requiredRegisters: ["patient_context_hash", "fhir_resource_type", "tpo_basis", "audit_context_present"],
    boundary: "FHIR writes and PHI export require patient-context hash, consent/TPO basis, resource scope, and audit context before mutation.",
    posture: "green"
  },
  {
    id: "hl7",
    label: "HL7 Interface",
    standard: "HL7",
    actionTypes: ["hl7.message.send"],
    requiredRegisters: ["patient_context_hash", "message_type", "patient_identity_verified"],
    boundary: "HL7 messages are governed before they trigger downstream ADT, order, result, scheduling, or billing workflows.",
    posture: "green"
  },
  {
    id: "ehr",
    label: "EHR Writeback",
    standard: "EHR",
    actionTypes: ["ehr.note.append", "ehr.problem_list.update", "ehr.medication_list.update"],
    requiredRegisters: ["clinician_privilege_active", "chart_lock_clear", "clinical_context_age_ms"],
    boundary: "Chart changes require active clinical privilege, current context, and clear chart lock before EHR consequence.",
    posture: "amber"
  },
  {
    id: "pharmacy",
    label: "Pharmacy Workflow",
    standard: "Pharmacy",
    actionTypes: ["pharmacy.prior_auth.submit", "pharmacy.dispense.request"],
    requiredRegisters: ["allergy_checked", "medication_interaction_clear", "pharmacist_authority_present"],
    boundary: "Medication workflows bind allergy, interaction, pharmacist authority, and medication reconciliation evidence before action.",
    posture: "red"
  },
  {
    id: "claims",
    label: "Claims / Prior Auth",
    standard: "Claims",
    actionTypes: ["claims.submit", "claims.adjust", "pharmacy.prior_auth.submit"],
    requiredRegisters: ["claim_attestation_present", "claim_amount_usd", "tpo_basis"],
    boundary: "Financial healthcare actions require attestation, bounded claim amount, and payment/operations/prior-auth basis.",
    posture: "amber"
  },
  {
    id: "imaging",
    label: "RIS / PACS",
    standard: "PACS/RIS",
    actionTypes: ["order.imaging.request", "imaging.study.release"],
    requiredRegisters: ["order_signing_authority", "fhir_resource_type", "clinical_context_age_ms"],
    boundary: "Imaging orders and study release require order authority, current context, and resource scope before radiology consequence.",
    posture: "green"
  },
  {
    id: "device",
    label: "Medical Device",
    standard: "Device",
    actionTypes: ["device.setting.update"],
    requiredRegisters: ["device_id", "device_safety_limits_active", "alarm_active", "device_telemetry_age_ms"],
    boundary: "Device commands are blocked unless safety limits, alarm posture, telemetry freshness, and patient context are proven.",
    posture: "red"
  },
  {
    id: "research",
    label: "Research Export",
    standard: "Research",
    actionTypes: ["research.dataset.export"],
    requiredRegisters: ["deidentification_valid", "privacy_officer_approval", "phi_record_count"],
    boundary: "Research exports bind de-identification, privacy approval, cohort size, and PHI minimization before dataset release.",
    posture: "amber"
  }
];

export const HEALTHCARE_EVIDENCE_EXPORT: HealthcareEvidenceExport = {
  bundleVersion: "aristotle.healthcare-evidence.v1",
  systemId: "west-health-system",
  facilityId: "west-hospital",
  clinicalUnit: "pharmacy",
  encounterId: "enc-2026-0525-008",
  patientContextHash: "patctx-0f2b8d7c9a1e",
  actionFamily: "prior-authorization",
  profiles: ["HIPAA", "HITECH", "FHIR_R4", "HL7_V2", "SOC2", "NIST_HIPAA"],
  redactedFields: ["patient_name", "mrn", "date_of_birth", "free_text_clinical_note"],
  bundleHash: shortHash("healthcare-evidence-bundle-west-hospital", 24),
  verification: "ok"
};

export const HEALTHCARE_SAFETY_DRILLS: HealthcareSafetyDrill[] = [
  { id: "patient-context", label: "Patient context", invariant: "patient_context_hash && patient_context_present", current: "bound / present", posture: "green", evidence: "Missing patient context escalates before EHR, PHI, pharmacy, or device consequence." },
  { id: "consent", label: "Consent or TPO basis", invariant: "consent_valid || basis in [treatment,payment,operations]", current: "prior-authorization", posture: "green", evidence: "PHI export without consent or TPO basis is hard-refused." },
  { id: "medication", label: "Medication safety", invariant: "allergy_checked && !allergy_conflict && interaction_clear", current: "clear", posture: "green", evidence: "Allergy override and controlled-substance force-dispense cannot mint a Warrant." },
  { id: "device", label: "Device safety", invariant: "alarm_active && safety_limits_active && telemetry_age <= 60000", current: "active / 1000 ms", posture: "green", evidence: "Alarm or safety-limit disable is refused even if an envelope is misconfigured." },
  { id: "phi", label: "PHI minimization", invariant: "phi_record_count <= 25 && redaction_manifest", current: "8 records", posture: "green", evidence: "Healthcare Evidence Bundles retain hashes and references by default, not raw PHI." },
  { id: "dual", label: "Dual-control clinical actions", invariant: "2-of-N approval before Warrant", current: "pending", posture: "amber", evidence: "Medication-list, dispense, PHI export, device update, and research export actions require plural authority." }
];

export const POLICY_HARNESS: PolicyHarnessCase[] = [
  { id: "case-under-cap", action: "stripe.refund amount=240", expected: "allow", actual: "allow", reasonCodes: ["ALLOWED"], coverage: "refund threshold" },
  { id: "case-large-refund", action: "stripe.refund amount=8000", expected: "escalate", actual: "escalate", reasonCodes: ["HUMAN_APPROVAL_REQUIRED"], coverage: "defer band" },
  { id: "case-payout", action: "stripe.payout amount=8000", expected: "refuse", actual: "refuse", reasonCodes: ["ACTION_DENIED"], coverage: "forbidden action" },
  { id: "case-missing-register", action: "breaker.open missing grid_load", expected: "fail-closed", actual: "fail-closed", reasonCodes: ["RUNTIME_STATE_MISSING"], coverage: "fail-closed state" }
];

export const EVIDENCE_PROFILE: EvidenceBundleProfile = {
  formatVersion: "aos-evidence-bundle/v0.1",
  signing: "Ed25519 warrant + GEL record signatures",
  verifier: "aristotle evidence verify --bundle",
  contents: ["canonical_action", "ward_context", "authority_envelope", "commit_gate_decision", "warrant", "gel_record", "runtime_register_snapshot", "replay_material"],
  lastExportHash: shortHash("evidence-bundle-commercial-readiness", 20)
};

export const RUNTIME_SLOS: RuntimeSlo[] = [
  { id: "slo-gate", label: "Commit Gate p95", target: "< 25 ms", current: "8.7 ms", posture: "green" },
  { id: "slo-warrant", label: "Warrant issuance p95", target: "< 50 ms", current: "14.2 ms", posture: "green" },
  { id: "slo-ledger", label: "GEL append p95", target: "< 75 ms", current: "31.4 ms", posture: "green" },
  { id: "slo-revoke", label: "Revocation propagation", target: "< 2 s", current: "0.8 s", posture: "green" },
  { id: "slo-replay", label: "Replay verify", target: "< 500 ms", current: "146 ms", posture: "green" }
];

export const FAILURE_DRILLS: FailureModeDrill[] = [
  { id: "fm-partition-mt", mode: "network-partition", ward: "ward-montana-range", state: "contained", consequence: "Edge node continues under cached authority until warrant TTL expires.", failClosed: true, evidenceHash: shortHash("fm-partition-mt", 16), operatorNextStep: "Review edge evidence bundle and reconcile patrol records." },
  { id: "fm-stale-pay", mode: "stale-authority", ward: "ward-payments", state: "requires-operator", consequence: "Large refund escalates because authority version is behind central policy.", failClosed: true, evidenceHash: shortHash("fm-stale-pay", 16), operatorNextStep: "Approve one-time warrant or reject pending fresh authority." },
  { id: "fm-revoke-cyber", mode: "revocation-lag", ward: "ward-cyber", state: "investigating", consequence: "Revoked incident bot cannot isolate host until revocation bus catches up.", failClosed: true, evidenceHash: shortHash("fm-revoke-cyber", 16), operatorNextStep: "Confirm envelope revocation reached all gateways." },
  { id: "fm-witness-grid", mode: "witness-disagreement", ward: "ward-grid", state: "contained", consequence: "Witness quorum disagreement blocks breaker operation before consequence.", failClosed: true, evidenceHash: shortHash("fm-witness-grid", 16), operatorNextStep: "Run replay against both witness snapshots." },
  { id: "fm-replay-grid", mode: "replay-divergence", ward: "ward-grid", state: "resolved", consequence: "Historical policy replay diverged from current policy as expected.", failClosed: false, evidenceHash: shortHash("fm-replay-grid", 16), operatorNextStep: "Attach divergence explanation to audit export." }
];

export const BUILDER_PREVIEW: BuilderPreview = {
  wardId: "ward-payments",
  wardName: "Enterprise Payments",
  sovereignty: "Treasury Risk",
  subject: "agent:remediation",
  allowedActions: ["stripe.refund"],
  refusedActions: ["stripe.payout", "stripe.transfer"],
  requiredRegisters: ["operator_identity", "customer_dispute_id", "amount_usd", "policy_version"],
  warrantTtlSeconds: 60,
  manifestHash: shortHash("builder-preview-manifest", 20),
  weakeningDiffs: [
    { path: "authority_envelope.expires_at", before: "15m", after: "30m", note: "Expiry extension broadens delegated authority and requires review." },
    { path: "constraints.max_amount_usd", before: "500", after: "1000", note: "Autonomous refund threshold increase weakens governance." }
  ],
  sampleOutcomes: [
    { action: "stripe.refund amount=240", decision: "allow", reasonCodes: ["ALLOWED"] },
    { action: "stripe.refund amount=8000", decision: "escalate", reasonCodes: ["HUMAN_APPROVAL_REQUIRED"] },
    { action: "stripe.payout amount=8000", decision: "refuse", reasonCodes: ["ACTION_DENIED"] },
    { action: "stripe.refund missing customer_dispute_id", decision: "fail-closed", reasonCodes: ["RUNTIME_STATE_MISSING"] }
  ]
};

export const SHADOW_PROFILE: ShadowProfileSummary = {
  wardId: "ward-payments",
  envelopeId: "ae-refund-114",
  evaluatedActions: 128,
  wouldAllow: 91,
  wouldRefuse: 22,
  wouldEscalate: 15,
  rolloutReady: false,
  allowRate: 0.711,
  findings: [
    { kind: "missing-register", actionId: "shadow-081", detail: "customer_dispute_id absent on high-value refund path." },
    { kind: "near-miss", actionId: "shadow-097", detail: "amount_usd 492 is within 2% of autonomous threshold." },
    { kind: "revoked-authority", actionId: "shadow-119", detail: "stale envelope ae-refund-109 observed in replay batch." }
  ]
};

export const APPROVAL_QUEUE: ApprovalItem[] = [
  {
    id: "apr-7c1f9a2b3d4e5f60",
    actionType: "host.isolate",
    subject: "agent:incident-responder",
    wardId: "ward-cyber",
    required: 2,
    approvals: 1,
    status: "pending",
    votes: [{ by: "alice@soc", decision: "approve", reason: "SEV-1 confirmed" }],
    createdAt: new Date(Date.now() - 1000 * 60 * 6).toISOString()
  },
  {
    id: "apr-3a8e2c7b9f10d246",
    actionType: "firewall.purge_all",
    subject: "agent:netops",
    wardId: "ward-cyber",
    required: 2,
    approvals: 0,
    status: "pending",
    votes: [],
    createdAt: new Date(Date.now() - 1000 * 60 * 2).toISOString()
  },
  {
    id: "apr-bb44ee9911223344",
    actionType: "payments.bulk_refund",
    subject: "agent:finance-bot",
    wardId: "ward-payments",
    required: 2,
    approvals: 2,
    status: "approved",
    votes: [{ by: "carol@fin", decision: "approve" }, { by: "dave@fin", decision: "approve" }],
    createdAt: new Date(Date.now() - 1000 * 60 * 20).toISOString()
  }
];

export const CONFLICT_INBOX: ConflictInboxItem[] = [
  {
    id: "conf-edge-001",
    wardId: "ward-montana-range",
    action: "drone.scan_area boundary=ranch-test-grid-a",
    edgeDecision: "allow",
    currentDecision: "allow",
    executionTimeDecision: "allow",
    conflictKind: "reason_divergence",
    status: "reconciled",
    gelRecordId: `gel-${shortHash("conf-edge-001", 14)}`,
    occurredAt: new Date(Date.now() - 1000 * 60 * 47).toISOString(),
    operatorNextStep: "No operator action; edge and central decisions agree."
  },
  {
    id: "conf-edge-002",
    wardId: "ward-montana-range",
    action: "drone.scan_area altitude_m=118",
    edgeDecision: "allow",
    currentDecision: "escalate",
    executionTimeDecision: "allow",
    conflictKind: "edge_more_permissive",
    status: "open",
    gelRecordId: `gel-${shortHash("conf-edge-002", 14)}`,
    occurredAt: new Date(Date.now() - 1000 * 60 * 112).toISOString(),
    operatorNextStep: "Accept if execution-time policy was valid; attach near-miss explanation."
  },
  {
    id: "conf-edge-003",
    wardId: "ward-grid",
    action: "breaker.open feeder=3",
    edgeDecision: "escalate",
    currentDecision: "allow",
    executionTimeDecision: "escalate",
    conflictKind: "edge_more_restrictive",
    status: "escalated",
    gelRecordId: `gel-${shortHash("conf-edge-003", 14)}`,
    occurredAt: new Date(Date.now() - 1000 * 60 * 196).toISOString(),
    operatorNextStep: "Review runtime register gap before marking reconciled."
  }
];
