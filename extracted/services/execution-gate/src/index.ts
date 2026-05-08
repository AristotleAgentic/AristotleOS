import { createApp, id, now } from "./lib.js";
import type { ExecutionDecision } from "@aristotle/shared-types";

const port = Number(process.env.PORT_EXECUTION_GATE ?? 7008);
const app = createApp();
let killSwitchState: "active" | "inactive" = (process.env.KILL_SWITCH_DEFAULT as "active" | "inactive") ?? "inactive";
const decisions = new Map<string, ExecutionDecision>();
const killEvents: Array<{
  state: "active" | "inactive";
  scope: "global" | "mission" | "domain" | "agent" | "device";
  scopeRef?: string;
}> = [];

const activeKillScopes = () => {
  const latestByScope = new Map<
    string,
    { state: "active" | "inactive"; scope: "global" | "mission" | "domain" | "agent" | "device"; scopeRef?: string }
  >();
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
      return Boolean(event.scopeRef && (event.scopeRef === context?.domain || event.scopeRef === context?.targetNode));
    }
    if (event.scope === "agent") return Boolean(context?.agentId && event.scopeRef === context.agentId);
    if (event.scope === "device") return Boolean(context?.deviceId && event.scopeRef === context.deviceId);
    return false;
  });
};

app.get("/health", (_req, res) =>
  res.json({ ok: true, service: "execution-gate", killSwitchState, activeKillScopes: activeKillScopes() })
);
app.get("/decisions", (_req, res) => res.json({ items: [...decisions.values()] }));
app.post("/kill-switch", (req, res) => {
  const scope =
    req.body.scope === "mission" ||
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
  const {
    warrantId,
    envelopeId,
    witnessAccepted = true,
    witnessRequired = false,
    identityLegitimate = true,
    authorityApproved = true,
    telemetrySatisfied = true,
    phase,
    targetType,
    targetId,
    telemetryReasons = [],
    missionId,
    domain,
    targetNode,
    agentId,
    deviceId
  } = req.body as {
    warrantId: string;
    envelopeId: string;
    witnessAccepted?: boolean;
    witnessRequired?: boolean;
    identityLegitimate?: boolean;
    authorityApproved?: boolean;
    telemetrySatisfied?: boolean;
    phase?: "dispatch" | "tool-action" | "completion";
    targetType?: "task" | "tool-action" | "mission";
    targetId?: string;
    telemetryReasons?: string[];
    missionId?: string;
    domain?: string;
    targetNode?: string;
    agentId?: string;
    deviceId?: string;
  };

  const haltActive = appliesKillSwitch({ missionId, domain, targetNode, agentId, deviceId });
  const witnessStatus = witnessRequired ? (witnessAccepted ? "satisfied" : "unsatisfied") : "not-required";
  const reasons: string[] = [];
  if (haltActive) reasons.push("Kill switch active for this scope");
  if (!identityLegitimate) reasons.push("Identity legitimacy failed at commit point.");
  if (!authorityApproved) reasons.push("Authority invariants failed at commit point.");
  if (!telemetrySatisfied) reasons.push(...(telemetryReasons.length > 0 ? telemetryReasons : ["Telemetry manifold rejected action."]));
  if (witnessRequired && !witnessAccepted) reasons.push("Witness obligation unsatisfied");

  const decision: ExecutionDecision = {
    id: id("dec"),
    artifactType: "execution-decision",
    timestamp: now(),
    actor: "execution-gate",
    warrantId,
    envelopeId,
    phase,
    targetType,
    targetId,
    decision:
      haltActive
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
  const { warrantId, envelopeId, witnessAccepted, witnessRequired = true, missionId, domain, targetNode, agentId, deviceId } = req.body as {
    warrantId: string;
    envelopeId: string;
    witnessAccepted: boolean;
    witnessRequired?: boolean;
    missionId?: string;
    domain?: string;
    targetNode?: string;
    agentId?: string;
    deviceId?: string;
  };
  const haltActive = appliesKillSwitch({ missionId, domain, targetNode, agentId, deviceId });
  const witnessStatus = witnessRequired ? (witnessAccepted ? "satisfied" : "unsatisfied") : "not-required";
  const decision: ExecutionDecision = {
    id: id("dec"),
    artifactType: "execution-decision",
    timestamp: now(),
    actor: "execution-gate",
    warrantId,
    envelopeId,
    decision: haltActive ? "halt" : witnessAccepted ? "allow" : "deny",
    reasons:
      haltActive
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
