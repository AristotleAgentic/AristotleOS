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
/** Revoke a single (Unused) warrant. Consumed/expired warrants are left as-is. */
export declare function revokeWarrant(store: GovernanceStore, warrantId: string, at: string, out?: RevocationOutcome): RevocationOutcome;
/** Revoke an Authority Envelope and cascade to its Warrants. */
export declare function revokeEnvelope(store: GovernanceStore, envelopeId: string, at: string, out?: RevocationOutcome): RevocationOutcome;
/** Revoke a Ward and cascade to its Envelopes and Warrants. */
export declare function revokeWard(store: GovernanceStore, wardId: string, at: string, out?: RevocationOutcome): RevocationOutcome;
/** Revoke a Meta Authority Envelope and cascade to every dependent Ward. */
export declare function revokeMae(store: GovernanceStore, maeId: string, at: string, out?: RevocationOutcome): RevocationOutcome;
/** Suspend a Ward (reversible) without cascading hard revocation. */
export declare function suspendWard(store: GovernanceStore, wardId: string, at: string): void;
