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
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Ed25519Keyring, HmacKeyring, InMemoryGovernanceStore, appointGovernor, chainMetrics, exportEvidence, createAuthorityEnvelope, createMae, constituteWard, evaluateCommit, issueWarrant, registerCommitGate, verifyGelChain, } from "@aristotle/governance-core";
/** Build the kernel's governance chain: store + keyring + a single fail-closed Commit Gate. */
export function createGovernanceChain(config) {
    const signKeyId = config.keyId ?? "governance-kernel-key";
    let keyring;
    let signingMode;
    if (config.signingPrivateKeyPath && config.signingPublicKeyPath) {
        keyring = new Ed25519Keyring().addKeyPair(signKeyId, readFileSync(config.signingPrivateKeyPath, "utf8"), readFileSync(config.signingPublicKeyPath, "utf8"));
        signingMode = "ed25519";
    }
    else {
        keyring = new HmacKeyring({ [signKeyId]: config.signingSecret ?? "dev-insecure-governance-chain-secret" });
        signingMode = "hmac";
    }
    const store = new InMemoryGovernanceStore();
    const statePath = config.statePath;
    if (statePath && existsSync(statePath)) {
        try {
            store.loadSnapshot(JSON.parse(readFileSync(statePath, "utf8")));
        }
        catch (e) {
            console.error(`[governance-kernel] failed to load chain state from ${statePath}:`, e);
        }
    }
    // Deterministic gate id so an issued/cached reference stays valid across restarts.
    const gate = registerCommitGate(store, {
        commit_gate_id: "gate-governance-kernel",
        name: config.gateName ?? "governance-kernel-commit-gate",
        fail_closed: true,
    });
    // Durable persistence: serialized atomic writes (temp file + rename). Writes are
    // chained so they never overlap, and each flush() resolves after its write lands.
    let queue = Promise.resolve();
    const writeOnce = async () => {
        if (!statePath)
            return;
        const tmp = `${statePath}.tmp`;
        await mkdir(dirname(statePath), { recursive: true });
        await writeFile(tmp, JSON.stringify(store.toSnapshot()));
        await rename(tmp, statePath);
    };
    const flush = () => {
        if (!statePath)
            return Promise.resolve();
        queue = queue.then(writeOnce, writeOnce);
        return queue;
    };
    // Persist the freshly-registered gate (and any migrated state) once at boot.
    if (statePath)
        void flush();
    return {
        store,
        keyring,
        signKeyId,
        signingMode,
        gate,
        options: (now) => ({ keyring, signKeyId, now }),
        persist: () => void flush(),
        flush,
    };
}
/** Wrap a handler so malformed input becomes a 400 rather than a crash. */
function wrap(fn) {
    return (req, res) => {
        try {
            fn(req, res);
        }
        catch (e) {
            res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
        }
    };
}
/**
 * Register the /v2 chain routes. Authoring routes seal (hash + sign + register)
 * each primitive; /v2/commit runs the full Commit Gate (validate whole chain,
 * consume warrant on Allow, write hash-chained GEL) and returns the decision.
 */
export function registerGovernanceChainRoutes(app, chain) {
    // Authoring + commit routes mutate the store; persist after each.
    const mutate = (fn) => wrap((req, res) => {
        fn(req, res);
        chain.persist();
    });
    app.post("/v2/meta-authority-envelope", mutate((req, res) => res.status(201).json(createMae(chain.store, chain.keyring, chain.signKeyId, req.body))));
    app.post("/v2/ward", mutate((req, res) => res.status(201).json(constituteWard(chain.store, chain.keyring, chain.signKeyId, req.body))));
    app.post("/v2/authority-envelope", mutate((req, res) => res.status(201).json(createAuthorityEnvelope(chain.store, chain.keyring, chain.signKeyId, req.body))));
    app.post("/v2/governor", mutate((req, res) => res.status(201).json(appointGovernor(chain.store, chain.keyring, chain.signKeyId, req.body))));
    app.post("/v2/warrant", mutate((req, res) => res.status(201).json(issueWarrant(chain.store, chain.keyring, chain.signKeyId, req.body))));
    // The Warden. A governed "no" (Deny/Escalate/FailClosed) is still a 200 with a
    // decision body — only malformed requests are HTTP errors. Persist because a
    // successful commit consumes the warrant and appends a GEL record.
    app.post("/v2/commit", mutate((req, res) => res.json(evaluateCommit(chain.store, req.body, chain.options()))));
    app.get("/v2/commit-gate", (_req, res) => res.json(chain.gate));
    app.get("/v2/gel", (_req, res) => {
        const records = chain.store.getGelChain();
        res.json({ count: records.length, integrity: verifyGelChain(records, chain.keyring), records });
    });
    app.get("/v2/metrics", (_req, res) => res.json(chainMetrics(chain.store, chain.keyring)));
    // Portable, offline-verifiable compliance evidence (signed + hash-chained).
    app.get("/v2/gel/export", (_req, res) => res.json(exportEvidence(chain.store, chain.keyring, chain.signKeyId)));
    app.get("/v2/wards/:id", (req, res) => {
        const ward = chain.store.getWard(req.params.id);
        if (!ward)
            return res.status(404).json({ error: "ward_not_found" });
        res.json(ward);
    });
    app.get("/v2/authority-envelopes/:id", (req, res) => {
        const env = chain.store.getEnvelope(req.params.id);
        if (!env)
            return res.status(404).json({ error: "authority_envelope_not_found" });
        res.json(env);
    });
    app.get("/v2/warrants/:id", (req, res) => {
        const warrant = chain.store.getWarrant(req.params.id);
        if (!warrant)
            return res.status(404).json({ error: "warrant_not_found" });
        res.json(warrant);
    });
}
