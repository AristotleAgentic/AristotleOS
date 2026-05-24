import type {
  Agent,
  AuthorityDomain,
  AuthorityEnvelope,
  CommitRequest,
  GatePipelineSample,
  GovernanceInvariant,
  InterlockEvent,
  LedgerRecord,
  MeshLink,
  MeshNode,
  PhysicalChannel,
  RuntimeRegister,
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
