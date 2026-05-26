/**
 * Static registry of every industry vertical present on the
 * ward-warrant-execution-control branch.
 *
 * Each entry mirrors what the runtime module exports (adapter catalog,
 * hard interlocks, regulatory framing, jurisdiction/site rule presets).
 * Used by VerticalsRegistryConsole + VerticalDetailConsole to render
 * the full surface area visibly in the operator UI.
 *
 * Demonstration-only across every preset — see the per-vertical banner.
 */

export type VerticalId =
  | "automotive"
  | "aviation"
  | "grid"
  | "healthcare"
  | "logistics"
  | "mining"
  | "pipeline"
  | "port"
  | "rail"
  | "robotics"
  | "space"
  | "swarm"
  | "telecom"
  | "title"
  | "water";

export interface VerticalAdapterRow {
  id: string;
  label: string;
  /** Action types this adapter family produces (sample). */
  actionTypes: string[];
  /** Source-of-truth boundary the adapter sits in front of. */
  boundary: string;
}

export interface VerticalConfig {
  id: VerticalId;
  /** Display name for the registry card + detail header. */
  name: string;
  /** One-line regulatory framing for the registry card. */
  framing: string;
  /** Long-form purpose for the detail header. */
  purpose: string;
  /** Regulatory citations rendered as chips. */
  regulatory: string[];
  /** Typed adapter boundaries. */
  adapters: VerticalAdapterRow[];
  /** Action types the gate refuses regardless of envelope. */
  hardInterlocks: string[];
  /** Jurisdiction / site / state rule preset count + label. */
  presets: {
    label: string;
    states: string[];
  };
  /** Test surface (counts) — informational. */
  testSurface: { tests: number; suite: string };
  /** True if a dedicated *OpsConsole component handles the section. */
  hasDedicatedConsole: boolean;
  /** Which existing SectionId routes there, if any. */
  dedicatedSectionId?:
    | "fleet" | "grid" | "healthcare" | "logistics" | "port"
    | "rail" | "noc" | "title" | "water";

  // -- Optional rich panels rendered by VerticalDetailConsole ----------------
  /** Workflow timeline: intent -> authority -> checks -> commit -> warrant -> submit -> evidence. */
  workflow?: VerticalWorkflowStep[];
  /** Safety / invariant cards (parallel to HealthcareOpsConsole drills). */
  safetyDrills?: VerticalSafetyDrill[];
  /** Sample evidence bundle export panel data. */
  evidenceSample?: VerticalEvidenceSample;
  /** Labels for the commit-boundary identity chain (e.g. Intent -> Ward -> Checks -> Adapter -> GEL). */
  boundaryChainLabels?: string[];
  /** Fail-closed rule panel description + chips. */
  failClosedRule?: { description: string; chips: string[] };
  /** Demonstration scenarios (parallel to Title's scenario cards). */
  scenarios?: VerticalScenario[];
}

export interface VerticalWorkflowStep {
  id: string;
  label: string;
  owner: string;
  state: "complete" | "active" | "blocked" | "pending";
  evidence: string;
}

export interface VerticalSafetyDrill {
  id: string;
  label: string;
  posture: "green" | "amber" | "red";
  current: string;
  invariant: string;
  evidence: string;
}

export interface VerticalEvidenceSample {
  bundleVersion: string;
  /** Key/value rows rendered in the bundle detail grid. */
  fields: Array<{ k: string; v: string; mono?: boolean }>;
  profile: string[];
  redactedFields: string[];
  bundleHash: string;
  verification: "ok" | "blocked";
}

export interface VerticalScenario {
  id: string;
  label: string;
  expected: "ALLOW" | "REFUSE" | "ESCALATE";
  rationale: string;
}

export const VERTICAL_REGISTRY: Record<VerticalId, VerticalConfig> = {
  automotive: {
    id: "automotive",
    name: "Automotive Fleet",
    framing: "Autonomous vehicle fleet (NHTSA, ISO 21448 SOTIF, UN R155)",
    purpose:
      "Govern autonomous vehicle actions from mission acceptance through admitted execution to safety evidence export.",
    regulatory: ["NHTSA", "ISO 21448 SOTIF", "UN R155 cybersecurity", "UN R156 SUMS", "ISO 26262", "SAE J3061"],
    adapters: [
      { id: "fleet-mission", label: "Fleet mission accept / reject", actionTypes: ["fleet.mission.accept"], boundary: "Fleet Mgmt System" },
      { id: "drive-by-wire", label: "Drive-by-wire commands", actionTypes: ["vehicle.steering.set", "vehicle.brake.apply"], boundary: "Vehicle DBW gateway" },
      { id: "remote-takeover", label: "Remote teleop takeover", actionTypes: ["teleop.takeover.engage"], boundary: "Teleop service" },
      { id: "fleet-historian", label: "Fleet historian write", actionTypes: ["fleet.historian.write"], boundary: "Historian / SOC archive" }
    ],
    hardInterlocks: ["vehicle.disable_collision_avoidance", "vehicle.bypass_lane_constraints", "warrant.reuse_attempt"],
    presets: { label: "Fleet operations regions", states: ["US-MT", "US-CA", "EU-DE", "JP"] },
    testSurface: { tests: 75, suite: "execution-control-runtime" },
    hasDedicatedConsole: true,
    dedicatedSectionId: "fleet"
  },
  aviation: {
    id: "aviation",
    name: "Aviation / UAV / eVTOL",
    framing: "FAA Part 107/108/91/135 + Remote ID + LAANC + ASTM F3548 UTM + SORA",
    purpose:
      "Govern UAV, eVTOL, and crewed-vehicle automation before flight commands cross into the airspace.",
    regulatory: ["14 CFR Part 107", "14 CFR Part 108", "14 CFR Part 91", "14 CFR Part 135", "14 CFR Part 89", "LAANC", "ASTM F3548", "SORA"],
    adapters: [
      { id: "uss-utm", label: "USS / UTM authorization", actionTypes: ["aviation.utm.authorize"], boundary: "USS provider" },
      { id: "flight-control", label: "Flight-control commands", actionTypes: ["aviation.flight.takeoff", "aviation.flight.land"], boundary: "Autopilot" },
      { id: "geofence", label: "Geofence activate / breach", actionTypes: ["aviation.geofence.activate"], boundary: "Onboard geofence" },
      { id: "remote-id", label: "Remote ID broadcast", actionTypes: ["aviation.remote_id.start"], boundary: "Remote ID module" },
      { id: "daa", label: "Detect & avoid arm", actionTypes: ["aviation.daa.arm"], boundary: "DAA sensor stack" }
    ],
    hardInterlocks: ["aviation.disable_daa", "aviation.bypass_geofence", "aviation.disable_remote_id", "warrant.reuse_attempt"],
    presets: { label: "Operating regions / waivers", states: ["FAA-Part107", "FAA-Part108", "EASA", "Transport-Canada"] },
    testSurface: { tests: 75, suite: "execution-control-runtime (aviation slice)" },
    hasDedicatedConsole: false,
    workflow: [
      { id: "mission", label: "Mission intake (operator, area, payload, waiver)", owner: "Flight operator", state: "complete", evidence: "Canonical Governed Action recorded" },
      { id: "authority", label: "Authority Envelope resolved (Part 107/108 + waivers)", owner: "Authority service", state: "complete", evidence: "Envelope unrevoked, signer authorized" },
      { id: "preflight", label: "Pre-flight checks (DAA, Remote ID, C2 link, RTL reserve, weather)", owner: "Pre-flight adapters", state: "complete", evidence: "All checks passed; readiness pinned" },
      { id: "airspace", label: "Airspace authorization (LAANC / USS)", owner: "USS / UTM provider", state: "complete", evidence: "Authorization id bound" },
      { id: "commit", label: "Commit Gate decision (ALLOW / REFUSE / ESCALATE)", owner: "Commit Gate", state: "active", evidence: "Decision pinned to rule-set version" },
      { id: "warrant", label: "Single-use Flight Warrant issued (Ed25519)", owner: "Warrant service", state: "pending", evidence: "Warrant consumed before takeoff" },
      { id: "evidence", label: "Aviation Evidence Bundle exported", owner: "GEL exporter", state: "pending", evidence: "aristotle.aviation-evidence.v1, signed + hash-chained" }
    ],
    safetyDrills: [
      { id: "daa", label: "Detect-and-Avoid health", posture: "green", current: "DAA armed; sensor fusion nominal", invariant: "require_daa_armed: true", evidence: "Pinned at commit time" },
      { id: "remote-id", label: "Remote ID broadcast", posture: "green", current: "Broadcasting per Part 89", invariant: "require_remote_id_broadcasting: true", evidence: "FAA-compliant Remote ID payload" },
      { id: "c2", label: "C2 link health", posture: "amber", current: "Latency 240ms (limit 400ms)", invariant: "max_c2_latency_ms: 400", evidence: "Telemetry snapshot in GEL" },
      { id: "rtl", label: "Return-to-launch reserve", posture: "green", current: "Battery 78% (RTL reserve 25%)", invariant: "require_rtl_battery_above_reserve: true", evidence: "Battery state-of-charge captured" }
    ],
    evidenceSample: {
      bundleVersion: "aristotle.aviation-evidence.v1",
      fields: [
        { k: "Operator", v: "operator:demo-flight-svc" },
        { k: "Aircraft", v: "uav:demo-quad-001", mono: true },
        { k: "Mission", v: "FLIGHT-DEMO-MT-2026-05-26-007", mono: true },
        { k: "Airspace authorization", v: "LAANC-2026-05-26-AB12CD", mono: true },
        { k: "Waiver state", v: "Part 107 standard" },
        { k: "Bundle hash", v: "0xabcd1234...e9f0", mono: true }
      ],
      profile: ["aristotle.aviation-evidence.v1", "FAA-Part107", "FAA-Part89", "aristotle.evidence-base.v1"],
      redactedFields: ["operator_phone", "exact_takeoff_coords"],
      bundleHash: "0xabcd1234...e9f0",
      verification: "ok"
    },
    boundaryChainLabels: ["Intent", "Ward", "Pre-flight", "Adapter", "GEL"],
    failClosedRule: {
      description:
        "Missing airspace authorization, disabled DAA, missing Remote ID broadcast, unhealthy C2 link, missing return-to-launch reserve, active TFR / NOTAM violation, or unsupported waiver — prevents Warrant issuance before any flight command reaches the aircraft.",
      chips: ["UTM", "DAA", "Remote ID", "weather", "TFR", "RTL"]
    },
    scenarios: [
      { id: "clean", label: "Part 107 daylight survey, full health", expected: "ALLOW", rationale: "All pre-flight checks pass; LAANC authorization current; battery + reserve above RTL." },
      { id: "no-daa", label: "Operator attempts takeoff with DAA disabled", expected: "REFUSE", rationale: "Hard interlock: aviation.disable_daa is refused regardless of envelope." },
      { id: "bvlos-no-waiver", label: "BVLOS without Part 108 / waiver on file", expected: "REFUSE", rationale: "Authority Envelope does not permit BVLOS without a current waiver." },
      { id: "weather", label: "Wind exceeds operating limit", expected: "REFUSE", rationale: "Pre-flight check fails: weather not within limits." },
      { id: "expired-laanc", label: "LAANC authorization expired mid-flight", expected: "ESCALATE", rationale: "Authorization expired; ground control approval required to land via abnormal procedure." }
    ]
  },
  grid: {
    id: "grid",
    name: "Electric Grid",
    framing: "NERC CIP + DERMS + relay protection + breaker switching",
    purpose:
      "Govern switching, DERMS, relay, and substation actions before any field-energizing consequence.",
    regulatory: ["NERC CIP-002 to CIP-014", "FERC Order 2222", "IEC 61850", "IEEE 1547"],
    adapters: [
      { id: "scada-write", label: "SCADA setpoint write", actionTypes: ["grid.scada.set"], boundary: "SCADA / EMS" },
      { id: "breaker", label: "Breaker open / close", actionTypes: ["grid.breaker.open", "grid.breaker.close"], boundary: "Substation RTU" },
      { id: "derms", label: "DERMS dispatch", actionTypes: ["grid.derms.dispatch"], boundary: "DER aggregator" },
      { id: "relay", label: "Relay setting change", actionTypes: ["grid.relay.set"], boundary: "Protection relay" }
    ],
    hardInterlocks: ["grid.disable_relay_protection", "grid.bypass_synchrocheck", "warrant.reuse_attempt"],
    presets: { label: "Balancing authorities", states: ["MISO", "PJM", "ERCOT", "CAISO", "NYISO"] },
    testSurface: { tests: 75, suite: "execution-control-runtime (grid slice)" },
    hasDedicatedConsole: true,
    dedicatedSectionId: "grid"
  },
  healthcare: {
    id: "healthcare",
    name: "Healthcare Clinical Operations",
    framing: "HIPAA + TPO basis + FHIR + HL7 + medical-device + claims",
    purpose:
      "Govern EHR, pharmacy, PHI, device, claims, and patient workflows before any clinical consequence.",
    regulatory: ["HIPAA Security Rule", "HIPAA Privacy Rule", "21 CFR Part 11", "FHIR R4", "HL7 v2", "FDA 21 CFR Part 820"],
    adapters: [
      { id: "ehr-write", label: "EHR writeback", actionTypes: ["healthcare.ehr.write"], boundary: "EHR" },
      { id: "pharmacy", label: "Pharmacy order", actionTypes: ["healthcare.rx.order"], boundary: "Pharmacy system" },
      { id: "device", label: "Medical-device command", actionTypes: ["healthcare.device.command"], boundary: "Medical device" },
      { id: "claims", label: "Claim attestation", actionTypes: ["healthcare.claim.attest"], boundary: "Payer integration" }
    ],
    hardInterlocks: ["healthcare.bypass_allergy_check", "healthcare.disable_dose_limit", "warrant.reuse_attempt"],
    presets: { label: "Care settings", states: ["acute", "ambulatory", "telehealth", "long-term"] },
    testSurface: { tests: 75, suite: "execution-control-runtime (healthcare slice)" },
    hasDedicatedConsole: true,
    dedicatedSectionId: "healthcare"
  },
  logistics: {
    id: "logistics",
    name: "Trucking & Logistics",
    framing: "Trucking / freight / HOS / cargo release / fuel / payment",
    purpose:
      "Govern dispatch, tender, HOS, route, cargo release, fuel, and payment before any freight consequence.",
    regulatory: ["49 CFR Part 395 HOS", "49 CFR Part 390-399", "PIP / C-TPAT", "FMCSA SMS"],
    adapters: [
      { id: "tender", label: "Load tender accept", actionTypes: ["logistics.load.accept"], boundary: "TMS" },
      { id: "hos", label: "HOS dispatch check", actionTypes: ["logistics.hos.dispatch"], boundary: "ELD" },
      { id: "cargo-release", label: "Cargo release", actionTypes: ["logistics.cargo.release"], boundary: "Terminal yard mgmt" },
      { id: "fuel", label: "Fuel card auth", actionTypes: ["logistics.fuel.auth"], boundary: "Fuel network" }
    ],
    hardInterlocks: ["logistics.bypass_hos", "logistics.override_seal_break", "warrant.reuse_attempt"],
    presets: { label: "Freight lanes", states: ["LTL", "FTL", "intermodal", "cross-border-MX", "cross-border-CA"] },
    testSurface: { tests: 75, suite: "execution-control-runtime (logistics slice)" },
    hasDedicatedConsole: true,
    dedicatedSectionId: "logistics"
  },
  mining: {
    id: "mining",
    name: "Mining",
    framing: "MSHA 30 CFR + ISO 17757 + ICMM GISTM",
    purpose:
      "Govern autonomous haul, drilling, blasting, ventilation, tailings, and methane-monitoring actions.",
    regulatory: ["MSHA 30 CFR Part 56/57", "MSHA 30 CFR Part 75/77", "ISO 17757 ASM safety", "ICMM GISTM tailings"],
    adapters: [
      { id: "haul", label: "Autonomous haul truck", actionTypes: ["mining.haul.dispatch"], boundary: "Fleet mgmt" },
      { id: "drill", label: "Autonomous drill", actionTypes: ["mining.drill.start"], boundary: "Drill controller" },
      { id: "blast", label: "Blast initiation", actionTypes: ["mining.blast.initiate"], boundary: "Blast controller" },
      { id: "ventilation", label: "Underground ventilation", actionTypes: ["mining.ventilation.set"], boundary: "Vent network" },
      { id: "tailings", label: "Tailings dam telemetry", actionTypes: ["mining.tailings.read"], boundary: "Tailings sensor net" }
    ],
    hardInterlocks: ["mining.bypass_methane_threshold", "mining.disable_proximity_detection", "mining.override_tailings_alarm", "warrant.reuse_attempt"],
    presets: { label: "Operating jurisdictions", states: ["US-MSHA", "AU-NSW", "CA-BC", "CL-COCHILCO", "ZA-DMRE"] },
    testSurface: { tests: 75, suite: "execution-control-runtime (mining slice)" },
    hasDedicatedConsole: false,
    workflow: [
      { id: "plan", label: "Plan dispatch (pit, bench, route)", owner: "Mine planner", state: "complete", evidence: "Plan version pinned" },
      { id: "authority", label: "Authority Envelope resolved (MSHA + operator)", owner: "Authority service", state: "complete", evidence: "Operator-qualified, envelope unrevoked" },
      { id: "preflight", label: "Pre-dispatch checks (proximity, methane, tailings alarm)", owner: "Safety adapters", state: "complete", evidence: "All checks passed" },
      { id: "commit", label: "Commit Gate decision", owner: "Commit Gate", state: "active", evidence: "Decision bound to rule-set" },
      { id: "warrant", label: "Single-use Operations Warrant issued", owner: "Warrant service", state: "pending", evidence: "Warrant consumed before haul / drill / blast" },
      { id: "execute", label: "Dispatch to autonomous fleet / drill / blast controller", owner: "Mine ops adapter", state: "pending", evidence: "Adapter receipt bound" },
      { id: "evidence", label: "Mining Evidence Bundle exported", owner: "GEL exporter", state: "pending", evidence: "aristotle.mining-evidence.v1, signed + hash-chained" }
    ],
    safetyDrills: [
      { id: "methane", label: "Methane threshold (underground)", posture: "green", current: "0.4% CH4 (limit 1.0% per MSHA)", invariant: "max_methane_pct: 1.0", evidence: "Gas detector telemetry in GEL" },
      { id: "proximity", label: "Proximity detection (autonomous haul)", posture: "green", current: "PDS armed; all 6 units detected", invariant: "require_proximity_detection: true", evidence: "PDS state pinned at commit" },
      { id: "tailings", label: "Tailings dam telemetry (ICMM GISTM)", posture: "amber", current: "Pore pressure +12% baseline; below trigger", invariant: "require_tailings_alarm_clear: true", evidence: "TARP record in GEL" },
      { id: "ventilation", label: "Ventilation network", posture: "green", current: "Airflow 78 m3/s (min 60)", invariant: "min_airflow_m3s: 60", evidence: "Vent telemetry captured" }
    ],
    evidenceSample: {
      bundleVersion: "aristotle.mining-evidence.v1",
      fields: [
        { k: "Operator", v: "operator:demo-mining-co" },
        { k: "Site", v: "pit-demo-mt-001", mono: true },
        { k: "Dispatch", v: "DSP-MT-2026-05-26-014", mono: true },
        { k: "Vehicle", v: "haul:auto-truck-12", mono: true },
        { k: "Jurisdiction", v: "US-MSHA" },
        { k: "Bundle hash", v: "0xbeef9876...a1b2", mono: true }
      ],
      profile: ["aristotle.mining-evidence.v1", "MSHA-30-CFR-56", "MSHA-30-CFR-75", "ICMM-GISTM", "aristotle.evidence-base.v1"],
      redactedFields: ["operator_employee_ids", "exact_blast_coords"],
      bundleHash: "0xbeef9876...a1b2",
      verification: "ok"
    },
    boundaryChainLabels: ["Intent", "Ward", "Safety checks", "Adapter", "GEL"],
    failClosedRule: {
      description:
        "Methane above threshold, proximity detection disabled, tailings alarm active, ventilation below minimum, miner-not-in-safe-zone for blast, or operator without current MSHA qualification — prevents Warrant issuance before haul, drill, blast, or ventilation command leaves the gate.",
      chips: ["MSHA", "PDS", "GISTM", "OQ", "ventilation"]
    },
    scenarios: [
      { id: "clean", label: "Clean autonomous haul dispatch", expected: "ALLOW", rationale: "PDS armed, all safety telemetry within limits, operator qualified." },
      { id: "methane", label: "Methane reading above MSHA limit", expected: "REFUSE", rationale: "Hard refusal via max_methane_pct bound." },
      { id: "pds-off", label: "Operator attempts dispatch with PDS disabled", expected: "REFUSE", rationale: "Hard interlock: mining.disable_proximity_detection." },
      { id: "tailings-trip", label: "Tailings TARP trigger fires", expected: "ESCALATE", rationale: "Dual control required: mine manager + tailings engineer." },
      { id: "blast", label: "Blast initiation outside cleared window", expected: "REFUSE", rationale: "Required readiness (window_open, miners_clear) not satisfied." }
    ]
  },
  pipeline: {
    id: "pipeline",
    name: "Pipeline (Oil & Gas)",
    framing: "49 CFR 192/195 + API 1164/1173/RP 1175",
    purpose:
      "Govern SCADA setpoints, valve / compressor commands, leak-detection response, and pigging operations.",
    regulatory: ["49 CFR Part 192", "49 CFR Part 195", "CRM 192.631/195.446", "OQ 192.801/195.501", "API 1164", "API 1173", "API RP 1175"],
    adapters: [
      { id: "scada", label: "SCADA setpoint", actionTypes: ["pipeline.scada.set"], boundary: "Pipeline SCADA" },
      { id: "valve", label: "Mainline valve open/close", actionTypes: ["pipeline.valve.open", "pipeline.valve.close"], boundary: "ROC" },
      { id: "compressor", label: "Compressor station", actionTypes: ["pipeline.compressor.start"], boundary: "Compressor controller" },
      { id: "leak-detection", label: "Leak-detection response", actionTypes: ["pipeline.leak.respond"], boundary: "CPM / LDS" },
      { id: "pigging", label: "Pigging operations", actionTypes: ["pipeline.pig.launch"], boundary: "Pig launcher" }
    ],
    hardInterlocks: ["pipeline.disable_leak_detection", "pipeline.bypass_overpressure_protection", "pipeline.disable_esd", "warrant.reuse_attempt"],
    presets: { label: "Operating regions", states: ["PHMSA-US", "AER-Canada", "ANP-Brazil"] },
    testSurface: { tests: 75, suite: "execution-control-runtime (pipeline slice)" },
    hasDedicatedConsole: false,
    workflow: [
      { id: "intent", label: "Operator intent (e.g. valve close, compressor restart)", owner: "Pipeline controller", state: "complete", evidence: "Canonical Governed Action recorded" },
      { id: "authority", label: "Authority Envelope resolved (controller + OQ)", owner: "Authority service", state: "complete", evidence: "Envelope unrevoked, controller OQ valid" },
      { id: "preflight", label: "Bound checks (LDS, ESD, overpressure, MAOP, fresh SCADA)", owner: "Pre-commit adapters", state: "complete", evidence: "All bounds pinned at commit time" },
      { id: "commit", label: "Commit Gate decision", owner: "Commit Gate", state: "active", evidence: "Decision bound to rule-set" },
      { id: "warrant", label: "Single-use Operations Warrant issued", owner: "Warrant service", state: "pending", evidence: "Warrant consumed before SCADA write" },
      { id: "submit", label: "Outbound to SCADA / ROC / compressor controller", owner: "Pipeline adapter", state: "pending", evidence: "Adapter receipt bound" },
      { id: "evidence", label: "Pipeline Evidence Bundle exported", owner: "GEL exporter", state: "pending", evidence: "aristotle.pipeline-evidence.v1, signed + hash-chained" }
    ],
    safetyDrills: [
      { id: "maop", label: "Pressure vs. MAOP", posture: "green", current: "1180 psig (78% of MAOP)", invariant: "max_pct_maop: 100", evidence: "SCADA snapshot at commit time" },
      { id: "lds", label: "Leak detection (CPM)", posture: "green", current: "CPM online; baseline drift < 0.5%", invariant: "require_leak_detection: true", evidence: "LDS state pinned" },
      { id: "esd", label: "Emergency Shutdown system", posture: "green", current: "ESD armed; all block valves healthy", invariant: "require_esd_armed: true", evidence: "ESD state captured" },
      { id: "scada-fresh", label: "SCADA freshness", posture: "amber", current: "Latest tag age 18s (limit 30s)", invariant: "max_scada_age_s: 30", evidence: "Telemetry age bound" }
    ],
    evidenceSample: {
      bundleVersion: "aristotle.pipeline-evidence.v1",
      fields: [
        { k: "Operator", v: "operator:demo-pipeline-co" },
        { k: "System", v: "pl-demo-mainline-001", mono: true },
        { k: "Segment", v: "MP-145 to MP-198" },
        { k: "Action", v: "pipeline.valve.close" },
        { k: "Region", v: "PHMSA-US" },
        { k: "Bundle hash", v: "0xfedc4321...e3f4", mono: true }
      ],
      profile: ["aristotle.pipeline-evidence.v1", "49-CFR-Part-192", "API-1164", "API-1173", "aristotle.evidence-base.v1"],
      redactedFields: ["operator_employee_ids", "exact_valve_coords"],
      bundleHash: "0xfedc4321...e3f4",
      verification: "ok"
    },
    boundaryChainLabels: ["Intent", "Ward", "Bounds", "Adapter", "GEL"],
    failClosedRule: {
      description:
        "MAOP exceeded, leak-detection offline, ESD disabled, SCADA stale, MOP-segment mismatch, controller without current OQ, or one-call notification missing — prevents Warrant issuance before any setpoint, valve, or compressor command leaves the gate.",
      chips: ["49 CFR 192/195", "MAOP", "LDS", "ESD", "OQ", "CRM"]
    },
    scenarios: [
      { id: "clean", label: "Clean valve close in nominal conditions", expected: "ALLOW", rationale: "Pressure within MAOP, LDS online, ESD armed, controller OQ valid." },
      { id: "overpressure-override", label: "Operator attempts to bypass overpressure protection", expected: "REFUSE", rationale: "Hard interlock: pipeline.bypass_overpressure_protection." },
      { id: "lds-off", label: "LDS offline during high-consequence area transit", expected: "REFUSE", rationale: "require_leak_detection bound fails." },
      { id: "compressor-restart", label: "Compressor restart after trip", expected: "ESCALATE", rationale: "Dual control: controller + ROC supervisor." },
      { id: "expired-oq", label: "Controller without current OQ for the action class", expected: "REFUSE", rationale: "OQ 192.801/195.501 check fails." }
    ]
  },
  port: {
    id: "port",
    name: "Maritime Port Operations",
    framing: "Terminal + gate + crane + VTS + customs + shore-power",
    purpose:
      "Govern terminal, gate, crane, VTS, customs, and shore-power actions before port consequence.",
    regulatory: ["33 CFR Part 105 MTSA", "IMO ISPS Code", "USCG Sector authority", "AAPA security guidelines"],
    adapters: [
      { id: "terminal", label: "Terminal yard move", actionTypes: ["port.yard.move"], boundary: "TOS" },
      { id: "gate", label: "Gate transaction", actionTypes: ["port.gate.process"], boundary: "Gate OS" },
      { id: "crane", label: "Quay crane command", actionTypes: ["port.crane.move"], boundary: "Crane controller" },
      { id: "vts", label: "VTS clearance", actionTypes: ["port.vts.clear"], boundary: "VTS / USCG" }
    ],
    hardInterlocks: ["port.bypass_customs_hold", "port.disable_collision_safety", "warrant.reuse_attempt"],
    presets: { label: "Port operations", states: ["USCG-Sector-Houston", "USCG-Sector-LA-LB", "Rotterdam", "Singapore"] },
    testSurface: { tests: 75, suite: "execution-control-runtime (port slice)" },
    hasDedicatedConsole: true,
    dedicatedSectionId: "port"
  },
  rail: {
    id: "rail",
    name: "Railroad Operations",
    framing: "Dispatch + PTC + wayside + switch + movement authority",
    purpose:
      "Govern dispatch, PTC, wayside, switch, and movement authority before any rail consequence.",
    regulatory: ["49 CFR Part 236 (PTC)", "49 CFR Part 234", "AAR Rule 49", "FRA orders"],
    adapters: [
      { id: "dispatch", label: "Dispatch authority", actionTypes: ["rail.movement.authorize"], boundary: "Dispatcher CADS" },
      { id: "ptc", label: "PTC interaction", actionTypes: ["rail.ptc.command"], boundary: "PTC back-office" },
      { id: "switch", label: "Switch throw", actionTypes: ["rail.switch.throw"], boundary: "Interlocking" },
      { id: "wayside", label: "Wayside signal", actionTypes: ["rail.signal.set"], boundary: "Wayside CTC" }
    ],
    hardInterlocks: ["rail.bypass_ptc", "rail.disable_track_circuit_check", "warrant.reuse_attempt"],
    presets: { label: "Operating jurisdictions", states: ["Class-I-US", "Class-II-US", "Short-line-US", "VIA-Canada"] },
    testSurface: { tests: 75, suite: "execution-control-runtime (rail slice)" },
    hasDedicatedConsole: true,
    dedicatedSectionId: "rail"
  },
  robotics: {
    id: "robotics",
    name: "Robotics / Humanoid",
    framing: "ISO 10218 + ISO/TS 15066 PFL/SSM + ISO 13482 + ISO 13849 + IEC 61508",
    purpose:
      "Govern industrial, collaborative, service, and humanoid-robot motion before consequence.",
    regulatory: ["ISO 10218-1/2 industrial robots", "ISO/TS 15066 collaborative PFL+SSM", "ISO 13482 personal-care robots", "ISO 13849 PL-d/e", "IEC 61508 SIL"],
    adapters: [
      { id: "motion", label: "Motion command", actionTypes: ["robotics.motion.execute"], boundary: "Robot controller" },
      { id: "gripper", label: "End-effector / payload", actionTypes: ["robotics.gripper.grasp"], boundary: "EOAT" },
      { id: "collab", label: "Collaborative-mode transition", actionTypes: ["robotics.collab.engage"], boundary: "Safety controller" },
      { id: "human-near", label: "Human-proximity policy", actionTypes: ["robotics.policy.human_present"], boundary: "Vision / lidar safety" }
    ],
    hardInterlocks: ["robotics.disable_estop", "robotics.bypass_force_limits", "robotics.override_collab_mode", "warrant.reuse_attempt"],
    presets: { label: "Deployment classes", states: ["ISO-10218-PL-d", "ISO-15066-PFL", "ISO-15066-SSM", "ISO-13482-personal-care"] },
    testSurface: { tests: 75, suite: "execution-control-runtime (robotics slice)" },
    hasDedicatedConsole: false,
    workflow: [
      { id: "intent", label: "Motion intent (cell, path, payload, EOAT)", owner: "Robot orchestrator", state: "complete", evidence: "Canonical Governed Action recorded" },
      { id: "authority", label: "Authority Envelope resolved (cell + role)", owner: "Authority service", state: "complete", evidence: "Envelope unrevoked, operator authorized" },
      { id: "preflight", label: "Safety bounds (force, speed, separation, e-stop, mode)", owner: "Safety controller", state: "complete", evidence: "Bounds pinned" },
      { id: "human-near", label: "Human-proximity check (vision/lidar safety zone)", owner: "Perception safety", state: "complete", evidence: "Zone status captured" },
      { id: "commit", label: "Commit Gate decision", owner: "Commit Gate", state: "active", evidence: "Decision bound to rule-set" },
      { id: "warrant", label: "Single-use Motion Warrant issued", owner: "Warrant service", state: "pending", evidence: "Warrant consumed before motion command" },
      { id: "evidence", label: "Robotics Evidence Bundle exported", owner: "GEL exporter", state: "pending", evidence: "aristotle.robotics-evidence.v1, signed + hash-chained" }
    ],
    safetyDrills: [
      { id: "estop", label: "E-stop circuit health", posture: "green", current: "PL-e circuit closed, all 4 buttons responsive", invariant: "require_estop_circuit_closed: true", evidence: "Safety PLC telemetry" },
      { id: "force-pfl", label: "Force limit (PFL collaborative)", posture: "green", current: "Peak 87 N (TS 15066 transient limit 150 N)", invariant: "max_pfl_force_n: 150", evidence: "FT sensor pinned at commit" },
      { id: "ssm", label: "Speed-and-Separation Monitoring", posture: "amber", current: "Separation 0.85 m (min 0.5 m)", invariant: "min_separation_m: 0.5", evidence: "Perception state captured" },
      { id: "humanoid", label: "Humanoid balance / fall protection", posture: "green", current: "CoM deviation 3.2 cm (limit 8 cm)", invariant: "max_com_deviation_cm: 8", evidence: "Balance controller state" }
    ],
    evidenceSample: {
      bundleVersion: "aristotle.robotics-evidence.v1",
      fields: [
        { k: "Operator", v: "operator:demo-robotics-co" },
        { k: "Cell", v: "cell-demo-assembly-A", mono: true },
        { k: "Robot", v: "robot:demo-cobot-007", mono: true },
        { k: "Class", v: "ISO-15066-PFL" },
        { k: "Action", v: "robotics.motion.execute" },
        { k: "Bundle hash", v: "0x9876fedc...c1d2", mono: true }
      ],
      profile: ["aristotle.robotics-evidence.v1", "ISO-10218", "ISO-15066", "ISO-13482", "ISO-13849", "IEC-61508", "aristotle.evidence-base.v1"],
      redactedFields: ["worker_employee_ids", "exact_cell_layout"],
      bundleHash: "0x9876fedc...c1d2",
      verification: "ok"
    },
    boundaryChainLabels: ["Intent", "Ward", "Safety", "Adapter", "GEL"],
    failClosedRule: {
      description:
        "E-stop circuit open, force limit exceeded, separation distance below SSM minimum, collaborative mode override attempt, humanoid CoM deviation outside envelope, missing payload limit, or missing operator authorization — prevents Warrant issuance before any motion command reaches the robot controller.",
      chips: ["ISO 10218", "ISO/TS 15066", "ISO 13482", "ISO 13849", "IEC 61508"]
    },
    scenarios: [
      { id: "clean", label: "Clean PFL pick-and-place", expected: "ALLOW", rationale: "Force, speed, separation, mode, e-stop all within ISO/TS 15066 PFL limits." },
      { id: "estop-disabled", label: "Operator attempts to disable e-stop", expected: "REFUSE", rationale: "Hard interlock: robotics.disable_estop." },
      { id: "ssm-breach", label: "Worker enters SSM minimum-separation zone", expected: "REFUSE", rationale: "min_separation_m bound fails." },
      { id: "collab-switch", label: "Switch from PFL to industrial mode mid-task", expected: "ESCALATE", rationale: "Dual control: cell safety lead + operator." },
      { id: "humanoid-fall", label: "Humanoid balance controller flags imminent fall", expected: "REFUSE", rationale: "max_com_deviation_cm bound fails; controller refuses motion." }
    ]
  },
  space: {
    id: "space",
    name: "Space Launch",
    framing: "FAA Part 450 + AST + SLD-30/45 + NASA NPR 8715.5 + ITAR + FCC + UN OST",
    purpose:
      "Govern countdown, propellant, ignition, flight termination, and payload deploy before any range consequence.",
    regulatory: ["14 CFR Part 450", "14 CFR Part 415/417", "FAA AST license", "USSF SLD-30/45 range safety", "NASA NPR 8715.5", "ITAR USML IV+XV", "EAR", "FCC Part 25/87", "UN Outer Space Treaty"],
    adapters: [
      { id: "range-safety", label: "Range Safety / Commander authority", actionTypes: ["space.range_commander_go", "space.range_clear_declare"], boundary: "Range commander" },
      { id: "propellant", label: "Propellant load / drain", actionTypes: ["space.propellant_load"], boundary: "Propellant farm" },
      { id: "ignition", label: "Igniter arm / ignite", actionTypes: ["space.igniter_arm", "space.ignite"], boundary: "Engine controller" },
      { id: "fts", label: "Flight Termination System", actionTypes: ["space.fts_arm", "space.fts_trigger"], boundary: "FTS receiver" },
      { id: "payload", label: "Payload deploy / despin", actionTypes: ["space.payload_deploy"], boundary: "Payload adapter" },
      { id: "weather-winds", label: "Weather / winds-aloft", actionTypes: ["space.weather_constraint_acknowledge"], boundary: "Range weather" }
    ],
    hardInterlocks: [
      "space.disable_flight_termination", "space.override_range_safety",
      "space.bypass_collision_avoidance", "space.ignite_outside_window",
      "space.bypass_wind_limits", "space.override_propellant_limits",
      "space.bypass_pad_interlocks", "space.payload_deploy_outside_primary",
      "warrant.reuse_attempt"
    ],
    presets: { label: "Launch sites (DEMO)", states: ["ccsfs", "vandenberg", "wallops", "starbase", "kodiak", "mojave"] },
    testSurface: { tests: 12, suite: "space.test.ts" },
    hasDedicatedConsole: false,
    workflow: [
      { id: "intent", label: "Operator intent (terminal count, propellant load, ignite)", owner: "Launch director", state: "complete", evidence: "Canonical Governed Action recorded" },
      { id: "authority", label: "Authority Envelope (operator + range commander)", owner: "Authority service", state: "complete", evidence: "Envelope unrevoked, signer authorized" },
      { id: "preflight", label: "Range / weather / FTS / AFTS / propellant / ITAR / comms checks", owner: "Pre-launch adapters", state: "complete", evidence: "Bounds pinned at commit time" },
      { id: "range-go", label: "Range Commander GO concurrence", owner: "Range commander", state: "complete", evidence: "Range GO captured" },
      { id: "commit", label: "Commit Gate decision (ALLOW / REFUSE / ESCALATE)", owner: "Commit Gate", state: "active", evidence: "Decision bound to site rule-set" },
      { id: "warrant", label: "Single-use Launch Warrant issued (dual-control)", owner: "Warrant service", state: "pending", evidence: "Two approvers consumed before ignition" },
      { id: "evidence", label: "Space Evidence Bundle exported", owner: "GEL exporter", state: "pending", evidence: "aristotle.space-evidence.v1, signed + hash-chained" }
    ],
    safetyDrills: [
      { id: "fts", label: "Flight Termination System health", posture: "green", current: "FTS + AFTS nominal, RF link OK, battery within envelope", invariant: "require_fts_armed + require_afts_nominal", evidence: "Range telemetry pinned" },
      { id: "wind", label: "Surface + upper wind", posture: "amber", current: "Surface 18 kts (limit 30), shear 22 kts/kft (limit 30)", invariant: "max_surface_wind_kts / max_upper_wind_shear_kts_per_kft", evidence: "Range weather snapshot" },
      { id: "range-clear", label: "Range clear (hazard area)", posture: "green", current: "Ships / aircraft / overflight all clear", invariant: "require_range_clear + require_hazard_area_cleared", evidence: "VTS + ATC + USCG inputs" },
      { id: "itar", label: "ITAR / comms posture", posture: "green", current: "USML IV+XV pre-clearance on file; FCC Part 25 filed", invariant: "require_itar_cleared + require_comms_licensed", evidence: "Pre-clearance refs in bundle" }
    ],
    evidenceSample: {
      bundleVersion: "aristotle.space-evidence.v1",
      fields: [
        { k: "Operator", v: "operator:demo-launch" },
        { k: "Flight", v: "FL-DEMO-CCSFS-2026-05-26-001", mono: true },
        { k: "Vehicle", v: "demo-orbital-class", mono: true },
        { k: "Site", v: "CCSFS (SLD-45)" },
        { k: "Site rule pack", v: "ccsfs-demo-2026-05-26", mono: true },
        { k: "Bundle hash", v: "0xa1b2c3d4...e5f6", mono: true }
      ],
      profile: ["aristotle.space-evidence.v1", "FAA-Part-450", "FAA-AST-license", "USSF-SLD-45-Range-Safety", "ITAR-USML-IV", "ITAR-USML-XV", "FCC-Part-25", "aristotle.evidence-base.v1"],
      redactedFields: ["payload_telemetry", "exact_trajectory"],
      bundleHash: "0xa1b2c3d4...e5f6",
      verification: "ok"
    },
    boundaryChainLabels: ["Intent", "Ward", "Range checks", "Adapter", "GEL"],
    failClosedRule: {
      description:
        "FTS / AFTS not armed, surface or upper wind above site limit, range not clear, hazard area not cleared, tracking radar not acquired, ITAR or comms pre-clearance missing, range commander GO not issued, or a hard interlock attempt — prevents Warrant issuance before any countdown advance, ignition, or FTS state change.",
      chips: ["Part 450", "FAA AST", "Range Safety", "FTS / AFTS", "ITAR", "FCC"]
    },
    scenarios: [
      { id: "clean", label: "Clean terminal count + ignite (dual-control)", expected: "ALLOW", rationale: "Range clear, weather + wind within limits, FTS armed, AFTS nominal, range commander GO, two approvers." },
      { id: "fts-off", label: "Operator attempts to disable FTS", expected: "REFUSE", rationale: "Hard interlock: space.disable_flight_termination." },
      { id: "wind-over", label: "Surface wind 35 kts exceeds site limit", expected: "REFUSE", rationale: "max_surface_wind_kts bound fails." },
      { id: "outside-window", label: "Ignite called outside launch window", expected: "REFUSE", rationale: "Hard interlock: space.ignite_outside_window." },
      { id: "payload-deploy-secondary", label: "Payload deploy outside primary insertion orbit", expected: "REFUSE", rationale: "Hard interlock: space.payload_deploy_outside_primary." },
      { id: "dual-control-pending", label: "Ignite request with only one approval", expected: "ESCALATE", rationale: "Dual control required: 2 approvers." }
    ]
  },
  swarm: {
    id: "swarm",
    name: "UAV Swarm / Disconnected-First",
    framing: "Disconnected-first + Fluidity Tokens + Mesh Revocation + Part 101 balloon stress case",
    purpose:
      "Govern multi-vehicle swarm coordination through disconnect/mesh-relay states without losing authority.",
    regulatory: ["14 CFR Part 107", "14 CFR Part 101 (balloon stress case)", "ASTM F3548 UTM", "USAF / DOD MIL-STD swarm doctrines"],
    adapters: [
      { id: "swarm-authority", label: "Swarm Authority Envelope", actionTypes: ["swarm.envelope.delegate"], boundary: "Swarm root authority" },
      { id: "disconnected-commit", label: "Disconnected Commit Gate", actionTypes: ["swarm.commit.local"], boundary: "Edge gate" },
      { id: "mesh-revocation", label: "Mesh Revocation Protocol", actionTypes: ["swarm.revoke.propagate"], boundary: "Mesh layer" },
      { id: "fluidity-token", label: "Fluidity Token (time-bounded)", actionTypes: ["swarm.fluidity.issue"], boundary: "Token service" },
      { id: "mission", label: "Mission acceptance", actionTypes: ["swarm.mission.accept"], boundary: "Mission planner" }
    ],
    hardInterlocks: ["swarm.disable_mesh_revocation", "swarm.bypass_fluidity_ttl", "swarm.override_disconnected_commit", "warrant.reuse_attempt"],
    presets: { label: "Mission classes", states: ["wildfire", "disaster-response", "comms-mesh", "agriculture", "range-ops", "infrastructure-inspection", "defense-perimeter", "reconnaissance", "high-altitude-launch"] },
    testSurface: { tests: 75, suite: "execution-control-runtime (swarm slice)" },
    hasDedicatedConsole: false,
    workflow: [
      { id: "intent", label: "Mission intent (class, area, swarm composition)", owner: "Mission commander", state: "complete", evidence: "Canonical Governed Action recorded" },
      { id: "authority", label: "Swarm Authority Envelope delegated", owner: "Authority service", state: "complete", evidence: "Envelope unrevoked, all units enrolled" },
      { id: "preflight", label: "Connectivity state, mesh health, Fluidity Token TTL", owner: "Mesh adapters", state: "complete", evidence: "Connectivity state captured" },
      { id: "commit", label: "Disconnected Commit Gate decision", owner: "Edge Commit Gate", state: "active", evidence: "Decision bound to local rule-set + Fluidity TTL" },
      { id: "warrant", label: "Flight Warrant issued (mesh-resilient)", owner: "Warrant service / edge", state: "pending", evidence: "Warrant signed for mesh propagation" },
      { id: "execute", label: "Per-unit dispatch (mesh-aware)", owner: "Swarm dispatcher", state: "pending", evidence: "Per-unit receipts collected" },
      { id: "evidence", label: "Mission Reconstruction Bundle exported", owner: "GEL exporter", state: "pending", evidence: "aristotle.swarm-evidence.v1, signed + hash-chained" }
    ],
    safetyDrills: [
      { id: "state", label: "Connectivity state machine", posture: "amber", current: "degraded (mesh-relay active, root unreachable 12 min)", invariant: "permitted_states: [connected, degraded, mesh-relay, hold-safe]", evidence: "State transitions in GEL" },
      { id: "fluidity", label: "Fluidity Token TTL", posture: "green", current: "TTL 4m 18s remaining", invariant: "min_fluidity_ttl_s: 60", evidence: "Token pinned at edge commit" },
      { id: "revocation", label: "Mesh Revocation Protocol health", posture: "green", current: "Last revocation gossip 23s ago (max 60s)", invariant: "require_mesh_revocation_active: true", evidence: "Gossip log fragment" },
      { id: "balloon", label: "Part 101 balloon (stress case)", posture: "green", current: "Altitude 28 km, geofenced, autonomous tracking active", invariant: "max_part101_altitude_km: 30", evidence: "Telemetry captured at upstream rejoin" }
    ],
    evidenceSample: {
      bundleVersion: "aristotle.swarm-evidence.v1",
      fields: [
        { k: "Mission", v: "MSN-DEMO-WILDFIRE-2026-05-26-003", mono: true },
        { k: "Mission class", v: "wildfire" },
        { k: "Commander", v: "actor:incident-commander" },
        { k: "Swarm size", v: "12 units (8 connected, 4 mesh-relay)" },
        { k: "Connectivity state", v: "degraded" },
        { k: "Bundle hash", v: "0x11223344...8899", mono: true }
      ],
      profile: ["aristotle.swarm-evidence.v1", "FAA-Part-107", "FAA-Part-101-stress-case", "ASTM-F3548-UTM", "aristotle.evidence-base.v1"],
      redactedFields: ["operator_phone", "exact_overflight_track"],
      bundleHash: "0x11223344...8899",
      verification: "ok"
    },
    boundaryChainLabels: ["Intent", "Swarm authority", "Edge commit", "Mesh adapter", "GEL"],
    failClosedRule: {
      description:
        "Mesh revocation disabled, Fluidity Token TTL exhausted, disconnected commit override attempt, connectivity state outside permitted set, balloon altitude outside Part 101 envelope, or swarm unit missing enrollment — prevents Warrant issuance / mesh propagation even at the edge.",
      chips: ["disconnected-first", "Fluidity Token", "Mesh Revocation", "Part 101", "ASTM F3548"]
    },
    scenarios: [
      { id: "clean-wildfire", label: "Wildfire mapping mission, fully connected", expected: "ALLOW", rationale: "All units enrolled; mesh + Fluidity + revocation healthy." },
      { id: "degraded-mesh", label: "Root unreachable; mesh-relay carries authority", expected: "ALLOW", rationale: "Disconnected commit with valid Fluidity Token + recent revocation gossip." },
      { id: "ttl-expired", label: "Fluidity Token expired without rejoin", expected: "REFUSE", rationale: "min_fluidity_ttl_s bound fails." },
      { id: "revocation-off", label: "Operator attempts to disable mesh revocation", expected: "REFUSE", rationale: "Hard interlock: swarm.disable_mesh_revocation." },
      { id: "balloon-extreme", label: "Part 101 balloon at 32 km altitude", expected: "REFUSE", rationale: "max_part101_altitude_km bound fails." },
      { id: "hold-safe", label: "Loss of mesh quorum triggers hold-safe", expected: "ESCALATE", rationale: "Auto-hold-safe; commander acknowledgement required to recover." }
    ]
  },
  telecom: {
    id: "telecom",
    name: "Telecom NOC",
    framing: "Autonomous network changes / NOC workflow / config / failover",
    purpose:
      "Govern autonomous network changes from mission to admitted execution to evidence export.",
    regulatory: ["FCC Part 76", "NIIF guidelines", "3GPP TS 33.501", "MEF service-orchestration"],
    adapters: [
      { id: "config", label: "Network config push", actionTypes: ["telecom.config.push"], boundary: "NMS" },
      { id: "failover", label: "Failover orchestration", actionTypes: ["telecom.failover.trigger"], boundary: "Site controller" },
      { id: "ran", label: "RAN cell change", actionTypes: ["telecom.ran.set"], boundary: "RAN OAM" }
    ],
    hardInterlocks: ["telecom.disable_e911_path", "telecom.bypass_change_window", "warrant.reuse_attempt"],
    presets: { label: "Operating tiers", states: ["Tier-1", "Tier-2", "Tier-3", "MVNO"] },
    testSurface: { tests: 75, suite: "execution-control-runtime (telecom slice)" },
    hasDedicatedConsole: true,
    dedicatedSectionId: "noc"
  },
  title: {
    id: "title",
    name: "Vehicle Title Transaction Layer",
    framing: "ELT + NMVTIS + ESIGN/UETA + 49 CFR Part 580 + UCC Article 9",
    purpose:
      "Govern vehicle title, lien, registration, and DMV-document actions before they cross into legal effect.",
    regulatory: ["State ELT statutes", "NMVTIS (AAMVA)", "49 CFR Part 580", "ESIGN Act", "UETA", "UCC Article 9", "State dealer licensing", "State lender authorization", "DLDV"],
    adapters: [
      { id: "elt-lien", label: "ELT Lien Release / Add", actionTypes: ["title.lien_release", "title.lien_add"], boundary: "Lender / state ELT hub" },
      { id: "title-tx", label: "Title transaction", actionTypes: ["title.transfer", "title.correction", "title.duplicate_issue"], boundary: "DMV title system" },
      { id: "registration", label: "Vehicle registration", actionTypes: ["title.registration_issue"], boundary: "DMV registration" },
      { id: "esign", label: "ESIGN / UETA digital sig", actionTypes: ["title.signature_capture"], boundary: "Signature provider" },
      { id: "dealer", label: "Dealer workflow", actionTypes: ["title.dealer_sale_submit"], boundary: "Dealer DMS" },
      { id: "lender", label: "Lender workflow", actionTypes: ["title.lender_payoff_confirm"], boundary: "Lender core" },
      { id: "dmv-submit", label: "DMV submission", actionTypes: ["title.dmv_submit_packet"], boundary: "State DMV endpoint" },
      { id: "fraud-check", label: "Fraud check", actionTypes: ["title.fraud_check_run"], boundary: "Identity provider" },
      { id: "nmvtis", label: "NMVTIS verification", actionTypes: ["title.nmvtis_query"], boundary: "AAMVA NMVTIS" }
    ],
    hardInterlocks: [
      "title.override_lien_release", "title.bypass_nmvtis", "title.bypass_theft_check",
      "title.bypass_state_rules", "title.override_dealer_license",
      "title.override_odometer_disclosure", "title.disable_identity_verification",
      "warrant.reuse_attempt"
    ],
    presets: { label: "Demonstration state presets", states: ["MT", "OR", "CA", "TX", "FL"] },
    testSurface: { tests: 22, suite: "title.test.ts" },
    hasDedicatedConsole: true,
    dedicatedSectionId: "title"
  },
  water: {
    id: "water",
    name: "Water Infrastructure",
    framing: "SCADA + PLC + pump + valve + dosing + discharge",
    purpose:
      "Govern SCADA, PLC, pump, valve, dosing, and discharge actions before any utility consequence.",
    regulatory: ["SDWA (Safe Drinking Water Act)", "CWA NPDES", "EPA Lead and Copper Rule", "AWIA cybersecurity"],
    adapters: [
      { id: "scada-water", label: "SCADA setpoint", actionTypes: ["water.scada.set"], boundary: "Plant SCADA" },
      { id: "pump", label: "Pump start / stop", actionTypes: ["water.pump.start"], boundary: "Pump VFD" },
      { id: "dosing", label: "Chemical dosing", actionTypes: ["water.dosing.set"], boundary: "Dosing pump" },
      { id: "discharge", label: "Discharge permit action", actionTypes: ["water.discharge.declare"], boundary: "NPDES reporting" }
    ],
    hardInterlocks: ["water.bypass_chlorine_residual", "water.override_disinfection_ct", "warrant.reuse_attempt"],
    presets: { label: "Utility classes", states: ["municipal-large", "municipal-small", "wholesale", "industrial-permitted"] },
    testSurface: { tests: 75, suite: "execution-control-runtime (water slice)" },
    hasDedicatedConsole: true,
    dedicatedSectionId: "water"
  }
};

export const VERTICAL_ORDER: VerticalId[] = [
  "automotive", "aviation", "grid", "healthcare", "logistics",
  "mining", "pipeline", "port", "rail", "robotics",
  "space", "swarm", "telecom", "title", "water"
];
