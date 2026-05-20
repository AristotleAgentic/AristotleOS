/**
 * GOVERNANCE_CHAIN_V2 — the Ward/Warrant runtime chain hosted inside the kernel.
 *
 * The governance-kernel is the natural authority for the chain: it already issues
 * warrants and resolves the meta-authority. Here it owns the durable
 * GovernanceStore and the Commit Gate, so warrant single-use consumption happens
 * in exactly one place (the execution-gate is stateless and cannot own it).
 *
 * This is additive and flag-gated: when GOVERNANCE_CHAIN_V2 is off, none of these
 * routes are registered and the legacy kernel endpoints behave exactly as before.
 * Routes live under /v2/* to keep them clearly separated from the legacy surface.
 */
import type { Express } from "express";
import { type CommitGate, type CommitOptions, type GovernanceStore, type Keyring } from "@aristotle/governance-core";
export interface RotationMaterial {
    /** HMAC secret for the new key (hmac mode). */
    secret?: string;
    /** Ed25519 PEMs for the new key (ed25519 mode). */
    privatePem?: string;
    publicPem?: string;
}
export interface GovernanceChain {
    store: GovernanceStore;
    keyring: Keyring;
    /** The currently-active signing key id (updates after rotateSigningKey). */
    signKeyId: string;
    /** Whether artifacts are signed with HMAC (single-domain) or ed25519 (BYO trust root). */
    signingMode: "hmac" | "ed25519";
    gate: CommitGate;
    /** Add a new signing key and make it active. Prior keys remain in the keyring so
     *  records signed before rotation still verify. */
    rotateSigningKey(keyId: string, material: RotationMaterial): void;
    /** Commit options for evaluateCommit (clock injectable for tests). */
    options(now?: Date): CommitOptions;
    /** Fire-and-forget durable persist (for route handlers). No-op without a statePath. */
    persist(): void;
    /** Await-able persist; resolves once a write reflecting current state completes. */
    flush(): Promise<void>;
}
export interface GovernanceChainConfig {
    /** HMAC signing secret (used when no ed25519 key paths are supplied). */
    signingSecret?: string;
    keyId?: string;
    /** Ed25519 PEM key paths (BYO trust root). When both are set, ed25519 is used. */
    signingPrivateKeyPath?: string;
    signingPublicKeyPath?: string;
    gateName?: string;
    /** When set, the chain loads from and persists to this file path. */
    statePath?: string;
}
/** Build the kernel's governance chain: store + keyring + a single fail-closed Commit Gate. */
export declare function createGovernanceChain(config: GovernanceChainConfig): GovernanceChain;
/**
 * Register the /v2 chain routes. Authoring routes seal (hash + sign + register)
 * each primitive; /v2/commit runs the full Commit Gate (validate whole chain,
 * consume warrant on Allow, write hash-chained GEL) and returns the decision.
 */
export declare function registerGovernanceChainRoutes(app: Express, chain: GovernanceChain): void;
