import { createHmac, timingSafeEqual, randomBytes, randomUUID } from "node:crypto";
import { createApp } from "./lib.js";
import { runGatewayPreflight } from "./preflight.js";
import { createGovernanceChainProxy } from "./governance-chain-proxy.js";
import { PAYMENTS_GOVERNANCE_SOURCE, TRIAL_SCENARIOS, evaluateTrialAction, parseGovernanceSource, planGovernanceChange, validateGovernanceSource } from "@aristotle/trial-engine";
const port = Number(process.env.PORT_GATEWAY ?? 8080);
const app = createApp();
const serviceDiscoveryMode = process.env.SERVICE_DISCOVERY_MODE ?? "container";
const operatorApiKey = process.env.OPERATOR_API_KEY?.trim();
const operatorSessionSecret = process.env.OPERATOR_SESSION_SECRET?.trim();
const operatorSessionEnforcement = process.env.OPERATOR_SESSION_ENFORCEMENT === "1" ||
    process.env.OPERATOR_SESSION_ENFORCEMENT === "true" ||
    process.env.OPERATOR_SESSION_ENFORCEMENT === "TRUE";
const operatorSessionTtlMs = Number(process.env.OPERATOR_SESSION_TTL_MS ?? 15 * 60 * 1000);
const operatorSessionSkewMs = Number(process.env.OPERATOR_SESSION_SKEW_MS ?? 60 * 1000);
const operatorRoleEnforcement = process.env.OPERATOR_ROLE_ENFORCEMENT === "1" ||
    process.env.OPERATOR_ROLE_ENFORCEMENT === "true" ||
    process.env.OPERATOR_ROLE_ENFORCEMENT === "TRUE";
const operatorDefaultRole = process.env.OPERATOR_DEFAULT_ROLE?.trim() || "operator";
const operatorReadRoles = new Set((process.env.OPERATOR_READ_ROLES ?? "viewer,operator,admin")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean));
const operatorMutationRoles = new Set((process.env.OPERATOR_MUTATION_ROLES ?? "operator,admin")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean));
const operatorReadActors = new Set((process.env.OPERATOR_READ_ACTORS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean));
const operatorMutationActors = new Set((process.env.OPERATOR_MUTATION_ACTORS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean));
const preflight = runGatewayPreflight();
if (!preflight.ok) {
    const failed = preflight.checks.filter((check) => check.status === "fail").map((check) => `${check.name}: ${check.detail}`);
    throw new Error(`Gateway preflight failed. ${failed.join(" | ")}`);
}
const serviceBase = (serviceName, hostEnvKey, portValue) => {
    const configuredHost = process.env[hostEnvKey]?.trim();
    const host = configuredHost ||
        (serviceDiscoveryMode === "local" ? "127.0.0.1" : serviceName);
    return `${host}:${portValue}`;
};
const governanceKernelBase = serviceBase("governance-kernel", "HOST_GOVERNANCE_KERNEL", Number(process.env.PORT_GOVERNANCE_KERNEL ?? 7001));
const policyCompilerBase = serviceBase("policy-compiler", "HOST_POLICY_COMPILER", Number(process.env.PORT_POLICY_COMPILER ?? 7002));
const evidenceLedgerBase = serviceBase("evidence-ledger", "HOST_EVIDENCE_LEDGER", Number(process.env.PORT_EVIDENCE_LEDGER ?? 7003));
const metaAuthorityRegistryBase = serviceBase("meta-authority-registry", "HOST_META_AUTHORITY_REGISTRY", Number(process.env.PORT_META_AUTHORITY_REGISTRY ?? 7004));
const simulationEngineBase = serviceBase("simulation-engine", "HOST_SIMULATION_ENGINE", Number(process.env.PORT_SIMULATION_ENGINE ?? 7005));
const authorityRouterBase = serviceBase("authority-router", "HOST_AUTHORITY_ROUTER", Number(process.env.PORT_AUTHORITY_ROUTER ?? 7006));
const witnessServiceBase = serviceBase("witness-service", "HOST_WITNESS_SERVICE", Number(process.env.PORT_WITNESS_SERVICE ?? 7007));
const executionGateBase = serviceBase("execution-gate", "HOST_EXECUTION_GATE", Number(process.env.PORT_EXECUTION_GATE ?? 7008));
const agentOsBase = serviceBase("agent-os", "HOST_AGENT_OS", Number(process.env.PORT_AGENT_OS ?? 7009));
const chainV2Enabled = (process.env.GOVERNANCE_CHAIN_V2 ?? "false").toLowerCase() === "true";
const readinessTimeoutMs = Number(process.env.GATEWAY_READINESS_TIMEOUT_MS ?? 2000);
const otelTracesExporter = (process.env.OTEL_TRACES_EXPORTER ?? "").toLowerCase();
const otelExporterEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(/\/+$/, "");
const otelServiceName = process.env.OTEL_SERVICE_NAME?.trim() || "aristotle-http-gateway";
const otelResourceAttributes = process.env.OTEL_RESOURCE_ATTRIBUTES?.trim() || "";
const readinessCriticalServices = new Set((process.env.GATEWAY_CRITICAL_SERVICES ?? "governance-kernel,policy-compiler,evidence-ledger,meta-authority-registry,simulation-engine,witness-service,execution-gate,agent-os")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean));
const observedServices = [
    { name: "governance-kernel", base: governanceKernelBase, path: "/health" },
    { name: "policy-compiler", base: policyCompilerBase, path: "/health" },
    { name: "evidence-ledger", base: evidenceLedgerBase, path: "/health" },
    { name: "meta-authority-registry", base: metaAuthorityRegistryBase, path: "/health" },
    { name: "simulation-engine", base: simulationEngineBase, path: "/health" },
    { name: "witness-service", base: witnessServiceBase, path: "/health" },
    { name: "execution-gate", base: executionGateBase, path: "/health" },
    { name: "agent-os", base: agentOsBase, path: "/health" }
];
console.log("http-gateway upstream bases", {
    governanceKernelBase,
    policyCompilerBase,
    evidenceLedgerBase,
    metaAuthorityRegistryBase,
    simulationEngineBase,
    authorityRouterBase,
    witnessServiceBase,
    executionGateBase,
    agentOsBase
});
const call = async (base, path, init) => {
    let res;
    try {
        res = await fetch(`http://${base}${path}`, init);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`upstream_fetch_failed ${base}${path}: ${message}`);
    }
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Upstream ${base}${path} failed with ${res.status}${body ? `: ${body}` : ""}`);
    }
    return res.json();
};
const roundMs = (value) => Math.round(value * 1000) / 1000;
const probeService = async (service, timeoutMs = readinessTimeoutMs) => {
    const startedAt = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(`http://${service.base}${service.path}`, { signal: controller.signal });
        const text = await response.text().catch(() => "");
        let json = null;
        try {
            json = text ? JSON.parse(text) : null;
        }
        catch {
            json = null;
        }
        return {
            name: service.name,
            base: service.base,
            critical: readinessCriticalServices.has(service.name),
            ok: response.ok && json?.ok === true,
            status: response.status,
            latencyMs: roundMs(performance.now() - startedAt),
            service: typeof json?.service === "string" ? json.service : undefined,
            killSwitchState: typeof json?.killSwitchState === "string" ? json.killSwitchState : undefined,
            activeKillScopes: Array.isArray(json?.activeKillScopes) ? json.activeKillScopes : undefined
        };
    }
    catch (error) {
        return {
            name: service.name,
            base: service.base,
            critical: readinessCriticalServices.has(service.name),
            ok: false,
            latencyMs: roundMs(performance.now() - startedAt),
            error: error instanceof Error ? error.message : String(error)
        };
    }
    finally {
        clearTimeout(timeout);
    }
};
const evaluateReadiness = async () => {
    const services = await Promise.all(observedServices.map((service) => probeService(service)));
    const failedCritical = services.filter((service) => service.critical && !service.ok);
    const activeGovernanceHalt = services.some((service) => (service.name === "governance-kernel" || service.name === "execution-gate") && service.killSwitchState === "active");
    const ok = preflight.ok && failedCritical.length === 0;
    return {
        ok,
        generatedAt: new Date().toISOString(),
        mode: preflight.mode,
        failClosed: !ok,
        activeGovernanceHalt,
        timeoutMs: readinessTimeoutMs,
        criticalServices: [...readinessCriticalServices],
        failedCritical: failedCritical.map((service) => service.name),
        preflight,
        services
    };
};
const prometheusEscape = (value) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
const renderGatewayMetrics = (readiness) => {
    const lines = [
        "# HELP aristotle_gateway_ready Gateway readiness posture; 1 means all critical upstreams and preflight checks pass.",
        "# TYPE aristotle_gateway_ready gauge",
        `aristotle_gateway_ready ${readiness.ok ? 1 : 0}`,
        "# HELP aristotle_gateway_fail_closed Gateway fail-closed posture; 1 means the gateway must refuse readiness.",
        "# TYPE aristotle_gateway_fail_closed gauge",
        `aristotle_gateway_fail_closed ${readiness.failClosed ? 1 : 0}`,
        "# HELP aristotle_gateway_preflight_ok Gateway enterprise preflight posture.",
        "# TYPE aristotle_gateway_preflight_ok gauge",
        `aristotle_gateway_preflight_ok{mode="${prometheusEscape(readiness.mode)}"} ${readiness.preflight.ok ? 1 : 0}`,
        "# HELP aristotle_upstream_ready Upstream readiness by service.",
        "# TYPE aristotle_upstream_ready gauge",
    ];
    for (const service of readiness.services) {
        lines.push(`aristotle_upstream_ready{service="${prometheusEscape(service.name)}",critical="${service.critical ? "true" : "false"}"} ${service.ok ? 1 : 0}`);
    }
    lines.push("# HELP aristotle_upstream_latency_ms Upstream readiness probe latency in milliseconds.");
    lines.push("# TYPE aristotle_upstream_latency_ms gauge");
    for (const service of readiness.services) {
        lines.push(`aristotle_upstream_latency_ms{service="${prometheusEscape(service.name)}"} ${service.latencyMs}`);
    }
    lines.push("# HELP aristotle_governance_halt_active Active governance halt observed at the kernel or execution gate.");
    lines.push("# TYPE aristotle_governance_halt_active gauge");
    lines.push(`aristotle_governance_halt_active ${readiness.activeGovernanceHalt ? 1 : 0}`);
    return `${lines.join("\n")}\n`;
};
const randomHex = (bytes) => randomBytes(bytes).toString("hex");
const hrTimeUnixNano = () => String(BigInt(Date.now()) * 1000000n);
const parseOtelResourceAttributes = () => Object.fromEntries(otelResourceAttributes
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
    const [key, ...rest] = entry.split("=");
    return [key, rest.join("=")];
})
    .filter(([key]) => Boolean(key)));
const emitOtelSpan = (span) => {
    if (otelTracesExporter !== "otlp" || !otelExporterEndpoint)
        return;
    const resourceAttributes = {
        "service.name": otelServiceName,
        "service.namespace": "aristotle-governance-os",
        ...parseOtelResourceAttributes()
    };
    const body = {
        resourceSpans: [
            {
                resource: {
                    attributes: Object.entries(resourceAttributes).map(([key, value]) => ({
                        key,
                        value: { stringValue: String(value) }
                    }))
                },
                scopeSpans: [
                    {
                        scope: { name: "aristotle.http-gateway", version: "0.1.0" },
                        spans: [
                            {
                                traceId: span.traceId,
                                spanId: span.spanId,
                                name: span.name,
                                kind: 2,
                                startTimeUnixNano: span.startTimeUnixNano,
                                endTimeUnixNano: span.endTimeUnixNano,
                                attributes: Object.entries(span.attributes).map(([key, value]) => ({
                                    key,
                                    value: typeof value === "boolean"
                                        ? { boolValue: value }
                                        : typeof value === "number"
                                            ? { doubleValue: value }
                                            : { stringValue: value }
                                })),
                                status: { code: span.statusCode >= 500 ? 2 : 1 }
                            }
                        ]
                    }
                ]
            }
        ]
    };
    void fetch(`${otelExporterEndpoint}/v1/traces`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
    }).catch(() => undefined);
};
const encodeSessionPayload = (claims) => Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
const signSessionPayload = (payload) => {
    if (!operatorSessionSecret) {
        throw new Error("Operator session secret is not configured.");
    }
    return createHmac("sha256", operatorSessionSecret).update(payload).digest("base64url");
};
const createOperatorSessionToken = (claims) => {
    const payload = encodeSessionPayload(claims);
    const signature = signSessionPayload(payload);
    return `ost.${payload}.${signature}`;
};
const parseOperatorSessionToken = (token) => {
    if (!operatorSessionSecret || !token.startsWith("ost.")) {
        return null;
    }
    const [, payload, signature] = token.split(".");
    if (!payload || !signature) {
        return null;
    }
    const expected = Buffer.from(signSessionPayload(payload), "utf8");
    const actual = Buffer.from(signature, "utf8");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
        return null;
    }
    try {
        const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        return claims;
    }
    catch {
        return null;
    }
};
const handleAsync = (handler) => (req, res) => {
    void handler(req, res).catch((error) => {
        const message = error instanceof Error ? error.message : "unknown_gateway_error";
        if (!res.headersSent) {
            res.status(502).json({ error: "upstream_failure", message });
        }
    });
};
const readOperatorCredential = (req) => {
    const keyHeader = req.header("x-operator-key")?.trim();
    if (keyHeader)
        return keyHeader;
    const authorization = req.header("authorization")?.trim();
    if (authorization?.toLowerCase().startsWith("bearer ")) {
        return authorization.slice(7).trim();
    }
    return undefined;
};
const readOperatorSession = (req) => {
    const authorization = req.header("authorization")?.trim();
    if (!authorization?.toLowerCase().startsWith("bearer ")) {
        return undefined;
    }
    const token = authorization.slice(7).trim();
    return token.startsWith("ost.") ? token : undefined;
};
const readOperatorActor = (req, fallback = "http-gateway") => {
    const actorHeader = req.header("x-operator-actor")?.trim();
    if (actorHeader)
        return actorHeader;
    const bodyActor = typeof req.body?.actor === "string" ? req.body.actor.trim() : "";
    return bodyActor || fallback;
};
const readOperatorRole = (req) => req.header("x-operator-role")?.trim() || operatorDefaultRole;
const isReadMethod = (method) => method === "GET" || method === "HEAD";
const validateSessionClaims = (claims, req) => {
    const issuedAt = Date.parse(claims.issuedAt);
    const expiresAt = Date.parse(claims.expiresAt);
    const now = Date.now();
    if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) {
        return { ok: false, error: "operator_session_invalid", message: "Operator session timestamps are invalid." };
    }
    if (issuedAt - operatorSessionSkewMs > now) {
        return { ok: false, error: "operator_session_not_yet_valid", message: "Operator session is not yet valid." };
    }
    if (expiresAt + operatorSessionSkewMs < now) {
        return { ok: false, error: "operator_session_expired", message: "Operator session has expired." };
    }
    const actor = readOperatorActor(req).trim();
    if (actor && actor !== claims.actor) {
        return { ok: false, error: "operator_session_actor_mismatch", message: "Operator actor does not match session claims." };
    }
    const role = readOperatorRole(req);
    if (role && role !== claims.role) {
        return { ok: false, error: "operator_session_role_mismatch", message: "Operator role does not match session claims." };
    }
    return { ok: true };
};
const deriveAssurancePosture = (mission) => {
    if (mission.status === "halted" || mission.activeKillSwitch)
        return "halted";
    if (mission.blockedTasks > 0)
        return "blocked";
    if (mission.agentVerified &&
        mission.deviceVerified &&
        mission.finalityCertificates > 0 &&
        mission.autonomyAttestations > 0) {
        return "insurable";
    }
    return "conditional";
};
const deriveAssuranceReasons = (mission) => {
    const reasons = [];
    if (mission.status === "halted") {
        reasons.push("Mission status is halted by sovereign governance.");
    }
    if (mission.activeKillSwitch) {
        const scopedControls = mission.activeKillScopes
            ?.map((scope) => `${scope.scope ?? "global"}${scope.scopeRef ? `:${scope.scopeRef}` : ""}`)
            .filter(Boolean)
            .join(", ") ?? "";
        reasons.push(scopedControls
            ? `Active sovereign halt scopes: ${scopedControls}.`
            : "An active sovereign halt scope applies to this mission or its governed domain.");
    }
    if (mission.blockedTasks > 0) {
        reasons.push(`Governance has blocked ${mission.blockedTasks} task${mission.blockedTasks === 1 ? "" : "s"}.`);
    }
    if (!mission.agentVerified) {
        reasons.push("Agent identity attestation is missing or unverified.");
    }
    if (!mission.deviceVerified) {
        reasons.push("Device identity attestation is missing or unverified.");
    }
    if (mission.finalityCertificates < 1) {
        reasons.push("No finality certificate has been committed for this mission yet.");
    }
    if (mission.autonomyAttestations < 1) {
        reasons.push("No autonomy attestation has been committed for this mission yet.");
    }
    if (!reasons.length) {
        reasons.push("Authority, identity, autonomy, and finality evidence satisfy the current assurance threshold.");
    }
    return reasons;
};
const getAssuranceReport = async () => {
    const [health, osState, artifacts] = await Promise.all([
        call(`127.0.0.1:${port}`, "/health"),
        call(agentOsBase, "/state"),
        call(evidenceLedgerBase, "/artifacts")
    ]);
    const activeKillScopes = (health.services ?? []).flatMap((service) => service.status === "fulfilled" && Array.isArray(service.value?.activeKillScopes) ? service.value.activeKillScopes : []);
    const missions = (osState.missions ?? []).map((mission) => {
        const missionTasks = (osState.executionTasks ?? []).filter((task) => task.missionId === mission.id);
        const missionArtifacts = (artifacts.items ?? []).filter((artifact) => artifact.missionId === mission.id);
        const missionActiveKillScopes = activeKillScopes.filter((scope) => scope.scope === "global" ||
            (scope.scope === "mission" && scope.scopeRef === mission.id) ||
            (scope.scope === "domain" && scope.scopeRef === mission.targetSystem) ||
            (scope.scope === "agent" &&
                missionTasks.some((task) => task.assignedAgentId === scope.scopeRef)) ||
            (scope.scope === "device" &&
                (osState.workspaces ?? []).some((workspace) => workspace.missionId === mission.id && workspace.id === scope.scopeRef)));
        const activeKillSwitch = missionActiveKillScopes.length > 0;
        const blockedTasks = missionTasks.filter((task) => task.status === "blocked" || task.status === "cancelled").length;
        const autonomyAttestations = missionArtifacts.filter((artifact) => artifact.artifactType === "autonomy-attestation").length;
        const finalityCertificates = missionArtifacts.filter((artifact) => artifact.artifactType === "finality-certificate").length;
        const agentVerified = missionArtifacts.some((artifact) => artifact.artifactType === "identity-attestation" &&
            artifact.subjectType === "agent" &&
            artifact.verification?.status !== "failed");
        const deviceVerified = missionArtifacts.some((artifact) => artifact.artifactType === "identity-attestation" &&
            artifact.subjectType === "device" &&
            artifact.verification?.status !== "failed");
        const assurancePosture = deriveAssurancePosture({
            status: mission.status,
            blockedTasks,
            autonomyAttestations,
            finalityCertificates,
            agentVerified,
            deviceVerified,
            activeKillSwitch
        });
        const reasons = deriveAssuranceReasons({
            status: mission.status,
            blockedTasks,
            autonomyAttestations,
            finalityCertificates,
            agentVerified,
            deviceVerified,
            activeKillSwitch,
            activeKillScopes: missionActiveKillScopes
        });
        return {
            missionId: mission.id,
            title: mission.title,
            status: mission.status,
            targetSystem: mission.targetSystem,
            blockedTasks,
            autonomyAttestations,
            finalityCertificates,
            agentVerified,
            deviceVerified,
            activeKillSwitch,
            activeKillScopes: missionActiveKillScopes,
            assurancePosture,
            reasons
        };
    });
    const systemPosture = missions.some((mission) => mission.assurancePosture === "halted")
        ? "halted"
        : missions.every((mission) => mission.assurancePosture === "insurable")
            ? "insurable"
            : "conditional";
    const systemReasons = [
        systemPosture === "halted" ? "At least one mission is under sovereign halt." : null,
        missions.some((mission) => mission.assurancePosture === "blocked")
            ? "At least one mission contains governance-blocked work."
            : null,
        missions.some((mission) => mission.assurancePosture === "conditional")
            ? "At least one mission is missing identity, autonomy, or finality evidence."
            : null,
        systemPosture === "insurable" && missions.length > 0
            ? "All active missions satisfy the current assurance threshold."
            : null
    ].filter((reason) => Boolean(reason));
    return {
        generatedAt: new Date().toISOString(),
        systemPosture,
        systemReasons,
        missions
    };
};
const getDeploymentPosture = () => ({
    generatedAt: new Date().toISOString(),
    mode: preflight.mode,
    operatorAuthEnabled: Boolean(operatorApiKey),
    operatorSessionEnabled: Boolean(operatorSessionSecret),
    operatorSessionEnforced: operatorSessionEnforcement,
    operatorSessionTtlMs,
    roleEnforcementEnabled: operatorRoleEnforcement,
    defaultRole: operatorDefaultRole,
    readRoles: [...operatorReadRoles],
    mutationRoles: [...operatorMutationRoles],
    readActors: [...operatorReadActors],
    mutationActors: [...operatorMutationActors],
    serviceDiscoveryMode,
    serviceBases: {
        governanceKernelBase,
        policyCompilerBase,
        evidenceLedgerBase,
        metaAuthorityRegistryBase,
        simulationEngineBase,
        authorityRouterBase,
        witnessServiceBase,
        executionGateBase,
        agentOsBase
    },
    durableStateConfigured: Boolean(process.env.EVIDENCE_LEDGER_STATE_PATH?.trim()) && Boolean(process.env.AGENT_OS_STATE_PATH?.trim()),
    insecureProductionOverride: process.env.ALLOW_INSECURE_PRODUCTION_BOOT === "1" ||
        process.env.ALLOW_INSECURE_PRODUCTION_BOOT === "true" ||
        process.env.ALLOW_INSECURE_PRODUCTION_BOOT === "TRUE",
    preflight
});
const deployableProfiles = [
    {
        id: "agents",
        label: "Agents",
        preferredTarget: "workspace",
        authorityLane: "mission.command",
        actuationBoundary: "governed tool adapters, repos, and workspaces",
        objective: "Coordinate enterprise AI agents under pre-execution governance.",
        assuranceFocus: "identity, tool leases, and admissible execution continuity"
    },
    {
        id: "vehicles",
        label: "Ground Vehicles",
        preferredTarget: "safety",
        authorityLane: "mission.command + safety.council",
        actuationBoundary: "routing, safety intervention, and vehicle autonomy commands",
        objective: "Govern autonomous driving and fleet movement before actuation.",
        assuranceFocus: "route continuity, sovereign halt, and safety-domain admissibility"
    },
    {
        id: "drones",
        label: "Aerial Drones",
        preferredTarget: "safety",
        authorityLane: "mission.command + safety.council",
        actuationBoundary: "flight-path, payload, and airspace execution controls",
        objective: "Keep drone flight and mission execution inside the sovereign boundary.",
        assuranceFocus: "airspace halt scope, degraded relay continuity, and witness posture"
    },
    {
        id: "infrastructure",
        label: "Infrastructure",
        preferredTarget: "workspace",
        authorityLane: "mission.command",
        actuationBoundary: "cloud, data center, and infrastructure control paths",
        objective: "Govern infrastructure changes with immutable evidence and rollback memory.",
        assuranceFocus: "deployment posture, device verification, and recovery continuity"
    },
    {
        id: "robotics",
        label: "Robotics",
        preferredTarget: "safety",
        authorityLane: "mission.command + safety.council",
        actuationBoundary: "motion, manipulator, and robotic process execution",
        objective: "Control robotic actuation with pre-execution authority and scoped halt.",
        assuranceFocus: "device halt, actuator continuity, and finality traceability"
    },
    {
        id: "industrial",
        label: "Industrial Systems",
        preferredTarget: "safety",
        authorityLane: "mission.command + safety.council",
        actuationBoundary: "plant, energy, and industrial control surfaces",
        objective: "Protect industrial automation with sovereign interruption and replayable memory.",
        assuranceFocus: "domain halt, delegated continuity, and insurable evidence"
    },
    {
        id: "cyber",
        label: "Cyber Operations",
        preferredTarget: "ledger",
        authorityLane: "mission.command + evidence.steward",
        actuationBoundary: "defensive automation, containment, and evidence operations",
        objective: "Run cyber response and evidence preservation under constitutional governance.",
        assuranceFocus: "evidence continuity, delegated authority, and assurance attestation"
    },
    {
        id: "maritime",
        label: "Maritime Systems",
        preferredTarget: "safety",
        authorityLane: "mission.command + safety.council",
        actuationBoundary: "navigation, collision avoidance, and vessel mission commands",
        objective: "Govern autonomous vessels and maritime corridors before execution.",
        assuranceFocus: "continuity under degraded relays and mission/domain sovereign halt"
    },
    {
        id: "assurance",
        label: "Assurance",
        preferredTarget: "ledger",
        authorityLane: "mission.command + evidence.steward",
        actuationBoundary: "attestation, replay, and insurability reporting",
        objective: "Audit the governance operating system itself with immutable institutional memory.",
        assuranceFocus: "assurance attestations, finality, and replayable counterfactuals"
    }
];
let trialPolicySource = PAYMENTS_GOVERNANCE_SOURCE;
const trialGelRecords = [];
const trialApprovals = new Map();
const appendTrialRecord = (evaluation) => {
    trialGelRecords.unshift(evaluation.gelRecord);
    if (trialGelRecords.length > 100)
        trialGelRecords.pop();
};
const evaluateTrialRequest = (body, approval) => {
    const scenarioId = typeof body.scenarioId === "string" ? body.scenarioId : undefined;
    const scenario = scenarioId ? TRIAL_SCENARIOS.find((item) => item.id === scenarioId) : undefined;
    const intent = (body.intent && typeof body.intent === "object" ? body.intent : scenario?.intent ?? TRIAL_SCENARIOS[0]?.intent);
    const source = typeof body.policy === "string" ? body.policy : trialPolicySource;
    const evaluation = evaluateTrialAction({
        source,
        intent,
        approval,
        previousHash: trialGelRecords[0]?.currentHash
    });
    appendTrialRecord(evaluation);
    if (evaluation.deferToken) {
        trialApprovals.set(evaluation.deferToken, { intent, source, evaluation });
    }
    return { scenario: scenario ?? null, intent, evaluation };
};
app.use((req, res, next) => {
    const traceId = randomHex(16);
    const spanId = randomHex(8);
    const start = performance.now();
    const startTimeUnixNano = hrTimeUnixNano();
    res.setHeader("traceparent", `00-${traceId}-${spanId}-01`);
    res.on("finish", () => {
        emitOtelSpan({
            traceId,
            spanId,
            name: `${req.method} ${req.route?.path ?? req.path}`,
            startTimeUnixNano,
            endTimeUnixNano: hrTimeUnixNano(),
            statusCode: res.statusCode,
            attributes: {
                "http.request.method": req.method,
                "http.route": req.route?.path?.toString() ?? req.path,
                "http.response.status_code": res.statusCode,
                "url.path": req.path,
                "aristotle.execution_boundary": req.path.includes("/operator/governance-chain") || req.path.includes("/operator/os") || req.path.includes("/operator/govern"),
                "aristotle.gateway.fail_closed": res.statusCode === 503 && (req.path === "/ready" || req.path.startsWith("/operator")),
                "duration.ms": Math.round((performance.now() - start) * 1000) / 1000
            }
        });
    });
    next();
});
app.get("/v1/status", (_req, res) => {
    const validation = validateGovernanceSource(trialPolicySource);
    res.json({
        ok: validation.ok,
        runtime: "aristotle-trial",
        activePolicyHash: validation.policy?.policyHash,
        governanceMode: "deterministic-trial",
        doctrine: "Governance must bind at the execution boundary before irreversible state mutation or external action occurs.",
        scenarios: TRIAL_SCENARIOS.map(({ id, title, summary }) => ({ id, title, summary }))
    });
});
app.post("/v1/actions/evaluate", (req, res) => {
    res.json(evaluateTrialRequest(req.body));
});
app.post("/v1/actions/execute", (req, res) => {
    const result = evaluateTrialRequest(req.body, req.body.approval);
    const executable = result.evaluation.decision === "PERMIT";
    res.status(executable ? 200 : result.evaluation.decision === "DEFER" ? 202 : 409).json({
        ...result,
        execution: executable
            ? { status: "executed", boundary: "commit-gate", warrantId: result.evaluation.warrant?.id }
            : { status: "not_executed", reason: result.evaluation.decisionCode }
    });
});
app.get("/v1/audit/tail", (_req, res) => res.json({ items: trialGelRecords.slice(0, 25) }));
app.get("/v1/audit/:recordId", (req, res) => {
    const record = trialGelRecords.find((item) => item.recordId === req.params.recordId);
    if (!record) {
        res.status(404).json({ error: "record_not_found" });
        return;
    }
    res.json(record);
});
app.post("/v1/replay", (req, res) => {
    const body = req.body;
    const result = evaluateTrialAction({
        source: typeof body.policy === "string" ? body.policy : trialPolicySource,
        intent: (body.intent && typeof body.intent === "object" ? body.intent : TRIAL_SCENARIOS[0].intent),
        previousHash: typeof body.previousHash === "string" ? body.previousHash : "GENESIS",
        now: typeof body.now === "string" ? body.now : "2026-01-01T00:00:00.000Z"
    });
    res.json({ replayed: true, evaluation: result });
});
app.get("/v1/approvals", (_req, res) => {
    res.json({
        items: Array.from(trialApprovals.entries()).map(([id, value]) => ({
            id,
            intent: value.intent,
            decisionCode: value.evaluation.decisionCode,
            explanation: value.evaluation.explanation
        }))
    });
});
app.post("/v1/approvals/:id/approve", (req, res) => {
    const deferred = trialApprovals.get(req.params.id);
    if (!deferred) {
        res.status(404).json({ error: "approval_not_found" });
        return;
    }
    const evaluation = evaluateTrialAction({
        source: deferred.source,
        intent: deferred.intent,
        approval: req.body.reducedAuthority ? "reduced_authority" : "approve",
        previousHash: trialGelRecords[0]?.currentHash
    });
    appendTrialRecord(evaluation);
    trialApprovals.delete(req.params.id);
    res.json({ approved: true, evaluation });
});
app.post("/v1/approvals/:id/deny", (req, res) => {
    const deferred = trialApprovals.get(req.params.id);
    if (!deferred) {
        res.status(404).json({ error: "approval_not_found" });
        return;
    }
    const evaluation = evaluateTrialAction({
        source: deferred.source,
        intent: deferred.intent,
        approval: "deny",
        previousHash: trialGelRecords[0]?.currentHash
    });
    appendTrialRecord(evaluation);
    trialApprovals.delete(req.params.id);
    res.json({ denied: true, evaluation });
});
app.post("/v1/policy/check", (req, res) => {
    const source = typeof req.body?.policy === "string" ? req.body.policy : trialPolicySource;
    const { policy, ...validation } = validateGovernanceSource(source);
    res.status(validation.ok ? 200 : 422).json({ ...validation, policyHash: policy?.policyHash });
});
app.post("/v1/policy/plan", (req, res) => {
    const source = typeof req.body?.policy === "string" ? req.body.policy : trialPolicySource;
    const plan = planGovernanceChange(source, trialPolicySource);
    res.status(plan.ok ? 200 : 422).json(plan);
});
app.post("/v1/policy/apply", (req, res) => {
    const source = typeof req.body?.policy === "string" ? req.body.policy : "";
    const validation = validateGovernanceSource(source);
    if (!validation.ok || !validation.policy) {
        res.status(422).json(validation);
        return;
    }
    trialPolicySource = source;
    parseGovernanceSource(trialPolicySource);
    res.json({ applied: true, policyHash: validation.policy.policyHash });
});
app.post("/operator/auth/session", (req, res) => {
    if (!operatorApiKey) {
        res.status(503).json({ error: "operator_auth_disabled", message: "Operator authentication is not configured." });
        return;
    }
    if (!operatorSessionSecret) {
        res.status(503).json({ error: "operator_session_disabled", message: "Operator session signing is not configured." });
        return;
    }
    const credential = readOperatorCredential(req);
    if (credential !== operatorApiKey) {
        res.status(401).json({ error: "operator_auth_required", message: "Valid operator credential required." });
        return;
    }
    const actor = readOperatorActor(req).trim();
    const role = readOperatorRole(req);
    const allowedActors = isReadMethod(req.method) ? operatorReadActors : operatorMutationActors;
    if (allowedActors.size > 0 && !allowedActors.has(actor)) {
        res.status(403).json({
            error: "operator_actor_forbidden",
            message: `Operator actor '${actor}' is not permitted for ${req.method} ${req.path}.`
        });
        return;
    }
    const allowedRoles = isReadMethod(req.method) ? operatorReadRoles : operatorMutationRoles;
    if (operatorRoleEnforcement && !allowedRoles.has(role)) {
        res.status(403).json({
            error: "operator_role_forbidden",
            message: `Operator role '${role}' is not permitted for ${req.method} ${req.path}.`
        });
        return;
    }
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + operatorSessionTtlMs);
    const claims = {
        actor,
        role,
        issuedAt: issuedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        sessionId: randomUUID()
    };
    res.json({
        token: createOperatorSessionToken(claims),
        tokenType: "Bearer",
        actor,
        role,
        issuedAt: claims.issuedAt,
        expiresAt: claims.expiresAt,
        sessionId: claims.sessionId
    });
});
app.use("/operator", (req, res, next) => {
    if (!operatorApiKey) {
        next();
        return;
    }
    const sessionToken = readOperatorSession(req);
    if (sessionToken) {
        const claims = parseOperatorSessionToken(sessionToken);
        if (!claims) {
            res.status(401).json({ error: "operator_session_invalid", message: "Valid operator session required." });
            return;
        }
        const validity = validateSessionClaims(claims, req);
        if (!validity.ok) {
            res.status(401).json({ error: validity.error, message: validity.message });
            return;
        }
        const allowedActors = isReadMethod(req.method) ? operatorReadActors : operatorMutationActors;
        if (allowedActors.size > 0 && !allowedActors.has(claims.actor)) {
            res.status(403).json({
                error: "operator_actor_forbidden",
                message: `Operator actor '${claims.actor}' is not permitted for ${req.method} ${req.path}.`
            });
            return;
        }
        if (operatorRoleEnforcement) {
            const allowedRoles = isReadMethod(req.method) ? operatorReadRoles : operatorMutationRoles;
            if (!allowedRoles.has(claims.role)) {
                res.status(403).json({
                    error: "operator_role_forbidden",
                    message: `Operator role '${claims.role}' is not permitted for ${req.method} ${req.path}.`
                });
                return;
            }
        }
        next();
        return;
    }
    if (operatorSessionEnforcement && req.path !== "/auth/session") {
        res.status(401).json({ error: "operator_session_required", message: "Signed operator session required." });
        return;
    }
    const credential = readOperatorCredential(req);
    if (credential === operatorApiKey) {
        const actor = readOperatorActor(req).trim();
        const allowedActors = isReadMethod(req.method) ? operatorReadActors : operatorMutationActors;
        if (allowedActors.size > 0 && !allowedActors.has(actor)) {
            res.status(403).json({
                error: "operator_actor_forbidden",
                message: `Operator actor '${actor}' is not permitted for ${req.method} ${req.path}.`
            });
            return;
        }
        if (!operatorRoleEnforcement) {
            next();
            return;
        }
        const role = readOperatorRole(req);
        const allowedRoles = isReadMethod(req.method) ? operatorReadRoles : operatorMutationRoles;
        if (allowedRoles.has(role)) {
            next();
            return;
        }
        res.status(403).json({
            error: "operator_role_forbidden",
            message: `Operator role '${role}' is not permitted for ${req.method} ${req.path}.`
        });
        return;
    }
    res.status(401).json({ error: "operator_auth_required", message: "Valid operator credential required." });
});
app.get("/health", handleAsync(async (_req, res) => {
    const services = await Promise.allSettled(observedServices.map((service) => call(service.base, service.path)));
    const readiness = await evaluateReadiness();
    res.json({ ok: true, services, preflight, readiness });
}));
app.get("/ready", handleAsync(async (_req, res) => {
    const readiness = await evaluateReadiness();
    res.status(readiness.ok ? 200 : 503).json(readiness);
}));
app.get("/metrics", handleAsync(async (_req, res) => {
    res.type("text/plain; version=0.0.4; charset=utf-8").send(renderGatewayMetrics(await evaluateReadiness()));
}));
app.get("/operator/mesh", handleAsync(async (_req, res) => res.json(await call(simulationEngineBase, "/telemetry"))));
app.get("/operator/deployables", handleAsync(async (_req, res) => res.json({ generatedAt: new Date().toISOString(), items: deployableProfiles })));
app.get("/operator/ledger", handleAsync(async (req, res) => {
    const params = new URLSearchParams();
    if (typeof req.query.traceId === "string")
        params.set("traceId", req.query.traceId);
    if (typeof req.query.relatedId === "string")
        params.set("relatedId", req.query.relatedId);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    res.json(await call(evidenceLedgerBase, `/timeline${suffix}`));
}));
app.get("/operator/ledger/artifacts", handleAsync(async (req, res) => {
    const params = new URLSearchParams();
    if (typeof req.query.traceId === "string")
        params.set("traceId", req.query.traceId);
    if (typeof req.query.branchId === "string")
        params.set("branchId", req.query.branchId);
    if (typeof req.query.relatedId === "string")
        params.set("relatedId", req.query.relatedId);
    if (typeof req.query.artifactType === "string")
        params.set("artifactType", req.query.artifactType);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    res.json(await call(evidenceLedgerBase, `/artifacts${suffix}`));
}));
app.get("/operator/ledger/artifacts/:artifactId", handleAsync(async (req, res) => {
    const artifactId = Array.isArray(req.params.artifactId) ? req.params.artifactId[0] : req.params.artifactId;
    res.json(await call(evidenceLedgerBase, `/artifacts/${encodeURIComponent(artifactId)}`));
}));
app.get("/operator/meta-authority", handleAsync(async (_req, res) => res.json(await call(metaAuthorityRegistryBase, "/artifacts"))));
app.get("/operator/envelopes", handleAsync(async (_req, res) => res.json(await call(governanceKernelBase, "/envelopes"))));
// GOVERNANCE_CHAIN_V2: status-preserving proxy to the kernel's Ward/Warrant chain
// so it can be observed/exercised next to the original surface above. Inherits the
// /operator auth + method RBAC applied by the middleware registered earlier.
app.use("/operator/governance-chain", createGovernanceChainProxy(governanceKernelBase, chainV2Enabled));
app.get("/operator/deployment/posture", handleAsync(async (_req, res) => res.json(getDeploymentPosture())));
app.get("/operator/assurance/report", handleAsync(async (_req, res) => res.json(await getAssuranceReport())));
app.post("/operator/assurance/attest", handleAsync(async (req, res) => {
    const report = await getAssuranceReport();
    const missionId = typeof req.body?.missionId === "string" ? req.body.missionId : undefined;
    const mission = missionId ? report.missions.find((item) => item.missionId === missionId) : undefined;
    const reportScope = mission ? "mission" : "system";
    const traceId = mission?.missionId ?? "system-assurance";
    const summary = reportScope === "mission"
        ? `Mission assurance attested as ${mission?.assurancePosture ?? "conditional"} for ${mission?.title ?? traceId}.`
        : `System assurance attested as ${report.systemPosture}.`;
    const committed = await call(evidenceLedgerBase, "/events/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            actor: req.body?.actor ?? "http-gateway",
            eventKind: "assurance.report.attested",
            traceId,
            payload: {
                reportScope,
                attestedBy: readOperatorActor(req),
                summary,
                report,
                mission
            }
        })
    });
    res.status(201).json({ report, mission, reportScope, committed });
}));
app.get("/operator/os/state", handleAsync(async (_req, res) => res.json(await call(agentOsBase, "/state"))));
app.get("/operator/os/missions", handleAsync(async (_req, res) => res.json(await call(agentOsBase, "/missions"))));
app.post("/operator/os/reconcile", handleAsync(async (_req, res) => res.json(await call(agentOsBase, "/reconcile", { method: "POST" }))));
app.post("/operator/os/autonomy/tick", handleAsync(async (_req, res) => res.json(await call(agentOsBase, "/autonomy/tick", { method: "POST" }))));
app.get("/operator/os/tasks/next", handleAsync(async (req, res) => {
    const params = new URLSearchParams();
    if (typeof req.query.agentId === "string")
        params.set("agentId", req.query.agentId);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    res.json(await call(agentOsBase, `/tasks/next${suffix}`));
}));
app.get("/operator/os/tasks/:taskId/actions", handleAsync(async (req, res) => res.json(await call(agentOsBase, `/tasks/${req.params.taskId}/actions`))));
app.post("/operator/os/tasks/:taskId/claim", handleAsync(async (req, res) => res.json(await call(agentOsBase, `/tasks/${req.params.taskId}/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req.body)
}))));
app.post("/operator/os/tasks/:taskId/actions", handleAsync(async (req, res) => res.json(await call(agentOsBase, `/tasks/${req.params.taskId}/actions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req.body)
}))));
app.post("/operator/os/tasks/:taskId/actions/:actionId/execute", handleAsync(async (req, res) => res.json(await call(agentOsBase, `/tasks/${req.params.taskId}/actions/${req.params.actionId}/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req.body)
}))));
app.post("/operator/os/tasks/:taskId/heartbeat", handleAsync(async (req, res) => res.json(await call(agentOsBase, `/tasks/${req.params.taskId}/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req.body)
}))));
app.post("/operator/os/tasks/:taskId/complete", handleAsync(async (req, res) => res.json(await call(agentOsBase, `/tasks/${req.params.taskId}/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req.body)
}))));
app.post("/operator/os/tasks/:taskId/retry", handleAsync(async (req, res) => res.json(await call(agentOsBase, `/tasks/${req.params.taskId}/retry`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req.body)
}))));
app.post("/operator/os/leases/:leaseId/renew", handleAsync(async (req, res) => res.json(await call(agentOsBase, `/leases/${req.params.leaseId}/renew`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req.body)
}))));
app.post("/operator/policy/compile", handleAsync(async (req, res) => res.json(await call(policyCompilerBase, "/compile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req.body)
}))));
app.post("/operator/os/agents", handleAsync(async (req, res) => {
    const agent = await call(agentOsBase, "/agents/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req.body)
    });
    const committed = await call(evidenceLedgerBase, "/events/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actor: readOperatorActor(req), eventKind: "agent-os.agent.registered", traceId: agent.id, payload: agent })
    });
    res.status(201).json({ agent, committed });
}));
app.post("/operator/os/workspaces", handleAsync(async (req, res) => {
    const workspace = await call(agentOsBase, "/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req.body)
    });
    const committed = await call(evidenceLedgerBase, "/events/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actor: readOperatorActor(req), eventKind: "agent-os.workspace.prepared", traceId: workspace.missionId, payload: workspace })
    });
    res.status(201).json({ workspace, committed });
}));
app.post("/operator/os/missions", handleAsync(async (req, res) => {
    const created = await call(agentOsBase, "/missions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req.body)
    });
    const compiledPolicy = await call(policyCompilerBase, "/compile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            policyName: req.body.governanceProfile ?? "supervised-build",
            policyText: req.body.policyText ?? "admission:require-supervision\nexecution:record-evidence\nsafety:respect-kill-switch"
        })
    });
    const committed = await call(evidenceLedgerBase, "/events/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actor: readOperatorActor(req), eventKind: "agent-os.mission.created", traceId: created.mission.id, payload: { ...created, compiledPolicy } })
    });
    res.status(201).json({ ...created, compiledPolicy, committed });
}));
app.post("/operator/os/missions/:missionId/advance", handleAsync(async (req, res) => {
    const advanced = await call(agentOsBase, `/missions/${req.params.missionId}/advance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req.body)
    });
    const committed = await call(evidenceLedgerBase, "/events/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actor: readOperatorActor(req), eventKind: "agent-os.mission.advanced", traceId: req.params.missionId, payload: advanced })
    });
    res.json({ ...advanced, committed });
}));
app.post("/operator/kill-switch", handleAsync(async (req, res) => {
    const kernel = await call(governanceKernelBase, "/kill-switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req.body)
    });
    const gate = await call(executionGateBase, "/kill-switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req.body)
    });
    const scope = req.body.scope ?? "global";
    const scopeRef = req.body.scopeRef;
    const traceId = typeof scopeRef === "string" && scope === "mission" ? scopeRef : typeof scopeRef === "string" ? `scope:${scope}:${scopeRef}` : `scope:${scope}`;
    const committed = await call(evidenceLedgerBase, "/events/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            actor: readOperatorActor(req),
            eventKind: "governance.kill-switch.updated",
            traceId,
            payload: {
                state: req.body.state,
                reason: req.body.reason ?? "operator action",
                scope,
                scopeRef,
                killSwitchState: req.body.state,
                kernel,
                gate
            }
        })
    });
    res.json({ kernel, gate, committed });
}));
app.post("/operator/govern", handleAsync(async (req, res) => {
    const envelopeResponse = await call(governanceKernelBase, "/validate-envelope", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req.body.envelope)
    });
    const warrant = await call(governanceKernelBase, "/issue-warrant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            envelopeId: envelopeResponse.envelope.id,
            missionId: req.body.missionId,
            targetNode: req.body.targetNode,
            witnessRequired: req.body.witnessRequired
        })
    });
    const route = await call(authorityRouterBase, "/route", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            source: req.body.envelope.issuer,
            target: req.body.targetNode,
            degradedNodes: req.body.degradedNodes ?? []
        })
    });
    const witness = req.body.witnessRequired === false
        ? null
        : await call(witnessServiceBase, "/verify", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ warrantId: warrant.id, envelopeId: envelopeResponse.envelope.id })
        });
    const decision = await call(executionGateBase, "/decide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            warrantId: warrant.id,
            envelopeId: envelopeResponse.envelope.id,
            witnessAccepted: witness ? witness.accepted : true,
            witnessRequired: req.body.witnessRequired !== false
        })
    });
    const committed = await call(evidenceLedgerBase, "/events/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            actor: readOperatorActor(req),
            eventKind: "governance.cycle.completed",
            traceId: warrant.id,
            payload: { envelope: envelopeResponse.envelope, warrant, witness, decision, route }
        })
    });
    res.json({ envelope: envelopeResponse, warrant, witness, route, decision, committed });
}));
app.post("/operator/replay/counterfactual", handleAsync(async (req, res) => {
    const branch = await call(evidenceLedgerBase, "/branches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req.body)
    });
    const projection = await call(simulationEngineBase, "/counterfactual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req.body)
    });
    const hypothetical = await call(evidenceLedgerBase, `/branches/${branch.id}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actor: readOperatorActor(req), eventKind: "counterfactual.projected", payload: projection })
    });
    res.json({ branch, projection, hypothetical });
}));
app.get("/operator/replay/:traceId", handleAsync(async (req, res) => {
    const traceId = Array.isArray(req.params.traceId) ? req.params.traceId[0] : req.params.traceId;
    const params = new URLSearchParams();
    if (traceId)
        params.set("traceId", traceId);
    if (typeof req.query.relatedId === "string")
        params.set("relatedId", req.query.relatedId);
    res.json(await call(evidenceLedgerBase, `/replay?${params.toString()}`));
}));
app.listen(port, () => console.log(`http-gateway on ${port}`));
