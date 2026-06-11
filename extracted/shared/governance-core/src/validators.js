/**
 * Validators for each primitive and its invariants.
 *
 * These are pure functions over already-loaded objects (the Commit Gate does the
 * loading). Each validator accumulates named `Violation`s rather than throwing,
 * so the gate can report exactly which invariant failed and write it into the
 * GEL Record. Hard "cannot evaluate" faults (missing primitive) are thrown as
 * `GovernanceError` by the store and turned into FailClosed by the gate.
 *
 * Invariant names are stable identifiers; tests assert on them and the GEL
 * Record cites them, so do not rename casually.
 */
import { canonicalize, hashCanonical, verifyObjectSignatures } from "./hash.js";
/**
 * Compute the issuer→key binding set for everything under a given MAE.
 *
 * In this trust model the MAE is the constitutional root of its tenant: every
 * artifact beneath it (the MAE itself, Wards under it, Authority Envelopes
 * under those Wards, and Warrants issued by those Envelopes) must be signed
 * by a key whose id appears in `mae.signing_keys`. This prevents a key
 * trusted for tenant B from forging tenant A's artifacts in a multi-tenant
 * deployment that shares a global keyring.
 *
 * Returns `undefined` when the MAE has no declared signing keys, which
 * preserves legacy behavior ("any keyring-known key is acceptable") for
 * fixtures and deployments that have not yet declared their key set. This
 * is intentional, but operators should populate `signing_keys` to actually
 * close the gap.
 */
function maeAllowedKeyIds(mae) {
    const keys = mae.signing_keys ?? [];
    if (keys.length === 0)
        return undefined;
    return new Set(keys.map((k) => k.key_id));
}
import { evaluateConstraints, intersect, isSubsetOf } from "./constraints.js";
import { combine, fromViolations, violation } from "./errors.js";
export function context(partial = {}) {
    return { now: partial.now ?? new Date(), presentationSkewMs: partial.presentationSkewMs ?? 120_000, keyring: partial.keyring };
}
function parse(ts) {
    const t = Date.parse(ts);
    return Number.isNaN(t) ? NaN : t;
}
/** Temporal + latched-revocation checks shared by the standing primitives. */
function lifecycle(prefix, fields, now) {
    const v = [];
    const t = now.getTime();
    if (fields.revoked_at)
        v.push(violation(`${prefix}-revoked`, `${prefix} was revoked at ${fields.revoked_at}`));
    if (fields.suspended_at)
        v.push(violation(`${prefix}-suspended`, `${prefix} is suspended since ${fields.suspended_at}`));
    const from = parse(fields.effective_from);
    if (Number.isNaN(from))
        v.push(violation(`${prefix}-temporal`, `${prefix} effective_from is unparseable`));
    else if (t < from)
        v.push(violation(`${prefix}-not-yet-effective`, `${prefix} not effective until ${fields.effective_from}`));
    if (fields.expires_at) {
        const until = parse(fields.expires_at);
        if (Number.isNaN(until))
            v.push(violation(`${prefix}-temporal`, `${prefix} expires_at is unparseable`));
        else if (t > until)
            v.push(violation(`${prefix}-expired`, `${prefix} expired at ${fields.expires_at}`));
    }
    return v;
}
function withinMonetary(candidate, ceiling) {
    if (!candidate)
        return true; // no claim to bound
    if (!ceiling)
        return true; // no ceiling imposed
    if (candidate.currency !== ceiling.currency)
        return false;
    return candidate.max_amount <= ceiling.max_amount;
}
// ---------------------------------------------------------------------------
// Meta Authority Envelope
// ---------------------------------------------------------------------------
export function validateMae(mae, ctx) {
    const v = [];
    if (!mae.mae_id)
        v.push(violation("mae-id-required", "MAE has no id"));
    if (!mae.issuer)
        v.push(violation("mae-issuer-required", "MAE has no issuer"));
    if (mae.policy_hash !== hashCanonical(stripForPolicyHash(mae)))
        v.push(violation("mae-policy-hash", "MAE policy_hash does not match content"));
    if ((mae.signatures ?? []).length === 0)
        v.push(violation("mae-unsigned", "MAE carries no signature"));
    // Issuer→key binding: the MAE is self-rooting, so its own signatures must
    // be by keys it declares in `signing_keys`. Stops a key from another tenant
    // (also present in a shared keyring) from forging this MAE.
    if (ctx.keyring && !verifyObjectSignatures(ctx.keyring, mae, maeAllowedKeyIds(mae)))
        v.push(violation("mae-signature-invalid", "MAE signature failed verification"));
    v.push(...lifecycle("mae", mae, ctx.now));
    return fromViolations(v);
}
// ---------------------------------------------------------------------------
// Ward
// ---------------------------------------------------------------------------
export function validateWardUnderMae(ward, mae, ctx) {
    const v = [];
    // A Ward must trace to a *valid* MAE.
    if (ward.mae_id !== mae.mae_id)
        v.push(violation("ward-traces-to-mae", "Ward.mae_id does not match the supplied MAE"));
    if (!maeIsLive(mae, ctx.now))
        v.push(violation("ward-requires-valid-mae", "Ward depends on an MAE that is not currently valid"));
    // A Ward with no human/institutional origin act is invalid.
    const origin = ward.human_origin_act;
    if (!origin || !origin.actor || !origin.signature) {
        v.push(violation("ward-invalid-without-origin-act", "Ward has no human/institutional origin act"));
    }
    else {
        if (mae.ward_creation_rules.require_human_origin_act && !["human", "institution"].includes(origin.actor_kind))
            v.push(violation("ward-requires-human-origin-act", "MAE requires a human/institutional origin act"));
        if (!mae.ward_creation_rules.allowed_origin_methods.includes(origin.method))
            v.push(violation("ward-origin-method-not-permitted", `origin method ${origin.method} not allowed by MAE`));
        if (mae.ward_creation_rules.require_presence_proof && !origin.presence_proof)
            v.push(violation("ward-requires-presence-proof", "MAE requires a confirmed-presence proof for the origin act"));
        // The constituting act must actually be signed by its origin key — not merely
        // present. This is what makes "machines cannot constitute Wards" enforceable.
        if (ctx.keyring) {
            const { signature, ...originBase } = origin;
            if (!ctx.keyring.verify(canonicalize(originBase), signature))
                v.push(violation("ward-origin-act-signature-invalid", "human origin act signature failed verification"));
        }
    }
    // The Ward must name what it protects and who answers, and bound itself.
    if (!ward.protected_interest)
        v.push(violation("ward-must-identify-protected-interest", "Ward names no protected interest"));
    if (!ward.accountable_party)
        v.push(violation("ward-must-identify-accountable-party", "Ward names no accountable party"));
    if (!ward.boundary_definition || ward.boundary_definition.predicates === undefined)
        v.push(violation("ward-must-define-boundary", "Ward has no boundary definition"));
    if (!ward.attribution_rule)
        v.push(violation("ward-must-define-consequence-attribution", "Ward has no attribution rule"));
    if (!ward.delegation_rules || ward.delegation_rules.who_may_create_authority_envelopes.length === 0)
        v.push(violation("ward-must-define-envelope-authors", "Ward does not say who may create Authority Envelopes"));
    // Ward type must be permitted by the MAE.
    if (!mae.ward_creation_rules.allowed_ward_types.includes(ward.ward_type))
        v.push(violation("ward-type-not-permitted", `MAE does not permit ward_type ${ward.ward_type}`));
    // Institutional Wards must trace to an institutional governance origin.
    if (ward.ward_type === "Institutional") {
        const ok = origin && (origin.actor_kind === "institution" || origin.method === "institutional-charter") && !!origin.attestation_ref;
        if (!ok)
            v.push(violation("institutional-ward-requires-governance-origin", "Institutional Ward lacks a traceable governance origin act"));
    }
    // A Ward may not delegate broader authority than its MAE permits.
    if (ward.delegation_rules && ward.delegation_rules.max_delegation_depth > mae.authority_envelope_rules.max_delegation_depth)
        v.push(violation("ward-may-not-exceed-mae", "Ward delegation depth exceeds MAE ceiling"));
    if (!isSubsetOf(ward.authority_envelope_constraints.permitted_action_classes, mae.authority_envelope_rules.permitted_action_classes))
        v.push(violation("ward-may-not-exceed-mae", "Ward permits action classes the MAE forbids"));
    if (!mae.constitutional_scope.includes("*") && !mae.constitutional_scope.includes(ward.consequence_domain))
        v.push(violation("ward-domain-outside-mae-scope", `Ward consequence_domain ${ward.consequence_domain} is outside MAE constitutional_scope`));
    // Integrity + lifecycle.
    if (ward.policy_hash !== hashCanonical(stripForPolicyHash(ward)))
        v.push(violation("ward-policy-hash", "Ward policy_hash does not match content"));
    if ((ward.signatures ?? []).length === 0)
        v.push(violation("ward-unsigned", "Ward carries no signature"));
    // Verify unconditionally (as the MAE path does): verifyObjectSignatures fails closed
    // on an empty signature set, so no `length > 0` guard that could weaken the check.
    // Issuer→key binding: a Ward under this MAE must be signed by a key the MAE
    // declares — a key trusted for another tenant's MAE cannot sign this Ward.
    if (ctx.keyring && !verifyObjectSignatures(ctx.keyring, ward, maeAllowedKeyIds(mae)))
        v.push(violation("ward-signature-invalid", "Ward signature failed verification"));
    v.push(...lifecycle("ward", ward, ctx.now));
    return fromViolations(v);
}
// ---------------------------------------------------------------------------
// Authority Envelope
// ---------------------------------------------------------------------------
export function validateEnvelopeUnderWard(env, ward, mae, ctx) {
    const v = [];
    // It must belong to exactly one Ward (and one MAE).
    if (env.ward_id !== ward.ward_id)
        v.push(violation("envelope-belongs-to-one-ward", "Envelope.ward_id mismatch"));
    if (env.mae_id !== mae.mae_id)
        v.push(violation("envelope-belongs-to-one-mae", "Envelope.mae_id mismatch"));
    // It cannot exceed Ward boundaries.
    if (!isSubsetOf(env.allowed_action_classes, ward.authority_envelope_constraints.permitted_action_classes))
        v.push(violation("envelope-cannot-exceed-ward", "Envelope permits action classes the Ward forbids"));
    const wardProhibited = intersect(env.allowed_action_classes, ward.authority_envelope_constraints.prohibited_action_classes);
    if (wardProhibited.length > 0)
        v.push(violation("envelope-cannot-exceed-ward", `Envelope allows Ward-prohibited classes: ${wardProhibited.join(", ")}`));
    if (!withinMonetary(env.monetary_limits, ward.authority_envelope_constraints.max_monetary_limit))
        v.push(violation("envelope-cannot-exceed-ward", "Envelope monetary limit exceeds Ward ceiling"));
    if (ward.authority_envelope_constraints.max_resource_scope && !isSubsetOf(env.resource_scope, ward.authority_envelope_constraints.max_resource_scope))
        v.push(violation("envelope-cannot-exceed-ward", "Envelope resource scope exceeds Ward ceiling"));
    if (env.delegation_depth > ward.delegation_rules.max_delegation_depth)
        v.push(violation("envelope-cannot-exceed-ward", "Envelope delegation depth exceeds Ward ceiling"));
    // It cannot exceed MAE rules.
    if (!isSubsetOf(env.allowed_action_classes, mae.authority_envelope_rules.permitted_action_classes))
        v.push(violation("envelope-cannot-exceed-mae", "Envelope permits action classes the MAE forbids"));
    const maeProhibited = intersect(env.allowed_action_classes, mae.authority_envelope_rules.prohibited_action_classes);
    if (maeProhibited.length > 0)
        v.push(violation("envelope-cannot-exceed-mae", `Envelope allows MAE-prohibited classes: ${maeProhibited.join(", ")}`));
    if (env.delegation_depth > mae.authority_envelope_rules.max_delegation_depth)
        v.push(violation("envelope-cannot-exceed-mae", "Envelope delegation depth exceeds MAE ceiling"));
    // It can only define the scope under which Warrants may be issued; it never
    // authorizes execution directly. Structurally enforced: an envelope has no
    // execution affordance, only warrant_issuance_rules.
    if (!env.warrant_issuance_rules)
        v.push(violation("envelope-only-scopes-warrants", "Envelope lacks warrant issuance rules"));
    // It must be authored by someone the Ward permits.
    const authors = ward.delegation_rules.who_may_create_authority_envelopes;
    if (!authors.includes(env.authored_by) && !authors.includes("*"))
        v.push(violation("envelope-author-not-permitted", `${env.authored_by} may not author envelopes in this Ward`));
    // Revocable + integrity + lifecycle.
    if (env.revocation_state === "revoked")
        v.push(violation("authority-envelope-revoked", "Envelope is revoked"));
    if (env.revocation_state === "suspended")
        v.push(violation("authority-envelope-suspended", "Envelope is suspended"));
    if (env.policy_hash !== hashCanonical(stripForPolicyHash(env)))
        v.push(violation("envelope-policy-hash", "Envelope policy_hash does not match content"));
    if ((env.signatures ?? []).length === 0)
        v.push(violation("envelope-unsigned", "Envelope carries no signature"));
    // Issuer→key binding: an Authority Envelope under this Ward/MAE must be
    // signed by a key the MAE declares — no foreign tenant's key may author
    // an envelope in this constitutional scope.
    if (ctx.keyring && !verifyObjectSignatures(ctx.keyring, env, maeAllowedKeyIds(mae)))
        v.push(violation("envelope-signature-invalid", "Envelope signature failed verification"));
    v.push(...lifecycle("authority-envelope", env, ctx.now));
    return fromViolations(v);
}
// ---------------------------------------------------------------------------
// Warrant
// ---------------------------------------------------------------------------
export function validateWarrant(warrant, env, ward, mae, request, ctx) {
    const v = [];
    // Bindings: one Ward, one Envelope, one MAE, one proposed action.
    if (warrant.mae_id !== mae.mae_id)
        v.push(violation("warrant-binds-one-mae", "Warrant.mae_id mismatch"));
    if (warrant.ward_id !== ward.ward_id)
        v.push(violation("warrant-binds-one-ward", "Warrant.ward_id mismatch"));
    if (warrant.authority_envelope_id !== env.authority_envelope_id)
        v.push(violation("warrant-binds-one-envelope", "Warrant.authority_envelope_id mismatch"));
    if (warrant.proposed_action_id !== request.action.proposed_action_id)
        v.push(violation("warrant-binds-one-action", "Warrant.proposed_action_id does not match the request"));
    // Non-replayable / single-use.
    if (warrant.consumption_state !== "Unused")
        v.push(violation("warrant-non-replayable", `Warrant is ${warrant.consumption_state}; a spent warrant cannot authorize another act`));
    // Temporal.
    const t = ctx.now.getTime();
    const from = parse(warrant.valid_from);
    const until = parse(warrant.expires_at);
    if (Number.isNaN(from) || Number.isNaN(until))
        v.push(violation("warrant-temporal", "Warrant temporal bounds unparseable"));
    else {
        if (t < from)
            v.push(violation("warrant-not-yet-valid", `Warrant not valid until ${warrant.valid_from}`));
        if (t > until)
            v.push(violation("warrant-expired", `Warrant expired at ${warrant.expires_at}`));
    }
    // Warrant validity may not outlast the Ward's ceiling.
    if (!Number.isNaN(from) && !Number.isNaN(until) && (until - from) / 1000 > ward.warrant_constraints.max_validity_seconds)
        v.push(violation("warrant-validity-exceeds-ward", "Warrant validity window exceeds Ward ceiling"));
    const presented = parse(request.presented_at);
    if (Number.isNaN(presented)) {
        v.push(violation("commit-presentation-temporal", "Commit request presented_at is unparseable"));
    }
    else {
        if (presented > t + ctx.presentationSkewMs)
            v.push(violation("commit-presentation-in-future", `Commit request presented_at exceeds evaluation time by more than ${ctx.presentationSkewMs}ms`));
        if (presented < t - ctx.presentationSkewMs)
            v.push(violation("commit-presentation-stale", `Commit request presented_at is older than the ${ctx.presentationSkewMs}ms admissibility window`));
        if (!Number.isNaN(from) && presented < from)
            v.push(violation("warrant-presented-before-valid", `Commit request was presented before warrant valid_from ${warrant.valid_from}`));
        if (!Number.isNaN(until) && presented > until)
            v.push(violation("warrant-presented-after-expiry", `Commit request was presented after warrant expiry ${warrant.expires_at}`));
    }
    // A Warrant cannot exceed / broaden its Authority Envelope.
    if (!isSubsetOf([warrant.action_type], env.allowed_action_classes))
        v.push(violation("warrant-cannot-exceed-authority-envelope", `action_type ${warrant.action_type} not in envelope allowed classes`));
    if (intersect([warrant.action_type], env.prohibited_action_classes).length > 0)
        v.push(violation("warrant-cannot-exceed-authority-envelope", `action_type ${warrant.action_type} is prohibited by envelope`));
    if (!isSubsetOf([warrant.resource], env.resource_scope) && !env.resource_scope.includes("*"))
        v.push(violation("warrant-cannot-broaden-envelope", `resource ${warrant.resource} outside envelope scope`));
    const amount = numberOrUndefined(request.action.parameters["amount"]);
    if (amount !== undefined && env.monetary_limits && amount > env.monetary_limits.max_amount)
        v.push(violation("warrant-cannot-broaden-envelope", `amount ${amount} exceeds envelope monetary limit ${env.monetary_limits.max_amount}`));
    // Binding integrity (non-substitution): the warrant is pinned to THIS act.
    if (warrant.parameters_hash !== hashCanonical(request.action.parameters))
        v.push(violation("warrant-bound-to-this-act", "parameters_hash does not match the presented action parameters"));
    if (warrant.context_hash !== hashCanonical(request.context))
        v.push(violation("warrant-bound-to-this-act", "context_hash does not match the presented context"));
    if (warrant.telemetry_snapshot_hash !== hashCanonical(request.telemetry))
        v.push(violation("warrant-bound-to-this-act", "telemetry_snapshot_hash does not match the presented telemetry"));
    // Nonce / replay protection.
    if (ward.warrant_constraints.require_nonce && !warrant.nonce)
        v.push(violation("warrant-replay-protection", "Ward requires a nonce; warrant has none"));
    // A Warrant cannot survive Ward or Envelope revocation.
    if (ward.revoked_at)
        v.push(violation("warrant-cannot-survive-ward-revocation", "Ward is revoked; dependent warrant is invalid"));
    if (env.revocation_state === "revoked")
        v.push(violation("warrant-cannot-survive-envelope-revocation", "Envelope is revoked; dependent warrant is invalid"));
    // Integrity.
    if ((warrant.signatures ?? []).length === 0)
        v.push(violation("warrant-unsigned", "Warrant carries no signature"));
    // Issuer→key binding: a Warrant issued under this Envelope/Ward/MAE must
    // be signed by a key the MAE declares. Even a perfectly-constructed Warrant
    // for a real Envelope cannot be admitted if the signing key belongs to
    // another tenant's constitution.
    if (ctx.keyring && !verifyObjectSignatures(ctx.keyring, warrant, maeAllowedKeyIds(mae)))
        v.push(violation("warrant-signature-invalid", "Warrant signature failed verification"));
    return fromViolations(v);
}
export function validateGovernorInstrument(governor, ward, instrument, ctx) {
    const v = [];
    if (governor.ward_id !== ward.ward_id)
        v.push(violation("governor-belongs-to-one-ward", "Governor.ward_id mismatch"));
    if (governor.revoked_at)
        v.push(violation("governor-revoked", "Governor is revoked"));
    if (governor.expires_at && parse(governor.expires_at) < ctx.now.getTime())
        v.push(violation("governor-expired", "Governor delegation expired"));
    if (!ward.governor_registry.includes(governor.subject) && !ward.governor_registry.includes(governor.governor_id))
        v.push(violation("governor-not-registered", "Governor is not in the Ward governor registry"));
    if (instrument.kind === "authority-envelope" && !governor.may_create_authority_envelopes)
        v.push(violation("governor-lacks-capability", "Governor may not create Authority Envelopes"));
    if (instrument.kind === "warrant" && !governor.may_issue_warrants)
        v.push(violation("governor-lacks-capability", "Governor may not issue Warrants"));
    // A Governor may author instruments only within the Ward's delegation rules.
    if (!isSubsetOf(instrument.action_classes, governor.delegation_scope.action_classes))
        v.push(violation("governor-cannot-exceed-delegated-scope", "Instrument action classes exceed Governor delegation scope"));
    if (!withinMonetary(instrument.monetary_limit, governor.delegation_scope.monetary_limit))
        v.push(violation("governor-cannot-exceed-delegated-scope", "Instrument monetary limit exceeds Governor delegation scope"));
    if (instrument.delegation_depth !== undefined && instrument.delegation_depth > governor.delegation_depth)
        v.push(violation("governor-cannot-exceed-delegated-scope", "Instrument delegation depth exceeds Governor depth"));
    return fromViolations(v);
}
// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
export function maeIsLive(mae, now) {
    return lifecycle("mae", mae, now).length === 0;
}
export function chainIsIntact(mae, ward, env, warrant, request, ctx) {
    return combine(validateMae(mae, ctx), validateWardUnderMae(ward, mae, ctx), validateEnvelopeUnderWard(env, ward, mae, ctx), validateWarrant(warrant, env, ward, mae, request, ctx));
}
function numberOrUndefined(v) {
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
/** Strip the fields excluded from policy_hash, mirroring hash.computePolicyHash. */
function stripForPolicyHash(obj) {
    const out = {};
    for (const k of Object.keys(obj))
        if (k !== "signatures" && k !== "policy_hash")
            out[k] = obj[k];
    return out;
}
export { evaluateConstraints };
