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
import { type Keyring } from "./hash.js";
import { evaluateConstraints } from "./constraints.js";
import { type ValidationResult } from "./errors.js";
import type { AuthorityEnvelope, CommitRequest, Governor, MetaAuthorityEnvelope, MonetaryLimit, Warrant, Ward } from "./types.js";
export interface ValidationContext {
    now: Date;
    /** When present, signatures are verified and missing/invalid ones are violations. */
    keyring?: Keyring;
}
export declare function context(partial?: Partial<ValidationContext>): ValidationContext;
export declare function validateMae(mae: MetaAuthorityEnvelope, ctx: ValidationContext): ValidationResult;
export declare function validateWardUnderMae(ward: Ward, mae: MetaAuthorityEnvelope, ctx: ValidationContext): ValidationResult;
export declare function validateEnvelopeUnderWard(env: AuthorityEnvelope, ward: Ward, mae: MetaAuthorityEnvelope, ctx: ValidationContext): ValidationResult;
export declare function validateWarrant(warrant: Warrant, env: AuthorityEnvelope, ward: Ward, mae: MetaAuthorityEnvelope, request: CommitRequest, ctx: ValidationContext): ValidationResult;
export interface GovernorInstrument {
    kind: "authority-envelope" | "warrant";
    action_classes: string[];
    monetary_limit?: MonetaryLimit;
    delegation_depth?: number;
}
export declare function validateGovernorInstrument(governor: Governor, ward: Ward, instrument: GovernorInstrument, ctx: ValidationContext): ValidationResult;
export declare function maeIsLive(mae: MetaAuthorityEnvelope, now: Date): boolean;
export declare function chainIsIntact(mae: MetaAuthorityEnvelope, ward: Ward, env: AuthorityEnvelope, warrant: Warrant, request: CommitRequest, ctx: ValidationContext): ValidationResult;
export { evaluateConstraints };
