import { createApp } from "./lib.js";
const port = Number(process.env.PORT_AUTHORITY_ROUTER ?? 7006);
const app = createApp();
app.get("/health", (_req, res) => res.json({ ok: true, service: "authority-router" }));
app.post("/route", (req, res) => {
    const { source, target, domain = "mission", phase = "dispatch", degradedNodes = [], riskLevel = "medium", requiredAuthorities = [] } = req.body;
    const relayByDomain = domain === "safety" || riskLevel === "high"
        ? "mesh.delta"
        : phase === "completion"
            ? "mesh.gamma"
            : phase === "tool-action"
                ? "mesh.beta"
                : "mesh.alpha";
    const alternateRelay = relayByDomain === "mesh.delta" ? "mesh.alpha" : "mesh.delta";
    const alternateAuthority = requiredAuthorities.find((authority) => authority !== source);
    const delegationAvailable = Boolean(alternateAuthority);
    const routeAffected = degradedNodes.includes(relayByDomain);
    const alternateAffected = degradedNodes.includes(alternateRelay);
    const disconnected = routeAffected && alternateAffected;
    const delegatedAuthorityAnchor = routeAffected && delegationAvailable ? alternateAuthority : source;
    const primary = [source, relayByDomain, target];
    const alternate = [delegatedAuthorityAnchor, alternateRelay, target];
    const selected = disconnected ? [] : routeAffected ? alternate : primary;
    const rejected = disconnected ? alternate : routeAffected ? primary : alternate;
    const authorityHint = requiredAuthorities.length ? `Authority chain anchored by ${requiredAuthorities[0]}` : "Authority chain inferred from issuer";
    const delegationReasoning = disconnected
        ? delegationAvailable
            ? `Delegated continuity candidate ${alternateAuthority} is available, but no admissible relay survives to carry the handoff.`
            : "No delegated authority lane is available for continuity handoff."
        : routeAffected
            ? delegationAvailable
                ? `Primary authority ${source} hands continuity to ${alternateAuthority} while ${relayByDomain} is degraded.`
                : `Primary authority ${source} retains control while rerouting around degraded relay ${relayByDomain}.`
            : `Primary authority ${source} remains the active constitutional anchor.`;
    const continuity = disconnected ? "disconnected" : routeAffected ? "degraded" : "stable";
    const continuityReasoning = disconnected
        ? `${authorityHint}. Primary relay ${relayByDomain} and failover relay ${alternateRelay} are degraded: ${degradedNodes.join(", ")}.`
        : routeAffected
            ? `${authorityHint}. Primary relay ${relayByDomain} degraded; failover relay ${alternateRelay} remains admissible.${delegationAvailable ? ` Delegated authority ${alternateAuthority} preserves cross-domain continuity.` : ""}`
            : `${authorityHint}. Authority continuity stable for ${domain} ${phase}.`;
    res.json({
        source,
        target,
        domain,
        phase,
        authorityAnchor: source,
        alternateAuthorityAnchor: alternateAuthority,
        delegatedAuthorityAnchor: disconnected ? undefined : delegatedAuthorityAnchor,
        selectedPath: selected,
        rejectedPath: rejected,
        degradedNodes,
        failoverReasoning: degradedNodes.length
            ? disconnected
                ? `${authorityHint}. No admissible relay remains because ${relayByDomain} and ${alternateRelay} are both degraded.`
                : routeAffected
                    ? `${authorityHint}. Primary relay ${relayByDomain} degraded: ${degradedNodes.join(", ")}`
                    : `${authorityHint}. Degraded nodes observed (${degradedNodes.join(", ")}) but primary relay ${relayByDomain} remains healthy.`
            : `${authorityHint}. Primary route healthy for ${domain} ${phase}.`,
        delegationReasoning,
        continuity,
        continuityReasoning,
        recoverable: disconnected || routeAffected,
        mode: disconnected ? "disconnected" : routeAffected ? "degraded" : "nominal"
    });
});
app.listen(port, () => console.log(`authority-router on ${port}`));
