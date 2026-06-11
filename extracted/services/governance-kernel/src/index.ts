import { resolve } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { createApp, id, now } from "./lib.js";
import { createGovernanceChain, registerGovernanceChainRoutes } from "./governance-chain.js";
import type { AuthorityEnvelope, ExecutionWarrant, KillSwitchEvent } from "@aristotle/shared-types";
// Substrate-backed Warrant lifecycle — Ed25519-signed, content-bound,
// nonce-protected. Lives alongside the legacy ExecutionWarrant flow.
import {
  createEd25519Signer,
  evaluateCommitGate,
  issueWarrant,
  verifyWarrant,
  type AristotleSigner,
  type AuthorityEnvelope as SubstrateEnvelope,
  type CanonicalActionInput,
  type WardManifest
} from "@aristotle/execution-control-runtime";
import { ReadinessChecks, mountHealthEndpoints } from "@aristotle/service-runtime";

const port = Number(process.env.PORT_GOVERNANCE_KERNEL ?? 7001);
const app = createApp();
const chainV2Enabled = (process.env.GOVERNANCE_CHAIN_V2 ?? "false").toLowerCase() === "true";
const serviceDiscoveryMode = process.env.SERVICE_DISCOVERY_MODE ?? "container";
const registryHost =
  process.env.HOST_META_AUTHORITY_REGISTRY ??
  (serviceDiscoveryMode === "local" ? "127.0.0.1" : "meta-authority-registry");
const registryBase = `http://${registryHost}:${process.env.PORT_META_AUTHORITY_REGISTRY ?? 7004}`;
let killSwitchState: "active" | "inactive" = (process.env.KILL_SWITCH_DEFAULT as "active" | "inactive") ?? "inactive";

const envelopes = new Map<string, AuthorityEnvelope>();
const warrants = new Map<string, ExecutionWarrant>();
const killEvents: KillSwitchEvent[] = [];

const activeKillScopes = () => {
  const latestByScope = new Map<string, KillSwitchEvent>();
  for (const event of killEvents) {
    latestByScope.set(`${event.scope}:${event.scopeRef ?? "*"}`, event);
  }
  return [...latestByScope.values()].filter((event) => event.state === "active");
};

const appliesKillSwitch = (context?: {
  missionId?: string;
  domain?: string;
  targetNode?: string;
  agentId?: string;
  deviceId?: string;
}) => {
  if (killSwitchState === "active") return true;
  return activeKillScopes().some((event) => {
    if (event.scope === "global") return true;
    if (event.scope === "mission") return Boolean(context?.missionId && event.scopeRef === context.missionId);
    if (event.scope === "domain") {
      return Boolean(
        event.scopeRef &&
          (event.scopeRef === context?.domain || event.scopeRef === context?.targetNode)
      );
    }
    if (event.scope === "agent") return Boolean(context?.agentId && event.scopeRef === context.agentId);
    if (event.scope === "device") return Boolean(context?.deviceId && event.scopeRef === context.deviceId);
    return false;
  });
};

// ---------------------------------------------------------------------------
// Substrate-backed Ed25519 signer.
// Pre-1.0: generate one ephemeral keypair at boot. Production deployments
// should inject a KMS-backed AristotleSigner (see LIMITATIONS.md §1).
// ---------------------------------------------------------------------------
let substrateSigner: AristotleSigner | null = null;
function getSubstrateSigner(): AristotleSigner {
  if (!substrateSigner) {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    substrateSigner = createEd25519Signer({
      privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString()
    });
  }
  return substrateSigner;
}

// Keep the custom /health handler because it surfaces extra fields
// (killSwitchState, activeKillScopes, governanceChainV2) that agent-os
// polls cross-service; mount only /healthz + /readyz from the shared
// helper.
app.get("/health", (_req, res) =>
  res.json({
    ok: true,
    service: "governance-kernel",
    killSwitchState,
    activeKillScopes: activeKillScopes(),
    governanceChainV2: chainV2Enabled,
    substrate_wired: true
  })
);
mountHealthEndpoints(app, {
  service: "governance-kernel",
  mountLegacyHealth: false,
  readiness: () => ReadinessChecks.start()
    .add("service_initialized", true)
    .build()
});
app.get("/envelopes", (_req, res) => res.json({ items: [...envelopes.values()] }));
app.get("/warrants", (_req, res) => res.json({ items: [...warrants.values()] }));
app.post("/kill-switch", (req, res) => {
  const nextState = req.body.state === "active" ? "active" : "inactive";
  if ((req.body.scope ?? "global") === "global") {
    killSwitchState = nextState;
  }
  const event: KillSwitchEvent = {
    id: id("kse"),
    artifactType: "kill-switch-event",
    timestamp: now(),
    actor: req.body.actor ?? "operator",
    state: nextState,
    reason: req.body.reason ?? "manual override",
    scope: req.body.scope ?? "global",
    scopeRef: req.body.scopeRef
  };
  killEvents.push(event);
  res.json(event);
});
app.post("/validate-envelope", async (req, res) => {
  const body = req.body as Partial<AuthorityEnvelope>;
  const registry = await fetch(`${registryBase}/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ issuer: body.issuer ?? body.actor, domain: body.domain })
  }).then(r => r.json()).catch(() => ({ allowed: true, chain: ["maa-root-001"], explanation: "local fallback" }));
  if (!registry.allowed) return res.status(403).json({ allowed: false, reason: registry.explanation });
  const envelope: AuthorityEnvelope = {
    id: body.id ?? id("env"),
    artifactType: "authority-envelope",
    timestamp: now(),
    actor: body.actor ?? "unknown",
    issuer: body.issuer ?? body.actor ?? "unknown",
    issuerChain: registry.chain,
    domain: body.domain ?? "unknown",
    subject: body.subject ?? "unknown",
    action: body.action ?? "unknown",
    validFrom: body.validFrom ?? now(),
    validUntil: body.validUntil ?? new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    permittedEffects: body.permittedEffects ?? [],
    constraints: body.constraints ?? {},
    metaAuthorityRef: registry.chain[0],
    verification: { status: "verified", verifier: "governance-kernel", reason: registry.explanation }
  };
  envelopes.set(envelope.id, envelope);
  res.json({ allowed: true, envelope, issuerChainExplanation: registry.explanation });
});
app.post("/issue-warrant", async (req, res) => {
  const { envelopeId, missionId, targetNode, witnessRequired = true, agentId, deviceId } = req.body as {
    envelopeId: string;
    missionId: string;
    targetNode: string;
    witnessRequired?: boolean;
    agentId?: string;
    deviceId?: string;
  };
  const envelope = envelopes.get(envelopeId);
  if (!envelope) return res.status(404).json({ error: "envelope_not_found" });
  if (appliesKillSwitch({ missionId, domain: envelope.domain, targetNode, agentId, deviceId })) {
    return res.status(423).json({ error: "kill_switch_active" });
  }
  const warrant: ExecutionWarrant = {
    id: id("war"),
    artifactType: "execution-warrant",
    timestamp: now(),
    actor: "governance-kernel",
    envelopeId,
    admissibilityHash: `adm-${Buffer.from(`${envelope.id}:${missionId}:${targetNode}`).toString("base64").slice(0, 16)}`,
    missionId,
    targetNode,
    obligations: { witnessRequired, minQuorum: witnessRequired ? Number(process.env.WITNESS_QUORUM ?? 2) : 0 },
    verification: { status: "verified", verifier: "governance-kernel" }
  };
  warrants.set(warrant.id, warrant);
  res.status(201).json(warrant);
});
app.post("/evaluate-admissibility", (req, res) => {
  const { envelopeId, policyCompileId, missionId, targetNode, agentId, deviceId } = req.body as {
    envelopeId: string;
    policyCompileId?: string;
    missionId?: string;
    targetNode?: string;
    agentId?: string;
    deviceId?: string;
  };
  const envelope = envelopes.get(envelopeId);
  if (!envelope) return res.status(404).json({ admissible: false, reasons: ["Envelope not found"] });
  const admissible = !appliesKillSwitch({ missionId, domain: envelope.domain, targetNode, agentId, deviceId });
  res.json({
    admissible,
    reasons: admissible ? ["Envelope valid", `Policy compile ref: ${policyCompileId ?? "none"}`] : ["Kill switch active for this scope"]
  });
});

if (chainV2Enabled) {
  const signingSecret = process.env.GOVERNANCE_CHAIN_SIGNING_SECRET;
  const resolveEnvPath = (key: string) => {
    const value = process.env[key];
    return value ? resolve(process.cwd(), value) : undefined;
  };
  const signingPrivateKeyPath = resolveEnvPath("GOVERNANCE_CHAIN_SIGNING_PRIVATE_KEY_PATH");
  const signingPublicKeyPath = resolveEnvPath("GOVERNANCE_CHAIN_SIGNING_PUBLIC_KEY_PATH");
  const usingEd25519 = Boolean(signingPrivateKeyPath && signingPublicKeyPath);
  if (!usingEd25519 && !signingSecret) {
    console.warn(
      "[governance-kernel] GOVERNANCE_CHAIN_V2 enabled without ed25519 keys or GOVERNANCE_CHAIN_SIGNING_SECRET; using an insecure dev secret. Configure signing before any non-dev use."
    );
  }
  const statePath = resolveEnvPath("GOVERNANCE_CHAIN_STATE_PATH");
  const chain = createGovernanceChain({
    signingSecret: signingSecret ?? "dev-insecure-governance-chain-secret",
    keyId: process.env.GOVERNANCE_CHAIN_KEY_ID,
    signingPrivateKeyPath,
    signingPublicKeyPath,
    statePath,
  });
  registerGovernanceChainRoutes(app, chain);
  console.log(
    `governance-kernel: GOVERNANCE_CHAIN_V2 enabled (signing: ${chain.signingMode})${statePath ? ` (durable: ${statePath})` : " (in-memory; set GOVERNANCE_CHAIN_STATE_PATH for durability)"} — Ward/Warrant chain at /v2/*`
  );
}

// ---------------------------------------------------------------------------
// Substrate-backed Warrant lifecycle (/v1/warrant/*)
//
// Sits alongside the legacy /issue-warrant flow (which uses the
// shared-types ExecutionWarrant shape). These new endpoints use the
// real substrate's Ed25519-signed, content-bound, single-use Warrant
// primitive from @aristotle/execution-control-runtime.
//
//   POST /v1/warrant/issue   — evaluate gate, mint signed Warrant
//   POST /v1/warrant/verify  — independently verify a Warrant
//
// Callers (UI, http-gateway, third parties) use the public verifier
// at @aristotle/warrant-verifier for offline verification; this
// service is the issuer.
// ---------------------------------------------------------------------------

app.post("/v1/warrant/issue", (req, res) => {
  const { ward, authorityEnvelope, action, ttlSeconds } = req.body as {
    ward: WardManifest;
    authorityEnvelope: SubstrateEnvelope;
    action: CanonicalActionInput;
    ttlSeconds?: number;
  };
  if (!ward || !authorityEnvelope || !action) {
    return res.status(400).json({
      ok: false,
      error: "missing_required_fields",
      detail: "ward, authorityEnvelope, and action are required"
    });
  }
  // Evaluate the gate first.
  const decision = evaluateCommitGate({ ward, authorityEnvelope, action, now: now() });
  if (decision.decision !== "ALLOW") {
    return res.status(403).json({
      ok: false,
      decision: decision.decision,
      reason_codes: decision.reason_codes,
      canonical_action_hash: decision.canonical_action_hash
    });
  }
  // Mint a signed Warrant.
  const signer = getSubstrateSigner();
  const warrant = issueWarrant(decision, action, authorityEnvelope, now(), signer, ttlSeconds ?? 60);
  if (!warrant) {
    return res.status(500).json({ ok: false, error: "warrant_issue_failed" });
  }
  res.status(201).json({
    ok: true,
    decision: decision.decision,
    canonical_action_hash: decision.canonical_action_hash,
    warrant,
    trust_anchor: { key_id: signer.key_id, public_key_pem: signer.public_key_pem }
  });
});

app.post("/v1/warrant/verify", (req, res) => {
  const { warrant, canonicalActionHash, trustedKeyIds, maxClockSkewMs, maxLifetimeMs } = req.body as {
    warrant: Parameters<typeof verifyWarrant>[0];
    canonicalActionHash: string;
    trustedKeyIds?: string[];
    maxClockSkewMs?: number;
    maxLifetimeMs?: number;
  };
  if (!warrant || !canonicalActionHash) {
    return res.status(400).json({
      ok: false,
      error: "missing_required_fields",
      detail: "warrant and canonicalActionHash are required"
    });
  }
  // If the caller didn't supply trustedKeyIds, default to our own
  // signer's key id (so warrants this kernel minted verify cleanly).
  const trusted = trustedKeyIds ?? [getSubstrateSigner().key_id];
  const verification = verifyWarrant(warrant, canonicalActionHash, now(), {
    trustedKeyIds: trusted,
    maxClockSkewMs,
    maxLifetimeMs
  });
  res.json({
    ok: verification.ok,
    reason: verification.reason,
    warrant_id: warrant.warrant_id,
    verified_at: now()
  });
});

app.get("/v1/trust-anchor", (_req, res) => {
  const signer = getSubstrateSigner();
  res.json({
    key_id: signer.key_id,
    algorithm: signer.algorithm,
    public_key_pem: signer.public_key_pem
  });
});

app.listen(port, () => console.log(`governance-kernel on ${port} (substrate-wired: Ed25519 warrant lifecycle at /v1/warrant/*)`));
