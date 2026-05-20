/**
 * Authoring helpers. These are the sanctioned way to bring primitives into being:
 * they compute the policy hash, sign the artifact, and register it in the store.
 * Hand-constructing primitives and inserting them raw is possible but bypasses
 * the integrity that the validators and Commit Gate rely on.
 *
 * Each `create*` returns the sealed artifact and also stores it.
 */
import { type Keyring } from "./hash.js";
import type { GovernanceStore } from "./store.js";
import type { AuthorityEnvelope, CommitGate, CommitRequest, FederationAgreement, Governor, HumanOriginAct, MetaAuthorityEnvelope, PresenceClaim, ProposedAction, Warrant, Ward } from "./types.js";
export type MaeInput = Omit<MetaAuthorityEnvelope, "mae_id" | "policy_hash" | "signatures"> & {
    mae_id?: string;
};
export declare function createMae(store: GovernanceStore, keyring: Keyring, keyId: string, input: MaeInput): MetaAuthorityEnvelope;
export type OriginActInput = Omit<HumanOriginAct, "signature">;
export type WardInput = Omit<Ward, "ward_id" | "policy_hash" | "signatures" | "human_origin_act"> & {
    ward_id?: string;
    human_origin_act: OriginActInput;
};
/** Constitute a Ward. The human/institutional origin act is signed here, modelling "confirmed presence". */
export declare function constituteWard(store: GovernanceStore, keyring: Keyring, keyId: string, input: WardInput): Ward;
export type GovernorInput = Omit<Governor, "governor_id" | "signatures"> & {
    governor_id?: string;
};
export declare function appointGovernor(store: GovernanceStore, keyring: Keyring, keyId: string, input: GovernorInput): Governor;
export type EnvelopeInput = Omit<AuthorityEnvelope, "authority_envelope_id" | "policy_hash" | "signatures"> & {
    authority_envelope_id?: string;
};
export declare function createAuthorityEnvelope(store: GovernanceStore, keyring: Keyring, keyId: string, input: EnvelopeInput): AuthorityEnvelope;
export interface IssueWarrantInput {
    warrant_id?: string;
    mae_id: string;
    ward_id: string;
    authority_envelope_id: string;
    issued_by: string;
    action: ProposedAction;
    context: Record<string, unknown>;
    telemetry: Record<string, unknown>;
    valid_from?: string;
    validity_seconds: number;
    nonce?: string;
}
/** Issue a single-use Warrant bound (by hash) to one specific proposed act. */
export declare function issueWarrant(store: GovernanceStore, keyring: Keyring, keyId: string, input: IssueWarrantInput): Warrant;
export declare function registerCommitGate(store: GovernanceStore, input: Omit<CommitGate, "commit_gate_id"> & {
    commit_gate_id?: string;
}): CommitGate;
export type FederationAgreementInput = Omit<FederationAgreement, "agreement_id" | "signatures"> & {
    agreement_id?: string;
};
export declare function createFederationAgreement(store: GovernanceStore, keyring: Keyring, keyId: string, input: FederationAgreementInput): FederationAgreement;
export interface CommitRequestInput {
    warrant: Warrant;
    commit_gate_id: string;
    action: ProposedAction;
    context: Record<string, unknown>;
    telemetry: Record<string, unknown>;
    actor_presence?: PresenceClaim;
    federation_agreement_id?: string;
    presented_at?: string;
    request_id?: string;
}
/** Build a CommitRequest whose chain references are taken from a warrant. */
export declare function commitRequestFor(input: CommitRequestInput): CommitRequest;
