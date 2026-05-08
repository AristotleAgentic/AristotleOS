import { createApp, id, now } from "./lib.js";
const port = Number(process.env.PORT_META_AUTHORITY_REGISTRY ?? 7004);
const app = createApp();
const artifacts = new Map();
const seed = {
    id: "maa-root-001",
    artifactType: "meta-authority-artifact",
    timestamp: now(),
    actor: "system.bootstrap",
    issuer: "system.bootstrap",
    subject: "coalition.core",
    domains: ["mission", "safety", "workspace", "repo", "ledger", "logistics"],
    delegationClass: "root",
    constraints: { mayMintAuthority: true },
    verification: { status: "verified", verifier: "bootstrap" }
};
artifacts.set(seed.id, seed);
const missionCommandSeed = {
    id: "maa-mission-command-001",
    artifactType: "meta-authority-artifact",
    timestamp: now(),
    actor: "system.bootstrap",
    issuer: "coalition.core",
    subject: "mission.command",
    domains: ["mission", "workspace", "repo", "logistics"],
    delegationClass: "delegated",
    parentAuthorityId: seed.id,
    constraints: { mayMintAuthority: false, commitPointRequired: true },
    verification: { status: "verified", verifier: "bootstrap" }
};
artifacts.set(missionCommandSeed.id, missionCommandSeed);
const safetyCouncilSeed = {
    id: "maa-safety-council-001",
    artifactType: "meta-authority-artifact",
    timestamp: now(),
    actor: "system.bootstrap",
    issuer: "coalition.core",
    subject: "safety.council",
    domains: ["safety"],
    delegationClass: "delegated",
    parentAuthorityId: seed.id,
    constraints: { mayMintAuthority: false, commitPointRequired: true, witnessRequired: true },
    verification: { status: "verified", verifier: "bootstrap" }
};
artifacts.set(safetyCouncilSeed.id, safetyCouncilSeed);
const evidenceStewardSeed = {
    id: "maa-evidence-steward-001",
    artifactType: "meta-authority-artifact",
    timestamp: now(),
    actor: "system.bootstrap",
    issuer: "coalition.core",
    subject: "evidence.steward",
    domains: ["ledger"],
    delegationClass: "delegated",
    parentAuthorityId: seed.id,
    constraints: { mayMintAuthority: false, commitPointRequired: true },
    verification: { status: "verified", verifier: "bootstrap" }
};
artifacts.set(evidenceStewardSeed.id, evidenceStewardSeed);
app.get("/health", (_req, res) => res.json({ ok: true, service: "meta-authority-registry" }));
app.get("/artifacts", (_req, res) => res.json({ items: [...artifacts.values()] }));
app.get("/artifacts/:id", (req, res) => {
    const artifact = artifacts.get(req.params.id);
    if (!artifact)
        return res.status(404).json({ error: "not_found" });
    res.json(artifact);
});
app.post("/artifacts", (req, res) => {
    const body = req.body;
    const artifact = {
        id: body.id ?? id("maa"),
        artifactType: "meta-authority-artifact",
        timestamp: now(),
        actor: body.actor ?? "unknown",
        issuer: body.issuer ?? body.actor ?? "unknown",
        subject: body.subject ?? "unknown",
        domains: body.domains ?? [],
        delegationClass: body.delegationClass ?? "delegated",
        parentAuthorityId: body.parentAuthorityId,
        constraints: body.constraints ?? {},
        verification: { status: "verified", verifier: "registry" }
    };
    artifacts.set(artifact.id, artifact);
    res.status(201).json(artifact);
});
app.post("/resolve", (req, res) => {
    const { issuer, domain } = req.body;
    const chain = [...artifacts.values()].filter(a => a.subject === issuer || a.actor === issuer);
    const allowed = chain.some(a => a.domains.includes(domain));
    res.json({
        issuer,
        domain,
        allowed,
        chain: chain.map(a => a.id),
        explanation: allowed ? `${issuer} is delegated for ${domain}` : `${issuer} lacks delegated authority for ${domain}`
    });
});
app.listen(port, () => console.log(`meta-authority-registry on ${port}`));
