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
import type { Express, Request, Response } from "express";
import {
  Ed25519Keyring,
  HmacKeyring,
  InMemoryGovernanceStore,
  appointGovernor,
  chainMetrics,
  exportEvidence,
  createAuthorityEnvelope,
  createMae,
  constituteWard,
  createFederationAgreement,
  openApiSpec,
  evaluateCommit,
  evaluateFederatedCommit,
  issueWarrant,
  registerCommitGate,
  scopeSnapshot,
  tenantSummaries,
  verifyGelChain,
  verifyGelRecords,
  type CommitGate,
  type CommitOptions,
  type CommitRequest,
  type GovernanceStore,
  type Keyring,
  type ScopeFilter,
  type StoreSnapshot,
} from "@aristotle/governance-core";

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
export function createGovernanceChain(config: GovernanceChainConfig): GovernanceChain {
  const primaryKeyId = config.keyId ?? "governance-kernel-key";
  let activeKeyId = primaryKeyId;
  let keyring: Keyring;
  let signingMode: "hmac" | "ed25519";
  let addSigningKey: (keyId: string, material: RotationMaterial) => void;
  if (config.signingPrivateKeyPath && config.signingPublicKeyPath) {
    const ed = new Ed25519Keyring().addKeyPair(
      primaryKeyId,
      readFileSync(config.signingPrivateKeyPath, "utf8"),
      readFileSync(config.signingPublicKeyPath, "utf8"),
    );
    keyring = ed;
    signingMode = "ed25519";
    addSigningKey = (keyId, m) => {
      if (!m.privatePem || !m.publicPem) throw new Error("ed25519 key rotation requires privatePem and publicPem");
      ed.addKeyPair(keyId, m.privatePem, m.publicPem);
    };
  } else {
    const hmac = new HmacKeyring({ [primaryKeyId]: config.signingSecret ?? "dev-insecure-governance-chain-secret" });
    keyring = hmac;
    signingMode = "hmac";
    addSigningKey = (keyId, m) => {
      if (!m.secret) throw new Error("hmac key rotation requires a secret");
      hmac.addKey(keyId, m.secret);
    };
  }
  const store = new InMemoryGovernanceStore();
  const statePath = config.statePath;

  if (statePath && existsSync(statePath)) {
    try {
      store.loadSnapshot(JSON.parse(readFileSync(statePath, "utf8")) as StoreSnapshot);
    } catch (e) {
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
  let queue: Promise<void> = Promise.resolve();
  const writeOnce = async (): Promise<void> => {
    if (!statePath) return;
    const tmp = `${statePath}.tmp`;
    await mkdir(dirname(statePath), { recursive: true });
    await writeFile(tmp, JSON.stringify(store.toSnapshot()));
    await rename(tmp, statePath);
  };
  const flush = (): Promise<void> => {
    if (!statePath) return Promise.resolve();
    queue = queue.then(writeOnce, writeOnce);
    return queue;
  };

  // Persist the freshly-registered gate (and any migrated state) once at boot.
  if (statePath) void flush();

  return {
    store,
    keyring,
    get signKeyId() {
      return activeKeyId;
    },
    signingMode,
    gate,
    rotateSigningKey: (keyId, material) => {
      addSigningKey(keyId, material);
      activeKeyId = keyId;
    },
    options: (now) => ({ keyring, signKeyId: activeKeyId, now }),
    persist: () => void flush(),
    flush,
  };
}

type Handler = (req: Request, res: Response) => void;

/** Wrap a handler so malformed input becomes a 400 rather than a crash. */
function wrap(fn: Handler): Handler {
  return (req, res) => {
    try {
      fn(req, res);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  };
}

/**
 * Register the /v2 chain routes. Authoring routes seal (hash + sign + register)
 * each primitive; /v2/commit runs the full Commit Gate (validate whole chain,
 * consume warrant on Allow, write hash-chained GEL) and returns the decision.
 */
export function registerGovernanceChainRoutes(app: Express, chain: GovernanceChain): void {
  // Authoring + commit routes mutate the store; persist after each.
  const mutate = (fn: Handler): Handler =>
    wrap((req, res) => {
      fn(req, res);
      chain.persist();
    });

  app.post(
    "/v2/meta-authority-envelope",
    mutate((req, res) => res.status(201).json(createMae(chain.store, chain.keyring, chain.signKeyId, req.body))),
  );

  app.post(
    "/v2/ward",
    mutate((req, res) => res.status(201).json(constituteWard(chain.store, chain.keyring, chain.signKeyId, req.body))),
  );

  app.post(
    "/v2/authority-envelope",
    mutate((req, res) => res.status(201).json(createAuthorityEnvelope(chain.store, chain.keyring, chain.signKeyId, req.body))),
  );

  app.post(
    "/v2/governor",
    mutate((req, res) => res.status(201).json(appointGovernor(chain.store, chain.keyring, chain.signKeyId, req.body))),
  );

  app.post(
    "/v2/warrant",
    mutate((req, res) => res.status(201).json(issueWarrant(chain.store, chain.keyring, chain.signKeyId, req.body))),
  );

  // The Warden. A governed "no" (Deny/Escalate/FailClosed) is still a 200 with a
  // decision body — only malformed requests are HTTP errors. Persist because a
  // successful commit consumes the warrant and appends a GEL record.
  app.post(
    "/v2/commit",
    mutate((req, res) => res.json(evaluateCommit(chain.store, req.body as CommitRequest, chain.options()))),
  );

  // Cross-Ward / cross-org federation. An agreement is the trust bridge; a
  // federated commit proves authority-chain compatibility across it (never
  // federation-by-identity).
  app.post(
    "/v2/federation-agreement",
    mutate((req, res) => res.status(201).json(createFederationAgreement(chain.store, chain.keyring, chain.signKeyId, req.body))),
  );

  app.post(
    "/v2/federated-commit",
    mutate((req, res) => res.json(evaluateFederatedCommit(chain.store, req.body as CommitRequest, chain.options()))),
  );

  app.get("/v2/federation-agreements/:id", (req, res) => {
    const agreement = chain.store.getFederationAgreement(req.params.id);
    if (!agreement) return res.status(404).json({ error: "federation_agreement_not_found" });
    res.json(agreement);
  });

  app.get("/v2/commit-gate", (_req, res) => res.json(chain.gate));

  // Rotate the active signing key. Prior keys remain in the keyring, so records
  // signed before rotation still verify. (Sensitive admin op; gateway-authed.)
  app.post(
    "/v2/rotate-signing-key",
    wrap((req, res) => {
      const { keyId, secret, privatePem, publicPem } = req.body ?? {};
      if (!keyId) throw new Error("rotate-signing-key requires keyId");
      chain.rotateSigningKey(keyId, { secret, privatePem, publicPem });
      res.json({ active: chain.signKeyId, signing_mode: chain.signingMode });
    }),
  );

  const scopeFromQuery = (req: Request): ScopeFilter => ({
    maeId: typeof req.query.mae === "string" ? req.query.mae : undefined,
    tenantId: typeof req.query.tenant === "string" ? req.query.tenant : undefined,
  });

  app.get("/v2/gel", (req, res) => {
    const filter = scopeFromQuery(req);
    const scoped = Boolean(filter.maeId || filter.tenantId);
    const records = scopeSnapshot(chain.store.toSnapshot(), filter).gel;
    const integrity = scoped ? verifyGelRecords(records, chain.keyring) : verifyGelChain(records, chain.keyring);
    res.json({ count: records.length, scoped, integrity, records });
  });

  app.get("/v2/metrics", (req, res) => res.json(chainMetrics(chain.store, chain.keyring, scopeFromQuery(req))));

  app.get("/v2/tenants", (_req, res) => res.json({ tenants: tenantSummaries(chain.store.toSnapshot()) }));

  app.get("/v2/openapi.json", (_req, res) => res.json(openApiSpec()));

  // Portable, offline-verifiable compliance evidence (signed + hash-chained).
  // With ?mae= or ?tenant= the bundle is scoped so a tenant export never leaks others.
  app.get("/v2/gel/export", (req, res) => res.json(exportEvidence(chain.store, chain.keyring, chain.signKeyId, scopeFromQuery(req))));

  app.get("/v2/wards/:id", (req, res) => {
    const ward = chain.store.getWard(req.params.id);
    if (!ward) return res.status(404).json({ error: "ward_not_found" });
    res.json(ward);
  });

  app.get("/v2/authority-envelopes/:id", (req, res) => {
    const env = chain.store.getEnvelope(req.params.id);
    if (!env) return res.status(404).json({ error: "authority_envelope_not_found" });
    res.json(env);
  });

  app.get("/v2/warrants/:id", (req, res) => {
    const warrant = chain.store.getWarrant(req.params.id);
    if (!warrant) return res.status(404).json({ error: "warrant_not_found" });
    res.json(warrant);
  });
}
