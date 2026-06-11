/**
 * GOVERNANCE_CHAIN_V2 client (agent-os side).
 *
 * agent-os does not import the chain library directly — it speaks to the kernel's
 * /v2 surface over HTTP, which is the correct service boundary. This module maps
 * agent-os's domain (mission / agent / task) onto the chain primitives and drives
 * a consequential act through the kernel Commit Gate:
 *
 *   MAE (one constitution)        <- ensureConstitution
 *     Ward (per mission)          <- mission.requestedBy is the human origin act
 *       Authority Envelope        <- per mission, scopes task.dispatch/completion
 *         Warrant (per act)       <- single-use, bound to this task+phase
 *           /v2/commit            <- Warden: validate chain, consume, GEL
 *
 * Modes:
 *   - "shadow"  : run the chain and report the decision, but never gate execution.
 *   - "enforce" : a non-Allow decision (or an unreachable chain) blocks the act.
 *
 * The execution-gate's kill-switch is folded into the Authority Envelope as an
 * operational limit; witness state is folded into the commit context for the GEL
 * record. The mapping uses sensible defaults (one Ward per mission, requester as
 * origin/accountable party); refine as the data model matures (see MIGRATION.md).
 */
const MAE_ID = "mae-agent-os-constitution";
const pastIso = () => new Date(Date.now() - 3_600_000).toISOString();
export function createChainClient(config) {
    const { kernelBase, mode } = config;
    const keyId = config.keyId ?? "governance-kernel-key";
    let constitutionEnsured = false;
    let gateId;
    const missionIds = new Map();
    const postJson = async (path, body) => {
        const r = await fetch(`${kernelBase}${path}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
        });
        return r.json();
    };
    const getJson = async (path) => (await fetch(`${kernelBase}${path}`)).json();
    const ensureConstitution = async () => {
        if (constitutionEnsured)
            return;
        await postJson("/v2/meta-authority-envelope", maeBody(keyId));
        constitutionEnsured = true;
    };
    const ensureMissionChain = async (mission) => {
        await ensureConstitution();
        const cached = missionIds.get(mission.id);
        if (cached)
            return cached;
        if (!gateId)
            gateId = (await getJson("/v2/commit-gate"))?.commit_gate_id;
        const wardId = `ward-${mission.id}`;
        const envelopeId = `env-${mission.id}`;
        await postJson("/v2/ward", wardBody(mission, wardId));
        await postJson("/v2/authority-envelope", envelopeBody(mission, wardId, envelopeId));
        const ids = { maeId: MAE_ID, wardId, envelopeId, gateId: gateId ?? "" };
        missionIds.set(mission.id, ids);
        return ids;
    };
    const executeCommit = async (ids, action, context, telemetry) => {
        const warrant = await postJson("/v2/warrant", {
            mae_id: ids.maeId,
            ward_id: ids.wardId,
            authority_envelope_id: ids.envelopeId,
            issued_by: "agent-os",
            action,
            context,
            telemetry,
            validity_seconds: 600,
        });
        if (!warrant?.warrant_id)
            return { warrantFailed: true, warrant };
        const decision = await postJson("/v2/commit", {
            request_id: `req-${action.proposed_action_id}`,
            mae_id: ids.maeId,
            ward_id: ids.wardId,
            authority_envelope_id: ids.envelopeId,
            warrant_id: warrant.warrant_id,
            commit_gate_id: ids.gateId,
            action,
            context,
            telemetry,
            presented_at: new Date().toISOString(),
        });
        return { decision, warrantId: warrant.warrant_id };
    };
    // Shared path for any consequential act: ensure the mission chain, commit, and
    // self-heal once if the kernel's store was reset (stale cached ids -> not-found).
    const submit = async (mission, action, context, telemetry) => {
        if (mode === "off")
            return { ran: false, mode };
        try {
            let ids = await ensureMissionChain(mission);
            let res = await executeCommit(ids, action, context, telemetry);
            if (res.decision?.decision === "FailClosed" && hasNotFound(res.decision)) {
                missionIds.delete(mission.id);
                constitutionEnsured = false;
                ids = await ensureMissionChain(mission);
                res = await executeCommit(ids, action, context, telemetry);
            }
            if (res.warrantFailed)
                return { ran: false, mode, ward_id: ids.wardId, error: "warrant_issue_failed" };
            const d = res.decision;
            return {
                ran: true,
                mode,
                decision: d?.decision,
                reasons: d?.reasons,
                violated_invariants: d?.violated_invariants,
                ward_id: ids.wardId,
                warrant_id: res.warrantId,
                gel_record_id: d?.gel_record_id,
            };
        }
        catch (e) {
            return { ran: false, mode, error: e instanceof Error ? e.message : String(e) };
        }
    };
    const commitTaskAct = (input) => submit(input.mission, {
        proposed_action_id: `act-${input.task.id}-${input.phase}-${Date.now()}`,
        action_type: `task.${input.phase}`,
        actor: input.task.assignedAgentId,
        resource: input.mission.targetSystem,
        parameters: { taskId: input.task.id, title: input.task.title, phase: input.phase },
    }, {
        missionId: input.mission.id,
        governanceProfile: input.mission.governanceProfile,
        riskLevel: input.mission.riskLevel,
        witness_required: input.witnessRequired,
        witness_accepted: input.witnessAccepted,
    }, {
        kill_switch_active: input.killSwitchActive,
        missing_lease_tools: input.missingLeaseTools.length,
        witness_obligation_met: !input.witnessRequired || input.witnessAccepted,
    });
    const commitToolAct = (input) => submit(input.mission, {
        proposed_action_id: `act-${input.action.id}-${Date.now()}`,
        action_type: `tool-action.${input.action.kind}`,
        actor: input.action.agentId,
        resource: input.action.toolId,
        parameters: { actionId: input.action.id, toolId: input.action.toolId, kind: input.action.kind, summary: input.action.summary },
    }, {
        missionId: input.mission.id,
        taskId: input.task.id,
        actionId: input.action.id,
        governanceProfile: input.mission.governanceProfile,
        riskLevel: input.mission.riskLevel,
    }, { kill_switch_active: input.killSwitchActive, witness_obligation_met: true });
    return { mode, commitTaskAct, commitToolAct };
}
function hasNotFound(decision) {
    return (decision.reasons ?? []).some((r) => r.endsWith("-not-found"));
}
// --- domain -> chain mapping ----------------------------------------------
function maeBody(keyId) {
    return {
        mae_id: MAE_ID,
        version: "1.0.0",
        issuer: "agent-os.operator",
        constitutional_scope: ["*"],
        ward_creation_rules: {
            allowed_ward_types: ["Institutional", "ProtectedSpace", "IndividualDirect", "IndividualDelegated"],
            require_human_origin_act: true,
            allowed_origin_methods: ["institutional-charter", "regulatory-designation"],
            allowed_domains: ["*"],
        },
        ward_amendment_rules: { authorized_amenders: ["agent-os.operator"] },
        ward_revocation_rules: { authorized_revokers: ["agent-os.operator"], cascade: true },
        authority_envelope_rules: { max_delegation_depth: 4, permitted_action_classes: ["*"], prohibited_action_classes: [], require_telemetry: false },
        federation_rules: { federation_allowed: false, trusted_mae_ids: [], exportable_evidence: false },
        signing_keys: [{ key_id: keyId, algorithm: "hmac-sha256" }],
        effective_from: pastIso(),
    };
}
function wardBody(mission, wardId) {
    return {
        ward_id: wardId,
        mae_id: MAE_ID,
        ward_type: "Institutional",
        name: `Mission Ward: ${mission.title}`,
        description: mission.objective || mission.title,
        sovereign_root: mission.requestedBy,
        human_origin_act: {
            actor: mission.requestedBy,
            actor_kind: "institution",
            method: "institutional-charter",
            attested_at: pastIso(),
            attestation_ref: `mission:${mission.id}`,
        },
        accountable_party: mission.requestedBy,
        protected_interest: `target system ${mission.targetSystem}`,
        boundary_definition: { kind: "organizational", description: `mission ${mission.id} operating domain`, predicates: [] },
        consequence_domain: mission.targetSystem,
        attribution_rule: { attributes_to: "accountable_party", description: `consequence returns to ${mission.requestedBy}` },
        governor_registry: ["agent-os"],
        delegation_rules: {
            who_may_create_authority_envelopes: ["agent-os", mission.requestedBy],
            who_may_issue_warrants: ["agent-os"],
            max_delegation_depth: 3,
            may_federate: false,
        },
        authority_envelope_constraints: { permitted_action_classes: ["task.dispatch", "task.completion", "tool-action.read", "tool-action.shell", "tool-action.edit", "tool-action.write"], prohibited_action_classes: [] },
        warrant_constraints: { max_validity_seconds: 900, require_nonce: true, require_telemetry_snapshot: true, single_use: true },
        revocation_rules: { authorized_revokers: ["agent-os.operator", mission.requestedBy], cascade: true },
        evidence_requirements: { require_gel_record: true, hash_chained: true, record_denials: true, record_escalations: true },
        effective_from: pastIso(),
    };
}
function envelopeBody(mission, wardId, envelopeId) {
    return {
        authority_envelope_id: envelopeId,
        ward_id: wardId,
        mae_id: MAE_ID,
        subject: "agent-os",
        actor_type: "Service",
        authored_by: "agent-os",
        allowed_action_classes: ["task.dispatch", "task.completion", "tool-action.read", "tool-action.shell", "tool-action.edit", "tool-action.write"],
        prohibited_action_classes: [],
        resource_scope: ["*"],
        temporal_scope: { from: pastIso() },
        // Execution-gate obligations folded in as operational limits, enforced at the
        // Commit Gate. kill_switch_active must be false; witness_obligation_met is a
        // derived flag (!witness_required || witness_accepted) so the witness duty is
        // enforced only when an act actually requires a witness.
        operational_limits: [
            { key: "kill_switch_active", op: "eq", value: false, message: "kill switch active for this scope" },
            { key: "witness_obligation_met", op: "eq", value: true, message: "witness obligation unsatisfied" },
        ],
        telemetry_requirements: [],
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
        effective_from: pastIso(),
    };
}
