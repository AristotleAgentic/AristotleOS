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

import { GENESIS_HASH } from "./gel.js";
import { GovernanceError } from "./errors.js";
import type {
  AuthorityEnvelope,
  CommitGate,
  FederationAgreement,
  GELRecord,
  Governor,
  MetaAuthorityEnvelope,
  Warrant,
  WarrantConsumptionProof,
  Ward,
} from "./types.js";

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
  spend: Array<{ envelopeId: string; currency: string; amount: number }>;
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

export class InMemoryGovernanceStore implements GovernanceStore {
  private maes = new Map<string, MetaAuthorityEnvelope>();
  private wards = new Map<string, Ward>();
  private governors = new Map<string, Governor>();
  private envelopes = new Map<string, AuthorityEnvelope>();
  private warrants = new Map<string, Warrant>();
  private gates = new Map<string, CommitGate>();
  private agreements = new Map<string, FederationAgreement>();
  private gel: GELRecord[] = [];
  /** Nonces already burned, to defeat replay across distinct warrant objects. */
  private consumedNonces = new Set<string>();
  /** Cumulative consumed spend: envelopeId -> currency -> total amount. */
  private spend = new Map<string, Map<string, number>>();

  putMae(mae: MetaAuthorityEnvelope): void {
    this.maes.set(mae.mae_id, mae);
  }
  getMae(id: string): MetaAuthorityEnvelope | undefined {
    return this.maes.get(id);
  }

  putWard(ward: Ward): void {
    this.wards.set(ward.ward_id, ward);
  }
  getWard(id: string): Ward | undefined {
    return this.wards.get(id);
  }
  wardsForMae(maeId: string): Ward[] {
    return [...this.wards.values()].filter((w) => w.mae_id === maeId);
  }

  putGovernor(g: Governor): void {
    this.governors.set(g.governor_id, g);
  }
  getGovernor(id: string): Governor | undefined {
    return this.governors.get(id);
  }

  putEnvelope(env: AuthorityEnvelope): void {
    this.envelopes.set(env.authority_envelope_id, env);
  }
  getEnvelope(id: string): AuthorityEnvelope | undefined {
    return this.envelopes.get(id);
  }
  envelopesForWard(wardId: string): AuthorityEnvelope[] {
    return [...this.envelopes.values()].filter((e) => e.ward_id === wardId);
  }

  putWarrant(w: Warrant): void {
    this.warrants.set(w.warrant_id, w);
  }
  getWarrant(id: string): Warrant | undefined {
    return this.warrants.get(id);
  }
  warrantsForEnvelope(envId: string): Warrant[] {
    return [...this.warrants.values()].filter((w) => w.authority_envelope_id === envId);
  }
  warrantsForWard(wardId: string): Warrant[] {
    return [...this.warrants.values()].filter((w) => w.ward_id === wardId);
  }

  putCommitGate(g: CommitGate): void {
    this.gates.set(g.commit_gate_id, g);
  }
  getCommitGate(id: string): CommitGate | undefined {
    return this.gates.get(id);
  }

  putFederationAgreement(a: FederationAgreement): void {
    this.agreements.set(a.agreement_id, a);
  }
  getFederationAgreement(id: string): FederationAgreement | undefined {
    return this.agreements.get(id);
  }

  consumeWarrant(warrantId: string, gateId: string, at: string): WarrantConsumptionProof {
    const w = this.warrants.get(warrantId);
    if (!w) throw new GovernanceError("warrant-not-found", warrantId);
    if (w.consumption_state !== "Unused") {
      // A consumed/expired/revoked/rejected warrant can never authorize again.
      throw new GovernanceError("warrant-already-consumed", `${warrantId} state=${w.consumption_state}`);
    }
    if (this.consumedNonces.has(w.nonce)) {
      throw new GovernanceError("nonce-replayed", w.nonce);
    }
    const prior = w.consumption_state;
    w.consumption_state = "Consumed";
    w.consumed_at = at;
    w.state_changed_at = at;
    w.commit_gate_id = gateId;
    this.consumedNonces.add(w.nonce);
    this.warrants.set(warrantId, w);
    return { warrant_id: warrantId, nonce: w.nonce, consumed_at: at, prior_state: prior, new_state: "Consumed" };
  }

  expireWarrant(warrantId: string, at: string): void {
    const w = this.warrants.get(warrantId);
    if (!w) throw new GovernanceError("warrant-not-found", warrantId);
    if (w.consumption_state !== "Unused") return;
    w.consumption_state = "Expired";
    w.state_changed_at = at;
    this.warrants.set(warrantId, w);
  }

  spentFor(envelopeId: string, currency: string): number {
    return this.spend.get(envelopeId)?.get(currency) ?? 0;
  }

  recordSpend(envelopeId: string, currency: string, amount: number): void {
    const byCurrency = this.spend.get(envelopeId) ?? new Map<string, number>();
    byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + amount);
    this.spend.set(envelopeId, byCurrency);
  }

  gelHeadHash(): string {
    return this.gel.length === 0 ? GENESIS_HASH : this.gel[this.gel.length - 1].gel_record_hash;
  }
  gelLength(): number {
    return this.gel.length;
  }
  appendGelRecord(record: GELRecord): void {
    this.gel.push(record);
  }
  getGelChain(): GELRecord[] {
    return [...this.gel];
  }

  toSnapshot(): StoreSnapshot {
    return {
      maes: [...this.maes.values()],
      wards: [...this.wards.values()],
      governors: [...this.governors.values()],
      envelopes: [...this.envelopes.values()],
      warrants: [...this.warrants.values()],
      gates: [...this.gates.values()],
      agreements: [...this.agreements.values()],
      gel: [...this.gel],
      consumedNonces: [...this.consumedNonces],
      spend: [...this.spend.entries()].flatMap(([envelopeId, byCurrency]) =>
        [...byCurrency.entries()].map(([currency, amount]) => ({ envelopeId, currency, amount })),
      ),
    };
  }

  loadSnapshot(s: StoreSnapshot): void {
    this.maes = new Map((s.maes ?? []).map((x) => [x.mae_id, x]));
    this.wards = new Map((s.wards ?? []).map((x) => [x.ward_id, x]));
    this.governors = new Map((s.governors ?? []).map((x) => [x.governor_id, x]));
    this.envelopes = new Map((s.envelopes ?? []).map((x) => [x.authority_envelope_id, x]));
    this.warrants = new Map((s.warrants ?? []).map((x) => [x.warrant_id, x]));
    this.gates = new Map((s.gates ?? []).map((x) => [x.commit_gate_id, x]));
    this.agreements = new Map((s.agreements ?? []).map((x) => [x.agreement_id, x]));
    this.gel = [...(s.gel ?? [])];
    this.consumedNonces = new Set(s.consumedNonces ?? []);
    this.spend = new Map();
    for (const entry of s.spend ?? []) {
      const byCurrency = this.spend.get(entry.envelopeId) ?? new Map<string, number>();
      byCurrency.set(entry.currency, entry.amount);
      this.spend.set(entry.envelopeId, byCurrency);
    }
  }
}
