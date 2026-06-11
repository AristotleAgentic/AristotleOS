import { createApp, id, now } from "./lib.js";
import { evaluateCommitGate } from "@aristotle/execution-control-runtime";
const port = Number(process.env.PORT_EXECUTION_GATE ?? 7008);
const app = createApp();
let killSwitchState = process.env.KILL_SWITCH_DEFAULT ?? "inactive";
const decisions = new Map();
const killEvents = [];
// ---------------------------------------------------------------------------
// Kill switch + scope semantics — unchanged from prior implementation.
// ---------------------------------------------------------------------------
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
/** Build a permissive default Ward when the caller didn't supply one.
 *  Uses domain as the ward_id so authorized actions for the domain are
 *  bound to the right Ward. permitted_subjects defaults to the supplied
 *  agentId / deviceId / "agent.unknown". */
function defaultWard(domain, subject) {
    return {
        ward_id: domain ?? "ward.default",
        name: domain ?? "Default Ward",
        sovereignty_context: "execution-gate.runtime",
        authority_domain: domain ?? "default",
        policy_version: "1.0.0",
        permitted_subjects: [subject]
    };
}
/** Build a permissive default AuthorityEnvelope when the caller didn't
 *  supply one. The envelope is scoped to the Ward built above and
 *  permits a single specific action_type. */
function defaultEnvelope(envelopeId, ward, subject, action_type) {
    return {
        envelope_id: envelopeId,
        ward_id: ward.ward_id,
        subject,
        allowed_actions: [action_type],
        denied_actions: [],
        constraints: {},
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        issuer: "execution-gate.bridge"
    };
}
/** Synthesize a CanonicalActionInput when the caller didn't supply one. */
function defaultAction(opts) {
    // CanonicalActionInput.params is JsonValue — drop undefined keys
    // rather than pass them through (JsonValue is null | string | number | boolean | array | object).
    const params = {};
    if (opts.missionId !== undefined)
        params.mission_id = opts.missionId;
    if (opts.targetType !== undefined)
        params.target_type = opts.targetType;
    return {
        action_id: opts.targetId ?? id("act"),
        ward_id: opts.wardId,
        subject: opts.subject,
        action_type: opts.action_type ?? (opts.targetType === "tool-action" ? "tool.execute" : opts.targetType === "mission" ? "mission.advance" : "task.execute"),
        target: opts.targetNode ?? "execution-gate",
        params,
        requested_at: now(),
        request_id: opts.targetId
    };
}
/** Map the substrate's CommitGateDecision to the shared-types
 *  ExecutionDecision shape the UI / http-gateway expect. Operator-side
 *  overlays (witness obligation, identity, telemetry) layer ON TOP of
 *  the substrate decision via `forceDeny` + `extraReasons` — the
 *  substrate's reason_codes are a closed taxonomy, so overlay reasons
 *  are surfaced verbatim alongside (not mutated into) it. */
function mapSubstrateDecisionToWire(cgd, base) {
    const effectiveAllow = cgd.decision === "ALLOW" && !base.forceDeny;
    const substrateDecision = base.haltActive ? "halt" : effectiveAllow ? "allow" : "deny";
    const reasons = [];
    if (base.haltActive)
        reasons.push("Kill switch active for this scope");
    for (const code of cgd.reason_codes) {
        reasons.push(`commit_gate:${code}`);
    }
    if (base.extraReasons)
        reasons.push(...base.extraReasons);
    if (reasons.length === 0 && substrateDecision === "allow") {
        reasons.push(`Commit gate ALLOW (${cgd.canonical_action_hash.slice(0, 12)}…)`);
    }
    return {
        id: id("dec"),
        artifactType: "execution-decision",
        timestamp: now(),
        actor: "execution-gate",
        warrantId: base.warrantId,
        envelopeId: base.envelopeId,
        phase: base.phase,
        targetType: base.targetType,
        targetId: base.targetId,
        decision: substrateDecision,
        reasons,
        killSwitchState: base.haltActive ? "active" : "inactive",
        witnessStatus: base.witnessStatus,
        verification: {
            status: base.haltActive || !effectiveAllow ? "failed" : "verified",
            verifier: "execution-gate+commit-gate",
            reason: `commit_gate decision=${cgd.decision} reason_codes=${cgd.reason_codes.join(",")} operator_overlay_deny=${Boolean(base.forceDeny)}`
        }
    };
}
// ---------------------------------------------------------------------------
// HTTP surface — same routes, real substrate behind them.
// ---------------------------------------------------------------------------
app.get("/health", (_req, res) => res.json({
    ok: true,
    service: "execution-gate",
    killSwitchState,
    activeKillScopes: activeKillScopes(),
    substrate_wired: true
}));
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
    const { warrantId, envelopeId, witnessAccepted = true, witnessRequired = false, identityLegitimate = true, authorityApproved = true, telemetrySatisfied = true, phase, targetType, targetId, telemetryReasons = [], missionId, domain, targetNode, agentId, deviceId, substrate } = req.body;
    const haltActive = appliesKillSwitch({ missionId, domain, targetNode, agentId, deviceId });
    const witnessStatus = witnessRequired ? (witnessAccepted ? "satisfied" : "unsatisfied") : "not-required";
    const subject = agentId ?? deviceId ?? "agent.unknown";
    const ward = substrate?.ward ?? defaultWard(domain, subject);
    const action = substrate?.action ?? defaultAction({ targetId, missionId, targetType, subject, wardId: ward.ward_id, targetNode });
    const envelope = substrate?.authorityEnvelope ?? defaultEnvelope(envelopeId, ward, subject, action.action_type);
    const cgd = evaluateCommitGate({ ward, authorityEnvelope: envelope, action, now: now() });
    // Operator-side overlays the commit gate's verdict — host gates
    // (witness obligation, identity, telemetry) layer on top.
    const overlayReasons = [];
    if (!identityLegitimate)
        overlayReasons.push("Identity legitimacy failed at commit point.");
    if (!authorityApproved)
        overlayReasons.push("Authority invariants failed at commit point.");
    if (!telemetrySatisfied)
        overlayReasons.push(...(telemetryReasons.length > 0 ? telemetryReasons : ["Telemetry manifold rejected action."]));
    if (witnessRequired && !witnessAccepted)
        overlayReasons.push("Witness obligation unsatisfied");
    const overlayDeny = overlayReasons.length > 0;
    // The substrate's reason_codes are a closed taxonomy. Operator-overlay
    // reasons stay on the wire (extraReasons) without mutating the CGD.
    const decision = mapSubstrateDecisionToWire(cgd, {
        warrantId,
        envelopeId,
        phase,
        targetType,
        targetId,
        witnessStatus,
        haltActive,
        extraReasons: overlayReasons,
        forceDeny: overlayDeny
    });
    decisions.set(decision.id, decision);
    res.json(decision);
});
app.post("/decide", (req, res) => {
    const { warrantId, envelopeId, witnessAccepted, witnessRequired = true, missionId, domain, targetNode, agentId, deviceId, substrate } = req.body;
    const haltActive = appliesKillSwitch({ missionId, domain, targetNode, agentId, deviceId });
    const witnessStatus = witnessRequired ? (witnessAccepted ? "satisfied" : "unsatisfied") : "not-required";
    const subject = agentId ?? deviceId ?? "agent.unknown";
    const ward = substrate?.ward ?? defaultWard(domain, subject);
    const action = substrate?.action ?? defaultAction({ subject, wardId: ward.ward_id, targetNode, missionId });
    const envelope = substrate?.authorityEnvelope ?? defaultEnvelope(envelopeId, ward, subject, action.action_type);
    const cgd = evaluateCommitGate({ ward, authorityEnvelope: envelope, action, now: now() });
    const witnessOverlayDeny = witnessRequired && !witnessAccepted;
    const decision = mapSubstrateDecisionToWire(cgd, {
        warrantId,
        envelopeId,
        witnessStatus,
        haltActive,
        forceDeny: witnessOverlayDeny,
        extraReasons: witnessOverlayDeny
            ? ["Witness obligation unsatisfied"]
            : witnessRequired
                ? ["Witness obligation satisfied"]
                : []
    });
    decisions.set(decision.id, decision);
    res.json(decision);
});
app.listen(port, () => console.log(`execution-gate on ${port} (substrate-wired: evaluateCommitGate)`));
