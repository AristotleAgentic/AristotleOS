import { createApp, id, now } from "./lib.js";
const port = Number(process.env.PORT_EXECUTION_GATE ?? 7008);
const app = createApp();
let killSwitchState = process.env.KILL_SWITCH_DEFAULT ?? "inactive";
const decisions = new Map();
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
            return Boolean(event.scopeRef && (event.scopeRef === context?.domain || event.scopeRef === context?.targetNode));
        }
        if (event.scope === "agent")
            return Boolean(context?.agentId && event.scopeRef === context.agentId);
        if (event.scope === "device")
            return Boolean(context?.deviceId && event.scopeRef === context.deviceId);
        return false;
    });
};
app.get("/health", (_req, res) => res.json({ ok: true, service: "execution-gate", killSwitchState, activeKillScopes: activeKillScopes() }));
app.get("/decisions", (_req, res) => res.json({ items: [...decisions.values()] }));
app.post("/kill-switch", (req, res) => {
    const scope = req.body.scope === "mission" ||
        req.body.scope === "domain" ||
        req.body.scope === "agent" ||
        req.body.scope === "device"
        ? req.body.scope
        : "global";
    if (scope === "global") {
        killSwitchState = req.body.state === "active" ? "active" : "inactive";
    }
    killEvents.push({ state: req.body.state === "active" ? "active" : "inactive", scope, scopeRef: req.body.scopeRef });
    res.json({ state: killSwitchState, reason: req.body.reason ?? "operator action", scope, scopeRef: req.body.scopeRef });
});
app.post("/commit-point", (req, res) => {
    const { warrantId, envelopeId, witnessAccepted = true, witnessRequired = false, identityLegitimate = true, authorityApproved = true, telemetrySatisfied = true, phase, targetType, targetId, telemetryReasons = [], missionId, domain, targetNode, agentId, deviceId } = req.body;
    const haltActive = appliesKillSwitch({ missionId, domain, targetNode, agentId, deviceId });
    const witnessStatus = witnessRequired ? (witnessAccepted ? "satisfied" : "unsatisfied") : "not-required";
    const reasons = [];
    if (haltActive)
        reasons.push("Kill switch active for this scope");
    if (!identityLegitimate)
        reasons.push("Identity legitimacy failed at commit point.");
    if (!authorityApproved)
        reasons.push("Authority invariants failed at commit point.");
    if (!telemetrySatisfied)
        reasons.push(...(telemetryReasons.length > 0 ? telemetryReasons : ["Telemetry manifold rejected action."]));
    if (witnessRequired && !witnessAccepted)
        reasons.push("Witness obligation unsatisfied");
    const decision = {
        id: id("dec"),
        artifactType: "execution-decision",
        timestamp: now(),
        actor: "execution-gate",
        warrantId,
        envelopeId,
        phase,
        targetType,
        targetId,
        decision: haltActive
            ? "halt"
            : identityLegitimate && authorityApproved && telemetrySatisfied && (!witnessRequired || witnessAccepted)
                ? "allow"
                : "deny",
        reasons: reasons.length > 0 ? reasons : [phase ? `Commit point approved for ${phase}.` : "Commit point approved."],
        killSwitchState: haltActive ? "active" : "inactive",
        witnessStatus,
        verification: { status: haltActive ? "failed" : "verified", verifier: "execution-gate" }
    };
    decisions.set(decision.id, decision);
    res.json(decision);
});
app.post("/decide", (req, res) => {
    const { warrantId, envelopeId, witnessAccepted, witnessRequired = true, missionId, domain, targetNode, agentId, deviceId } = req.body;
    const haltActive = appliesKillSwitch({ missionId, domain, targetNode, agentId, deviceId });
    const witnessStatus = witnessRequired ? (witnessAccepted ? "satisfied" : "unsatisfied") : "not-required";
    const decision = {
        id: id("dec"),
        artifactType: "execution-decision",
        timestamp: now(),
        actor: "execution-gate",
        warrantId,
        envelopeId,
        decision: haltActive ? "halt" : witnessAccepted ? "allow" : "deny",
        reasons: haltActive
            ? ["Kill switch active for this scope"]
            : witnessRequired
                ? witnessAccepted
                    ? ["Witness obligation satisfied"]
                    : ["Witness obligation unsatisfied"]
                : ["Witness obligation not required"],
        killSwitchState: haltActive ? "active" : "inactive",
        witnessStatus,
        verification: { status: haltActive ? "failed" : "verified", verifier: "execution-gate" }
    };
    decisions.set(decision.id, decision);
    res.json(decision);
});
app.listen(port, () => console.log(`execution-gate on ${port}`));
