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
    hasDedicatedConsole: false
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
    hasDedicatedConsole: false
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
    hasDedicatedConsole: false
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
    hasDedicatedConsole: false
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
    hasDedicatedConsole: false
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
    hasDedicatedConsole: false
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
