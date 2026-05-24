import type {
  Agent,
  AuthorityDomain,
  AuthorityEnvelope,
  BuilderPreview,
  CommitRequest,
  ConflictInboxItem,
  GatePipelineSample,
  EvidenceBundleProfile,
  FailureModeDrill,
  GovernanceInvariant,
  GovernanceMissionTemplate,
  InterlockEvent,
  LedgerRecord,
  MeshLink,
  MeshNode,
  PhysicalChannel,
  PolicyHarnessCase,
  PolicyPromotionStage,
  RuntimeRegister,
  RuntimeSlo,
  ShadowProfileSummary,
  ToolGatewayAdapter,
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
