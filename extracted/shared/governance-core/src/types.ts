/**
 * The runtime governance primitives.
 *
 * The chain, top to bottom:
 *
 *   MetaAuthorityEnvelope   constitutional layer: who may constitute Wards at all
 *     -> Ward               sovereign protected domain + accountability root
 *       -> AuthorityEnvelope  delegated operating scope inside the Ward
 *         -> Warrant          single-use conveyance for ONE proposed act
 *           -> CommitGate     the Warden: admissibility at the execution boundary
 *             -> Execution    consequence, only after the gate permits
 *               -> GELRecord  the receipt: proof of the whole lineage
 *
 * Naming is load-bearing and intentional:
 *   - Ward is NOT a tenant / namespace / session / RBAC role / policy bundle.
 *   - Warrant is NOT a token (it is exhaustible and act-specific).
 *   - GELRecord is NOT merely a log (it proves authority lineage).
 *   - CommitGate is NOT middleware (it is the enforcement boundary).
 *   - Governor is NOT the Ward (delegation extends reach, never moves consequence).
 */

import type { Constraint } from "./constraints.js";
import type { Signature, SignatureAlgorithm } from "./hash.js";

export type ISO8601 = string;

/** Lifecycle state shared by the standing primitives (MAE, Ward, Envelope). */
export type RevocationState = "active" | "suspended" | "revoked";

/** A signing key referenced by an artifact (never carries the secret). */
export interface SigningKey {
  key_id: string;
  algorithm: SignatureAlgorithm;
  /** PEM public key for ed25519; omitted for symmetric/HMAC trust domains. */
  public_key?: string;
}

export interface MonetaryLimit {
  currency: string;
  max_amount: number;
}

export interface TemporalScope {
  from: ISO8601;
  until?: ISO8601;
}

// ---------------------------------------------------------------------------
// 1. Meta Authority Envelope — the constitutional layer
// ---------------------------------------------------------------------------

export type WardType = "IndividualDirect" | "IndividualDelegated" | "Institutional" | "ProtectedSpace";

export type OriginMethod =
  | "webauthn"
  | "wet-signature"
  | "key-ceremony"
  | "institutional-charter"
  | "regulatory-designation";

export interface WardCreationRules {
  allowed_ward_types: WardType[];
  /** The article's first invariant: machines cannot constitute Wards. */
  require_human_origin_act: boolean;
  /** Require a confirmed-presence proof (e.g. WebAuthn assertion, ceremony witness). */
  require_presence_proof?: boolean;
  allowed_origin_methods: OriginMethod[];
  /** Domains a Ward's boundary may claim. "*" = unrestricted. */
  allowed_domains: string[];
  max_wards?: number;
}

export interface AmendmentRules {
  authorized_amenders: string[];
  min_quorum?: number;
}

export interface RevocationRules {
  authorized_revokers: string[];
  /** Whether revocation propagates downward to dependents. Should be true. */
  cascade: boolean;
}

export interface AuthorityEnvelopeRules {
  max_delegation_depth: number;
  /** Global ceiling on action classes any envelope may permit. "*" = any. */
  permitted_action_classes: string[];
  prohibited_action_classes: string[];
  require_telemetry: boolean;
  max_temporal_window_seconds?: number;
}

export interface FederationRules {
  federation_allowed: boolean;
  /** Foreign MAEs this MAE is willing to recognise, by id. */
  trusted_mae_ids: string[];
  /** Foreign signing key ids accepted as trust anchors. */
  trust_anchors?: string[];
  exportable_evidence: boolean;
}

export interface MetaAuthorityEnvelope {
  mae_id: string;
  version: string;
  issuer: string;
  /** Domains this constitution has standing over. */
  constitutional_scope: string[];
  ward_creation_rules: WardCreationRules;
  ward_amendment_rules: AmendmentRules;
  ward_revocation_rules: RevocationRules;
  authority_envelope_rules: AuthorityEnvelopeRules;
  federation_rules: FederationRules;
  signing_keys: SigningKey[];
  policy_hash: string;
  effective_from: ISO8601;
  expires_at?: ISO8601;
  revoked_at?: ISO8601;
  parent_mae_id?: string;
  signatures: Signature[];
}

// ---------------------------------------------------------------------------
// 2. Ward — the sovereign protected domain
// ---------------------------------------------------------------------------

/**
 * The constituting act. A Ward with no human/institutional origin act is invalid.
 * This is where "confirmed presence" enters the chain: the act is attested and
 * signed by a living human (or a chartered institutional officer).
 */
export interface HumanOriginAct {
  actor: string;
  actor_kind: "human" | "institution";
  method: OriginMethod;
  attested_at: ISO8601;
  /** Pointer to the evidence (WebAuthn assertion, ceremony log, charter, designation). */
  attestation_ref: string;
  presence_proof?: string;
  signature: Signature;
}

export interface BoundaryDefinition {
  kind: "logical" | "spatial" | "network" | "organizational";
  description: string;
  /** Predicates evaluated against the action context at commit (e.g. geofence). */
  predicates: Constraint[];
}

export interface WardDelegationRules {
  /** Subjects/governor ids that may author Authority Envelopes. "sovereign_root" allowed. */
  who_may_create_authority_envelopes: string[];
  who_may_issue_warrants: string[];
  max_delegation_depth: number;
  may_federate: boolean;
}

export interface EnvelopeConstraints {
  permitted_action_classes: string[];
  prohibited_action_classes: string[];
  max_resource_scope?: string[];
  max_monetary_limit?: MonetaryLimit;
}

export interface WarrantConstraints {
  max_validity_seconds: number;
  require_nonce: boolean;
  require_telemetry_snapshot: boolean;
  single_use: boolean;
}

export interface EvidenceRequirements {
  require_gel_record: boolean;
  hash_chained: boolean;
  record_denials: boolean;
  record_escalations: boolean;
}

/** How consequence is attributed — derived AFTER the receipt, never before. */
export interface AttributionRule {
  attributes_to: "accountable_party" | "actor" | "governor" | "sovereign_root";
  escalates_to?: string;
  description: string;
}

export interface Ward {
  ward_id: string;
  mae_id: string;
  ward_type: WardType;
  name: string;
  description: string;
  /** The constituting authority identifier (the sovereign of this domain). */
  sovereign_root: string;
  human_origin_act: HumanOriginAct;
  /** Who bears consequence. The accountability root. */
  accountable_party: string;
  /** Whose interest the Ward exists to protect. */
  protected_interest: string;
  boundary_definition: BoundaryDefinition;
  /** Where consequences land / are attributed. */
  consequence_domain: string;
  attribution_rule: AttributionRule;
  /** Governor ids authorized to author instruments inside this Ward. */
  governor_registry: string[];
  delegation_rules: WardDelegationRules;
  authority_envelope_constraints: EnvelopeConstraints;
  warrant_constraints: WarrantConstraints;
  revocation_rules: RevocationRules;
  evidence_requirements: EvidenceRequirements;
  effective_from: ISO8601;
  expires_at?: ISO8601;
  suspended_at?: ISO8601;
  revoked_at?: ISO8601;
  policy_hash: string;
  signatures: Signature[];
}

// ---------------------------------------------------------------------------
// 9. Governor — delegated author inside a Ward
// ---------------------------------------------------------------------------

export interface GovernorScope {
  action_classes: string[];
  resource_scope?: string[];
  monetary_limit?: MonetaryLimit;
}

export interface Governor {
  governor_id: string;
  ward_id: string;
  subject: string;
  delegation_scope: GovernorScope;
  may_create_authority_envelopes: boolean;
  may_issue_warrants: boolean;
  may_delegate: boolean;
  delegation_depth: number;
  effective_from: ISO8601;
  expires_at?: ISO8601;
  revoked_at?: ISO8601;
  signatures: Signature[];
}

// ---------------------------------------------------------------------------
// 3. Authority Envelope — delegated operating scope inside a Ward
// ---------------------------------------------------------------------------

export type ActorType = "Human" | "Agent" | "Model" | "Service" | "Workflow" | "Organization";

export interface WarrantIssuanceRules {
  max_warrants?: number;
  require_nonce: boolean;
  require_parameters_hash: boolean;
  require_context_hash: boolean;
  require_telemetry_snapshot_hash: boolean;
  max_validity_seconds: number;
}

export interface EscalationRule {
  when: Constraint;
  action: "escalate" | "deny";
  to?: string;
}

export interface AuthorityEnvelope {
  authority_envelope_id: string;
  ward_id: string;
  mae_id: string;
  subject: string;
  actor_type: ActorType;
  /** Governor id or "sovereign_root" that authored this envelope. */
  authored_by: string;
  allowed_action_classes: string[];
  prohibited_action_classes: string[];
  resource_scope: string[];
  temporal_scope: TemporalScope;
  geographic_scope?: Constraint[];
  /** Per-act ceiling on the action's `amount`. */
  monetary_limits?: MonetaryLimit;
  /** Cumulative ceiling across ALL acts consumed under this envelope (a spend budget). */
  cumulative_monetary_limit?: MonetaryLimit;
  operational_limits: Constraint[];
  telemetry_requirements: Constraint[];
  escalation_requirements: EscalationRule[];
  warrant_issuance_rules: WarrantIssuanceRules;
  delegation_allowed: boolean;
  delegation_depth: number;
  revocation_state: RevocationState;
  policy_hash: string;
  effective_from: ISO8601;
  expires_at?: ISO8601;
  revoked_at?: ISO8601;
  signatures: Signature[];
}

// ---------------------------------------------------------------------------
// 4. Warrant — single-use authority conveyance for one proposed act
// ---------------------------------------------------------------------------

export type ConsumptionState = "Unused" | "Consumed" | "Expired" | "Revoked" | "Rejected";

export interface Warrant {
  warrant_id: string;
  mae_id: string;
  ward_id: string;
  authority_envelope_id: string;
  proposed_action_id: string;
  action_type: string;
  actor: string;
  resource: string;
  /** Bindings that pin this warrant to ONE specific act (non-substitution). */
  parameters_hash: string;
  context_hash: string;
  telemetry_snapshot_hash: string;
  issued_by: string;
  issued_at: ISO8601;
  valid_from: ISO8601;
  expires_at: ISO8601;
  /** Single-use nonce; tracked globally to prevent replay across warrants. */
  nonce: string;
  consumption_state: ConsumptionState;
  consumed_at?: ISO8601;
  commit_gate_id?: string;
  signatures: Signature[];
}

// ---------------------------------------------------------------------------
// 5. Commit Gate — the Warden at the execution boundary
// ---------------------------------------------------------------------------

export interface CommitGate {
  commit_gate_id: string;
  name: string;
  guards_ward_ids?: string[];
  /** Must be true. The gate refuses execution on any incomplete chain. */
  fail_closed: boolean;
}

export interface ProposedAction {
  proposed_action_id: string;
  action_type: string;
  actor: string;
  resource: string;
  parameters: Record<string, unknown>;
}

export interface PresenceClaim {
  actor: string;
  reachable: boolean;
  last_seen: ISO8601;
  proof?: string;
}

export interface CommitRequest {
  request_id: string;
  mae_id: string;
  ward_id: string;
  authority_envelope_id: string;
  warrant_id: string;
  commit_gate_id: string;
  action: ProposedAction;
  context: Record<string, unknown>;
  telemetry: Record<string, unknown>;
  presented_at: ISO8601;
  actor_presence?: PresenceClaim;
  /** Set for federated commits; names the trust bridge being traversed. */
  federation_agreement_id?: string;
}

export type CommitDecisionKind = "Allow" | "Deny" | "Escalate" | "FailClosed";

/** The six questions every consequential action must answer, as references. */
export interface ChainRefs {
  mae_id?: string;
  ward_id?: string;
  authority_envelope_id?: string;
  warrant_id?: string;
  commit_gate_id?: string;
  gel_record_id?: string;
}

export interface CommitDecision {
  decision: CommitDecisionKind;
  request_id: string;
  reasons: string[];
  violated_invariants: string[];
  warrant_consumed: boolean;
  gel_record_id?: string;
  gel_record_hash?: string;
  evaluated_at: ISO8601;
  chain: ChainRefs;
}

// ---------------------------------------------------------------------------
// 6. GEL Record — the receipt / proof of authority lineage
// ---------------------------------------------------------------------------

export type GelDecision = CommitDecisionKind;

export interface RevocationSnapshot {
  mae: RevocationState;
  ward: RevocationState;
  authority_envelope: RevocationState;
  warrant: ConsumptionState;
}

export interface WarrantConsumptionProof {
  warrant_id: string;
  nonce: string;
  consumed_at: ISO8601;
  prior_state: ConsumptionState;
  new_state: ConsumptionState;
}

export interface ExecutionResult {
  status: "success" | "failure" | "aborted";
  summary?: string;
  output_hash?: string;
  recorded_at: ISO8601;
}

export interface GELRecord {
  gel_record_id: string;
  /** Position in the hash chain (0-based). */
  sequence: number;
  /** Hash of the previous record; GENESIS_HASH for the first. */
  previous_gel_hash: string;
  mae_id?: string;
  ward_id?: string;
  authority_envelope_id?: string;
  warrant_id?: string;
  commit_gate_id?: string;
  actor: string;
  action: string;
  action_hash: string;
  context_hash: string;
  telemetry_hash: string;
  /** [mae.policy_hash, ward.policy_hash, envelope.policy_hash] when known. */
  policy_hashes: string[];
  revocation_snapshot: RevocationSnapshot;
  decision: GelDecision;
  decision_reason: string;
  /** Present on Allow records: proves authority was consumed BEFORE attribution. */
  warrant_consumption_proof?: WarrantConsumptionProof;
  /** Present only on execution-outcome records, recorded after the act. */
  execution_result?: ExecutionResult;
  /** "admissibility" = the commit decision; "execution" = the consequence outcome. */
  record_kind: "admissibility" | "execution";
  timestamp: ISO8601;
  signatures: Signature[];
  gel_record_hash: string;
}

// ---------------------------------------------------------------------------
// 11. Federation — cross-domain Ward trust
// ---------------------------------------------------------------------------

export interface EnvelopeCompatibility {
  shared_action_classes: string[];
  max_monetary_limit?: MonetaryLimit;
}

export interface FederationAgreement {
  agreement_id: string;
  local_mae_id: string;
  foreign_mae_id: string;
  local_ward_id: string;
  foreign_ward_id: string;
  /** The shared zone the agreement governs (e.g. a joint search grid). */
  shared_resource_scope: string[];
  jurisdiction_rules: Constraint[];
  /** Foreign signing key ids accepted under this agreement. */
  trust_anchors: string[];
  envelope_compatibility: EnvelopeCompatibility;
  evidence_exportable: boolean;
  effective_from: ISO8601;
  expires_at?: ISO8601;
  revoked_at?: ISO8601;
  signatures: Signature[];
}
