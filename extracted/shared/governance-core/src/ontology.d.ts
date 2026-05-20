/**
 * Governance ontology.
 *
 * AristotleOS does not ask whether an agent is authenticated. It asks whether a
 * consequential act is admissible under a complete authority chain at the moment
 * of execution. That question only stays answerable if the following concepts are
 * kept distinct. Collapsing any two of them is the "governance fiction" failure
 * mode: systems that look governed (credentials, logs) but have no bounded
 * authority.
 *
 * The cardinal rule of the chain is: **authority must precede attribution.** The
 * Warrant determines whether an act was sanctioned; the GEL Record records that
 * it occurred; only then is attribution derived. Identity-based access control
 * reverses this order, which is why identity is necessary but never sufficient.
 *
 * These types are deliberately thin. Their job is to name the seven concepts at
 * the type level and force call sites to say which one they mean, not to carry
 * behaviour. The behaviour lives in the primitives that reference them.
 */
/** GovernanceConcept enumerates the seven things that must never be collapsed. */
export type GovernanceConcept = "identity" | "presence" | "authority" | "sovereignty" | "admissibility" | "execution" | "attribution";
/**
 * Identity: who or what the actor *is*. A stable claim about an entity.
 * Necessary for the chain but, on its own, authorizes nothing.
 */
export interface Identity {
    readonly concept: "identity";
    subject: string;
    subjectType: "human" | "agent" | "model" | "service" | "workflow" | "organization" | "device";
    fingerprint?: string;
    issuer?: string;
    verificationStatus: "verified" | "degraded" | "revoked" | "unverified";
}
/**
 * Presence: whether the actor is *currently participating or reachable*. Distinct
 * from identity (a known actor may be absent) and from authority (a present actor
 * may still be unauthorized). Liveness, not legitimacy.
 */
export interface Presence {
    readonly concept: "presence";
    subject: string;
    reachable: boolean;
    lastSeen: string;
    proof?: string;
}
/**
 * Authority: what the actor *may* do. Always delegated, always bounded, always
 * traceable to a sovereign origin. Expressed by Authority Envelopes (standing
 * scope) and conveyed for a single act by Warrants.
 */
export interface Authority {
    readonly concept: "authority";
    subject: string;
    wardId: string;
    authorityEnvelopeId: string;
    allowedActionClasses: string[];
}
/**
 * Sovereignty: on whose behalf, and within which protected domain, authority is
 * exercised. This is the Ward. It is *not* the actor and *not* the operator; it
 * is the protected interest and the accountability root to which consequence
 * returns.
 */
export interface Sovereignty {
    readonly concept: "sovereignty";
    wardId: string;
    protectedInterest: string;
    accountableParty: string;
    consequenceDomain: string;
}
/**
 * Admissibility: whether *this specific action* is allowed *at this moment*. A
 * point-in-time judgement made by the Commit Gate. Standing authority does not
 * imply admissibility; revocation, telemetry, temporal scope, and replay state
 * can all make an otherwise-authorized act inadmissible right now.
 */
export interface Admissibility {
    readonly concept: "admissibility";
    proposedActionId: string;
    evaluatedAt: string;
    admissible: boolean;
    reasons: string[];
}
/**
 * Execution: the actual production of consequence. It happens *only after* the
 * Commit Gate permits it, and it is recorded separately from the authority that
 * sanctioned it.
 */
export interface Execution {
    readonly concept: "execution";
    proposedActionId: string;
    warrantId: string;
    performedAt: string;
    status: "success" | "failure" | "aborted";
}
/**
 * Attribution: who bears responsibility *after* the action. Derived from the GEL
 * Record, never asserted before it. This is the terminal concept of the chain
 * and the reason the Ward must name an accountable party up front.
 */
export interface Attribution {
    readonly concept: "attribution";
    gelRecordId: string;
    wardId: string;
    accountableParty: string;
    derivedAt: string;
}
/**
 * The fixed ordering relation between concepts at commit time. Encoded as data so
 * that tests and reviewers can assert that no stage is skipped or reordered. In
 * particular `authority` precedes `attribution`, and `admissibility` precedes
 * `execution`.
 */
export declare const CHAIN_ORDER: GovernanceConcept[];
/** True iff concept `a` must be established no later than concept `b`. */
export declare function precedes(a: GovernanceConcept, b: GovernanceConcept): boolean;
