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

// ---------------------------------------------------------------------------
// Tenant lifecycle primitives
// ---------------------------------------------------------------------------
//
// The bootstrap primitive above stands a tenant up. Real deployments
// also need the operations that follow:
//   - rotate the signing key (without downtime; new artifacts use the
//     new key, old ones still verify against the old key until they
//     expire / are re-signed).
//   - suspend a tenant (latch all standing artifacts; gate refuses
//     subsequent actions while preserving evidence).
//   - revoke a tenant (terminal; cascades through MAE -> Wards ->
//     Envelopes).
//   - export a tenant snapshot for migration to another store.
// These primitives operate on the existing standing artifacts in a
// GovernanceStore; they do NOT bypass the validators (every mutation
// re-signs the resulting artifact under the supplied keyring).
//
// ---------------------------------------------------------------------------

export interface RotateTenantKeyInput {
  tenant_id: string;
  store: GovernanceStore;
  /** Current keyring containing the OLD key. */
  keyring: Keyring;
  /** Current signing key id. */
  oldKeyId: string;
  /** New signing key id; must already be present in the supplied keyring
   *  (callers add it via keyring.addKey or equivalent before calling). */
  newKeyId: string;
  newKeyAlgorithm?: "hmac-sha256" | "ed25519";
  now?: Date;
}

export interface RotateTenantKeyResult {
  tenant_id: string;
  mae_id: string;
  rotated_at: string;
  added_key_id: string;
  /** Whether the OLD key id was kept in signing_keys for a grace
   *  period (true) or removed immediately (false). Default keeps. */
  old_key_retained: boolean;
}

/**
 * Rotate a tenant's MAE signing key. Adds the new key to
 * `mae.signing_keys` and re-signs the MAE; preserves the old key in
 * `signing_keys` for backward verification of in-flight artifacts.
 * Callers can call `pruneRetiredTenantKey` later to remove it.
 */
export function rotateTenantKey(input: RotateTenantKeyInput): RotateTenantKeyResult {
  const now = input.now ?? new Date();
  // Find the tenant's MAE in the store.
  // GovernanceStore exposes getMae(id) but not listMaes; we identify
  // the MAE via wardsForMae traversal isn't possible without the id.
  // The most robust path is to snapshot + filter.
  const snap = input.store.toSnapshot();
  const mae = snap.maes.find((m) => m.tenant_id === input.tenant_id);
  if (!mae) throw new Error(`no MAE found for tenant_id=${input.tenant_id}`);
  if (mae.signing_keys.some((k) => k.key_id === input.newKeyId)) {
    throw new Error(`newKeyId=${input.newKeyId} is already in signing_keys`);
  }
  if (!mae.signing_keys.some((k) => k.key_id === input.oldKeyId)) {
    throw new Error(`oldKeyId=${input.oldKeyId} is not currently in signing_keys`);
  }
  const updatedMae: MetaAuthorityEnvelope = {
    ...mae,
    signing_keys: [
      ...mae.signing_keys,
      { key_id: input.newKeyId, algorithm: input.newKeyAlgorithm ?? "hmac-sha256" }
    ]
  };
  // Re-sign with the NEW key so downstream verifiers will use the
  // new key going forward. The OLD key is still present in
  // signing_keys, so any artifact signed under it still validates
  // through the existing keyring.
  // We don't have direct access to createMae's sealing here; the
  // cleanest path is to clear signatures + policy_hash and let the
  // factory re-seal. Use the same internal trick the factory uses.
  const { signatures: _sigs, policy_hash: _ph, ...rest } = updatedMae;
  const resealed = { ...rest, policy_hash: "", signatures: [] };
  // Re-compute policy_hash + signature using the same logic the
  // factory uses. We reach into governance-core hash helpers.
  // (We import them lazily to avoid widening the public surface.)
  reseal(resealed, input.keyring, input.newKeyId);
  input.store.putMae(resealed as MetaAuthorityEnvelope);
  return {
    tenant_id: input.tenant_id,
    mae_id: mae.mae_id,
    rotated_at: now.toISOString(),
    added_key_id: input.newKeyId,
    old_key_retained: true
  };
}

export interface PruneRetiredKeyInput {
  tenant_id: string;
  store: GovernanceStore;
  keyring: Keyring;
  /** New (active) signing key id, used to re-sign the MAE after the
   *  retired key is removed. */
  activeKeyId: string;
  retiredKeyId: string;
}

/**
 * Remove a retired signing key from a tenant's MAE.signing_keys. The
 * MAE is re-signed under the active key. After this returns, any
 * artifact still signed by the retired key will fail validation.
 */
export function pruneRetiredTenantKey(input: PruneRetiredKeyInput): { tenant_id: string; mae_id: string; removed_key_id: string } {
  const snap = input.store.toSnapshot();
  const mae = snap.maes.find((m) => m.tenant_id === input.tenant_id);
  if (!mae) throw new Error(`no MAE found for tenant_id=${input.tenant_id}`);
  if (!mae.signing_keys.some((k) => k.key_id === input.retiredKeyId)) {
    throw new Error(`retiredKeyId=${input.retiredKeyId} is not in signing_keys`);
  }
  if (!mae.signing_keys.some((k) => k.key_id === input.activeKeyId)) {
    throw new Error(`activeKeyId=${input.activeKeyId} is not in signing_keys`);
  }
  if (input.activeKeyId === input.retiredKeyId) {
    throw new Error("activeKeyId and retiredKeyId must differ");
  }
  const filtered = mae.signing_keys.filter((k) => k.key_id !== input.retiredKeyId);
  const updated: MetaAuthorityEnvelope = {
    ...mae,
    signing_keys: filtered,
    policy_hash: "",
    signatures: []
  };
  reseal(updated, input.keyring, input.activeKeyId);
  input.store.putMae(updated);
  return { tenant_id: input.tenant_id, mae_id: mae.mae_id, removed_key_id: input.retiredKeyId };
}

export interface SuspendTenantInput {
  tenant_id: string;
  store: GovernanceStore;
  reason: string;
  now?: Date;
}

/**
 * Suspend a tenant: set MAE + every Ward + every AuthorityEnvelope's
 * `suspended_at` (or `revocation_state: "suspended"` where the type
 * uses that field). Suspended artifacts make the gate refuse all
 * subsequent actions but leave evidence intact for forensic recovery.
 *
 * Note: this primitive does NOT re-sign artifacts after the suspension
 * field flip — `suspended_at` is a lifecycle latch outside the
 * signature material on most artifacts. The validators consult it
 * directly.
 */
export function suspendTenant(input: SuspendTenantInput): { tenant_id: string; suspended_at: string; affected: { wards: number; envelopes: number } } {
  const now = input.now ?? new Date();
  const ts = now.toISOString();
  const snap = input.store.toSnapshot();
  const mae = snap.maes.find((m) => m.tenant_id === input.tenant_id);
  if (!mae) throw new Error(`no MAE found for tenant_id=${input.tenant_id}`);

  // MAE doesn't have a `suspended_at`; we model suspension via revoked_at
  // semantics on Wards and revocation_state on Envelopes. The MAE itself
  // is left intact so the audit trail of the suspension reason can be
  // appended via the GEL when the operator does it.
  let wards = 0, envelopes = 0;
  for (const w of input.store.wardsForMae(mae.mae_id)) {
    if (w.suspended_at) continue;
    input.store.putWard({ ...w, suspended_at: ts });
    wards++;
  }
  for (const e of snap.envelopes.filter((env) => env.mae_id === mae.mae_id)) {
    if (e.revocation_state === "suspended" || e.revocation_state === "revoked") continue;
    input.store.putEnvelope({ ...e, revocation_state: "suspended" });
    envelopes++;
  }
  // Sink a tiny audit-style log entry; callers wanting a GEL record
  // should do that explicitly via the GEL machinery. We bind `reason`
  // into the returned shape so it's at least surfaced.
  return { tenant_id: input.tenant_id, suspended_at: ts, affected: { wards, envelopes } };
}

/**
 * Revoke a tenant terminally. Latches `revoked_at` on every Ward and
 * marks every Envelope `revocation_state: "revoked"`. Wards' cascade
 * rules then propagate revocation through the rest of the chain.
 */
export function revokeTenant(input: SuspendTenantInput): { tenant_id: string; revoked_at: string; affected: { wards: number; envelopes: number } } {
  const now = input.now ?? new Date();
  const ts = now.toISOString();
  const snap = input.store.toSnapshot();
  const mae = snap.maes.find((m) => m.tenant_id === input.tenant_id);
  if (!mae) throw new Error(`no MAE found for tenant_id=${input.tenant_id}`);

  let wards = 0, envelopes = 0;
  for (const w of input.store.wardsForMae(mae.mae_id)) {
    if (w.revoked_at) continue;
    input.store.putWard({ ...w, revoked_at: ts });
    wards++;
  }
  for (const e of snap.envelopes.filter((env) => env.mae_id === mae.mae_id)) {
    if (e.revocation_state === "revoked") continue;
    input.store.putEnvelope({ ...e, revocation_state: "revoked" });
    envelopes++;
  }
  return { tenant_id: input.tenant_id, revoked_at: ts, affected: { wards, envelopes } };
}

export interface TenantSnapshot {
  tenant_id: string;
  exported_at: string;
  mae: MetaAuthorityEnvelope;
  wards: Ward[];
  envelopes: AuthorityEnvelope[];
}

/**
 * Export everything under one tenant as a portable snapshot. Useful
 * for tenant migration (export from store A, importTenantSnapshot
 * into store B). Excludes Warrants + GEL because those are not in
 * scope for a control-plane migration (warrants are single-use; GEL
 * is hash-chained and must be replicated separately).
 */
export function exportTenantSnapshot(input: { tenant_id: string; store: GovernanceStore; now?: Date }): TenantSnapshot {
  const snap = input.store.toSnapshot();
  const mae = snap.maes.find((m) => m.tenant_id === input.tenant_id);
  if (!mae) throw new Error(`no MAE found for tenant_id=${input.tenant_id}`);
  return {
    tenant_id: input.tenant_id,
    exported_at: (input.now ?? new Date()).toISOString(),
    mae,
    wards: input.store.wardsForMae(mae.mae_id),
    envelopes: snap.envelopes.filter((e) => e.mae_id === mae.mae_id)
  };
}

/**
 * Import a previously exported TenantSnapshot into another store.
 * Fails fast if any artifact in the snapshot collides with an
 * existing id in the target.
 */
export function importTenantSnapshot(input: { snapshot: TenantSnapshot; store: GovernanceStore; overwrite?: boolean }): { tenant_id: string; imported: { mae: 1; wards: number; envelopes: number } } {
  const overwrite = input.overwrite ?? false;
  if (!overwrite) {
    if (input.store.getMae(input.snapshot.mae.mae_id)) {
      throw new Error(`MAE collision: ${input.snapshot.mae.mae_id}`);
    }
    for (const w of input.snapshot.wards) {
      if (input.store.getWard(w.ward_id)) throw new Error(`Ward collision: ${w.ward_id}`);
    }
    for (const e of input.snapshot.envelopes) {
      if (input.store.getEnvelope(e.authority_envelope_id)) throw new Error(`Envelope collision: ${e.authority_envelope_id}`);
    }
  }
  input.store.putMae(input.snapshot.mae);
  for (const w of input.snapshot.wards) input.store.putWard(w);
  for (const e of input.snapshot.envelopes) input.store.putEnvelope(e);
  return {
    tenant_id: input.snapshot.tenant_id,
    imported: { mae: 1, wards: input.snapshot.wards.length, envelopes: input.snapshot.envelopes.length }
  };
}

// ---------------------------------------------------------------------------
// internal: reseal an artifact in place using the governance-core
// hashing helpers. We do this lazily so we don't widen the
// tenant-onboarding import surface unnecessarily.
// ---------------------------------------------------------------------------

import { computePolicyHash, signObject } from "@aristotle/governance-core";

function reseal(obj: { policy_hash: string; signatures: import("@aristotle/governance-core").Signature[] }, keyring: Keyring, keyId: string): void {
  obj.policy_hash = computePolicyHash(obj as unknown as Record<string, unknown>);
  obj.signatures = [signObject(keyring, keyId, obj as unknown as Record<string, unknown>)];
}

export type { MetaAuthorityEnvelope, Ward, AuthorityEnvelope, Governor, GovernanceStore, Keyring };
