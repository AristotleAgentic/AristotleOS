/**
 * The Commit Gate — the Warden at the execution boundary.
 *
 * The gate does not author policy. It evaluates whether a *proposed* act is
 * admissible under a *complete* authority chain, and it does so BEFORE the act
 * produces consequence. It implements the spec evaluator in fixed order:
 *
 *   MAE validity -> Ward validity -> Authority Envelope validity -> Warrant
 *   validity -> action classification -> context admissibility -> telemetry ->
 *   revocation state -> temporal -> replay protection -> GEL precommit record.
 *
 * It returns Allow | Deny | Escalate | FailClosed and NEVER allows execution if
 * the chain is incomplete. The two terminal guarantees:
 *   - On Allow the Warrant is consumed (single-use) BEFORE the receipt is written
 *     — authority precedes attribution.
 *   - Any missing primitive or non-consumable warrant fails CLOSED, with evidence.
 */
import { hashCanonical } from "./hash.js";
import { evaluateConstraints, isSubsetOf, satisfies } from "./constraints.js";
import { GovernanceError, violation } from "./errors.js";
import { finalizeAndAppend } from "./gel.js";
import { newId } from "./ids.js";
import { chainIsIntact, context } from "./validators.js";
export function evaluateCommit(store, request, opts) {
    const ctx = context({ now: opts.now, keyring: opts.keyring });
    const now = ctx.now;
    const chain = { commit_gate_id: request.commit_gate_id };
    try {
        // -- load + structural existence (each miss is fail-closed) ---------------
        const gate = store.getCommitGate(request.commit_gate_id);
        if (!gate)
            return emit(store, opts, request, chain, "FailClosed", ["commit-gate-not-found"], undefined, undefined, now);
        if (!gate.fail_closed) {
            // A gate that does not fail closed is not a Warden. Refuse to operate it.
            return emit(store, opts, request, chain, "FailClosed", ["commit-gate-must-fail-closed"], undefined, undefined, now);
        }
        const mae = store.getMae(request.mae_id);
        if (!mae)
            return emit(store, opts, request, chain, "FailClosed", ["mae-not-found"], undefined, undefined, now);
        chain.mae_id = mae.mae_id;
        const ward = store.getWard(request.ward_id);
        if (!ward)
            return emit(store, opts, request, chain, "FailClosed", ["ward-not-found"], undefined, undefined, now);
        chain.ward_id = ward.ward_id;
        const env = store.getEnvelope(request.authority_envelope_id);
        if (!env)
            return emit(store, opts, request, chain, "FailClosed", ["authority-envelope-not-found"], ward, undefined, now);
        chain.authority_envelope_id = env.authority_envelope_id;
        const warrant = store.getWarrant(request.warrant_id);
        if (!warrant)
            return emit(store, opts, request, chain, "FailClosed", ["warrant-not-found"], ward, undefined, now);
        chain.warrant_id = warrant.warrant_id;
        // -- chain validity (MAE -> Ward -> Envelope -> Warrant) -----------------
        const violations = [...chainIsIntact(mae, ward, env, warrant, request, ctx).violations];
        // -- action classification ----------------------------------------------
        if (request.action.action_type !== warrant.action_type)
            violations.push(violation("action-classification", "request action_type does not match the warrant"));
        if (!isSubsetOf([request.action.action_type], env.allowed_action_classes))
            violations.push(violation("action-classification", `action_type ${request.action.action_type} not permitted by envelope`));
        // -- context admissibility (Ward boundary, geo, operational limits) ------
        const facts = { ...request.telemetry, ...request.context, ...request.action.parameters };
        violations.push(...evaluateConstraints(ward.boundary_definition?.predicates, facts, "ward-boundary"));
        violations.push(...evaluateConstraints(env.geographic_scope, facts, "envelope-geographic-scope"));
        violations.push(...evaluateConstraints(env.operational_limits, facts, "envelope-operational-limit"));
        // -- telemetry requirements ---------------------------------------------
        violations.push(...evaluateConstraints(env.telemetry_requirements, request.telemetry, "envelope-telemetry"));
        // -- escalation ----------------------------------------------------------
        let escalate = false;
        for (const rule of env.escalation_requirements ?? []) {
            if (satisfies(rule.when, facts)) {
                if (rule.action === "deny")
                    violations.push(violation("escalation-deny", `denied by escalation rule on ${rule.when.key}`));
                else
                    escalate = true;
            }
        }
        // -- decide --------------------------------------------------------------
        if (violations.length > 0) {
            return emit(store, opts, request, chain, "Deny", violations.map((v) => v.invariant), ward, { mae, env, warrant }, now, violations);
        }
        if (escalate) {
            return emit(store, opts, request, chain, "Escalate", ["escalation-required"], ward, { mae, env, warrant }, now);
        }
        // -- allow: consume warrant FIRST, then write the receipt ----------------
        let proof;
        try {
            proof = store.consumeWarrant(warrant.warrant_id, request.commit_gate_id, now.toISOString());
        }
        catch (e) {
            if (e instanceof GovernanceError)
                return emit(store, opts, request, chain, "FailClosed", [e.code], ward, { mae, env, warrant }, now);
            throw e;
        }
        const record = writeRecord(store, opts, request, chain, "Allow", ["admissible"], { mae, ward, env, warrant }, now, proof);
        chain.gel_record_id = record.gel_record_id;
        return decision("Allow", request, chain, ["admissible"], [], true, record, now);
    }
    catch (e) {
        // Anything unanticipated is a refusal to answer: fail closed.
        return emit(store, opts, request, chain, "FailClosed", ["chain-incomplete"], undefined, undefined, now, [
            violation("chain-incomplete", e instanceof Error ? e.message : String(e)),
        ]);
    }
}
/**
 * Record the outcome of a permitted execution as a SEPARATE GEL record. Keeping
 * admissibility and execution as distinct records is the ledger expression of
 * the ontology: authority, execution and attribution are not the same event.
 */
export function recordExecutionOutcome(store, opts, allowDecision, result) {
    const now = opts.now ?? new Date();
    const draft = {
        gel_record_id: newId("gel"),
        mae_id: allowDecision.chain.mae_id,
        ward_id: allowDecision.chain.ward_id,
        authority_envelope_id: allowDecision.chain.authority_envelope_id,
        warrant_id: allowDecision.chain.warrant_id,
        commit_gate_id: allowDecision.chain.commit_gate_id,
        actor: "execution",
        action: "execution.outcome",
        action_hash: result.output_hash ?? hashCanonical(result),
        context_hash: "",
        telemetry_hash: "",
        policy_hashes: [],
        revocation_snapshot: { mae: "active", ward: "active", authority_envelope: "active", warrant: "Consumed" },
        decision: "Allow",
        decision_reason: `execution ${result.status}`,
        execution_result: result,
        record_kind: "execution",
        timestamp: now.toISOString(),
    };
    return finalizeAndAppend(store, opts.keyring, opts.signKeyId, draft);
}
function emit(store, opts, request, chain, kind, reasons, ward, objects, now, violations = []) {
    // Denials, escalations and fail-closed all leave evidence by default. A Ward
    // may opt out of recording denials, but never escalations or fail-closed.
    const recordIt = kind === "Allow" ||
        kind === "Escalate" ||
        kind === "FailClosed" ||
        !ward ||
        ward.evidence_requirements?.record_denials !== false;
    let record;
    if (recordIt) {
        record = writeRecord(store, opts, request, chain, kind, reasons, { ...objects, ward }, now, undefined);
        chain.gel_record_id = record.gel_record_id;
    }
    return decision(kind, request, chain, reasons, violations.map((v) => v.invariant), false, record, now);
}
function writeRecord(store, opts, request, chain, kind, reasons, objects, now, proof) {
    const draft = {
        gel_record_id: newId("gel"),
        mae_id: chain.mae_id,
        ward_id: chain.ward_id,
        authority_envelope_id: chain.authority_envelope_id,
        warrant_id: chain.warrant_id,
        commit_gate_id: chain.commit_gate_id,
        actor: request.action.actor,
        action: request.action.action_type,
        action_hash: hashCanonical(request.action.parameters),
        context_hash: hashCanonical(request.context),
        telemetry_hash: hashCanonical(request.telemetry),
        policy_hashes: policyHashes(objects),
        revocation_snapshot: snapshot(objects),
        decision: kind,
        decision_reason: reasons.join("; ") || kind,
        warrant_consumption_proof: proof,
        record_kind: "admissibility",
        timestamp: now.toISOString(),
    };
    return finalizeAndAppend(store, opts.keyring, opts.signKeyId, draft);
}
function decision(kind, request, chain, reasons, violated, consumed, record, now) {
    return {
        decision: kind,
        request_id: request.request_id,
        reasons,
        violated_invariants: violated,
        warrant_consumed: consumed,
        gel_record_id: record?.gel_record_id,
        gel_record_hash: record?.gel_record_hash,
        evaluated_at: now.toISOString(),
        chain,
    };
}
function policyHashes(o) {
    return [o.mae?.policy_hash, o.ward?.policy_hash, o.env?.policy_hash].filter((h) => typeof h === "string");
}
function snapshot(o) {
    return {
        mae: o.mae?.revoked_at ? "revoked" : "active",
        ward: o.ward?.revoked_at ? "revoked" : o.ward?.suspended_at ? "suspended" : "active",
        authority_envelope: o.env?.revocation_state ?? "active",
        warrant: o.warrant?.consumption_state ?? "Unused",
    };
}
