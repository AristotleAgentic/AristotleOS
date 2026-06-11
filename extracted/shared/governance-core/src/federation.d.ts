/**
 * Cross-domain Ward federation.
 *
 * Federation is NOT achieved through identity. A foreign actor being who they say
 * they are proves nothing about whether their authority chain is honoured here. A
 * federated action must instead prove authority-chain compatibility across a
 * trust bridge:
 *
 *   - local MAE validity
 *   - foreign MAE trust admissibility (the local MAE must recognise it)
 *   - a Ward-to-Ward trust relationship (a live FederationAgreement)
 *   - Authority Envelope compatibility (the act class is shared)
 *   - Warrant validity (the ordinary chain still runs end to end)
 *   - jurisdictional / domain boundary rules
 *   - GEL receipt exportability
 *
 * If the trust bridge does not validate, the commit is denied (or fails closed
 * when no bridge exists at all) — never silently allowed.
 */
import { type ValidationResult } from "./errors.js";
import { type CommitOptions } from "./commit-gate.js";
import type { GovernanceStore } from "./store.js";
import type { CommitDecision, CommitRequest, FederationAgreement } from "./types.js";
export declare function validateFederation(store: GovernanceStore, agreement: FederationAgreement, request: CommitRequest, ctx?: import("./validators.js").ValidationContext): ValidationResult;
/**
 * Evaluate a federated commit: validate the trust bridge, then (only if it holds)
 * run the ordinary Commit Gate so the full MAE->Ward->Envelope->Warrant chain is
 * still enforced. No trust bridge => fail closed.
 */
export declare function evaluateFederatedCommit(store: GovernanceStore, request: CommitRequest, opts: CommitOptions): CommitDecision;
