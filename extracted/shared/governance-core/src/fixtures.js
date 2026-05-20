/**
 * Scenario fixtures. Each `build*` returns a fully-constituted, signed governance
 * world plus a `propose()` helper that issues a fresh single-use Warrant for a
 * specific act and returns a matching CommitRequest. The fixtures are the
 * worked examples from the spec and double as the substrate for the test suite.
 *
 *   A. Payments agent   — refund authority up to $500
 *   B. Drone swarm      — survey grid cells below 400 ft, telemetry-gated
 *   C. Healthcare       — may DRAFT but never SUBMIT a medication order
 *   D. Federation       — cross-Ward search zone across a trust bridge
 */
import { HmacKeyring } from "./hash.js";
import { isoPlusSeconds, newId, nowIso } from "./ids.js";
import { InMemoryGovernanceStore } from "./store.js";
import { appointGovernor, commitRequestFor, constituteWard, createAuthorityEnvelope, createFederationAgreement, createMae, issueWarrant, registerCommitGate, } from "./factory.js";
const KEY_ID = "key-root";
function world() {
    const store = new InMemoryGovernanceStore();
    const keyring = new HmacKeyring({ [KEY_ID]: "fixture-secret" });
    return { store, keyring, keyId: KEY_ID };
}
function originAct(actor, actorKind, method) {
    return { actor, actor_kind: actorKind, method, attested_at: nowIso(), attestation_ref: `att:${actor}`, presence_proof: `presence:${actor}` };
}
const past = () => isoPlusSeconds(new Date(), -3600);
// ---------------------------------------------------------------------------
// A. Payments agent — Company treasury domain, refund authority up to $500
// ---------------------------------------------------------------------------
export function buildPayments() {
    const { store, keyring, keyId } = world();
    const mae = createMae(store, keyring, keyId, {
        version: "1.0.0",
        issuer: "treasury.constitution",
        constitutional_scope: ["treasury", "payments"],
        ward_creation_rules: {
            allowed_ward_types: ["Institutional"],
            require_human_origin_act: true,
            allowed_origin_methods: ["institutional-charter", "key-ceremony"],
            allowed_domains: ["treasury", "payments"],
        },
        ward_amendment_rules: { authorized_amenders: ["treasury.board"] },
        ward_revocation_rules: { authorized_revokers: ["treasury.board"], cascade: true },
        authority_envelope_rules: {
            max_delegation_depth: 3,
            permitted_action_classes: ["payment.refund", "payment.read"],
            prohibited_action_classes: ["payment.wire.external"],
            require_telemetry: true,
        },
        federation_rules: { federation_allowed: false, trusted_mae_ids: [], exportable_evidence: false },
        signing_keys: [{ key_id: keyId, algorithm: "hmac-sha256" }],
        effective_from: past(),
    });
    const ward = constituteWard(store, keyring, keyId, {
        mae_id: mae.mae_id,
        ward_type: "Institutional",
        name: "Company Treasury Domain",
        description: "The treasury's sovereign domain over company funds and customer remediation.",
        sovereign_root: "treasury.board",
        human_origin_act: originAct("treasury.board", "institution", "institutional-charter"),
        accountable_party: "treasury.board",
        protected_interest: "company funds and the customers owed remediation",
        boundary_definition: { kind: "organizational", description: "treasury financial operations", predicates: [] },
        consequence_domain: "treasury",
        attribution_rule: { attributes_to: "accountable_party", description: "consequence returns to the treasury board" },
        governor_registry: ["payments.controller"],
        delegation_rules: {
            who_may_create_authority_envelopes: ["treasury.board", "payments.controller"],
            who_may_issue_warrants: ["payments.controller"],
            max_delegation_depth: 3,
            may_federate: false,
        },
        authority_envelope_constraints: {
            permitted_action_classes: ["payment.refund", "payment.read"],
            prohibited_action_classes: ["payment.wire.external"],
            max_monetary_limit: { currency: "USD", max_amount: 5000 },
        },
        warrant_constraints: { max_validity_seconds: 600, require_nonce: true, require_telemetry_snapshot: true, single_use: true },
        revocation_rules: { authorized_revokers: ["treasury.board"], cascade: true },
        evidence_requirements: { require_gel_record: true, hash_chained: true, record_denials: true, record_escalations: true },
        effective_from: past(),
    });
    const governor = appointGovernor(store, keyring, keyId, {
        ward_id: ward.ward_id,
        subject: "payments.controller",
        delegation_scope: { action_classes: ["payment.refund", "payment.read"], monetary_limit: { currency: "USD", max_amount: 2000 } },
        may_create_authority_envelopes: true,
        may_issue_warrants: true,
        may_delegate: false,
        delegation_depth: 2,
        effective_from: past(),
    });
    const envelope = createAuthorityEnvelope(store, keyring, keyId, {
        ward_id: ward.ward_id,
        mae_id: mae.mae_id,
        subject: "agent.payments",
        actor_type: "Agent",
        authored_by: "payments.controller",
        allowed_action_classes: ["payment.refund"],
        prohibited_action_classes: ["payment.wire.external"],
        resource_scope: ["customer:X"],
        temporal_scope: { from: past() },
        monetary_limits: { currency: "USD", max_amount: 500 },
        operational_limits: [],
        telemetry_requirements: [{ key: "fraud_score", op: "lt", value: 0.8, message: "fraud score too high for autonomous refund" }],
        escalation_requirements: [{ when: { key: "amount", op: "gt", value: 450 }, action: "escalate", to: "payments.controller" }],
        warrant_issuance_rules: {
            require_nonce: true,
            require_parameters_hash: true,
            require_context_hash: true,
            require_telemetry_snapshot_hash: true,
            max_validity_seconds: 600,
        },
        delegation_allowed: false,
        delegation_depth: 1,
        revocation_state: "active",
        effective_from: past(),
    });
    const gate = registerCommitGate(store, { name: "treasury-commit-gate", fail_closed: true });
    const propose = (opts = {}) => {
        const action = {
            proposed_action_id: newId("act"),
            action_type: opts.action_type ?? "payment.refund",
            actor: opts.actor ?? "agent.payments",
            resource: opts.resource ?? "customer:X",
            parameters: opts.parameters ?? { amount: 412, currency: "USD", customer: "X" },
        };
        const context = opts.context ?? { ticket: "T-1042", reason: "defective item" };
        const telemetry = opts.telemetry ?? { fraud_score: 0.12 };
        const warrant = issueWarrant(store, keyring, keyId, {
            mae_id: mae.mae_id,
            ward_id: ward.ward_id,
            authority_envelope_id: envelope.authority_envelope_id,
            issued_by: opts.issued_by ?? "payments.controller",
            action,
            context,
            telemetry,
            validity_seconds: opts.validity_seconds ?? 300,
        });
        const request = commitRequestFor({ warrant, commit_gate_id: gate.commit_gate_id, action, context, telemetry });
        return { action, context, telemetry, warrant, request };
    };
    return { store, keyring, keyId, mae, ward, envelope, gate, governor, propose };
}
// ---------------------------------------------------------------------------
// B. Drone swarm — Ranch field operations, survey grid below 400 ft
// ---------------------------------------------------------------------------
export function buildDrone() {
    const { store, keyring, keyId } = world();
    const mae = createMae(store, keyring, keyId, {
        version: "1.0.0",
        issuer: "faa.part108.constitution",
        constitutional_scope: ["airspace", "field-ops"],
        ward_creation_rules: {
            allowed_ward_types: ["ProtectedSpace"],
            require_human_origin_act: true,
            allowed_origin_methods: ["regulatory-designation", "wet-signature"],
            allowed_domains: ["airspace", "field-ops"],
        },
        ward_amendment_rules: { authorized_amenders: ["ranch.operator"] },
        ward_revocation_rules: { authorized_revokers: ["ranch.operator", "faa.authority"], cascade: true },
        authority_envelope_rules: {
            max_delegation_depth: 2,
            permitted_action_classes: ["drone.survey", "drone.return"],
            prohibited_action_classes: ["drone.payload.release"],
            require_telemetry: true,
        },
        federation_rules: { federation_allowed: true, trusted_mae_ids: [], exportable_evidence: true },
        signing_keys: [{ key_id: keyId, algorithm: "hmac-sha256" }],
        effective_from: past(),
    });
    const ward = constituteWard(store, keyring, keyId, {
        mae_id: mae.mae_id,
        ward_type: "ProtectedSpace",
        name: "Ranch Field Operations Domain",
        description: "The geofenced operating area within which drone survey is governed.",
        sovereign_root: "ranch.operator",
        human_origin_act: originAct("ranch.operator", "human", "regulatory-designation"),
        accountable_party: "ranch.operator",
        protected_interest: "persons, livestock and aircraft within the field operating area",
        boundary_definition: {
            kind: "spatial",
            description: "below 400 ft AGL, inside grid cells A-D, weather permitting",
            predicates: [
                { key: "altitude_ft", op: "lte", value: 400, message: "above 400 ft AGL ceiling" },
                { key: "geo_cell", op: "in", value: ["A", "B", "C", "D"], message: "outside permitted grid cells" },
                { key: "weather_ok", op: "eq", value: true, message: "weather not within limits" },
            ],
        },
        consequence_domain: "field-ops",
        attribution_rule: { attributes_to: "accountable_party", description: "consequence returns to the ranch operator of record" },
        governor_registry: ["flight.director"],
        delegation_rules: {
            who_may_create_authority_envelopes: ["ranch.operator", "flight.director"],
            who_may_issue_warrants: ["flight.director"],
            max_delegation_depth: 2,
            may_federate: true,
        },
        authority_envelope_constraints: {
            permitted_action_classes: ["drone.survey", "drone.return"],
            prohibited_action_classes: ["drone.payload.release"],
        },
        warrant_constraints: { max_validity_seconds: 900, require_nonce: true, require_telemetry_snapshot: true, single_use: true },
        revocation_rules: { authorized_revokers: ["ranch.operator", "faa.authority"], cascade: true },
        evidence_requirements: { require_gel_record: true, hash_chained: true, record_denials: true, record_escalations: true },
        effective_from: past(),
    });
    const envelope = createAuthorityEnvelope(store, keyring, keyId, {
        ward_id: ward.ward_id,
        mae_id: mae.mae_id,
        subject: "drone.fleet",
        actor_type: "Agent",
        authored_by: "flight.director",
        allowed_action_classes: ["drone.survey", "drone.return"],
        prohibited_action_classes: ["drone.payload.release"],
        resource_scope: ["grid:A", "grid:B", "grid:C", "grid:D"],
        temporal_scope: { from: past() },
        operational_limits: [],
        telemetry_requirements: [{ key: "battery_pct", op: "gte", value: 30, message: "battery below safe-return threshold" }],
        escalation_requirements: [{ when: { key: "near_miss", op: "eq", value: true }, action: "escalate", to: "flight.director" }],
        warrant_issuance_rules: {
            require_nonce: true,
            require_parameters_hash: true,
            require_context_hash: true,
            require_telemetry_snapshot_hash: true,
            max_validity_seconds: 900,
        },
        delegation_allowed: false,
        delegation_depth: 1,
        revocation_state: "active",
        effective_from: past(),
    });
    const gate = registerCommitGate(store, { name: "ranch-launch-gate", fail_closed: true });
    const propose = (opts = {}) => {
        const action = {
            proposed_action_id: newId("act"),
            action_type: opts.action_type ?? "drone.survey",
            actor: opts.actor ?? "drone.3",
            resource: opts.resource ?? "grid:B",
            parameters: opts.parameters ?? { route: "B", drone: 3 },
        };
        const context = opts.context ?? { geo_cell: "B", mission: "survey-route-B" };
        const telemetry = opts.telemetry ?? { altitude_ft: 350, geo_cell: "B", weather_ok: true, battery_pct: 82, near_miss: false };
        const warrant = issueWarrant(store, keyring, keyId, {
            mae_id: mae.mae_id,
            ward_id: ward.ward_id,
            authority_envelope_id: envelope.authority_envelope_id,
            issued_by: opts.issued_by ?? "flight.director",
            action,
            context,
            telemetry,
            validity_seconds: opts.validity_seconds ?? 600,
        });
        const request = commitRequestFor({ warrant, commit_gate_id: gate.commit_gate_id, action, context, telemetry });
        return { action, context, telemetry, warrant, request };
    };
    return { store, keyring, keyId, mae, ward, envelope, gate, propose };
}
// ---------------------------------------------------------------------------
// C. Healthcare — Clinical care unit, may DRAFT but never SUBMIT an order
// ---------------------------------------------------------------------------
export function buildHealthcare() {
    const { store, keyring, keyId } = world();
    const mae = createMae(store, keyring, keyId, {
        version: "1.0.0",
        issuer: "hospital.constitution",
        constitutional_scope: ["clinical"],
        ward_creation_rules: {
            allowed_ward_types: ["ProtectedSpace", "Institutional"],
            require_human_origin_act: true,
            allowed_origin_methods: ["institutional-charter", "regulatory-designation"],
            allowed_domains: ["clinical"],
        },
        ward_amendment_rules: { authorized_amenders: ["chief.medical.officer"] },
        ward_revocation_rules: { authorized_revokers: ["chief.medical.officer"], cascade: true },
        authority_envelope_rules: {
            max_delegation_depth: 2,
            permitted_action_classes: ["medication.order.draft", "chart.read"],
            // SUBMIT is constitutionally outside any agent envelope in this MAE.
            prohibited_action_classes: ["medication.order.submit", "medication.order.administer"],
            require_telemetry: false,
        },
        federation_rules: { federation_allowed: false, trusted_mae_ids: [], exportable_evidence: false },
        signing_keys: [{ key_id: keyId, algorithm: "hmac-sha256" }],
        effective_from: past(),
    });
    const ward = constituteWard(store, keyring, keyId, {
        mae_id: mae.mae_id,
        ward_type: "ProtectedSpace",
        name: "Clinical Care Unit",
        description: "A regulated clinical unit where entry triggers medication-governance conditions.",
        sovereign_root: "chief.medical.officer",
        human_origin_act: originAct("chief.medical.officer", "institution", "institutional-charter"),
        accountable_party: "attending.physician",
        protected_interest: "patient safety",
        boundary_definition: {
            kind: "organizational",
            description: "agents may assist clinicians but may never directly affect a patient",
            predicates: [{ key: "patient_consent_on_file", op: "eq", value: true, message: "no patient consent on file" }],
        },
        consequence_domain: "clinical",
        attribution_rule: { attributes_to: "accountable_party", escalates_to: "chief.medical.officer", description: "consequence returns to the attending physician" },
        governor_registry: ["attending.physician"],
        delegation_rules: {
            who_may_create_authority_envelopes: ["chief.medical.officer", "attending.physician"],
            who_may_issue_warrants: ["attending.physician"],
            max_delegation_depth: 2,
            may_federate: false,
        },
        authority_envelope_constraints: {
            permitted_action_classes: ["medication.order.draft", "chart.read"],
            prohibited_action_classes: ["medication.order.submit", "medication.order.administer"],
        },
        warrant_constraints: { max_validity_seconds: 300, require_nonce: true, require_telemetry_snapshot: true, single_use: true },
        revocation_rules: { authorized_revokers: ["chief.medical.officer"], cascade: true },
        evidence_requirements: { require_gel_record: true, hash_chained: true, record_denials: true, record_escalations: true },
        effective_from: past(),
    });
    const envelope = createAuthorityEnvelope(store, keyring, keyId, {
        ward_id: ward.ward_id,
        mae_id: mae.mae_id,
        subject: "agent.clinical",
        actor_type: "Agent",
        authored_by: "attending.physician",
        allowed_action_classes: ["medication.order.draft", "chart.read"],
        prohibited_action_classes: ["medication.order.submit", "medication.order.administer"],
        resource_scope: ["patient:123"],
        temporal_scope: { from: past() },
        operational_limits: [],
        telemetry_requirements: [],
        escalation_requirements: [],
        warrant_issuance_rules: {
            require_nonce: true,
            require_parameters_hash: true,
            require_context_hash: true,
            require_telemetry_snapshot_hash: true,
            max_validity_seconds: 300,
        },
        delegation_allowed: false,
        delegation_depth: 1,
        revocation_state: "active",
        effective_from: past(),
    });
    const gate = registerCommitGate(store, { name: "clinical-commit-gate", fail_closed: true });
    const propose = (opts = {}) => {
        const action = {
            proposed_action_id: newId("act"),
            action_type: opts.action_type ?? "medication.order.draft",
            actor: opts.actor ?? "agent.clinical",
            resource: opts.resource ?? "patient:123",
            parameters: opts.parameters ?? { drug: "amoxicillin", dose_mg: 500, note: "draft recommendation" },
        };
        const context = opts.context ?? { patient_consent_on_file: true, encounter: "E-77" };
        const telemetry = opts.telemetry ?? {};
        const warrant = issueWarrant(store, keyring, keyId, {
            mae_id: mae.mae_id,
            ward_id: ward.ward_id,
            authority_envelope_id: envelope.authority_envelope_id,
            issued_by: opts.issued_by ?? "attending.physician",
            action,
            context,
            telemetry,
            validity_seconds: opts.validity_seconds ?? 120,
        });
        const request = commitRequestFor({ warrant, commit_gate_id: gate.commit_gate_id, action, context, telemetry });
        return { action, context, telemetry, warrant, request };
    };
    return { store, keyring, keyId, mae, ward, envelope, gate, propose };
}
/** Build a cross-domain federation world. `trusted=false` removes Ward B's MAE from Ward A's trust list. */
export function buildFederation(trusted = true) {
    const { store, keyring, keyId } = world();
    const foreignMae = createMae(store, keyring, keyId, {
        mae_id: "mae-emergency-command",
        version: "1.0.0",
        issuer: "emergency.command.constitution",
        constitutional_scope: ["emergency", "search-and-rescue"],
        ward_creation_rules: {
            allowed_ward_types: ["Institutional"],
            require_human_origin_act: true,
            allowed_origin_methods: ["regulatory-designation"],
            allowed_domains: ["emergency", "search-and-rescue"],
        },
        ward_amendment_rules: { authorized_amenders: ["incident.commander"] },
        ward_revocation_rules: { authorized_revokers: ["incident.commander"], cascade: true },
        authority_envelope_rules: { max_delegation_depth: 2, permitted_action_classes: ["drone.enter", "search.coordinate"], prohibited_action_classes: [], require_telemetry: true },
        federation_rules: { federation_allowed: true, trusted_mae_ids: ["mae-ranch-airspace"], exportable_evidence: true },
        signing_keys: [{ key_id: keyId, algorithm: "hmac-sha256" }],
        effective_from: past(),
    });
    const localMae = createMae(store, keyring, keyId, {
        mae_id: "mae-ranch-airspace",
        version: "1.0.0",
        issuer: "ranch.airspace.constitution",
        constitutional_scope: ["airspace", "field-ops"],
        ward_creation_rules: {
            allowed_ward_types: ["ProtectedSpace"],
            require_human_origin_act: true,
            allowed_origin_methods: ["regulatory-designation"],
            allowed_domains: ["airspace", "field-ops"],
        },
        ward_amendment_rules: { authorized_amenders: ["ranch.operator"] },
        ward_revocation_rules: { authorized_revokers: ["ranch.operator"], cascade: true },
        authority_envelope_rules: { max_delegation_depth: 2, permitted_action_classes: ["drone.survey", "drone.enter"], prohibited_action_classes: [], require_telemetry: true },
        federation_rules: {
            federation_allowed: true,
            trusted_mae_ids: trusted ? ["mae-emergency-command"] : [],
            exportable_evidence: true,
        },
        signing_keys: [{ key_id: keyId, algorithm: "hmac-sha256" }],
        effective_from: past(),
    });
    const wardA = constituteWard(store, keyring, keyId, {
        mae_id: localMae.mae_id,
        ward_type: "ProtectedSpace",
        name: "Field Drone Operator Domain",
        description: "Ranch drone operating area, party to mutual-aid search operations.",
        sovereign_root: "ranch.operator",
        human_origin_act: originAct("ranch.operator", "human", "regulatory-designation"),
        accountable_party: "ranch.operator",
        protected_interest: "persons and aircraft within and adjacent to the field area",
        boundary_definition: {
            kind: "spatial",
            description: "below 400 ft AGL",
            predicates: [{ key: "altitude_ft", op: "lte", value: 400, message: "above 400 ft AGL" }],
        },
        consequence_domain: "field-ops",
        attribution_rule: { attributes_to: "accountable_party", description: "consequence returns to the ranch operator" },
        governor_registry: ["flight.director"],
        delegation_rules: {
            who_may_create_authority_envelopes: ["ranch.operator", "flight.director"],
            who_may_issue_warrants: ["flight.director"],
            max_delegation_depth: 2,
            may_federate: true,
        },
        authority_envelope_constraints: { permitted_action_classes: ["drone.survey", "drone.enter"], prohibited_action_classes: [] },
        warrant_constraints: { max_validity_seconds: 900, require_nonce: true, require_telemetry_snapshot: true, single_use: true },
        revocation_rules: { authorized_revokers: ["ranch.operator"], cascade: true },
        evidence_requirements: { require_gel_record: true, hash_chained: true, record_denials: true, record_escalations: true },
        effective_from: past(),
    });
    const wardB = constituteWard(store, keyring, keyId, {
        mae_id: foreignMae.mae_id,
        ward_type: "Institutional",
        name: "Emergency Response Command",
        description: "Incident command for the joint search operation.",
        sovereign_root: "incident.commander",
        human_origin_act: originAct("incident.commander", "institution", "regulatory-designation"),
        accountable_party: "incident.commander",
        protected_interest: "the missing person and responders",
        boundary_definition: { kind: "organizational", description: "incident command area", predicates: [] },
        consequence_domain: "emergency",
        attribution_rule: { attributes_to: "accountable_party", description: "consequence returns to incident command" },
        governor_registry: ["search.coordinator"],
        delegation_rules: {
            who_may_create_authority_envelopes: ["incident.commander"],
            who_may_issue_warrants: ["search.coordinator"],
            max_delegation_depth: 2,
            may_federate: true,
        },
        authority_envelope_constraints: { permitted_action_classes: ["drone.enter", "search.coordinate"], prohibited_action_classes: [] },
        warrant_constraints: { max_validity_seconds: 900, require_nonce: true, require_telemetry_snapshot: true, single_use: true },
        revocation_rules: { authorized_revokers: ["incident.commander"], cascade: true },
        evidence_requirements: { require_gel_record: true, hash_chained: true, record_denials: true, record_escalations: true },
        effective_from: past(),
    });
    const envelopeA = createAuthorityEnvelope(store, keyring, keyId, {
        ward_id: wardA.ward_id,
        mae_id: localMae.mae_id,
        subject: "drone.fleet",
        actor_type: "Agent",
        authored_by: "flight.director",
        allowed_action_classes: ["drone.enter", "drone.survey"],
        prohibited_action_classes: [],
        resource_scope: ["zone:search-1"],
        temporal_scope: { from: past() },
        operational_limits: [],
        telemetry_requirements: [{ key: "battery_pct", op: "gte", value: 30 }],
        escalation_requirements: [],
        warrant_issuance_rules: {
            require_nonce: true,
            require_parameters_hash: true,
            require_context_hash: true,
            require_telemetry_snapshot_hash: true,
            max_validity_seconds: 900,
        },
        delegation_allowed: false,
        delegation_depth: 1,
        revocation_state: "active",
        effective_from: past(),
    });
    const gate = registerCommitGate(store, { name: "federated-search-gate", fail_closed: true });
    const agreement = createFederationAgreement(store, keyring, keyId, {
        local_mae_id: localMae.mae_id,
        foreign_mae_id: foreignMae.mae_id,
        local_ward_id: wardA.ward_id,
        foreign_ward_id: wardB.ward_id,
        shared_resource_scope: ["zone:search-1"],
        jurisdiction_rules: [{ key: "altitude_ft", op: "lte", value: 400, message: "federated zone ceiling exceeded" }],
        trust_anchors: [KEY_ID],
        envelope_compatibility: { shared_action_classes: ["drone.enter"] },
        evidence_exportable: true,
        effective_from: past(),
    });
    const propose = (opts = {}) => {
        const action = {
            proposed_action_id: newId("act"),
            action_type: opts.action_type ?? "drone.enter",
            actor: opts.actor ?? "drone.3",
            resource: opts.resource ?? "zone:search-1",
            parameters: opts.parameters ?? { route: "sweep-1" },
        };
        const context = opts.context ?? { mission: "search-and-rescue" };
        const telemetry = opts.telemetry ?? { altitude_ft: 300, battery_pct: 75 };
        const warrant = issueWarrant(store, keyring, keyId, {
            mae_id: localMae.mae_id,
            ward_id: wardA.ward_id,
            authority_envelope_id: envelopeA.authority_envelope_id,
            issued_by: "flight.director",
            action,
            context,
            telemetry,
            validity_seconds: opts.validity_seconds ?? 600,
        });
        const request = commitRequestFor({
            warrant,
            commit_gate_id: gate.commit_gate_id,
            action,
            context,
            telemetry,
            federation_agreement_id: opts.withAgreement === false ? undefined : agreement.agreement_id,
        });
        return { action, context, telemetry, warrant, request };
    };
    return { store, keyring, keyId, localMae, foreignMae, wardA, wardB, envelopeA, gate, agreement, propose };
}
