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
export class InMemoryGovernanceStore {
    maes = new Map();
    wards = new Map();
    governors = new Map();
    envelopes = new Map();
    warrants = new Map();
    gates = new Map();
    agreements = new Map();
    gel = [];
    /** Nonces already burned, to defeat replay across distinct warrant objects. */
    consumedNonces = new Set();
    /** Cumulative consumed spend: envelopeId -> currency -> total amount. */
    spend = new Map();
    putMae(mae) {
        this.maes.set(mae.mae_id, mae);
    }
    getMae(id) {
        return this.maes.get(id);
    }
    putWard(ward) {
        this.wards.set(ward.ward_id, ward);
    }
    getWard(id) {
        return this.wards.get(id);
    }
    wardsForMae(maeId) {
        return [...this.wards.values()].filter((w) => w.mae_id === maeId);
    }
    putGovernor(g) {
        this.governors.set(g.governor_id, g);
    }
    getGovernor(id) {
        return this.governors.get(id);
    }
    putEnvelope(env) {
        this.envelopes.set(env.authority_envelope_id, env);
    }
    getEnvelope(id) {
        return this.envelopes.get(id);
    }
    envelopesForWard(wardId) {
        return [...this.envelopes.values()].filter((e) => e.ward_id === wardId);
    }
    putWarrant(w) {
        this.warrants.set(w.warrant_id, w);
    }
    getWarrant(id) {
        return this.warrants.get(id);
    }
    warrantsForEnvelope(envId) {
        return [...this.warrants.values()].filter((w) => w.authority_envelope_id === envId);
    }
    warrantsForWard(wardId) {
        return [...this.warrants.values()].filter((w) => w.ward_id === wardId);
    }
    putCommitGate(g) {
        this.gates.set(g.commit_gate_id, g);
    }
    getCommitGate(id) {
        return this.gates.get(id);
    }
    putFederationAgreement(a) {
        this.agreements.set(a.agreement_id, a);
    }
    getFederationAgreement(id) {
        return this.agreements.get(id);
    }
    consumeWarrant(warrantId, gateId, at) {
        const w = this.warrants.get(warrantId);
        if (!w)
            throw new GovernanceError("warrant-not-found", warrantId);
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
        w.commit_gate_id = gateId;
        this.consumedNonces.add(w.nonce);
        this.warrants.set(warrantId, w);
        return { warrant_id: warrantId, nonce: w.nonce, consumed_at: at, prior_state: prior, new_state: "Consumed" };
    }
    spentFor(envelopeId, currency) {
        return this.spend.get(envelopeId)?.get(currency) ?? 0;
    }
    recordSpend(envelopeId, currency, amount) {
        const byCurrency = this.spend.get(envelopeId) ?? new Map();
        byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + amount);
        this.spend.set(envelopeId, byCurrency);
    }
    gelHeadHash() {
        return this.gel.length === 0 ? GENESIS_HASH : this.gel[this.gel.length - 1].gel_record_hash;
    }
    gelLength() {
        return this.gel.length;
    }
    appendGelRecord(record) {
        this.gel.push(record);
    }
    getGelChain() {
        return [...this.gel];
    }
    toSnapshot() {
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
            spend: [...this.spend.entries()].flatMap(([envelopeId, byCurrency]) => [...byCurrency.entries()].map(([currency, amount]) => ({ envelopeId, currency, amount }))),
        };
    }
    loadSnapshot(s) {
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
            const byCurrency = this.spend.get(entry.envelopeId) ?? new Map();
            byCurrency.set(entry.currency, entry.amount);
            this.spend.set(entry.envelopeId, byCurrency);
        }
    }
}
