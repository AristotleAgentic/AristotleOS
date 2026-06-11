/**
 * Revocation semantics. Revocation propagates strictly downward:
 *
 *   MAE revoked        -> every dependent Ward (and its Envelopes/Warrants) invalid
 *   Ward revoked       -> every Authority Envelope and Warrant in it invalid
 *   Envelope revoked   -> every dependent Warrant invalid
 *   Warrant revoked    -> the proposed action it conveyed is invalid
 *   Warrant consumed   -> the proposed action cannot be replayed (handled at the gate)
 *
 * This module performs *eager* cascade so the stored state reflects the
 * revocation immediately. The Commit Gate independently re-validates the whole
 * chain on every commit, so even a missed cascade still fails closed — eager
 * propagation is correctness-as-defence-in-depth, not the sole guarantee.
 */

import type { GovernanceStore } from "./store.js";

export interface RevocationOutcome {
  revoked_maes: string[];
  revoked_wards: string[];
  revoked_envelopes: string[];
  revoked_warrants: string[];
}

function empty(): RevocationOutcome {
  return { revoked_maes: [], revoked_wards: [], revoked_envelopes: [], revoked_warrants: [] };
}

/** Revoke a single (Unused) warrant. Consumed/expired warrants are left as-is. */
export function revokeWarrant(store: GovernanceStore, warrantId: string, at: string, out = empty()): RevocationOutcome {
  const w = store.getWarrant(warrantId);
  if (!w) return out;
  if (w.consumption_state === "Unused") {
    w.consumption_state = "Revoked";
    w.state_changed_at = at;
    store.putWarrant(w);
    out.revoked_warrants.push(w.warrant_id);
  }
  return out;
}

/** Revoke an Authority Envelope and cascade to its Warrants. */
export function revokeEnvelope(store: GovernanceStore, envelopeId: string, at: string, out = empty()): RevocationOutcome {
  const env = store.getEnvelope(envelopeId);
  if (!env) return out;
  if (env.revocation_state !== "revoked") {
    env.revocation_state = "revoked";
    env.revoked_at = at;
    store.putEnvelope(env);
    out.revoked_envelopes.push(env.authority_envelope_id);
  }
  for (const w of store.warrantsForEnvelope(envelopeId)) revokeWarrant(store, w.warrant_id, at, out);
  return out;
}

/** Revoke a Ward and cascade to its Envelopes and Warrants. */
export function revokeWard(store: GovernanceStore, wardId: string, at: string, out = empty()): RevocationOutcome {
  const ward = store.getWard(wardId);
  if (!ward) return out;
  if (!ward.revoked_at) {
    ward.revoked_at = at;
    store.putWard(ward);
    out.revoked_wards.push(ward.ward_id);
  }
  for (const env of store.envelopesForWard(wardId)) revokeEnvelope(store, env.authority_envelope_id, at, out);
  // Catch any warrants bound to the ward directly (defensive).
  for (const w of store.warrantsForWard(wardId)) revokeWarrant(store, w.warrant_id, at, out);
  return out;
}

/** Revoke a Meta Authority Envelope and cascade to every dependent Ward. */
export function revokeMae(store: GovernanceStore, maeId: string, at: string, out = empty()): RevocationOutcome {
  const mae = store.getMae(maeId);
  if (!mae) return out;
  if (!mae.revoked_at) {
    mae.revoked_at = at;
    store.putMae(mae);
    out.revoked_maes.push(mae.mae_id);
  }
  for (const ward of store.wardsForMae(maeId)) revokeWard(store, ward.ward_id, at, out);
  return out;
}

/** Suspend a Ward (reversible) without cascading hard revocation. */
export function suspendWard(store: GovernanceStore, wardId: string, at: string): void {
  const ward = store.getWard(wardId);
  if (!ward) return;
  ward.suspended_at = at;
  store.putWard(ward);
}
