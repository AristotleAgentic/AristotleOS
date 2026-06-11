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
export {};
