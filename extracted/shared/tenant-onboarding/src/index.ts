/**
 * @aristotle/tenant-onboarding — bootstrap primitive for a new tenant.
 *
 * Substrate audit #10 was 'Multi-tenant Control Plane at 40%'. The
 * read-side (tenancy.ts / scopeSnapshot) was already in place; the
 * gap was the write-side: a single primitive that takes a tenant_id
 * and produces a fully-constituted, signed, validator-checked
 * governance world.
 *
 *   bootstrapTenant(input)
 *     -> { mae, ward, envelope, store, keyring, keyId, summary }
 *
 * What gets minted:
 *   - MetaAuthorityEnvelope    constitutional root for this tenant,
 *                              with conservative ward-creation /
 *                              envelope rules and the supplied signing
 *                              key declared as the only authorized
 *                              issuer key (close the cross-tenant
 *                              forge gap from day one).
 *   - Ward                     one initial operational domain with
 *                              `accountable_party` set to the
 *                              `accountable_party` field of the input
 *                              (or `${tenant_id}.steward` by default).
 *   - AuthorityEnvelope        one bootstrap envelope authorizing the
 *                              bootstrap agent subject to a small set
 *                              of `allowed_action_classes`.
 *
 * What this primitive does NOT do:
 *   - It does NOT mint or rotate signing keys. The caller supplies a
 *     `Keyring` and `keyId`. For local demos pass a fresh
 *     `HmacKeyring`; for production, plug in your real KMS-backed
 *     keyring.
 *   - It does NOT contact a federation registry. Federation is
 *     disabled by default; enable via `federation.enable`.
 *   - It does NOT issue Warrants. The whole point is to set up the
 *     standing primitives that allow Warrants to be issued later.
 *
 * The primitive is deterministic given the same input + keyring + the
 * same clock seed; rerunning with different `now` values changes
 * `effective_from`/`expires_at` but not the artifact shape.
 */

import {
  appointGovernor,
  constituteWard,
  createAuthorityEnvelope,
  createMae,
  HmacKeyring,
  InMemoryGovernanceStore,
  type AuthorityEnvelope,
  type Governor,
  type GovernanceStore,
  type Keyring,
  type MetaAuthorityEnvelope,
  type Ward
} from "@aristotle/governance-core";

export interface TenantBootstrapInput {
  /** Owning tenant id. Surfaces in the MAE.tenant_id field and scopes
   *  every artifact under it (read-side multi-tenancy). */
  tenant_id: string;
  /** Display name for the tenant; used in artifact descriptions. */
  organization_name: string;
  /** Issuer identifier (e.g. "<tenant>.constitution" or a DID). */
  issuer: string;
  /** Constitutional scope domains the MAE covers ("treasury", "fleet-ops", ...). */
  constitutional_scope?: string[];
  /** Bootstrap agent subject the initial envelope is issued to. */
  bootstrap_subject: string;
  /** Allowed action classes for the bootstrap envelope. Default: ["bootstrap.read"]. */
  bootstrap_allowed_action_classes?: string[];
  /** Action classes that are constitutionally prohibited under this MAE. Default: ["payment.wire.external", "*.destruct"]. */
  prohibited_action_classes?: string[];
  /** Human / institution accountable for the initial Ward. Default: `${tenant_id}.steward`. */
  accountable_party?: string;
  /** Sovereign root for the initial Ward. Default: `${tenant_id}.sovereign`. */
  sovereign_root?: string;
  /** Federation config. Defaults to disabled. */
  federation?: { enable: boolean; trusted_mae_ids?: string[]; exportable_evidence?: boolean };
  /** Keyring + key id used to sign all artifacts. Required. */
  keyring: Keyring;
  keyId: string;
  /** Optional existing store to insert into. Defaults to a fresh InMemoryGovernanceStore. */
  store?: GovernanceStore;
  /** Clock seed. Defaults to new Date(). */
  now?: Date;
}

export interface TenantBootstrapSummary {
  tenant_id: string;
  organization_name: string;
  mae_id: string;
  ward_id: string;
  authority_envelope_id: string;
  bootstrap_subject: string;
  signing_key_id: string;
  artifacts_signed: 3;
  warning?: string;
}

export interface TenantBootstrapResult {
  mae: MetaAuthorityEnvelope;
  ward: Ward;
  envelope: AuthorityEnvelope;
  governor?: Governor;
  store: GovernanceStore;
  keyring: Keyring;
  keyId: string;
  summary: TenantBootstrapSummary;
}

/** Reasonable conservative defaults the primitive applies when the
 *  caller doesn't override. */
const DEFAULT_PROHIBITED = ["payment.wire.external", "*.destruct"];
const DEFAULT_BOOTSTRAP_ACTIONS = ["bootstrap.read"];

function isoMinusSeconds(d: Date, seconds: number): string {
  return new Date(d.getTime() - seconds * 1000).toISOString();
}

/**
 * Bootstrap a tenant. Returns the standing primitives plus a structured
 * summary the caller can log / return to an admin UI.
 */
export function bootstrapTenant(input: TenantBootstrapInput): TenantBootstrapResult {
  const now = input.now ?? new Date();
  const past = isoMinusSeconds(now, 3600);
  const store = input.store ?? new InMemoryGovernanceStore();
  const sovereignRoot = input.sovereign_root ?? `${input.tenant_id}.sovereign`;
  const accountableParty = input.accountable_party ?? `${input.tenant_id}.steward`;
  const constitutionalScope = input.constitutional_scope ?? [input.tenant_id];
  const bootstrapActions = input.bootstrap_allowed_action_classes ?? DEFAULT_BOOTSTRAP_ACTIONS;
  const prohibited = input.prohibited_action_classes ?? DEFAULT_PROHIBITED;
  const federation = input.federation ?? { enable: false };

  // 1) MAE — constitutional layer for this tenant.
  const mae = createMae(store, input.keyring, input.keyId, {
    version: "1.0.0",
    issuer: input.issuer,
    tenant_id: input.tenant_id,
    constitutional_scope: constitutionalScope,
    ward_creation_rules: {
      allowed_ward_types: ["Institutional", "ProtectedSpace"],
      require_human_origin_act: true,
      allowed_origin_methods: ["institutional-charter", "key-ceremony"],
      allowed_domains: constitutionalScope
    },
    ward_amendment_rules: { authorized_amenders: [sovereignRoot] },
    ward_revocation_rules: { authorized_revokers: [sovereignRoot], cascade: true },
    authority_envelope_rules: {
      max_delegation_depth: 2,
      permitted_action_classes: bootstrapActions,
      prohibited_action_classes: prohibited,
      require_telemetry: false
    },
    federation_rules: {
      federation_allowed: federation.enable,
      trusted_mae_ids: federation.trusted_mae_ids ?? [],
      exportable_evidence: federation.exportable_evidence ?? false
    },
    signing_keys: [{ key_id: input.keyId, algorithm: "hmac-sha256" }],
    effective_from: past
  });

  // 2) Initial Ward — operational domain.
  const ward = constituteWard(store, input.keyring, input.keyId, {
    mae_id: mae.mae_id,
    ward_type: "Institutional",
    name: `${input.organization_name} — Bootstrap Ward`,
    description: `Initial operational domain provisioned for tenant ${input.tenant_id}.`,
    sovereign_root: sovereignRoot,
    human_origin_act: {
      actor: sovereignRoot,
      actor_kind: "institution",
      method: "institutional-charter",
      attested_at: now.toISOString(),
      attestation_ref: `bootstrap:${input.tenant_id}`,
      presence_proof: `bootstrap:${input.tenant_id}`
    },
    accountable_party: accountableParty,
    protected_interest: `${input.organization_name} bootstrap operations`,
    boundary_definition: {
      kind: "organizational",
      description: "initial tenant boundary; refine before extending action scope",
      predicates: []
    },
    consequence_domain: input.tenant_id,
    attribution_rule: {
      attributes_to: "accountable_party",
      description: `consequence returns to ${accountableParty}`
    },
    governor_registry: [accountableParty],
    delegation_rules: {
      who_may_create_authority_envelopes: [sovereignRoot, accountableParty],
      who_may_issue_warrants: [accountableParty],
      max_delegation_depth: 2,
      may_federate: federation.enable
    },
    authority_envelope_constraints: {
      permitted_action_classes: bootstrapActions,
      prohibited_action_classes: prohibited
    },
    warrant_constraints: {
      max_validity_seconds: 300,
      require_nonce: true,
      require_telemetry_snapshot: true,
      single_use: true
    },
    revocation_rules: { authorized_revokers: [sovereignRoot], cascade: true },
    evidence_requirements: {
      require_gel_record: true,
      hash_chained: true,
      record_denials: true,
      record_escalations: true
    },
    effective_from: past
  });

  // 3) Initial Authority Envelope for the bootstrap subject.
  const envelope = createAuthorityEnvelope(store, input.keyring, input.keyId, {
    ward_id: ward.ward_id,
    mae_id: mae.mae_id,
    subject: input.bootstrap_subject,
    actor_type: "Agent",
    authored_by: accountableParty,
    allowed_action_classes: bootstrapActions,
    prohibited_action_classes: prohibited,
    resource_scope: [],
    temporal_scope: { from: past },
    operational_limits: [],
    telemetry_requirements: [],
    escalation_requirements: [],
    warrant_issuance_rules: {
      require_nonce: true,
      require_parameters_hash: true,
      require_context_hash: true,
      require_telemetry_snapshot_hash: true,
      max_validity_seconds: 300
    },
    delegation_allowed: false,
    delegation_depth: 1,
    revocation_state: "active",
    effective_from: past
  } as Parameters<typeof createAuthorityEnvelope>[3]);

  let governor: Governor | undefined;
  // 4) Optional: appoint the accountable_party as governor if it's
  //    distinct from the sovereign root. This is the more typical
  //    operating pattern (sovereign delegates day-to-day to a steward).
  if (accountableParty !== sovereignRoot) {
    governor = appointGovernor(store, input.keyring, input.keyId, {
      ward_id: ward.ward_id,
      subject: accountableParty,
      delegation_scope: { action_classes: bootstrapActions },
      may_create_authority_envelopes: true,
      may_issue_warrants: true,
      may_delegate: false,
      delegation_depth: 1,
      effective_from: past
    });
  }

  const summary: TenantBootstrapSummary = {
    tenant_id: input.tenant_id,
    organization_name: input.organization_name,
    mae_id: mae.mae_id,
    ward_id: ward.ward_id,
    authority_envelope_id: envelope.authority_envelope_id,
    bootstrap_subject: input.bootstrap_subject,
    signing_key_id: input.keyId,
    artifacts_signed: 3
  };

  // Warn the caller when they used the local demo keyring; production
  // deployments should not bootstrap a tenant under an in-process HMAC.
  if (input.keyring instanceof HmacKeyring) {
    summary.warning = "bootstrapped under HmacKeyring (demonstration); use a KMS-backed keyring for production tenants";
  }

  return { mae, ward, envelope, governor, store, keyring: input.keyring, keyId: input.keyId, summary };
}

/**
 * Convenience: bootstrap a tenant under a fresh local HmacKeyring,
 * suitable for tests, demos, and the first run of an evaluation
 * environment. Generates a secret per call so each demo tenant is
 * keyed independently.
 */
export function bootstrapTenantWithLocalKeyring(
  input: Omit<TenantBootstrapInput, "keyring" | "keyId">
): TenantBootstrapResult {
  const keyId = `key-${input.tenant_id}`;
  const keyring = new HmacKeyring({ [keyId]: `secret:${input.tenant_id}:${Date.now()}` });
  return bootstrapTenant({ ...input, keyring, keyId });
}

export type { MetaAuthorityEnvelope, Ward, AuthorityEnvelope, Governor, GovernanceStore, Keyring };
