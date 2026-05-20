import { resolve } from "node:path";
import { createApp, id, now } from "./lib.js";
import { createGovernanceChain, registerGovernanceChainRoutes } from "./governance-chain.js";
const port = Number(process.env.PORT_GOVERNANCE_KERNEL ?? 7001);
const app = createApp();
const chainV2Enabled = (process.env.GOVERNANCE_CHAIN_V2 ?? "false").toLowerCase() === "true";
const serviceDiscoveryMode = process.env.SERVICE_DISCOVERY_MODE ?? "container";
const registryHost = process.env.HOST_META_AUTHORITY_REGISTRY ??
    (serviceDiscoveryMode === "local" ? "127.0.0.1" : "meta-authority-registry");
const registryBase = `http://${registryHost}:${process.env.PORT_META_AUTHORITY_REGISTRY ?? 7004}`;
let killSwitchState = process.env.KILL_SWITCH_DEFAULT ?? "inactive";
const envelopes = new Map();
const warrants = new Map();
const killEvents = [];
const activeKillScopes = () => {
    const latestByScope = new Map();
    for (const event of killEvents) {
        latestByScope.set(`${event.scope}:${event.scopeRef ?? "*"}`, event);
    }
    return [...latestByScope.values()].filter((event) => event.state === "active");
};
const appliesKillSwitch = (context) => {
    if (killSwitchState === "active")
        return true;
    return activeKillScopes().some((event) => {
        if (event.scope === "global")
            return true;
        if (event.scope === "mission")
            return Boolean(context?.missionId && event.scopeRef === context.missionId);
        if (event.scope === "domain") {
            return Boolean(event.scopeRef &&
                (event.scopeRef === context?.domain || event.scopeRef === context?.targetNode));
        }
        if (event.scope === "agent")
            return Boolean(context?.agentId && event.scopeRef === context.agentId);
        if (event.scope === "device")
            return Boolean(context?.deviceId && event.scopeRef === context.deviceId);
        return false;
    });
};
app.get("/health", (_req, res) => res.json({ ok: true, service: "governance-kernel", killSwitchState, activeKillScopes: activeKillScopes(), governanceChainV2: chainV2Enabled }));
app.get("/envelopes", (_req, res) => res.json({ items: [...envelopes.values()] }));
app.get("/warrants", (_req, res) => res.json({ items: [...warrants.values()] }));
app.post("/kill-switch", (req, res) => {
    const nextState = req.body.state === "active" ? "active" : "inactive";
    if ((req.body.scope ?? "global") === "global") {
        killSwitchState = nextState;
    }
    const event = {
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
    const body = req.body;
    const registry = await fetch(`${registryBase}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ issuer: body.issuer ?? body.actor, domain: body.domain })
    }).then(r => r.json()).catch(() => ({ allowed: true, chain: ["maa-root-001"], explanation: "local fallback" }));
    if (!registry.allowed)
        return res.status(403).json({ allowed: false, reason: registry.explanation });
    const envelope = {
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
    const { envelopeId, missionId, targetNode, witnessRequired = true, agentId, deviceId } = req.body;
    const envelope = envelopes.get(envelopeId);
    if (!envelope)
        return res.status(404).json({ error: "envelope_not_found" });
    if (appliesKillSwitch({ missionId, domain: envelope.domain, targetNode, agentId, deviceId })) {
        return res.status(423).json({ error: "kill_switch_active" });
    }
    const warrant = {
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
    const { envelopeId, policyCompileId, missionId, targetNode, agentId, deviceId } = req.body;
    const envelope = envelopes.get(envelopeId);
    if (!envelope)
        return res.status(404).json({ admissible: false, reasons: ["Envelope not found"] });
    const admissible = !appliesKillSwitch({ missionId, domain: envelope.domain, targetNode, agentId, deviceId });
    res.json({
        admissible,
        reasons: admissible ? ["Envelope valid", `Policy compile ref: ${policyCompileId ?? "none"}`] : ["Kill switch active for this scope"]
    });
});
if (chainV2Enabled) {
    const signingSecret = process.env.GOVERNANCE_CHAIN_SIGNING_SECRET;
    const resolveEnvPath = (key) => {
        const value = process.env[key];
        return value ? resolve(process.cwd(), value) : undefined;
    };
    const signingPrivateKeyPath = resolveEnvPath("GOVERNANCE_CHAIN_SIGNING_PRIVATE_KEY_PATH");
    const signingPublicKeyPath = resolveEnvPath("GOVERNANCE_CHAIN_SIGNING_PUBLIC_KEY_PATH");
    const usingEd25519 = Boolean(signingPrivateKeyPath && signingPublicKeyPath);
    if (!usingEd25519 && !signingSecret) {
        console.warn("[governance-kernel] GOVERNANCE_CHAIN_V2 enabled without ed25519 keys or GOVERNANCE_CHAIN_SIGNING_SECRET; using an insecure dev secret. Configure signing before any non-dev use.");
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
    console.log(`governance-kernel: GOVERNANCE_CHAIN_V2 enabled (signing: ${chain.signingMode})${statePath ? ` (durable: ${statePath})` : " (in-memory; set GOVERNANCE_CHAIN_STATE_PATH for durability)"} — Ward/Warrant chain at /v2/*`);
}
app.listen(port, () => console.log(`governance-kernel on ${port}`));
