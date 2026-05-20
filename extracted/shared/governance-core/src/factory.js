/**
 * Authoring helpers. These are the sanctioned way to bring primitives into being:
 * they compute the policy hash, sign the artifact, and register it in the store.
 * Hand-constructing primitives and inserting them raw is possible but bypasses
 * the integrity that the validators and Commit Gate rely on.
 *
 * Each `create*` returns the sealed artifact and also stores it.
 */
import { canonicalize, computePolicyHash, hashCanonical, signObject } from "./hash.js";
import { newId, nowIso, isoPlusSeconds } from "./ids.js";
function sealPolicy(keyring, keyId, obj) {
    obj.policy_hash = computePolicyHash(obj);
    obj.signatures = [signObject(keyring, keyId, obj)];
    return obj;
}
function sealSigned(keyring, keyId, obj) {
    obj.signatures = [signObject(keyring, keyId, obj)];
    return obj;
}
export function createMae(store, keyring, keyId, input) {
    const mae = sealPolicy(keyring, keyId, {
        ...input,
        mae_id: input.mae_id ?? newId("mae"),
        policy_hash: "",
        signatures: [],
    });
    store.putMae(mae);
    return mae;
}
/** Constitute a Ward. The human/institutional origin act is signed here, modelling "confirmed presence". */
export function constituteWard(store, keyring, keyId, input) {
    const originBase = { ...input.human_origin_act };
    const human_origin_act = {
        ...originBase,
        signature: keyring.sign(keyId, canonicalize(originBase)),
    };
    const ward = sealPolicy(keyring, keyId, {
        ...input,
        ward_id: input.ward_id ?? newId("ward"),
        human_origin_act,
        policy_hash: "",
        signatures: [],
    });
    store.putWard(ward);
    return ward;
}
export function appointGovernor(store, keyring, keyId, input) {
    const governor = sealSigned(keyring, keyId, {
        ...input,
        governor_id: input.governor_id ?? newId("gov"),
        signatures: [],
    });
    store.putGovernor(governor);
    return governor;
}
export function createAuthorityEnvelope(store, keyring, keyId, input) {
    const env = sealPolicy(keyring, keyId, {
        ...input,
        authority_envelope_id: input.authority_envelope_id ?? newId("env"),
        policy_hash: "",
        signatures: [],
    });
    store.putEnvelope(env);
    return env;
}
/** Issue a single-use Warrant bound (by hash) to one specific proposed act. */
export function issueWarrant(store, keyring, keyId, input) {
    const issued_at = nowIso();
    const valid_from = input.valid_from ?? issued_at;
    const warrant = sealSigned(keyring, keyId, {
        warrant_id: input.warrant_id ?? newId("wrt"),
        mae_id: input.mae_id,
        ward_id: input.ward_id,
        authority_envelope_id: input.authority_envelope_id,
        proposed_action_id: input.action.proposed_action_id,
        action_type: input.action.action_type,
        actor: input.action.actor,
        resource: input.action.resource,
        parameters_hash: hashCanonical(input.action.parameters),
        context_hash: hashCanonical(input.context),
        telemetry_snapshot_hash: hashCanonical(input.telemetry),
        issued_by: input.issued_by,
        issued_at,
        valid_from,
        expires_at: isoPlusSeconds(valid_from, input.validity_seconds),
        nonce: input.nonce ?? newId("nonce"),
        consumption_state: "Unused",
        signatures: [],
    });
    store.putWarrant(warrant);
    return warrant;
}
export function registerCommitGate(store, input) {
    const gate = { ...input, commit_gate_id: input.commit_gate_id ?? newId("gate") };
    store.putCommitGate(gate);
    return gate;
}
export function createFederationAgreement(store, keyring, keyId, input) {
    const agreement = sealSigned(keyring, keyId, {
        ...input,
        agreement_id: input.agreement_id ?? newId("fed"),
        signatures: [],
    });
    store.putFederationAgreement(agreement);
    return agreement;
}
/** Build a CommitRequest whose chain references are taken from a warrant. */
export function commitRequestFor(input) {
    return {
        request_id: input.request_id ?? newId("req"),
        mae_id: input.warrant.mae_id,
        ward_id: input.warrant.ward_id,
        authority_envelope_id: input.warrant.authority_envelope_id,
        warrant_id: input.warrant.warrant_id,
        commit_gate_id: input.commit_gate_id,
        action: input.action,
        context: input.context,
        telemetry: input.telemetry,
        presented_at: input.presented_at ?? nowIso(),
        actor_presence: input.actor_presence,
        federation_agreement_id: input.federation_agreement_id,
    };
}
