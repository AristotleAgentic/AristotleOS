/**
 * Cross-domain Ward federation.
 *
 * Federation is NOT achieved through identity. A foreign actor being who they say
 * they are proves nothing about whether their authority chain is honoured here. A
 * federated action must instead prove authority-chain compatibility across a
 * trust bridge:
 *
 *   - local MAE validity
 *   - foreign MAE trust admissibility (the local MAE must recognise it)
 *   - a Ward-to-Ward trust relationship (a live FederationAgreement)
 *   - Authority Envelope compatibility (the act class is shared)
 *   - Warrant validity (the ordinary chain still runs end to end)
 *   - jurisdictional / domain boundary rules
 *   - GEL receipt exportability
 *
 * If the trust bridge does not validate, the commit is denied (or fails closed
 * when no bridge exists at all) — never silently allowed.
 */
import { hashCanonical } from "./hash.js";
import { evaluateConstraints, isSubsetOf } from "./constraints.js";
import { fromViolations, valid, violation } from "./errors.js";
import { finalizeAndAppend } from "./gel.js";
import { newId } from "./ids.js";
import { context, maeIsLive } from "./validators.js";
import { evaluateCommit } from "./commit-gate.js";
export function validateFederation(store, agreement, request, ctx = context()) {
    const v = [];
    const now = ctx.now;
    const localMae = store.getMae(agreement.local_mae_id);
    const foreignMae = store.getMae(agreement.foreign_mae_id);
    if (!localMae)
        return fromViolations([violation("federation-local-mae-missing", agreement.local_mae_id)]);
    if (!foreignMae)
        return fromViolations([violation("federation-foreign-mae-missing", agreement.foreign_mae_id)]);
    if (!maeIsLive(localMae, now))
        v.push(violation("federation-local-mae-invalid", "local MAE not currently valid"));
    if (!maeIsLive(foreignMae, now))
        v.push(violation("federation-foreign-mae-invalid", "foreign MAE not currently valid"));
    // The local constitution must both permit federation and recognise the foreign MAE.
    if (!localMae.federation_rules.federation_allowed)
        v.push(violation("federation-not-allowed", "local MAE forbids federation"));
    if (!localMae.federation_rules.trusted_mae_ids.includes(agreement.foreign_mae_id))
        v.push(violation("federation-requires-trust-relationship", `local MAE does not trust ${agreement.foreign_mae_id}`));
    // The agreement itself is the Ward-to-Ward trust relationship; it must be live
    // and must actually bridge the Ward the warrant rides on.
    if (agreement.revoked_at)
        v.push(violation("ward-to-ward-trust-required", "federation agreement revoked"));
    if (agreement.expires_at && Date.parse(agreement.expires_at) < now.getTime())
        v.push(violation("ward-to-ward-trust-required", "federation agreement expired"));
    if (agreement.local_ward_id !== request.ward_id && agreement.foreign_ward_id !== request.ward_id)
        v.push(violation("ward-to-ward-trust-required", "request Ward is not party to this federation agreement"));
    // Envelope/action compatibility across the bridge.
    if (!isSubsetOf([request.action.action_type], agreement.envelope_compatibility.shared_action_classes))
        v.push(violation("federated-envelope-compatibility", `${request.action.action_type} is not a shared action class`));
    // The action must target the shared zone, and satisfy jurisdiction rules.
    if (!isSubsetOf([request.action.resource], agreement.shared_resource_scope) && !agreement.shared_resource_scope.includes("*"))
        v.push(violation("federated-zone-scope", `${request.action.resource} is outside the shared zone`));
    const facts = { ...request.telemetry, ...request.context, ...request.action.parameters };
    v.push(...evaluateConstraints(agreement.jurisdiction_rules, facts, "jurisdiction-boundary"));
    // Evidence produced under federation must be exportable to the foreign domain.
    if (!agreement.evidence_exportable || !foreignMae.federation_rules.exportable_evidence)
        v.push(violation("gel-receipt-exportable", "federated GEL evidence is not exportable to the foreign domain"));
    return v.length === 0 ? valid() : fromViolations(v);
}
/**
 * Evaluate a federated commit: validate the trust bridge, then (only if it holds)
 * run the ordinary Commit Gate so the full MAE->Ward->Envelope->Warrant chain is
 * still enforced. No trust bridge => fail closed.
 */
export function evaluateFederatedCommit(store, request, opts) {
    const agreement = request.federation_agreement_id ? store.getFederationAgreement(request.federation_agreement_id) : undefined;
    if (!agreement) {
        return federatedDecision(store, opts, request, "FailClosed", ["federation-agreement-not-found"]);
    }
    const ctx = context({ now: opts.now, keyring: opts.keyring });
    const fed = validateFederation(store, agreement, request, ctx);
    if (!fed.ok) {
        return federatedDecision(store, opts, request, "Deny", fed.violations.map((x) => x.invariant));
    }
    return evaluateCommit(store, request, opts);
}
/** Write a federation-stage GEL record and return the corresponding decision. */
function federatedDecision(store, opts, request, kind, reasons) {
    const now = opts.now ?? new Date();
    const chain = {
        mae_id: request.mae_id,
        ward_id: request.ward_id,
        authority_envelope_id: request.authority_envelope_id,
        warrant_id: request.warrant_id,
        commit_gate_id: request.commit_gate_id,
    };
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
        policy_hashes: [],
        revocation_snapshot: { mae: "active", ward: "active", authority_envelope: "active", warrant: "Unused" },
        decision: kind,
        decision_reason: `federation: ${reasons.join("; ")}`,
        record_kind: "admissibility",
        timestamp: now.toISOString(),
    };
    const record = finalizeAndAppend(store, opts.keyring, opts.signKeyId, draft);
    chain.gel_record_id = record.gel_record_id;
    return {
        decision: kind,
        request_id: request.request_id,
        reasons,
        violated_invariants: reasons,
        warrant_consumed: false,
        gel_record_id: record.gel_record_id,
        gel_record_hash: record.gel_record_hash,
        evaluated_at: now.toISOString(),
        chain,
    };
}
