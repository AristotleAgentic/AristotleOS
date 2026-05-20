/**
 * Scenario fixtures. Each `build*` returns a fully-constituted, signed governance
 * world plus a `propose()` helper that issues a fresh single-use Warrant for a
 * specific act and returns a matching CommitRequest. The fixtures are the
 * worked examples from the spec and double as the substrate for the test suite.
 *
 *   A. Payments agent   — refund authority up to $500
 *   B. Drone swarm      — survey grid cells below 400 ft, telemetry-gated
 *   C. Healthcare       — may DRAFT but never SUBMIT a medication order
 *   D. Federation       — cross-Ward search zone across a trust bridge
 */
import { type Keyring } from "./hash.js";
import { type GovernanceStore } from "./store.js";
import type { AuthorityEnvelope, CommitGate, CommitRequest, FederationAgreement, Governor, MetaAuthorityEnvelope, ProposedAction, Warrant, Ward } from "./types.js";
export interface ProposeOptions {
    action_type?: string;
    actor?: string;
    resource?: string;
    parameters?: Record<string, unknown>;
    context?: Record<string, unknown>;
    telemetry?: Record<string, unknown>;
    validity_seconds?: number;
    issued_by?: string;
}
export interface ProposeResult {
    action: ProposedAction;
    context: Record<string, unknown>;
    telemetry: Record<string, unknown>;
    warrant: Warrant;
    request: CommitRequest;
}
export interface ScenarioWorld {
    store: GovernanceStore;
    keyring: Keyring;
    keyId: string;
    mae: MetaAuthorityEnvelope;
    ward: Ward;
    envelope: AuthorityEnvelope;
    gate: CommitGate;
    governor?: Governor;
    propose: (opts?: ProposeOptions) => ProposeResult;
}
export declare function buildPayments(): ScenarioWorld;
export declare function buildDrone(): ScenarioWorld;
export declare function buildHealthcare(): ScenarioWorld;
export interface FederationWorld {
    store: GovernanceStore;
    keyring: Keyring;
    keyId: string;
    localMae: MetaAuthorityEnvelope;
    foreignMae: MetaAuthorityEnvelope;
    wardA: Ward;
    wardB: Ward;
    envelopeA: AuthorityEnvelope;
    gate: CommitGate;
    agreement: FederationAgreement;
    propose: (opts?: ProposeOptions & {
        withAgreement?: boolean;
    }) => ProposeResult;
}
/** Build a cross-domain federation world. `trusted=false` removes Ward B's MAE from Ward A's trust list. */
export declare function buildFederation(trusted?: boolean): FederationWorld;
