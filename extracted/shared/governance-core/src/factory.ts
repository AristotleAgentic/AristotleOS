/**
 * Authoring helpers. These are the sanctioned way to bring primitives into being:
 * they compute the policy hash, sign the artifact, and register it in the store.
 * Hand-constructing primitives and inserting them raw is possible but bypasses
 * the integrity that the validators and Commit Gate rely on.
 *
 * Each `create*` returns the sealed artifact and also stores it.
 */

import { canonicalize, computePolicyHash, hashCanonical, signObject, type Keyring, type Signature } from "./hash.js";
import { GovernanceError } from "./errors.js";
import { newId, nowIso, isoPlusSeconds } from "./ids.js";
import type { GovernanceStore } from "./store.js";
import type {
  AuthorityEnvelope,
  CommitGate,
  CommitRequest,
  FederationAgreement,
  Governor,
  HumanOriginAct,
  MetaAuthorityEnvelope,
  PresenceClaim,
  ProposedAction,
  Warrant,
  Ward,
} from "./types.js";

type Sealed = { policy_hash: string; signatures: Signature[] };

function sealPolicy<T extends Sealed>(keyring: Keyring, keyId: string, obj: T): T {
  obj.policy_hash = computePolicyHash(obj as unknown as Record<string, unknown>);
  obj.signatures = [signObject(keyring, keyId, obj as unknown as Record<string, unknown>)];
  return obj;
}

function sealSigned<T extends { signatures: Signature[] }>(keyring: Keyring, keyId: string, obj: T): T {
  obj.signatures = [signObject(keyring, keyId, obj as unknown as Record<string, unknown>)];
  return obj;
}

export type MaeInput = Omit<MetaAuthorityEnvelope, "mae_id" | "policy_hash" | "signatures"> & { mae_id?: string };

export function createMae(store: GovernanceStore, keyring: Keyring, keyId: string, input: MaeInput): MetaAuthorityEnvelope {
  const mae = sealPolicy(keyring, keyId, {
    ...input,
    mae_id: input.mae_id ?? newId("mae"),
    policy_hash: "",
    signatures: [],
  } as MetaAuthorityEnvelope);
  store.putMae(mae);
  return mae;
}

export type OriginActInput = Omit<HumanOriginAct, "signature">;
export type WardInput = Omit<Ward, "ward_id" | "policy_hash" | "signatures" | "human_origin_act"> & {
  ward_id?: string;
  human_origin_act: OriginActInput;
};

/** Constitute a Ward. The human/institutional origin act is signed here, modelling "confirmed presence". */
export function constituteWard(store: GovernanceStore, keyring: Keyring, keyId: string, input: WardInput): Ward {
  const originBase = { ...input.human_origin_act };
  const human_origin_act: HumanOriginAct = {
    ...originBase,
    signature: keyring.sign(keyId, canonicalize(originBase)),
  };
  const ward = sealPolicy(keyring, keyId, {
    ...input,
    ward_id: input.ward_id ?? newId("ward"),
    human_origin_act,
    policy_hash: "",
    signatures: [],
  } as Ward);
  store.putWard(ward);
  return ward;
}

export type GovernorInput = Omit<Governor, "governor_id" | "signatures"> & { governor_id?: string };

export function appointGovernor(store: GovernanceStore, keyring: Keyring, keyId: string, input: GovernorInput): Governor {
  const governor = sealSigned(keyring, keyId, {
    ...input,
    governor_id: input.governor_id ?? newId("gov"),
    signatures: [],
  } as Governor);
  store.putGovernor(governor);
  return governor;
}

export type EnvelopeInput = Omit<AuthorityEnvelope, "authority_envelope_id" | "policy_hash" | "signatures"> & {
  authority_envelope_id?: string;
};

export function createAuthorityEnvelope(store: GovernanceStore, keyring: Keyring, keyId: string, input: EnvelopeInput): AuthorityEnvelope {
  const env = sealPolicy(keyring, keyId, {
    ...input,
    authority_envelope_id: input.authority_envelope_id ?? newId("env"),
    policy_hash: "",
    signatures: [],
  } as AuthorityEnvelope);
  store.putEnvelope(env);
  return env;
}

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
export function issueWarrant(store: GovernanceStore, keyring: Keyring, keyId: string, input: IssueWarrantInput): Warrant {
  // Enforce the envelope's warrant issuance quota, if any.
  const envelope = store.getEnvelope(input.authority_envelope_id);
  const maxWarrants = envelope?.warrant_issuance_rules?.max_warrants;
  if (typeof maxWarrants === "number" && store.warrantsForEnvelope(input.authority_envelope_id).length >= maxWarrants) {
    throw new GovernanceError("warrant-quota-exceeded", `envelope ${input.authority_envelope_id} has issued its maximum of ${maxWarrants} warrants`);
  }
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
  } as Warrant);
  store.putWarrant(warrant);
  return warrant;
}

export function registerCommitGate(store: GovernanceStore, input: Omit<CommitGate, "commit_gate_id"> & { commit_gate_id?: string }): CommitGate {
  const gate: CommitGate = { ...input, commit_gate_id: input.commit_gate_id ?? newId("gate") };
  store.putCommitGate(gate);
  return gate;
}

export type FederationAgreementInput = Omit<FederationAgreement, "agreement_id" | "signatures"> & { agreement_id?: string };

export function createFederationAgreement(store: GovernanceStore, keyring: Keyring, keyId: string, input: FederationAgreementInput): FederationAgreement {
  const agreement = sealSigned(keyring, keyId, {
    ...input,
    agreement_id: input.agreement_id ?? newId("fed"),
    signatures: [],
  } as FederationAgreement);
  store.putFederationAgreement(agreement);
  return agreement;
}

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
export function commitRequestFor(input: CommitRequestInput): CommitRequest {
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
