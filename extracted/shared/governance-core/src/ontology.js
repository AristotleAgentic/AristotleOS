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
/**
 * The fixed ordering relation between concepts at commit time. Encoded as data so
 * that tests and reviewers can assert that no stage is skipped or reordered. In
 * particular `authority` precedes `attribution`, and `admissibility` precedes
 * `execution`.
 */
export const CHAIN_ORDER = [
    "identity",
    "presence",
    "authority",
    "sovereignty",
    "admissibility",
    "execution",
    "attribution",
];
/** True iff concept `a` must be established no later than concept `b`. */
export function precedes(a, b) {
    return CHAIN_ORDER.indexOf(a) <= CHAIN_ORDER.indexOf(b);
}
