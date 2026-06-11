/**
 * The governance store holds the live chain and is the single place where the
 * two irreversible state transitions happen: consuming a warrant and appending
 * a GEL record. Everything else is read-mostly registration.
 *
 * The in-memory implementation is the reference; a durable implementation
 * (backing the existing evidence-ledger / governance-kernel services) must
 * preserve the same two guarantees:
 *   - `consumeWarrant` is atomic and single-shot (replay-proof).
 *   - `appendGelRecord` is append-only and hash-chained.
 */
import type { AuthorityEnvelope, CommitGate, FederationAgreement, GELRecord, Governor, MetaAuthorityEnvelope, Warrant, WarrantConsumptionProof, Ward } from "./types.js";
/** Serializable snapshot of the whole store, for durable persistence. */
export interface StoreSnapshot {
    maes: MetaAuthorityEnvelope[];
    wards: Ward[];
    governors: Governor[];
    envelopes: AuthorityEnvelope[];
    warrants: Warrant[];
    gates: CommitGate[];
    agreements: FederationAgreement[];
    gel: GELRecord[];
    consumedNonces: string[];
    /** Cumulative consumed spend per envelope+currency (for budget enforcement). */
    spend: Array<{
        envelopeId: string;
        currency: string;
        amount: number;
    }>;
}
export interface GovernanceStore {
    putMae(mae: MetaAuthorityEnvelope): void;
    getMae(id: string): MetaAuthorityEnvelope | undefined;
    putWard(ward: Ward): void;
    getWard(id: string): Ward | undefined;
    wardsForMae(maeId: string): Ward[];
    putGovernor(g: Governor): void;
    getGovernor(id: string): Governor | undefined;
    putEnvelope(env: AuthorityEnvelope): void;
    getEnvelope(id: string): AuthorityEnvelope | undefined;
    envelopesForWard(wardId: string): AuthorityEnvelope[];
    putWarrant(w: Warrant): void;
    getWarrant(id: string): Warrant | undefined;
    warrantsForEnvelope(envId: string): Warrant[];
    warrantsForWard(wardId: string): Warrant[];
    putCommitGate(g: CommitGate): void;
    getCommitGate(id: string): CommitGate | undefined;
    putFederationAgreement(a: FederationAgreement): void;
    getFederationAgreement(id: string): FederationAgreement | undefined;
    /** Atomic single-use consumption. Throws GovernanceError if already spent or replayed. */
    consumeWarrant(warrantId: string, gateId: string, at: string): WarrantConsumptionProof;
    /** Latch an unused warrant into Expired when the commit boundary observes expiry. */
    expireWarrant(warrantId: string, at: string): void;
    /** Cumulative-spend accounting for envelope budgets. */
    spentFor(envelopeId: string, currency: string): number;
    recordSpend(envelopeId: string, currency: string, amount: number): void;
    /** GEL hash-chain accessors. */
    gelHeadHash(): string;
    gelLength(): number;
    appendGelRecord(record: GELRecord): void;
    getGelChain(): GELRecord[];
    /** Durable persistence hooks. Consumed-nonce state must round-trip so that
     *  single-use enforcement survives a restart. */
    toSnapshot(): StoreSnapshot;
    loadSnapshot(snapshot: StoreSnapshot): void;
}
export declare class InMemoryGovernanceStore implements GovernanceStore {
    private maes;
    private wards;
    private governors;
    private envelopes;
    private warrants;
    private gates;
    private agreements;
    private gel;
    /** Nonces already burned, to defeat replay across distinct warrant objects. */
    private consumedNonces;
    /** Cumulative consumed spend: envelopeId -> currency -> total amount. */
    private spend;
    putMae(mae: MetaAuthorityEnvelope): void;
    getMae(id: string): MetaAuthorityEnvelope | undefined;
    putWard(ward: Ward): void;
    getWard(id: string): Ward | undefined;
    wardsForMae(maeId: string): Ward[];
    putGovernor(g: Governor): void;
    getGovernor(id: string): Governor | undefined;
    putEnvelope(env: AuthorityEnvelope): void;
    getEnvelope(id: string): AuthorityEnvelope | undefined;
    envelopesForWard(wardId: string): AuthorityEnvelope[];
    putWarrant(w: Warrant): void;
    getWarrant(id: string): Warrant | undefined;
    warrantsForEnvelope(envId: string): Warrant[];
    warrantsForWard(wardId: string): Warrant[];
    putCommitGate(g: CommitGate): void;
    getCommitGate(id: string): CommitGate | undefined;
    putFederationAgreement(a: FederationAgreement): void;
    getFederationAgreement(id: string): FederationAgreement | undefined;
    consumeWarrant(warrantId: string, gateId: string, at: string): WarrantConsumptionProof;
    expireWarrant(warrantId: string, at: string): void;
    spentFor(envelopeId: string, currency: string): number;
    recordSpend(envelopeId: string, currency: string, amount: number): void;
    gelHeadHash(): string;
    gelLength(): number;
    appendGelRecord(record: GELRecord): void;
    getGelChain(): GELRecord[];
    toSnapshot(): StoreSnapshot;
    loadSnapshot(s: StoreSnapshot): void;
}
