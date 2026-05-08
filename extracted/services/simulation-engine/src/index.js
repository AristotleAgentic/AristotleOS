import { createApp, id, now } from "./lib.js";
const port = Number(process.env.PORT_SIMULATION_ENGINE ?? 7005);
const tickMs = Number(process.env.REPLAY_TICK_MS ?? 1500);
const app = createApp();
let tick = 0;
let degradedNodes = ["mesh.gamma"];
app.get("/health", (_req, res) => res.json({ ok: true, service: "simulation-engine", tick }));
app.get("/telemetry", (_req, res) => {
    res.json({
        tick,
        nodes: [
            { id: "mesh.alpha", status: degradedNodes.includes("mesh.alpha") ? "degraded" : "healthy", load: 0.62 },
            { id: "mesh.beta", status: degradedNodes.includes("mesh.beta") ? "degraded" : "healthy", load: 0.38 },
            { id: "mesh.gamma", status: degradedNodes.includes("mesh.gamma") ? "degraded" : "healthy", load: 0.81 }
        ],
        missionTimeline: [{ tick, label: "governance-cycle", timestamp: now() }]
    });
});
app.post("/degrade", (req, res) => {
    degradedNodes = req.body.nodes ?? degradedNodes;
    res.json({ degradedNodes, tick });
});
app.post("/counterfactual", (req, res) => {
    const scenario = req.body;
    const projectedRoute = scenario.route
        ? (() => {
            const projectedDegradedNodes = scenario.degradedNodes ?? scenario.route.degradedNodes ?? [];
            const primaryRelay = scenario.route.selectedPath?.[1];
            const alternateRelay = scenario.route.rejectedPath?.[1];
            const routeAffected = typeof primaryRelay === "string" && projectedDegradedNodes.includes(primaryRelay);
            const alternateAffected = typeof alternateRelay === "string" && projectedDegradedNodes.includes(alternateRelay);
            const disconnected = routeAffected && alternateAffected;
            const delegatedAuthorityAnchor = disconnected
                ? undefined
                : routeAffected
                    ? scenario.route.alternateAuthorityAnchor ?? scenario.route.delegatedAuthorityAnchor ?? scenario.route.authorityAnchor
                    : scenario.route.authorityAnchor ?? scenario.route.source;
            const selectedRelay = disconnected
                ? undefined
                : routeAffected
                    ? scenario.route.rejectedPath?.[1] ?? alternateRelay
                    : scenario.route.selectedPath?.[1] ?? primaryRelay;
            return {
                ...scenario.route,
                delegatedAuthorityAnchor,
                degradedNodes: projectedDegradedNodes,
                selectedPath: disconnected
                    ? []
                    : [delegatedAuthorityAnchor ?? scenario.route.source, selectedRelay, scenario.route.target].filter((value) => typeof value === "string" && value.length > 0),
                rejectedPath: disconnected
                    ? scenario.route.rejectedPath ?? scenario.route.selectedPath ?? []
                    : routeAffected
                        ? scenario.route.selectedPath ?? []
                        : scenario.route.rejectedPath ?? [],
                failoverReasoning: scenario.injectKillSwitch
                    ? `Sovereign ${scenario.scope ?? "global"} halt${scenario.scopeRef ? ` for ${scenario.scopeRef}` : ""} suppresses commit.`
                    : disconnected
                        ? `Counterfactual degradation on ${[primaryRelay, alternateRelay].filter(Boolean).join(", ")} removes every admissible authority relay.`
                        : routeAffected
                            ? `Counterfactual degradation on ${primaryRelay} forces reroute.`
                            : "Counterfactual conditions leave the primary authority route intact.",
                delegationReasoning: disconnected
                    ? scenario.route.alternateAuthorityAnchor
                        ? `Delegated authority ${scenario.route.alternateAuthorityAnchor} is available, but no admissible relay survives to carry the handoff.`
                        : "No delegated authority lane remains available under the counterfactual interruption."
                    : routeAffected
                        ? scenario.route.alternateAuthorityAnchor
                            ? `Counterfactual conditions shift constitutional anchoring from ${scenario.route.authorityAnchor ?? scenario.route.source} to ${scenario.route.alternateAuthorityAnchor}.`
                            : `Counterfactual conditions preserve the same authority anchor while rerouting around ${primaryRelay}.`
                        : `Counterfactual conditions keep ${scenario.route.authorityAnchor ?? scenario.route.source} as the active authority anchor.`,
                continuity: disconnected ? "disconnected" : routeAffected ? "degraded" : "stable",
                continuityReasoning: disconnected
                    ? "Counterfactual conditions remove both primary and failover authority continuity."
                    : routeAffected
                        ? "Counterfactual conditions preserve degraded-but-admissible continuity through the failover relay."
                        : "Counterfactual conditions preserve stable authority continuity.",
                recoverable: disconnected || routeAffected,
                mode: disconnected ? "disconnected" : routeAffected ? "degraded" : "nominal"
            };
        })()
        : undefined;
    const projectedRecoveryPaths = scenario.injectKillSwitch
        ? [
            {
                label: "Clear sovereign halt",
                mode: "resume",
                scope: scenario.scope,
                scopeRef: scenario.scopeRef,
                summary: `Resume the governed commit path after clearing the ${scenario.scope ?? "global"} halt${scenario.scopeRef ? ` for ${scenario.scopeRef}` : ""}.`
            },
            {
                label: "Delegate to alternate authority lane",
                mode: "delegate",
                scope: scenario.scope,
                scopeRef: scenario.scopeRef,
                summary: `Preserve intent while shifting execution toward an alternate authority lane outside the halted ${scenario.scope ?? "global"} scope.`
            },
            {
                label: "Escalate for constitutional review",
                mode: "escalate",
                scope: scenario.scope,
                scopeRef: scenario.scopeRef,
                summary: "Route the interrupted task into institutional review before any new commit attempt."
            }
        ]
        : projectedRoute?.mode === "disconnected"
            ? [
                {
                    label: "Restore an admissible authority lane",
                    mode: "resume",
                    summary: "Recover either the primary or failover relay before the next governed commit attempt."
                },
                {
                    label: "Delegate across domains",
                    mode: "delegate",
                    summary: `Shift execution into ${projectedRoute.alternateAuthorityAnchor ?? "a surviving delegated authority lane"} while preserving mission intent.`
                },
                {
                    label: "Escalate disconnected continuity",
                    mode: "escalate",
                    summary: "Hold execution until the institution resolves the disconnected governance posture."
                }
            ]
            : projectedRoute?.mode === "degraded"
                ? [
                    {
                        label: "Reroute through surviving relay",
                        mode: "reroute",
                        summary: `Continue through ${projectedRoute.selectedPath?.join(" -> ") || "the alternate route"} under degraded conditions.`
                    },
                    ...(projectedRoute.alternateAuthorityAnchor
                        ? [
                            {
                                label: "Delegate through alternate authority",
                                mode: "delegate",
                                summary: `Re-anchor constitutional continuity to ${projectedRoute.alternateAuthorityAnchor} while the primary lane remains degraded.`
                            }
                        ]
                        : []),
                    {
                        label: "Escalate degraded route",
                        mode: "escalate",
                        summary: "Hold execution until the degraded routing posture receives operator or institutional review."
                    }
                ]
                : [
                    {
                        label: "Continue nominal execution",
                        mode: "resume",
                        summary: "Counterfactual conditions leave the governed path admissible for continued execution."
                    }
                ];
    res.json({
        branchSeed: id("cfb"),
        hypothetical: true,
        scenario,
        projectedRoute,
        projectedRecoveryPaths,
        projectedOutcome: scenario.injectKillSwitch || projectedRoute?.mode === "disconnected"
            ? "halt"
            : projectedRoute?.mode === "degraded"
                ? "reroute"
                : "continue"
    });
});
setInterval(() => tick++, tickMs);
app.listen(port, () => console.log(`simulation-engine on ${port}`));
