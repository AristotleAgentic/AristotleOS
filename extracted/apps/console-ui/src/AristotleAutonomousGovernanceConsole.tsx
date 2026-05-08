import React, { useEffect, useMemo, useState } from "react";
import {
  attestAssuranceReport,
  advanceMission,
  createMission,
  fetchLedgerArtifact,
  fetchLedgerArtifacts,
  fetchLedgerTimeline,
  fetchOperatorSnapshot,
  projectCounterfactual,
  registerAgent,
  setGatewayKillSwitch,
  triggerAutonomyTick,
  type CounterfactualProjection,
  type AuthorityRoute,
  type GatewayHealth,
  type LedgerArtifactList,
  type LedgerTimeline,
  type OperatorSnapshot
} from "./gateway-client.js";

type ConsoleProps = {
  gatewayBaseUrl?: string;
  autoRefreshMs?: number;
};

type MeshNode = {
  id: string;
  label: string;
  x: number;
  y: number;
  role: string;
  latency: number;
  integrity: "nominal" | "degraded" | "contested";
  load: number;
  active: boolean;
};

type MeshLink = {
  id: string;
  from: string;
  to: string;
  status: "active" | "degraded" | "standby";
  traffic: number;
};

const INITIAL_LINKS: MeshLink[] = [
  { id: "l1", from: "kernel", to: "simulation", status: "active", traffic: 72 },
  { id: "l2", from: "kernel", to: "execution", status: "active", traffic: 54 },
  { id: "l3", from: "simulation", to: "agent-os", status: "active", traffic: 61 },
  { id: "l4", from: "simulation", to: "registry", status: "degraded", traffic: 34 },
  { id: "l5", from: "agent-os", to: "ledger", status: "standby", traffic: 17 },
  { id: "l6", from: "execution", to: "ledger", status: "active", traffic: 49 },
  { id: "l7", from: "registry", to: "ledger", status: "active", traffic: 44 },
  { id: "l8", from: "kernel", to: "agent-os", status: "standby", traffic: 22 }
];

const INITIAL_NODES: MeshNode[] = [
  { id: "kernel", label: "Helena Core", x: 18, y: 38, role: "Governance Kernel", latency: 12, integrity: "nominal", load: 62, active: true },
  { id: "simulation", label: "Bozeman Mesh", x: 42, y: 22, role: "Simulation Engine", latency: 19, integrity: "nominal", load: 51, active: true },
  { id: "execution", label: "Missoula Edge", x: 28, y: 70, role: "Execution Gate", latency: 26, integrity: "nominal", load: 47, active: true },
  { id: "agent-os", label: "Kalispell Runtime", x: 57, y: 48, role: "Agent OS", latency: 33, integrity: "nominal", load: 39, active: true },
  { id: "registry", label: "Billings Relay", x: 78, y: 35, role: "Meta Authority", latency: 28, integrity: "degraded", load: 58, active: true },
  { id: "ledger", label: "Butte Ledger", x: 52, y: 78, role: "Evidence Ledger", latency: 21, integrity: "nominal", load: 43, active: true }
];

const MISSION_TARGET_OPTIONS = [
  {
    value: "workspace",
    label: "workspace",
    objectiveHint: "Create the first governed delivery mission for the AI operating system.",
    authorityHint: "mission.command",
    routeHint: "delivery lane via workspace relay"
  },
  {
    value: "safety",
    label: "safety",
    objectiveHint: "Validate a high-integrity safety intervention path under sovereign governance.",
    authorityHint: "mission.command, safety.council",
    routeHint: "high-integrity lane via safety relay"
  },
  {
    value: "ledger",
    label: "ledger",
    objectiveHint: "Audit evidence continuity and finality posture across the governance ledger.",
    authorityHint: "mission.command, evidence.steward",
    routeHint: "evidence lane via ledger-adjacent relay"
  }
] as const;

const DEPLOYABLE_TABS = [
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
] as const;
type DeployableTabId = (typeof DEPLOYABLE_TABS)[number]["id"];
type DeployableProfile = (typeof DEPLOYABLE_TABS)[number];

function deriveMissionAuthorities(targetSystem: string) {
  if (targetSystem === "safety") return ["mission.command", "safety.council"];
  if (targetSystem === "ledger") return ["mission.command", "evidence.steward"];
  return ["mission.command"];
}

function deriveMissionSuccessMetric(targetSystem: string) {
  if (targetSystem === "safety") return "safety actuation remains admissible only under sovereign authority";
  if (targetSystem === "ledger") return "evidence continuity and finality remain intact";
  return "mission completes without governance violations";
}

function mapTargetSystemToDeployableTab(targetSystem?: string): DeployableTabId {
  if (targetSystem === "safety") return "vehicles";
  if (targetSystem === "ledger") return "assurance";
  return "agents";
}

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatTimestamp(value?: string) {
  if (!value) return "awaiting signal";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatTaskPhase(phase?: "prepare" | "execute" | "audit") {
  if (!phase) return "unspecified";
  if (phase === "prepare") return "prepare";
  if (phase === "execute") return "execute";
  return "audit";
}

function describeKillScope(scope?: string, scopeRef?: string) {
  if (!scope) return "global governance open";
  if (scope === "global") return "global sovereign halt";
  if (scope === "mission") return `mission halt ${scopeRef ?? "unresolved"}`;
  if (scope === "domain") return `domain halt ${scopeRef ?? "unresolved"}`;
  if (scope === "agent") return `agent halt ${scopeRef ?? "unresolved"}`;
  if (scope === "device") return `device halt ${scopeRef ?? "unresolved"}`;
  return `${scope} ${scopeRef ?? ""}`.trim();
}

function readAuthorityRoute(value: unknown): AuthorityRoute | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<AuthorityRoute>;
  if (!Array.isArray(candidate.selectedPath) || !Array.isArray(candidate.rejectedPath)) return null;
  if (typeof candidate.mode !== "string" || typeof candidate.failoverReasoning !== "string") return null;
  if (typeof candidate.source !== "string" || typeof candidate.target !== "string") return null;
  if (typeof candidate.domain !== "string" || typeof candidate.phase !== "string") return null;
  return {
    source: candidate.source,
    target: candidate.target,
    domain: candidate.domain,
    phase: candidate.phase as AuthorityRoute["phase"],
    authorityAnchor:
      typeof candidate.authorityAnchor === "string" ? candidate.authorityAnchor : candidate.source,
    alternateAuthorityAnchor:
      typeof candidate.alternateAuthorityAnchor === "string" ? candidate.alternateAuthorityAnchor : undefined,
    delegatedAuthorityAnchor:
      typeof candidate.delegatedAuthorityAnchor === "string" ? candidate.delegatedAuthorityAnchor : undefined,
    selectedPath: candidate.selectedPath.filter((item): item is string => typeof item === "string"),
    rejectedPath: candidate.rejectedPath.filter((item): item is string => typeof item === "string"),
    degradedNodes: Array.isArray(candidate.degradedNodes)
      ? candidate.degradedNodes.filter((item): item is string => typeof item === "string")
      : [],
    failoverReasoning: candidate.failoverReasoning,
    delegationReasoning:
      typeof candidate.delegationReasoning === "string" ? candidate.delegationReasoning : candidate.failoverReasoning,
    continuity:
      candidate.continuity === "degraded" || candidate.continuity === "disconnected" ? candidate.continuity : "stable",
    continuityReasoning:
      typeof candidate.continuityReasoning === "string" ? candidate.continuityReasoning : candidate.failoverReasoning,
    recoverable: candidate.recoverable !== false,
    mode:
      candidate.mode === "degraded" || candidate.mode === "disconnected" ? candidate.mode : "nominal"
  };
}

function eventAuthorityRoute(payload: Record<string, unknown>): AuthorityRoute | null {
  return (
    readAuthorityRoute(payload.route) ??
    readAuthorityRoute((payload.action as { governance?: { route?: AuthorityRoute } } | undefined)?.governance?.route) ??
    readAuthorityRoute((payload.decision as { route?: AuthorityRoute } | undefined)?.route)
  );
}

function compactId(value?: string) {
  if (!value) return "unavailable";
  return value.length > 18 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

function formatVerificationStatus(value?: "verified" | "degraded" | "revoked" | "unverified" | "failed") {
  if (!value) return "unverified";
  if (value === "verified") return "verified";
  if (value === "degraded") return "degraded";
  if (value === "revoked") return "revoked";
  if (value === "failed") return "failed";
  return "unverified";
}

function FocusBanner({
  tone,
  title,
  subtitle
}: {
  tone: "emerald" | "cyan";
  title: string;
  subtitle?: string;
}) {
  return (
    <div
      className={cn(
        "mb-4 rounded-xl border px-3 py-2 text-xs",
        tone === "emerald"
          ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
          : "border-cyan-500/20 bg-cyan-500/10 text-cyan-100"
      )}
    >
      <div>{title}</div>
      {subtitle && <div className="mt-1 text-[11px] opacity-80">{subtitle}</div>}
    </div>
  );
}

function getMissionActionReadiness(
  action: "progress" | "execute" | "complete" | "halt",
  missionStatus?: "draft" | "planned" | "active" | "blocked" | "completed" | "halted",
  focusedCommitPosture?: "halted" | "admissible" | "blocked" | "evaluating" | "standby",
  nextReadyTaskTitle?: string | null
) {
  if (!missionStatus) {
    return { enabled: false, reason: "No mission selected." };
  }
  if (action === "halt") {
    return { enabled: missionStatus !== "halted", reason: missionStatus === "halted" ? "Mission already halted." : "Immediate sovereign halt." };
  }
  if (missionStatus === "halted" || missionStatus === "completed") {
    return { enabled: false, reason: `Mission is already ${missionStatus}.` };
  }
  if (action === "execute") {
    if (focusedCommitPosture === "halted") return { enabled: false, reason: "Kill switch is active." };
    if (focusedCommitPosture === "blocked") return { enabled: false, reason: "Focused commit posture is blocked." };
    if (!nextReadyTaskTitle) return { enabled: false, reason: "No release-ready task is available." };
    return { enabled: true, reason: `Execute next admissible task: ${nextReadyTaskTitle}.` };
  }
  if (action === "complete") {
    if (focusedCommitPosture === "blocked") return { enabled: false, reason: "Governance has blocked the focused task." };
    if (focusedCommitPosture === "evaluating") return { enabled: false, reason: "Governance evaluation is still in progress." };
    return { enabled: true, reason: "Commit governed completion and advance release." };
  }
  return { enabled: true, reason: "Advance mission posture under governance." };
}

function summarizeHealthService(health: GatewayHealth | undefined, serviceName: string) {
  return health?.services.find(
    (service) => service.status === "fulfilled" && service.value.service === serviceName
  );
}

function deriveKillSwitchState(snapshot: OperatorSnapshot | null) {
  const service = summarizeHealthService(snapshot?.health, "governance-kernel");
  if (service?.status === "fulfilled" && service.value.killSwitchState) {
    return service.value.killSwitchState;
  }
  return "inactive" as const;
}

function deriveActiveKillScopes(snapshot: OperatorSnapshot | null) {
  const kernel = summarizeHealthService(snapshot?.health, "governance-kernel");
  const gate = summarizeHealthService(snapshot?.health, "execution-gate");
  const scopes = [
    ...((kernel?.status === "fulfilled" ? kernel.value.activeKillScopes : []) ?? []),
    ...((gate?.status === "fulfilled" ? gate.value.activeKillScopes : []) ?? [])
  ];
  const deduped = new Map<string, (typeof scopes)[number]>();
  for (const scope of scopes) {
    deduped.set(`${scope.scope ?? "global"}:${scope.scopeRef ?? "*"}`, scope);
  }
  return [...deduped.values()].filter((scope) => scope.state === "active");
}

function createVisualNodes(snapshot: OperatorSnapshot | null, animatedTick: number, killSwitchActive: boolean) {
  if (!snapshot) return INITIAL_NODES;

  const simulationLoad = snapshot.mesh.nodes.reduce((sum, node) => sum + node.load, 0) / Math.max(snapshot.mesh.nodes.length, 1);
  const degradedTelemetry = snapshot.mesh.nodes.some((node) => node.status === "degraded");
  const activeMissionCount = snapshot.osState.posture.activeMissions;
  const blockedMissionCount = snapshot.osState.posture.blockedMissions;
  const leasedTools = snapshot.osState.posture.leasedTools;
  const committedEvents = snapshot.ledger.committed.length;
  const metaAuthorities = snapshot.metaAuthority.items.length;

  const health = {
    kernel: summarizeHealthService(snapshot.health, "governance-kernel")?.status === "fulfilled",
    simulation: summarizeHealthService(snapshot.health, "simulation-engine")?.status === "fulfilled",
    execution: summarizeHealthService(snapshot.health, "execution-gate")?.status === "fulfilled",
    agentOs: summarizeHealthService(snapshot.health, "agent-os")?.status === "fulfilled",
    registry: summarizeHealthService(snapshot.health, "meta-authority-registry")?.status === "fulfilled",
    ledger: summarizeHealthService(snapshot.health, "evidence-ledger")?.status === "fulfilled"
  };

  return [
    {
      id: "kernel",
      label: "Helena Core",
      x: 18,
      y: 38,
      role: "Governance Kernel",
      latency: clamp(10 + activeMissionCount * 4 + animatedTick % 6, 8, 84),
      integrity: killSwitchActive ? "contested" : health.kernel ? "nominal" : "degraded",
      load: clamp(22 + activeMissionCount * 14 + leasedTools * 5, 10, 96),
      active: health.kernel
    },
    {
      id: "simulation",
      label: "Bozeman Mesh",
      x: 42,
      y: 22,
      role: "Simulation Engine",
      latency: clamp(14 + Math.round(simulationLoad * 28) + (animatedTick % 5), 8, 84),
      integrity: degradedTelemetry ? "degraded" : "nominal",
      load: clamp(Math.round(simulationLoad * 100), 10, 96),
      active: health.simulation && !killSwitchActive
    },
    {
      id: "execution",
      label: "Missoula Edge",
      x: 28,
      y: 70,
      role: "Execution Gate",
      latency: clamp(18 + activeMissionCount * 5, 8, 84),
      integrity: killSwitchActive ? "contested" : health.execution ? "nominal" : "degraded",
      load: clamp(15 + activeMissionCount * 13, 10, 96),
      active: health.execution && !killSwitchActive
    },
    {
      id: "agent-os",
      label: "Kalispell Runtime",
      x: 57,
      y: 48,
      role: "Agent OS",
      latency: clamp(12 + snapshot.osState.agents.length * 3 + leasedTools * 2, 8, 84),
      integrity: blockedMissionCount > 0 ? "degraded" : health.agentOs ? "nominal" : "degraded",
      load: clamp(18 + activeMissionCount * 17 + leasedTools * 7, 10, 96),
      active: health.agentOs
    },
    {
      id: "registry",
      label: "Billings Relay",
      x: 78,
      y: 35,
      role: "Meta Authority",
      latency: clamp(16 + metaAuthorities * 4, 8, 84),
      integrity: metaAuthorities > 0 ? "nominal" : "degraded",
      load: clamp(20 + metaAuthorities * 9, 10, 96),
      active: health.registry
    },
    {
      id: "ledger",
      label: "Butte Ledger",
      x: 52,
      y: 78,
      role: "Evidence Ledger",
      latency: clamp(15 + Math.min(committedEvents, 12) * 3, 8, 84),
      integrity: blockedMissionCount > 1 ? "degraded" : health.ledger ? "nominal" : "degraded",
      load: clamp(20 + Math.min(committedEvents, 12) * 6, 10, 96),
      active: health.ledger
    }
  ];
}

function createVisualLinks(nodes: MeshNode[], killSwitchActive: boolean) {
  const degradedNodeIds = new Set(nodes.filter((node) => node.integrity !== "nominal").map((node) => node.id));
  return INITIAL_LINKS.map((link, index) => {
    const touchesDegraded = degradedNodeIds.has(link.from) || degradedNodeIds.has(link.to);
    return {
      ...link,
      status: killSwitchActive ? "standby" : touchesDegraded ? "degraded" : "active",
      traffic: clamp(link.traffic + (index % 2 === 0 ? 6 : -4), 8, 96)
    };
  });
}

export default function AristotleAutonomousGovernanceConsole({
  gatewayBaseUrl,
  autoRefreshMs = 5000
}: ConsoleProps) {
  const [snapshot, setSnapshot] = useState<OperatorSnapshot | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string>("kernel");
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isTogglingKillSwitch, setIsTogglingKillSwitch] = useState(false);
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedDeployableTab, setSelectedDeployableTab] = useState<DeployableTabId>("agents");
  const [animatedTick, setAnimatedTick] = useState(0);
  const [optimisticKillSwitch, setOptimisticKillSwitch] = useState<"active" | "inactive" | null>(null);
  const [taskFilter, setTaskFilter] = useState<"all" | "live" | "waiting" | "blocked" | "completed">("live");
  const [taskQuery, setTaskQuery] = useState("");
  const [focusedLedgerTimeline, setFocusedLedgerTimeline] = useState<LedgerTimeline | null>(null);
  const [focusedLedgerArtifacts, setFocusedLedgerArtifacts] = useState<LedgerArtifactList | null>(null);
  const [hydratedFocusedArtifacts, setHydratedFocusedArtifacts] = useState<LedgerArtifactList["items"]>([]);
  const [counterfactualProjection, setCounterfactualProjection] = useState<CounterfactualProjection | null>(null);
  const [isProjectingCounterfactual, setIsProjectingCounterfactual] = useState(false);
  const [counterfactualArtifacts, setCounterfactualArtifacts] = useState<LedgerArtifactList | null>(null);
  const [killSwitchDraft, setKillSwitchDraft] = useState<{
    scope: "global" | "mission" | "domain" | "agent" | "device";
    scopeRef: string;
  }>({ scope: "global", scopeRef: "" });
  const [missionDraft, setMissionDraft] = useState({
    title: "Bootstrap agentic workspace",
    objective: "Create the first governed delivery mission for the AI operating system.",
    priority: "high" as const,
    riskLevel: "medium" as const,
    targetSystem: "workspace" as (typeof MISSION_TARGET_OPTIONS)[number]["value"]
  });
  const [agentDraft, setAgentDraft] = useState({
    name: "Console Field Operator",
    role: "operator" as const
  });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const next = await fetchOperatorSnapshot(gatewayBaseUrl);
        if (cancelled) return;
        setSnapshot(next);
        setError(null);
      } catch (fetchError) {
        if (cancelled) return;
        setError(fetchError instanceof Error ? fetchError.message : "failed to load operator snapshot");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();
    const interval = setInterval(() => void load(), autoRefreshMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [autoRefreshMs, gatewayBaseUrl]);

  useEffect(() => {
    const interval = setInterval(() => setAnimatedTick((tick) => tick + 1), 1200);
    return () => clearInterval(interval);
  }, []);

  const actualKillSwitch = deriveKillSwitchState(snapshot);
  const killSwitchState = optimisticKillSwitch ?? actualKillSwitch;
  const killSwitch = killSwitchState === "active";
  const activeKillScopes = deriveActiveKillScopes(snapshot);

  const nodes = useMemo(
    () => createVisualNodes(snapshot, animatedTick, killSwitch),
    [snapshot, animatedTick, killSwitch]
  );
  const links = useMemo(() => createVisualLinks(nodes, killSwitch), [nodes, killSwitch]);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? nodes[0],
    [nodes, selectedNodeId]
  );

  const stats = useMemo(() => {
    const activeNodes = nodes.filter((node) => node.active).length;
    const degradedLinks = links.filter((link) => link.status === "degraded").length;
    const activeLinks = links.filter((link) => link.status === "active").length;
    return { activeNodes, degradedLinks, activeLinks };
  }, [links, nodes]);

  const primaryMission = useMemo(() => {
    const missions = snapshot?.osState.missions ?? [];
    const selectedMission = selectedMissionId
      ? missions.find((mission) => mission.id === selectedMissionId)
      : null;
    return (
      selectedMission ??
      missions.find((mission) => mission.status === "active") ??
      missions.find((mission) => mission.status === "planned") ??
      missions[0] ??
      null
    );
  }, [selectedMissionId, snapshot]);
  const deployableTabs: DeployableProfile[] = useMemo(() => {
    const remote = snapshot?.deployableProfiles.items ?? [];
    if (!remote.length) {
      return [...DEPLOYABLE_TABS];
    }
    return remote.map((item) => ({
      id: item.id as DeployableTabId,
      label: item.label,
      preferredTarget: item.preferredTarget,
      authorityLane: item.authorityLane,
      actuationBoundary: item.actuationBoundary,
      objective: item.objective,
      assuranceFocus: item.assuranceFocus
    }));
  }, [snapshot?.deployableProfiles.items]);
  const activeDeployableTab = useMemo(
    () =>
      deployableTabs.find((tab) => tab.id === selectedDeployableTab) ??
      deployableTabs.find((tab) => tab.id === mapTargetSystemToDeployableTab(primaryMission?.targetSystem)) ??
      deployableTabs[0],
    [deployableTabs, primaryMission?.targetSystem, selectedDeployableTab]
  );

  const latestEnvelope = snapshot?.envelopes.items.at(-1) ?? null;
  const latestMetaAuthority = snapshot?.metaAuthority.items.at(-1) ?? null;
  const latestLedgerEvents = (snapshot?.ledger.committed ?? []).slice(-4).reverse();
  const latestLedgerArtifacts = (snapshot?.ledgerArtifacts.items ?? []).slice(-5).reverse();
  const memoryHighlights = (snapshot?.osState.memory ?? []).slice(-3).reverse();
  const missionExecutionTasks = primaryMission
    ? snapshot?.osState.executionTasks.filter((task) => task.missionId === primaryMission.id) ?? []
    : [];
  const missionExecutionReceipts = primaryMission
    ? snapshot?.osState.executionReceipts
        .filter((receipt) => receipt.missionId === primaryMission.id)
        .slice(-3)
        .reverse() ?? []
    : [];
  const missionToolActions = primaryMission
    ? snapshot?.osState.toolActions
        .filter((action) => action.missionId === primaryMission.id)
        .slice(-4)
        .reverse() ?? []
    : [];
  const missionGovernanceFeed = primaryMission
    ? snapshot?.ledger.committed
        .filter((event) => {
          const payloadMissionId = typeof event.payload.missionId === "string" ? event.payload.missionId : undefined;
          return event.traceId === primaryMission.id || payloadMissionId === primaryMission.id;
        })
        .slice(-6)
        .reverse() ?? []
    : [];
  const runningTaskCount = missionExecutionTasks.filter((task) => task.status === "running").length;
  const readyTaskCount = missionExecutionTasks.filter(
    (task) => task.status === "queued" && Boolean(task.coordination?.releaseReady)
  ).length;
  const waitingTaskCount = missionExecutionTasks.filter(
    (task) => task.status === "queued" && task.coordination?.releaseReady === false
  ).length;
  const blockedTaskCount = missionExecutionTasks.filter(
    (task) => task.status === "blocked" || task.status === "cancelled"
  ).length;
  const completedTaskCount = missionExecutionTasks.filter((task) => task.status === "completed").length;
  const nextReadyTask =
    missionExecutionTasks.find((task) => task.status === "queued" && Boolean(task.coordination?.releaseReady)) ?? null;
  const latestReleaseEvent =
    missionGovernanceFeed.find((event) => event.eventKind === "agent-os.execution.task.released") ?? null;
  const missionDecisionEvents = missionGovernanceFeed.filter((event) =>
    /released|completed|blocked|dispatched|advanced/.test(event.eventKind)
  );
  const missionArtifactTimeline = primaryMission
    ? snapshot?.ledgerArtifacts.items
        .filter((artifact) => artifact.missionId === primaryMission.id)
        .slice(-6)
        .reverse() ?? []
    : [];
  const activeGovernedTask =
    missionExecutionTasks.find((task) => task.status === "running") ??
    missionExecutionTasks.find((task) => task.status === "queued" && Boolean(task.coordination?.releaseReady)) ??
    missionExecutionTasks[0] ??
    null;
  const focusedTask = missionExecutionTasks.find((task) => task.id === selectedTaskId) ?? activeGovernedTask;
  const focusedTaskReceipts = focusedTask
    ? missionExecutionReceipts.filter((receipt) => receipt.taskId === focusedTask.id)
    : missionExecutionReceipts;
  const focusedTaskToolActions = focusedTask
    ? missionToolActions.filter((action) => action.taskId === focusedTask.id)
    : missionToolActions;
  const focusedTaskEventNeedles = new Set(
    [
      focusedTask?.id,
      focusedTask?.governance?.policyCompileId,
      focusedTask?.governance?.envelopeId,
      focusedTask?.governance?.warrantId,
      focusedTask?.governance?.commitDecisionId,
      focusedTask?.governance?.witnessReceiptId,
      focusedTask?.governance?.decisionId,
      focusedTask?.governance?.finalityCertificateId,
      focusedTask?.governance?.agentIdentityRef,
      focusedTask?.governance?.deviceIdentityRef
    ].filter((value): value is string => Boolean(value))
  );
  const mergedFocusedTaskArtifacts = useMemo(() => {
    const items = [...(focusedLedgerArtifacts?.items ?? []), ...hydratedFocusedArtifacts];
    const deduped = new Map<string, LedgerArtifactList["items"][number]>();
    items.forEach((artifact) => deduped.set(artifact.id, artifact));
    return [...deduped.values()].sort((left, right) => right.timestamp.localeCompare(left.timestamp));
  }, [focusedLedgerArtifacts?.items, hydratedFocusedArtifacts]);
  const focusedTaskTimeline = (focusedLedgerTimeline?.committed ?? missionDecisionEvents).filter((event) => {
    if (!focusedTask) return true;
    const payloadValues = Object.values(event.payload ?? {}).flatMap((value) =>
      typeof value === "string" ? [value] : []
    );
    return payloadValues.some((value) => focusedTaskEventNeedles.has(value));
  });
  const focusedTaskArtifactTimeline = (mergedFocusedTaskArtifacts.length > 0 ? mergedFocusedTaskArtifacts : missionArtifactTimeline).filter((artifact) => {
    if (!focusedTask) return true;
    return (
      focusedTaskEventNeedles.has(artifact.id) ||
      (artifact.envelopeId ? focusedTaskEventNeedles.has(artifact.envelopeId) : false) ||
      (artifact.warrantId ? focusedTaskEventNeedles.has(artifact.warrantId) : false) ||
      (artifact.decisionId ? focusedTaskEventNeedles.has(artifact.decisionId) : false)
    );
  });
  const focusedEnvelopeArtifact =
    focusedTaskArtifactTimeline.find((artifact) => artifact.artifactType === "authority-envelope") ?? latestEnvelope;
  const focusedWarrantArtifact =
    focusedTaskArtifactTimeline.find((artifact) => artifact.artifactType === "execution-warrant") ?? null;
  const focusedDecisionArtifact =
    focusedTaskArtifactTimeline.find((artifact) => artifact.artifactType === "execution-decision") ?? null;
  const focusedFinalityArtifact =
    focusedTaskArtifactTimeline.find((artifact) => artifact.artifactType === "finality-certificate") ?? null;
  const focusedAutonomyArtifact =
    focusedTaskArtifactTimeline.find((artifact) => artifact.artifactType === "autonomy-attestation") ?? null;
  const focusedAgentIdentityArtifact =
    focusedTaskArtifactTimeline.find(
      (artifact) =>
        artifact.artifactType === "identity-attestation" &&
        artifact.subjectType === "agent" &&
        artifact.subjectId === focusedTask?.assignedAgentId
    ) ??
    focusedTaskArtifactTimeline.find(
      (artifact) => artifact.artifactType === "identity-attestation" && artifact.subjectType === "agent"
    ) ??
    null;
  const focusedDeviceIdentityArtifact =
    focusedTaskArtifactTimeline.find(
      (artifact) =>
        artifact.artifactType === "identity-attestation" &&
        artifact.subjectType === "device" &&
        artifact.subjectId === (focusedTask?.execution?.workspaceId ?? primaryMission?.workspaceId)
    ) ??
    focusedTaskArtifactTimeline.find(
      (artifact) => artifact.artifactType === "identity-attestation" && artifact.subjectType === "device"
    ) ??
    null;
  const focusedAuthorityRoute =
    focusedTask?.governance?.route ??
    focusedTaskToolActions.find((action) => action.governance?.route)?.governance?.route ??
    null;
  const focusedAgent =
    snapshot?.osState.agents.find((agent) => agent.id === focusedTask?.assignedAgentId) ?? null;
  const focusedWorkspace =
    snapshot?.osState.workspaces.find((workspace) => workspace.id === (focusedTask?.execution?.workspaceId ?? primaryMission?.workspaceId)) ??
    null;
  const governanceFeedEvents = focusedTask ? focusedTaskTimeline : missionGovernanceFeed;
  const governanceFeedArtifacts = focusedTask
    ? focusedTaskArtifactTimeline
    : latestLedgerArtifacts;
  const missionKillEvents = governanceFeedEvents.filter((event) => event.eventKind === "governance.kill-switch.updated");
  const missionAutonomyEvents = governanceFeedEvents.filter((event) =>
    /autonomous-completed|runtime\.reconciled/.test(event.eventKind)
  );
  const killSwitchEvents = (snapshot?.ledger.committed ?? [])
    .filter((event) => event.eventKind === "governance.kill-switch.updated")
    .slice(0, 4);
  const focusedMemoryHighlights = focusedTask
    ? (snapshot?.osState.memory ?? [])
        .filter((record) => {
          const haystack = [record.summary, ...record.tags].join(" ");
          return [...focusedTaskEventNeedles].some((needle) => haystack.includes(needle));
        })
        .slice(-3)
        .reverse()
    : memoryHighlights;
  const focusedCommitPosture = killSwitch
    ? "halted"
    : focusedTask?.governance?.status === "approved"
      ? "admissible"
      : focusedTask?.governance?.status === "blocked"
        ? "blocked"
        : focusedTask
          ? "evaluating"
          : "standby";
  const focusedCommitRefs = [
    focusedTask?.governance?.policyCompileId,
    focusedEnvelopeArtifact?.id ?? focusedTask?.governance?.envelopeId,
    focusedWarrantArtifact?.id ?? focusedTask?.governance?.warrantId,
    focusedDecisionArtifact?.id ?? focusedTask?.governance?.commitDecisionId,
    focusedFinalityArtifact?.id ?? focusedTask?.governance?.finalityCertificateId,
    focusedAgentIdentityArtifact?.id ?? focusedTask?.governance?.agentIdentityRef,
    focusedDeviceIdentityArtifact?.id ?? focusedTask?.governance?.deviceIdentityRef
  ].filter(Boolean).length;
  const focusedAgentVerification = formatVerificationStatus(
    focusedAgentIdentityArtifact?.verification?.status === "failed"
      ? "failed"
      : focusedAgent?.verificationStatus ?? focusedAgentIdentityArtifact?.verification?.status
  );
  const focusedDeviceVerification = formatVerificationStatus(
    focusedDeviceIdentityArtifact?.verification?.status === "failed"
      ? "failed"
      : focusedWorkspace?.verificationStatus ?? focusedDeviceIdentityArtifact?.verification?.status
  );
  const focusedIdentitySummary = focusedTask
    ? `agent ${focusedTask.assignedAgentId} ${focusedAgentVerification} | device ${focusedTask.execution?.workspaceId ?? primaryMission?.workspaceId ?? "unassigned"} ${focusedDeviceVerification}`
    : "identity posture awaiting governed focus";
  const focusedAssurancePosture = !focusedTask
    ? "standby"
    : focusedCommitPosture === "halted" || focusedCommitPosture === "blocked"
      ? "non-insurable"
      : focusedAgentVerification === "verified" &&
          focusedDeviceVerification === "verified" &&
          (focusedTask.governance?.witnessStatus === "satisfied" || focusedTask.governance?.witnessStatus === "not-required")
        ? "insurable"
        : "conditional";
  const focusedAutonomySummary = focusedAutonomyArtifact
    ? `${focusedAutonomyArtifact.autonomyMode ?? "unspecified"}${focusedAutonomyArtifact.continuity ? ` | ${focusedAutonomyArtifact.continuity}` : ""}${focusedAutonomyArtifact.delegatedAuthorityAnchor ? ` | ${focusedAutonomyArtifact.delegatedAuthorityAnchor}` : ""}`
    : "no autonomy attestation";
  const autonomyHealth = summarizeHealthService(snapshot?.health, "agent-os");
  const autonomyTickSeconds =
    autonomyHealth?.status === "fulfilled" && typeof autonomyHealth.value.autonomyTickMs === "number"
      ? Math.round(autonomyHealth.value.autonomyTickMs / 1000)
      : null;
  const latestAutonomyEvent = missionAutonomyEvents[0] ?? null;
  const primaryMissionAssurance =
    snapshot?.assuranceReport.missions.find((mission) => mission.missionId === primaryMission?.id) ?? null;
  const deployableMissions =
    snapshot?.assuranceReport.missions.filter((mission) => mission.targetSystem === activeDeployableTab.preferredTarget) ?? [];
  const deployableMissionCount = deployableMissions.length;
  const deployableBlockedCount = deployableMissions.reduce((total, mission) => total + mission.blockedTasks, 0);
  const deployableAutonomyCount = deployableMissions.reduce((total, mission) => total + mission.autonomyAttestations, 0);
  const deployableFinalityCount = deployableMissions.reduce((total, mission) => total + mission.finalityCertificates, 0);
  const deployableHaltCount = deployableMissions.filter((mission) => mission.activeKillSwitch).length;
  const deployableAssurancePosture =
    deployableMissions.find((mission) => mission.missionId === primaryMission?.id)?.assurancePosture ??
    (deployableMissions.some((mission) => mission.assurancePosture === "halted" || mission.assurancePosture === "blocked")
      ? "contested"
      : deployableMissions.some((mission) => mission.assurancePosture === "conditional")
        ? "conditional"
        : deployableMissions.length > 0
          ? "insurable"
          : "standby");
  const deployableAssuranceSummary =
    deployableMissions[0]?.reasons.join(" ") ??
    (activeDeployableTab.id === "assurance"
      ? "Attest and replay enterprise governance posture across all deployable lanes."
      : `Route ${activeDeployableTab.label.toLowerCase()} through the ${activeDeployableTab.preferredTarget} governance lane.`);
  const recentAssuranceArtifacts =
    snapshot?.ledgerArtifacts.items
      .filter(
        (artifact) =>
          artifact.artifactType === "assurance-attestation" &&
          (!primaryMission || artifact.missionId === primaryMission.id || artifact.reportScope === "system")
      )
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
      .slice(0, 4) ?? [];
  const latestAssuranceArtifact =
    recentAssuranceArtifacts[0] ?? null;
  const focusedBlockingSummary =
    focusedTask?.coordination?.blockedByTaskIds?.join(", ") ??
    (focusedTask?.coordination?.releaseReady === false ? focusedTask.coordination.releaseCondition : "none");
  const focusedKillScope =
    focusedTask &&
    activeKillScopes.find(
      (scope) =>
        scope.scope === "global" ||
        (scope.scope === "mission" && scope.scopeRef === focusedTask.missionId) ||
        (scope.scope === "domain" && scope.scopeRef === focusedTask.governance?.route?.domain) ||
        (scope.scope === "agent" && scope.scopeRef === focusedTask.assignedAgentId) ||
        (scope.scope === "device" && scope.scopeRef === (focusedTask.execution?.workspaceId ?? primaryMission?.workspaceId))
    );
  const derivedKillScopeRef =
    killSwitchDraft.scope === "mission"
      ? primaryMission?.id ?? ""
      : killSwitchDraft.scope === "domain"
        ? focusedTask?.governance?.route?.domain ?? primaryMission?.targetSystem ?? missionDraft.targetSystem
        : killSwitchDraft.scope === "agent"
          ? focusedTask?.assignedAgentId ?? ""
          : killSwitchDraft.scope === "device"
            ? focusedTask?.execution?.workspaceId ?? primaryMission?.workspaceId ?? ""
        : "";
  const selectedKillScopeRef = killSwitchDraft.scope === "global" ? undefined : killSwitchDraft.scopeRef.trim() || derivedKillScopeRef;
  const selectedKillActive =
    killSwitchDraft.scope === "global"
      ? killSwitch
      : activeKillScopes.some(
          (scope) =>
            scope.state === "active" &&
            scope.scope === killSwitchDraft.scope &&
            scope.scopeRef === selectedKillScopeRef
        );
  const missionActionReadiness = {
    progress: getMissionActionReadiness("progress", primaryMission?.status, focusedCommitPosture, nextReadyTask?.title ?? null),
    execute: getMissionActionReadiness("execute", primaryMission?.status, focusedCommitPosture, nextReadyTask?.title ?? null),
    complete: getMissionActionReadiness("complete", primaryMission?.status, focusedCommitPosture, nextReadyTask?.title ?? null),
    halt: getMissionActionReadiness("halt", primaryMission?.status, focusedCommitPosture, nextReadyTask?.title ?? null)
  };
  const filteredMissionExecutionTasks = useMemo(() => {
    const normalizedQuery = taskQuery.trim().toLowerCase();
    const matchesFilter = (task: (typeof missionExecutionTasks)[number]) => {
      if (taskFilter === "all") return true;
      if (taskFilter === "live") return task.status === "running" || (task.status === "queued" && Boolean(task.coordination?.releaseReady));
      if (taskFilter === "waiting") return task.status === "queued" && task.coordination?.releaseReady === false;
      if (taskFilter === "blocked") return task.status === "blocked" || task.status === "cancelled";
      return task.status === "completed";
    };

    return [...missionExecutionTasks]
      .filter((task) => {
        if (!matchesFilter(task)) return false;
        if (!normalizedQuery) return true;
        const haystack = [
          task.title,
          task.id,
          task.ownerRole,
          task.assignedAgentId,
          task.coordination?.phase,
          ...(task.coordination?.blockedByTaskIds ?? []),
          ...(task.requiredTools ?? [])
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalizedQuery);
      })
      .sort((left, right) => {
        const weight = (task: (typeof missionExecutionTasks)[number]) => {
          if (task.status === "running") return 0;
          if (task.status === "queued" && task.coordination?.releaseReady) return 1;
          if (task.status === "queued") return 2;
          if (task.status === "blocked" || task.status === "cancelled") return 3;
          return 4;
        };
        return weight(left) - weight(right) || right.updatedAt.localeCompare(left.updatedAt);
      });
  }, [missionExecutionTasks, taskFilter, taskQuery]);

  useEffect(() => {
    const missions = snapshot?.osState.missions ?? [];
    if (missions.length === 0) {
      setSelectedMissionId(null);
      return;
    }
    if (selectedMissionId && missions.some((mission) => mission.id === selectedMissionId)) {
      return;
    }
    const defaultMission =
      missions.find((mission) => mission.status === "active") ??
      missions.find((mission) => mission.status === "planned") ??
      missions[0];
    setSelectedMissionId(defaultMission?.id ?? null);
  }, [selectedMissionId, snapshot]);

  useEffect(() => {
    if (missionExecutionTasks.length === 0) {
      setSelectedTaskId(null);
      return;
    }
    if (selectedTaskId && missionExecutionTasks.some((task) => task.id === selectedTaskId)) {
      return;
    }
    setSelectedTaskId(activeGovernedTask?.id ?? missionExecutionTasks[0]?.id ?? null);
  }, [activeGovernedTask?.id, missionExecutionTasks, selectedTaskId]);

  useEffect(() => {
    let cancelled = false;
    if (!primaryMission?.id || !focusedTask?.id) {
      setFocusedLedgerTimeline(null);
      setFocusedLedgerArtifacts(null);
      setHydratedFocusedArtifacts([]);
      return;
    }

    const loadFocusedEvidence = async () => {
      try {
        const [timeline, artifacts] = await Promise.all([
          fetchLedgerTimeline(gatewayBaseUrl, { traceId: primaryMission.id, relatedId: focusedTask.id }),
          fetchLedgerArtifacts(gatewayBaseUrl, { traceId: primaryMission.id, relatedId: focusedTask.id })
        ]);
        if (cancelled) return;
        setFocusedLedgerTimeline(timeline);
        setFocusedLedgerArtifacts(artifacts);

        const knownArtifactIds = new Set(artifacts.items.map((artifact) => artifact.id));
        const relatedArtifactIds = [
          focusedTask.governance?.envelopeId,
          focusedTask.governance?.warrantId,
          focusedTask.governance?.witnessReceiptId,
          focusedTask.governance?.decisionId,
          focusedTask.governance?.finalityCertificateId,
          focusedTask.governance?.agentIdentityRef,
          focusedTask.governance?.deviceIdentityRef
        ].filter((value): value is string => Boolean(value) && !knownArtifactIds.has(value));

        if (relatedArtifactIds.length === 0) {
          setHydratedFocusedArtifacts([]);
          return;
        }

        const hydratedArtifacts = await Promise.allSettled(
          relatedArtifactIds.map((artifactId) => fetchLedgerArtifact(gatewayBaseUrl, artifactId))
        );
        if (cancelled) return;
        setHydratedFocusedArtifacts(
          hydratedArtifacts
            .filter(
              (
                result
              ): result is PromiseFulfilledResult<LedgerArtifactList["items"][number]> => result.status === "fulfilled"
            )
            .map((result) => result.value)
        );
      } catch {
        if (cancelled) return;
        setFocusedLedgerTimeline(null);
        setFocusedLedgerArtifacts(null);
        setHydratedFocusedArtifacts([]);
      }
    };

    void loadFocusedEvidence();
    return () => {
      cancelled = true;
    };
  }, [focusedTask?.id, gatewayBaseUrl, primaryMission?.id]);

  const handleKillSwitchToggle = async () => {
    const nextState = selectedKillActive ? "inactive" : "active";
    try {
      setIsTogglingKillSwitch(true);
      const scope = killSwitchDraft.scope;
      const scopeRef = scope === "global" ? undefined : killSwitchDraft.scopeRef.trim() || derivedKillScopeRef || undefined;
      if (scope !== "global" && !scopeRef) {
        throw new Error(`No ${scope} scope reference is available for sovereign halt.`);
      }
      if (scope === "global") {
        setOptimisticKillSwitch(nextState);
      }
      await setGatewayKillSwitch(gatewayBaseUrl, nextState, { scope, scopeRef });
      const refreshed = await fetchOperatorSnapshot(gatewayBaseUrl);
      setSnapshot(refreshed);
      setError(null);
      setActionMessage(`Kill switch set to ${nextState} for ${scope}${scopeRef ? `:${scopeRef}` : ""}.`);
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "failed to update kill switch");
    } finally {
      setOptimisticKillSwitch(null);
      setIsTogglingKillSwitch(false);
    }
  };

  const handleProjectCounterfactual = async (mode: "reroute" | "halt" | "agent-halt" | "device-halt") => {
    if (!primaryMission || !focusedTask) return;
    try {
      setIsProjectingCounterfactual(true);
      setError(null);
      const counterfactualScope =
        mode === "halt"
          ? "mission"
          : mode === "agent-halt"
            ? "agent"
            : mode === "device-halt"
              ? "device"
              : "domain";
      const counterfactualScopeRef =
        mode === "halt"
          ? primaryMission.id
          : mode === "agent-halt"
            ? focusedTask.assignedAgentId
            : mode === "device-halt"
              ? focusedTask.execution?.workspaceId ?? primaryMission.workspaceId
              : primaryMission.targetSystem;
      const projection = await projectCounterfactual(gatewayBaseUrl, {
        parentTraceId: primaryMission.id,
        label: `${focusedTask.title} ${mode} projection`,
        missionId: primaryMission.id,
        taskId: focusedTask.id,
        route: focusedTask.governance?.route,
        degradedNodes: mode === "reroute" ? ["mesh.alpha"] : [],
        injectKillSwitch: mode !== "reroute",
        scope: counterfactualScope,
        scopeRef: counterfactualScopeRef
      });
      setCounterfactualProjection(projection);
      const branchArtifacts = await fetchLedgerArtifacts(gatewayBaseUrl, { branchId: projection.branch.id });
      setCounterfactualArtifacts(branchArtifacts);
      setActionMessage(`Counterfactual ${mode} projection generated.`);
    } catch (projectionError) {
      setError(projectionError instanceof Error ? projectionError.message : "failed to project counterfactual");
    } finally {
      setIsProjectingCounterfactual(false);
    }
  };

  const refreshSnapshot = async () => {
    const refreshed = await fetchOperatorSnapshot(gatewayBaseUrl);
    setSnapshot(refreshed);
    return refreshed;
  };

  const handleRegisterAgent = async () => {
    try {
      setIsSubmittingAction(true);
      setError(null);
      await registerAgent(gatewayBaseUrl, {
        name: agentDraft.name,
        role: agentDraft.role,
        model: agentDraft.role === "operator" ? "gpt-5.4" : "gpt-5.4-mini",
        provider: "openai",
        specializations: ["operator coordination", "runtime supervision"],
        toolchains: ["gateway", "ledger", "shell"],
        trustTier: agentDraft.role === "operator" ? "privileged" : "delegated",
        maxConcurrency: 2,
        workspaceAffinity: "console"
      });
      await refreshSnapshot();
      setActionMessage(`Registered ${agentDraft.name} as ${agentDraft.role}.`);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "failed to register agent");
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleCreateMission = async () => {
    try {
      setIsSubmittingAction(true);
      setError(null);
      const requiredAuthorities = deriveMissionAuthorities(missionDraft.targetSystem);
      const successMetric = deriveMissionSuccessMetric(missionDraft.targetSystem);
      await createMission(gatewayBaseUrl, {
        title: missionDraft.title,
        objective: missionDraft.objective,
        priority: missionDraft.priority,
        riskLevel: missionDraft.riskLevel,
        governanceProfile: "supervised-build",
        targetSystem: missionDraft.targetSystem,
        requiredAuthorities,
        requiredTools: ["shell", "editor", "ledger"],
        successMetrics: [successMetric],
        requestedBy: "console-ui"
      });
      await refreshSnapshot();
      setActionMessage(`Mission created: ${missionDraft.title} (${missionDraft.targetSystem}).`);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "failed to create mission");
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleAdvanceMission = async (action: "progress" | "execute" | "complete" | "halt") => {
    if (!primaryMission) return;
    try {
      setIsSubmittingAction(true);
      setError(null);
      await advanceMission(gatewayBaseUrl, primaryMission.id, { action, actor: "console-ui" });
      await refreshSnapshot();
      setActionMessage(`Mission ${primaryMission.title} advanced via ${action}.`);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "failed to advance mission");
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleAutonomyTick = async () => {
    try {
      setIsSubmittingAction(true);
      setError(null);
      const result = await triggerAutonomyTick(gatewayBaseUrl);
      setSnapshot(result.snapshot);
      setActionMessage("Autonomous governed continuity tick executed.");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "failed to trigger autonomy tick");
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleAttestAssurance = async (scope: "mission" | "system") => {
    try {
      setIsSubmittingAction(true);
      setError(null);
      const result = await attestAssuranceReport(gatewayBaseUrl, {
        missionId: scope === "mission" ? primaryMission?.id : undefined,
        actor: "console-ui"
      });
      await refreshSnapshot();
      setActionMessage(
        result.reportScope === "mission"
          ? `Mission assurance attested for ${result.mission?.title ?? primaryMission?.title ?? "selected mission"}.`
          : "System assurance attested."
      );
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "failed to attest assurance");
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleLoadDeployablePreset = (tabId: DeployableTabId) => {
    const nextTab = deployableTabs.find((tab) => tab.id === tabId) ?? deployableTabs[0];
    const option =
      MISSION_TARGET_OPTIONS.find((item) => item.value === nextTab.preferredTarget) ?? MISSION_TARGET_OPTIONS[0];
    setSelectedDeployableTab(nextTab.id);
    setMissionDraft((current) => ({
      ...current,
      targetSystem: option.value,
      objective: nextTab.objective,
      riskLevel: option.value === "safety" ? "high" : option.value === "ledger" ? "medium" : "medium"
    }));
    setActionMessage(`${nextTab.label} deployable lane loaded into the mission composer.`);
  };

  const getNode = (id: string) => nodes.find((node) => node.id === id);

  const policyLines = primaryMission
    ? [
        `profile:${primaryMission.governanceProfile}`,
        `domain:${primaryMission.targetSystem}`,
        `risk:${primaryMission.riskLevel}`,
        `authorities:${primaryMission.requiredAuthorities.join(",") || "mission.command"}`,
        `tools:${primaryMission.requiredTools.join(",") || "shell,editor,ledger"}`,
        `success:${primaryMission.successMetrics[0] ?? "mission completes without governance violations"}`
      ]
    : [
        "profile:supervised-build",
        "domain:workspace",
        "risk:medium",
        "authorities:mission.command",
        "tools:shell,editor,ledger",
        "success:mission completes without governance violations"
      ];

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 rounded-2xl border border-cyan-500/20 bg-slate-900/70 p-5 shadow-2xl lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-cyan-400">Aristotle Autonomous Governance Console</div>
            <h1 className="mt-2 text-3xl font-semibold">Governance OS Operator Surface</h1>
            <p className="mt-2 text-sm text-slate-400">
              The preserved operator surface is now reading live runtime state from the gateway, ledger, governance mesh, and Agent OS mission plane.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-right text-sm lg:min-w-[360px]">
            <div className="rounded-xl border border-cyan-500/20 bg-slate-950/70 p-3">
              <div className="text-xs uppercase tracking-widest text-slate-500">Runtime</div>
              <div className="mt-2 font-medium text-slate-100">
                {isLoading ? "Connecting" : error ? "Link degraded" : "Live control plane"}
              </div>
              <div className="mt-1 text-xs text-slate-400">
                {snapshot ? `Updated ${formatTimestamp(snapshot.osState.generatedAt)}` : "Awaiting first gateway snapshot"}
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              <div className="text-xs uppercase tracking-widest text-slate-500">Status</div>
              <div
                className={cn(
                  "mt-2 inline-flex items-center rounded-full border px-3 py-1 text-sm",
                  killSwitch
                    ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                    : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                )}
              >
                {killSwitch ? "Kill Switch Engaged" : "Governed execution available"}
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              <div className="text-xs uppercase tracking-widest text-slate-500">Missions</div>
              <div className="mt-2 font-medium text-slate-100">{snapshot?.osState.posture.activeMissions ?? 0} active</div>
              <div className="mt-1 text-xs text-slate-400">{snapshot?.osState.posture.blockedMissions ?? 0} blocked or halted</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              <div className="text-xs uppercase tracking-widest text-slate-500">Agents</div>
              <div className="mt-2 font-medium text-slate-100">{snapshot?.osState.posture.readyAgents ?? 0} ready</div>
              <div className="mt-1 text-xs text-slate-400">{snapshot?.osState.posture.leasedTools ?? 0} leased tools</div>
            </div>
          </div>
        </header>

        <section className="rounded-2xl border border-cyan-500/20 bg-[linear-gradient(135deg,rgba(8,47,73,0.7),rgba(15,23,42,0.92),rgba(30,41,59,0.88))] p-5 shadow-2xl">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="text-xs uppercase tracking-[0.28em] text-cyan-300">Mission Command Deck</div>
              {(snapshot?.osState.missions.length ?? 0) > 1 && (
                <div className="mt-3 max-w-md">
                  <label className="mb-1 block text-xs uppercase tracking-widest text-slate-500">Mission Focus</label>
                  <select
                    value={primaryMission?.id ?? ""}
                    onChange={(event) => setSelectedMissionId(event.target.value || null)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-slate-100"
                  >
                    {(snapshot?.osState.missions ?? []).map((mission) => (
                      <option key={mission.id} value={mission.id}>
                        {mission.title} | {mission.status} | {mission.priority}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="mt-2 text-2xl font-semibold text-slate-50">
                {primaryMission ? primaryMission.title : "No primary mission locked"}
              </div>
              <div className="mt-2 text-sm text-slate-300">
                {primaryMission
                  ? `${primaryMission.objective} This mission is ${primaryMission.status}, governed by ${primaryMission.governanceProfile}, and targeted at ${primaryMission.targetSystem}.${focusedTask ? ` Live governed focus: ${focusedTask.title} in ${formatTaskPhase(focusedTask.coordination?.phase)} phase with ${focusedCommitPosture} commit posture.` : ""}`
                  : "Standby posture. Create a governed mission to engage the runtime."}
              </div>
              <div className="mt-4">
                <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Deployable Surfaces</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {deployableTabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setSelectedDeployableTab(tab.id)}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-xs uppercase tracking-wide transition",
                        activeDeployableTab.id === tab.id
                          ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-100"
                          : "border-slate-700 bg-slate-950/80 text-slate-400 hover:border-slate-500 hover:text-slate-200"
                      )}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <div className="mt-3 rounded-2xl border border-slate-700 bg-slate-950/70 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="max-w-2xl">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-medium text-slate-100">{activeDeployableTab.label}</div>
                        <span
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wide",
                            deployableAssurancePosture === "insurable" &&
                              "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
                            deployableAssurancePosture === "conditional" &&
                              "border-amber-500/30 bg-amber-500/10 text-amber-200",
                            deployableAssurancePosture === "contested" &&
                              "border-rose-500/30 bg-rose-500/10 text-rose-300",
                            deployableAssurancePosture === "standby" &&
                              "border-slate-700 bg-slate-800/80 text-slate-300"
                          )}
                        >
                          {deployableAssurancePosture}
                        </span>
                      </div>
                      <div className="mt-2 text-sm text-slate-300">{activeDeployableTab.objective}</div>
                      <div className="mt-3 grid gap-2 text-xs text-slate-400 md:grid-cols-2">
                        <div>Core lane {activeDeployableTab.preferredTarget}</div>
                        <div>Authority lane {activeDeployableTab.authorityLane}</div>
                        <div>Actuation boundary {activeDeployableTab.actuationBoundary}</div>
                        <div>Assurance focus {activeDeployableTab.assuranceFocus}</div>
                      </div>
                    </div>
                    <div className="min-w-[240px] rounded-xl border border-slate-800 bg-slate-900/70 p-3 text-xs text-slate-300">
                      <div className="font-medium text-slate-100">Deployable Readout</div>
                      <div className="mt-2 space-y-1">
                        <div>{deployableMissionCount} mission lanes active in this surface</div>
                        <div>{deployableBlockedCount} blocked tasks under this assurance frame</div>
                        <div>{deployableAutonomyCount} autonomy attestations recorded</div>
                        <div>{deployableFinalityCount} finality artifacts committed</div>
                        <div>{deployableHaltCount} active sovereign halts touching this surface</div>
                      </div>
                      <div className="mt-3 text-[11px] text-slate-500">{deployableAssuranceSummary}</div>
                      <button
                        type="button"
                        onClick={() => handleLoadDeployablePreset(activeDeployableTab.id)}
                        className="mt-3 w-full rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-100"
                      >
                        LOAD INTO MISSION COMPOSER
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <div className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-cyan-100">
                  Active execution {runningTaskCount}
                </div>
                <div className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-emerald-100">
                  Admissible now {readyTaskCount}
                </div>
                <div className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-amber-100">
                  Awaiting release {waitingTaskCount}
                </div>
                <div className="rounded-full border border-rose-400/30 bg-rose-400/10 px-3 py-1 text-rose-100">
                  Governance blocked {blockedTaskCount}
                </div>
                <div className="rounded-full border border-slate-500/30 bg-slate-800/70 px-3 py-1 text-slate-200">
                  Finalized {completedTaskCount}
                </div>
              </div>
            </div>

            <div className="grid min-w-[280px] grid-cols-1 gap-3 sm:grid-cols-2 lg:w-[520px]">
              <div className="rounded-xl border border-slate-700 bg-slate-950/70 p-4">
                <div className="text-xs uppercase tracking-widest text-slate-500">Next Admissible Task</div>
                <div className="mt-2 font-medium text-slate-100">{nextReadyTask?.title ?? "No release-ready task"}</div>
                <div className="mt-1 text-xs text-slate-400">
                  {nextReadyTask
                    ? `${formatTaskPhase(nextReadyTask.coordination?.phase)} phase on ${nextReadyTask.assignedAgentId}`
                    : "Waiting on release conditions or active execution."}
                </div>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-950/70 p-4">
                <div className="text-xs uppercase tracking-widest text-slate-500">Latest Release Event</div>
                <div className="mt-2 font-medium text-slate-100">
                  {latestReleaseEvent?.eventKind ?? "No release event recorded"}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  {latestReleaseEvent ? formatTimestamp(latestReleaseEvent.timestamp) : "Release events appear when completion unlocks downstream work."}
                </div>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-950/70 p-4">
                <div className="text-xs uppercase tracking-widest text-slate-500">Governed Commit Posture</div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="font-medium text-slate-100">{focusedTask?.title ?? "No focused task"}</div>
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wide",
                      focusedCommitPosture === "admissible" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
                      focusedCommitPosture === "blocked" && "border-rose-500/30 bg-rose-500/10 text-rose-300",
                      focusedCommitPosture === "evaluating" && "border-amber-500/30 bg-amber-500/10 text-amber-200",
                      focusedCommitPosture === "halted" && "border-rose-500/30 bg-rose-500/10 text-rose-300",
                      focusedCommitPosture === "standby" && "border-slate-700 bg-slate-800/80 text-slate-300"
                    )}
                  >
                    {focusedCommitPosture}
                  </span>
                </div>
                <div className="mt-2 text-xs text-slate-400">
                  {focusedTask
                    ? `${formatTaskPhase(focusedTask.coordination?.phase)} phase | ${focusedCommitRefs} authority refs | witness ${focusedTask.governance?.witnessStatus ?? "pending"}${focusedAuthorityRoute ? ` | route ${focusedAuthorityRoute.mode} | continuity ${focusedAuthorityRoute.continuity}` : ""}`
                    : "Select a governed task to inspect its live commit posture."}
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  Identity posture {focusedIdentitySummary}
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  Blockers {focusedBlockingSummary}
                </div>
                {focusedKillScope && (
                  <div className="mt-2 rounded-lg border border-rose-500/20 bg-rose-500/10 p-2 text-xs text-rose-100">
                    Sovereign halt posture {describeKillScope(focusedKillScope.scope, focusedKillScope.scopeRef)}
                  </div>
                )}
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-950/70 p-4">
                <div className="text-xs uppercase tracking-widest text-slate-500">Assurance Posture</div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="font-medium text-slate-100">{focusedTask?.title ?? "No focused task"}</div>
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wide",
                      focusedAssurancePosture === "insurable" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
                      focusedAssurancePosture === "conditional" && "border-amber-500/30 bg-amber-500/10 text-amber-200",
                      focusedAssurancePosture === "non-insurable" && "border-rose-500/30 bg-rose-500/10 text-rose-300",
                      focusedAssurancePosture === "standby" && "border-slate-700 bg-slate-800/80 text-slate-300"
                    )}
                  >
                    {focusedAssurancePosture}
                  </span>
                </div>
                <div className="mt-2 text-xs text-slate-400">
                  {focusedTask
                    ? `Agent ${focusedAgentVerification} | Device ${focusedDeviceVerification} | Witness ${focusedTask.governance?.witnessStatus ?? "pending"}`
                    : "Select a governed task to inspect verification and assurance posture."}
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  {focusedTask
                    ? `Identity refs ${compactId(focusedTask.governance?.agentIdentityRef)} | ${compactId(focusedTask.governance?.deviceIdentityRef)}`
                    : "Immutable identity attestations will appear here once a task is governed."}
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  {focusedTask
                    ? `Autonomy attestation ${compactId(focusedAutonomyArtifact?.id)} | ${focusedAutonomySummary}`
                    : "Autonomy attestation will appear here when governed self-progression occurs."}
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  Enterprise report {snapshot?.assuranceReport.systemPosture ?? "conditional"} | mission{" "}
                  {primaryMissionAssurance?.assurancePosture ?? "conditional"}
                </div>
                <div className="mt-2 space-y-1 text-[11px] text-slate-500">
                  {(primaryMissionAssurance?.reasons ?? []).length > 0 ? (
                    primaryMissionAssurance?.reasons.slice(0, 2).map((reason) => (
                      <div key={reason}>• {reason}</div>
                    ))
                  ) : (
                    <div>• Enterprise assurance reasons will appear here when the selected mission accumulates governed evidence.</div>
                  )}
                </div>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-950/70 p-4">
                <div className="text-xs uppercase tracking-widest text-slate-500">Autonomy Control</div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="font-medium text-slate-100">Governed continuity loop</div>
                  <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[11px] uppercase tracking-wide text-cyan-200">
                    {autonomyTickSeconds ? `${autonomyTickSeconds}s cadence` : "runtime cadence unavailable"}
                  </span>
                </div>
                <div className="mt-2 text-xs text-slate-400">
                  {latestAutonomyEvent
                    ? `${latestAutonomyEvent.eventKind} at ${formatTimestamp(latestAutonomyEvent.timestamp)}`
                    : "No autonomous governed continuity event recorded for this mission yet."}
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  {focusedTask
                    ? `Focused autonomy assurance ${focusedAutonomySummary}`
                    : "Focus a governed task to inspect autonomy assurance artifacts."}
                </div>
                <div className="mt-3">
                  <button
                    onClick={() => void handleAutonomyTick()}
                    disabled={isSubmittingAction}
                    className="rounded-lg bg-cyan-700 px-3 py-2 text-xs font-medium text-white hover:bg-cyan-600 disabled:opacity-40"
                  >
                    TRIGGER AUTONOMY TICK
                  </button>
                </div>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-950/70 p-4">
                <div className="text-xs uppercase tracking-widest text-slate-500">Deployment Posture</div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="font-medium text-slate-100">
                    {snapshot?.deploymentPosture.mode ?? "development"} deployment
                  </div>
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wide",
                      snapshot?.deploymentPosture.preflight.ok
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                        : "border-rose-500/30 bg-rose-500/10 text-rose-300"
                    )}
                  >
                    {snapshot?.deploymentPosture.preflight.ok ? "deployable" : "attention"}
                  </span>
                </div>
                <div className="mt-2 text-xs text-slate-400">
                  auth {snapshot?.deploymentPosture.operatorAuthEnabled ? "enabled" : "open"} | rbac{" "}
                  {snapshot?.deploymentPosture.roleEnforcementEnabled ? "enforced" : "permissive"} | discovery{" "}
                  {snapshot?.deploymentPosture.serviceDiscoveryMode ?? "unknown"}
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  default role {snapshot?.deploymentPosture.defaultRole ?? "operator"} | mutate{" "}
                  {(snapshot?.deploymentPosture.mutationRoles ?? []).join(", ") || "operator,admin"}
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  durable state {snapshot?.deploymentPosture.durableStateConfigured ? "configured" : "missing"}
                  {snapshot?.deploymentPosture.insecureProductionOverride ? " | insecure override active" : ""}
                </div>
                <div className="mt-2 space-y-1 text-[11px] text-slate-500">
                  {(snapshot?.deploymentPosture.preflight.checks ?? []).slice(0, 3).map((check) => (
                    <div key={check.name}>
                      • {check.name}: {check.status} | {check.detail}
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-950/70 p-4 sm:col-span-2">
                <div className="text-xs uppercase tracking-widest text-slate-500">Enterprise Assurance Report</div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="font-medium text-slate-100">System posture</div>
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wide",
                      snapshot?.assuranceReport.systemPosture === "insurable" &&
                        "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
                      snapshot?.assuranceReport.systemPosture === "conditional" &&
                        "border-amber-500/30 bg-amber-500/10 text-amber-200",
                      snapshot?.assuranceReport.systemPosture === "halted" &&
                        "border-rose-500/30 bg-rose-500/10 text-rose-300"
                    )}
                  >
                    {snapshot?.assuranceReport.systemPosture ?? "conditional"}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                  <div>
                    {latestAssuranceArtifact
                      ? `Latest assurance attestation ${compactId(latestAssuranceArtifact.id)} at ${formatTimestamp(latestAssuranceArtifact.timestamp)}`
                      : "No immutable assurance attestation committed yet."}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void handleAttestAssurance("mission")}
                      disabled={isSubmittingAction || !primaryMission}
                      className="rounded-lg bg-emerald-700 px-3 py-2 text-[11px] font-medium text-white hover:bg-emerald-600 disabled:opacity-40"
                    >
                      ATTEST MISSION
                    </button>
                    <button
                      onClick={() => void handleAttestAssurance("system")}
                      disabled={isSubmittingAction}
                      className="rounded-lg bg-cyan-700 px-3 py-2 text-[11px] font-medium text-white hover:bg-cyan-600 disabled:opacity-40"
                    >
                      ATTEST SYSTEM
                    </button>
                  </div>
                </div>
                <div className="mt-2 space-y-1 text-xs text-slate-400">
                  {(snapshot?.assuranceReport.systemReasons ?? []).length > 0 ? (
                    (snapshot?.assuranceReport.systemReasons ?? []).slice(0, 3).map((reason) => (
                      <div key={reason}>• {reason}</div>
                    ))
                  ) : (
                    <div>• System assurance reasons will appear once governed missions accumulate evidence.</div>
                  )}
                </div>
                <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-400">
                  <div className="uppercase tracking-widest text-slate-500">Recent Assurance History</div>
                  <div className="mt-2 space-y-2">
                    {recentAssuranceArtifacts.length > 0 ? (
                      recentAssuranceArtifacts.map((artifact) => (
                        <div key={artifact.id} className="rounded-md border border-slate-800 bg-slate-950/70 p-2">
                          <div className="flex items-center justify-between text-slate-300">
                            <div>
                              {artifact.reportScope === "mission" ? "Mission assurance" : "System assurance"}
                              {artifact.assurancePosture ? ` | ${artifact.assurancePosture}` : artifact.systemPosture ? ` | ${artifact.systemPosture}` : ""}
                            </div>
                            <div className="text-[11px] text-slate-500">{formatTimestamp(artifact.timestamp)}</div>
                          </div>
                          {artifact.summary && <div className="mt-1 text-[11px] text-slate-500">{artifact.summary}</div>}
                        </div>
                      ))
                    ) : (
                      <div className="text-slate-500">No assurance attestations recorded yet.</div>
                    )}
                  </div>
                </div>
                <div className="mt-2 grid gap-2 text-xs md:grid-cols-2">
                  {(snapshot?.assuranceReport.missions ?? []).slice(0, 4).map((mission) => (
                    <div key={mission.missionId} className="rounded-lg border border-slate-800 bg-slate-900/80 p-3 text-slate-300">
                      <div className="flex items-center justify-between">
                        <div className="font-medium text-slate-100">{mission.title}</div>
                        <span
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide",
                            mission.assurancePosture === "insurable" &&
                              "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
                            mission.assurancePosture === "conditional" &&
                              "border-amber-500/30 bg-amber-500/10 text-amber-200",
                            (mission.assurancePosture === "blocked" || mission.assurancePosture === "halted") &&
                              "border-rose-500/30 bg-rose-500/10 text-rose-300"
                          )}
                        >
                          {mission.assurancePosture}
                        </span>
                      </div>
                      <div className="mt-1 text-slate-500">
                        {mission.targetSystem} | status {mission.status} | blocked {mission.blockedTasks}
                      </div>
                      <div className="mt-1 text-slate-500">
                        autonomy {mission.autonomyAttestations} | finality {mission.finalityCertificates}
                      </div>
                      <div className="mt-1 text-slate-500">
                        agent {mission.agentVerified ? "verified" : "unverified"} | device {mission.deviceVerified ? "verified" : "unverified"}
                        {mission.activeKillSwitch ? " | sovereign halt active" : ""}
                      </div>
                      {mission.activeKillScopes.length > 0 && (
                        <div className="mt-1 text-slate-500">
                          scopes {mission.activeKillScopes.map((scope) => describeKillScope(scope.scope, scope.scopeRef)).join(" | ")}
                        </div>
                      )}
                      <div className="mt-2 space-y-1 text-[11px] text-slate-400">
                        {mission.reasons.slice(0, 3).map((reason) => (
                          <div key={reason}>• {reason}</div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-950/70 p-4 sm:col-span-2">
                <div className="text-xs uppercase tracking-widest text-slate-500">Operator Quick Actions</div>
                <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
                  {(["progress", "execute", "complete", "halt"] as const).map((action) => (
                    <div key={action} className="space-y-1">
                      <button
                        onClick={() => void handleAdvanceMission(action)}
                        disabled={isSubmittingAction || !primaryMission || !missionActionReadiness[action].enabled}
                        className={cn(
                          "w-full rounded-lg px-3 py-2 text-xs font-medium text-white disabled:opacity-40",
                          action === "halt"
                            ? "bg-rose-600 hover:bg-rose-500"
                            : action === "complete"
                              ? "bg-emerald-600 hover:bg-emerald-500"
                              : "bg-cyan-700 hover:bg-cyan-600"
                        )}
                      >
                        {action.toUpperCase()}
                      </button>
                      <div className="px-1 text-[11px] text-slate-500">{missionActionReadiness[action].reason}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-12 gap-4">
          <section className="col-span-12 rounded-2xl border border-cyan-500/20 bg-slate-900/70 p-5 shadow-xl lg:col-span-8">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-medium">Governance Mesh Visualization</h2>
                <span className="text-xs text-slate-400">simulation-engine + agent-os + evidence-ledger</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <div className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-emerald-300">Active Links {stats.activeLinks}</div>
                <div className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-200">Degraded {stats.degradedLinks}</div>
                <div className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-cyan-200">Nodes {stats.activeNodes}</div>
              </div>
            </div>

            <div className="relative h-80 overflow-hidden rounded-xl border border-cyan-500/20 bg-slate-950/80">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(34,211,238,0.12),transparent_55%)]" />
              <div
                className="absolute inset-0 opacity-20"
                style={{
                  backgroundImage:
                    "linear-gradient(rgba(56,189,248,0.16) 1px, transparent 1px), linear-gradient(90deg, rgba(56,189,248,0.16) 1px, transparent 1px)",
                  backgroundSize: "32px 32px"
                }}
              />

              <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
                {links.map((link) => {
                  const from = getNode(link.from);
                  const to = getNode(link.to);
                  if (!from || !to) return null;
                  const isSelected = selectedNodeId === from.id || selectedNodeId === to.id;
                  const stroke =
                    link.status === "active"
                      ? "rgba(34,211,238,0.95)"
                      : link.status === "degraded"
                        ? "rgba(251,191,36,0.9)"
                        : "rgba(71,85,105,0.55)";
                  const strokeWidth = isSelected ? 1.4 : 0.9;
                  const dash = link.status === "standby" ? "2.5 2.5" : link.status === "degraded" ? "4 2" : "0";
                  return (
                    <g key={link.id}>
                      <line
                        x1={from.x}
                        y1={from.y}
                        x2={to.x}
                        y2={to.y}
                        stroke={stroke}
                        strokeWidth={strokeWidth}
                        strokeDasharray={dash}
                        opacity={isSelected ? 1 : 0.8}
                      />
                      {link.status === "active" && !killSwitch && (
                        <circle r="1.2" fill="rgba(103,232,249,0.95)">
                          <animateMotion
                            dur={`${Math.max(2.4, 7 - link.traffic / 18)}s`}
                            repeatCount="indefinite"
                            path={`M ${from.x} ${from.y} L ${to.x} ${to.y}`}
                          />
                        </circle>
                      )}
                    </g>
                  );
                })}

                {nodes.map((node, index) => {
                  const fill =
                    node.integrity === "nominal"
                      ? "rgba(16,185,129,0.95)"
                      : node.integrity === "degraded"
                        ? "rgba(245,158,11,0.95)"
                        : "rgba(244,63,94,0.95)";
                  const glow = node.active && !killSwitch ? fill : "rgba(71,85,105,0.8)";
                  const selected = node.id === selectedNodeId;
                  return (
                    <g key={node.id} onClick={() => setSelectedNodeId(node.id)} className="cursor-pointer">
                      {node.active && !killSwitch && (
                        <circle cx={node.x} cy={node.y} r="4.5" fill="none" stroke={glow} strokeWidth="0.35" opacity="0.45">
                          <animate attributeName="r" values="3.8;6.2;3.8" dur={`${2 + index * 0.22}s`} repeatCount="indefinite" />
                          <animate attributeName="opacity" values="0.5;0.12;0.5" dur={`${2 + index * 0.22}s`} repeatCount="indefinite" />
                        </circle>
                      )}
                      <circle
                        cx={node.x}
                        cy={node.y}
                        r={selected ? 2.55 : 2.1}
                        fill={killSwitch ? "rgba(148,163,184,0.8)" : fill}
                        stroke={selected ? "rgba(255,255,255,0.95)" : "rgba(15,23,42,0.9)"}
                        strokeWidth={selected ? 0.45 : 0.25}
                      />
                      <text x={node.x + 2.8} y={node.y - 2.2} fill="rgba(226,232,240,0.95)" fontSize="3">
                        {node.label}
                      </text>
                      <text x={node.x + 2.8} y={node.y + 1.8} fill="rgba(100,116,139,0.95)" fontSize="2.4">
                        {node.role}
                      </text>
                    </g>
                  );
                })}
              </svg>

              <div className="absolute left-4 top-4 rounded-xl border border-slate-800 bg-slate-950/85 px-3 py-2 text-xs text-slate-300">
                <div className="font-medium text-slate-100">Active Mesh State</div>
                <div className="mt-1 text-slate-400">
                  Tick {snapshot?.mesh.tick ?? animatedTick} | {snapshot?.mesh.missionTimeline.length ?? 0} live mission timeline entries
                </div>
              </div>

              <div className="absolute bottom-4 right-4 w-64 rounded-xl border border-slate-800 bg-slate-950/88 p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Selected Node</span>
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5",
                      selectedNode.integrity === "nominal" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
                      selectedNode.integrity === "degraded" && "border-amber-500/30 bg-amber-500/10 text-amber-200",
                      selectedNode.integrity === "contested" && "border-rose-500/30 bg-rose-500/10 text-rose-300"
                    )}
                  >
                    {killSwitch ? "halted" : selectedNode.integrity}
                  </span>
                </div>
                <div className="mt-2 font-medium text-slate-100">{selectedNode.label}</div>
                <div className="mt-1 text-slate-400">{selectedNode.role}</div>
                <div className="mt-3 space-y-2">
                  <div>
                    <div className="flex items-center justify-between text-slate-400">
                      <span>Latency</span>
                      <span>{killSwitch ? "--" : `${selectedNode.latency}ms`}</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-800">
                      <div className="h-full rounded-full bg-cyan-400" style={{ width: `${Math.min(100, selectedNode.latency * 2.2)}%` }} />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-slate-400">
                      <span>Load</span>
                      <span>{killSwitch ? "0%" : `${selectedNode.load}%`}</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-800">
                      <div className="h-full rounded-full bg-emerald-400" style={{ width: `${killSwitch ? 0 : selectedNode.load}%` }} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="col-span-12 rounded-2xl border border-rose-500/20 bg-slate-900/70 p-5 shadow-xl lg:col-span-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-medium">Kill Switch</h2>
              <span className="text-xs text-slate-400">kernel + execution-gate</span>
            </div>
            <div className="space-y-3">
                <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4">
                  <div className="text-sm text-rose-200">Emergency interrupt supremacy enforced across the execution mesh.</div>
                  <div className="mt-2 text-xs text-rose-100/70">
                    {selectedKillActive
                      ? "The selected sovereign scope is halted until the operator resets execution."
                      : "Execution remains available under governed admission."}
                  </div>
                </div>
              {focusedTask && (
                  <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-xs text-slate-300">
                  <div className="text-slate-500">Current governed focus</div>
                  <div className="mt-1 text-slate-100">{focusedTask.title}</div>
                  <div className="mt-1 text-slate-500">
                    {formatTaskPhase(focusedTask.coordination?.phase)} phase | {focusedCommitPosture} | {compactId(focusedTask.id)}
                  </div>
                  <div className="mt-1 text-slate-500">
                    {killSwitch
                      ? "This halt is currently suppressing downstream actuation for the focused governed thread and the wider mesh."
                      : "If engaged, sovereign halt will override this focused governed thread and the wider mesh."}
                  </div>
                  {focusedKillScope && (
                    <div className="mt-2 text-amber-200">
                      Active sovereign scope {focusedKillScope.scope}
                      {focusedKillScope.scopeRef ? ` | ${focusedKillScope.scopeRef}` : ""}
                    </div>
                  )}
                  </div>
              )}
              <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-xs text-slate-300">
                <div>
                  <div className="text-slate-500">Sovereign halt scope</div>
                  <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <select
                      value={killSwitchDraft.scope}
                      onChange={(event) =>
                        setKillSwitchDraft((current) => ({
                          ...current,
                          scope: event.target.value as "global" | "mission" | "domain" | "agent" | "device",
                          scopeRef:
                            event.target.value === "global"
                              ? ""
                              : event.target.value === "mission"
                                ? primaryMission?.id ?? current.scopeRef
                                : event.target.value === "domain"
                                  ? focusedTask?.governance?.route?.domain ?? primaryMission?.targetSystem ?? current.scopeRef
                                  : event.target.value === "agent"
                                    ? focusedTask?.assignedAgentId ?? current.scopeRef
                                    : focusedTask?.execution?.workspaceId ?? primaryMission?.workspaceId ?? current.scopeRef
                        }))
                      }
                      className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                    >
                      <option value="global">global</option>
                      <option value="mission">mission</option>
                      <option value="domain">domain</option>
                      <option value="agent">agent</option>
                      <option value="device">device</option>
                    </select>
                    <input
                      value={killSwitchDraft.scope === "global" ? "" : killSwitchDraft.scopeRef}
                      onChange={(event) =>
                        setKillSwitchDraft((current) => ({
                          ...current,
                          scopeRef: event.target.value
                        }))
                      }
                      disabled={killSwitchDraft.scope === "global"}
                      placeholder={killSwitchDraft.scope === "global" ? "not required" : derivedKillScopeRef || "scope reference"}
                      className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 disabled:opacity-60"
                    />
                  </div>
                </div>
                <div className="text-slate-500">
                  {killSwitchDraft.scope === "global"
                    ? "Global halt suppresses all downstream governed actuation."
                    : `Scoped halt target ${killSwitchDraft.scopeRef || derivedKillScopeRef || "unresolved"} will suppress only that governed ${killSwitchDraft.scope}.`}
                </div>
              </div>
              <button
                onClick={() => void handleKillSwitchToggle()}
                disabled={isTogglingKillSwitch}
                className={cn(
                  "w-full rounded-xl px-4 py-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                  selectedKillActive ? "bg-slate-700 text-slate-100 hover:bg-slate-600" : "bg-rose-600 text-white hover:bg-rose-500"
                )}
              >
                {isTogglingKillSwitch
                  ? "UPDATING EXECUTION POSTURE"
                  : selectedKillActive
                    ? "RESET SELECTED HALT"
                    : killSwitchDraft.scope === "global"
                      ? "HALT ALL DOWNSTREAM ACTUATION"
                      : `HALT ${killSwitchDraft.scope.toUpperCase()} ACTUATION`}
              </button>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
                  <div className="text-slate-500">Ready agents</div>
                  <div className="mt-1 font-medium text-slate-100">{snapshot?.osState.posture.readyAgents ?? 0}</div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
                  <div className="text-slate-500">Leased tools</div>
                  <div className="mt-1 font-medium text-slate-100">{snapshot?.osState.posture.leasedTools ?? 0}</div>
                </div>
              </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-xs text-slate-300">
                  <div className="text-slate-500">Active halt scopes</div>
                  <div className="mt-1 font-medium text-slate-100">
                    {activeKillScopes.length > 0
                    ? activeKillScopes.map((scope) => describeKillScope(scope.scope, scope.scopeRef)).join(" | ")
                    : "global governance open"}
                  </div>
                </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-xs text-slate-300">
                <div className="text-slate-500">Recent halt events</div>
                <div className="mt-2 space-y-2">
                  {killSwitchEvents.length > 0 ? (
                    killSwitchEvents.map((event) => {
                      const payload = event.payload as {
                        state?: string;
                        scope?: string;
                        scopeRef?: string;
                        reason?: string;
                      };
                      return (
                        <div key={event.id} className="rounded-lg border border-slate-800 bg-slate-900/80 p-2">
                          <div className="text-slate-100">
                            {(payload.state ?? "unknown").toUpperCase()} {describeKillScope(payload.scope, payload.scopeRef)}
                          </div>
                          <div className="mt-1 text-slate-500">{payload.reason ?? "no reason recorded"}</div>
                          <div className="mt-1 text-slate-500">{formatTimestamp(event.timestamp)}</div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-slate-500">No sovereign halt events recorded yet.</div>
                  )}
                </div>
              </div>
              {error && <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-100">{error}</div>}
            </div>
          </section>
          <section className="col-span-12 rounded-2xl border border-slate-700 bg-slate-900/70 p-5 shadow-xl lg:col-span-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-medium">Node Telemetry</h2>
              <span className="text-xs text-slate-400">simulation-engine</span>
            </div>
            <div className="space-y-3">
              {nodes.map((node) => (
                <button
                  key={node.id}
                  onClick={() => setSelectedNodeId(node.id)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-xl border bg-slate-950/80 p-3 text-left",
                    selectedNodeId === node.id ? "border-cyan-500/40" : "border-slate-800"
                  )}
                >
                  <div>
                    <div className="text-sm font-medium">{node.label}</div>
                    <div className="text-xs text-slate-500">
                      Latency {killSwitch ? "--" : `${node.latency}ms`} | {killSwitch ? "Execution halted" : `Integrity ${node.integrity}`}
                    </div>
                  </div>
                  <div
                    className={cn(
                      "h-2 w-2 rounded-full",
                      killSwitch ? "bg-slate-500" : node.integrity === "nominal" ? "bg-emerald-400" : node.integrity === "degraded" ? "bg-amber-400" : "bg-rose-400"
                    )}
                  />
                </button>
              ))}
            </div>
          </section>

          <section className="col-span-12 rounded-2xl border border-slate-700 bg-slate-900/70 p-5 shadow-xl lg:col-span-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-medium">Policy Compiler</h2>
              <span className="text-xs text-slate-400">policy-compiler</span>
            </div>
            <div className="h-56 rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-sm text-slate-400">
              {policyLines.map((line) => (
                <div key={line}>{line}</div>
              ))}
              {primaryMission && (
                <div className="mt-4 border-t border-slate-800 pt-3 text-xs text-slate-500">
                  Primary mission {primaryMission.title} is {primaryMission.status}.
                </div>
              )}
            </div>
          </section>

          <section className="col-span-12 rounded-2xl border border-slate-700 bg-slate-900/70 p-5 shadow-xl lg:col-span-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-medium">Meta-Authority Registry</h2>
              <span className="text-xs text-slate-400">meta-authority-registry</span>
            </div>
            <div className="space-y-3 text-sm">
              <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
                {(latestMetaAuthority?.subject ?? "coalition.core")} to {(primaryMission?.requiredAuthorities[0] ?? "mission.command")} to {(focusedEnvelopeArtifact?.subject ?? "edge.actor.alpha")}
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
                Delegation class: {latestMetaAuthority?.delegationClass ?? "root"}
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
                Permitted domains: {(latestMetaAuthority?.domains ?? ["mission", "safety", "logistics"]).join(", ")}
              </div>
            </div>
          </section>

          <section className="col-span-12 rounded-2xl border border-slate-700 bg-slate-900/70 p-5 shadow-xl lg:col-span-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-medium">Evidence Ledger Explorer</h2>
              <span className="text-xs text-slate-400">evidence-ledger</span>
            </div>
            <div className="space-y-3 text-sm">
              {primaryMission && (
                <div className="rounded-xl border border-cyan-500/20 bg-slate-950/80 p-4">
                  <div className="text-xs uppercase tracking-widest text-cyan-200">Mission Governance Feed</div>
                  {focusedTask && (
                    <div className="mt-2 text-xs text-slate-400">
                      Focused task {focusedTask.title} | {compactId(focusedTask.id)}
                    </div>
                  )}
                  <div className="mt-3 grid grid-cols-2 gap-3 text-xs lg:grid-cols-4">
                    <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3">
                      <div className="text-slate-500">Trace</div>
                      <div className="mt-1 font-medium text-slate-100">{compactId(primaryMission.id)}</div>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3">
                      <div className="text-slate-500">Release events</div>
                      <div className="mt-1 font-medium text-slate-100">
                        {governanceFeedEvents.filter((event) => event.eventKind === "agent-os.execution.task.released").length}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3">
                      <div className="text-slate-500">Dispatch events</div>
                      <div className="mt-1 font-medium text-slate-100">
                        {governanceFeedEvents.filter((event) => event.eventKind === "agent-os.execution.task.dispatched").length}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3">
                      <div className="text-slate-500">Completion events</div>
                      <div className="mt-1 font-medium text-slate-100">
                        {governanceFeedEvents.filter((event) => event.eventKind === "agent-os.execution.task.completed").length}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3">
                      <div className="text-slate-500">Sovereign halts</div>
                      <div className="mt-1 font-medium text-slate-100">{missionKillEvents.length}</div>
                    </div>
                  </div>
                  {missionKillEvents.length > 0 && (
                    <div className="mt-3 rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-100">
                      {missionKillEvents
                        .slice(-3)
                        .reverse()
                        .map((event) => {
                          const payload = event.payload as { scope?: string; scopeRef?: string; state?: string };
                          return `${(payload.state ?? "unknown").toUpperCase()} ${describeKillScope(payload.scope, payload.scopeRef)}`;
                        })
                        .join(" | ")}
                    </div>
                  )}
                </div>
              )}
              {governanceFeedArtifacts.length > 0 && (
                <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-3">
                  <div className="text-xs uppercase tracking-widest text-cyan-200">
                    {focusedTask ? "Focused Governance Artifacts" : "Indexed Governance Artifacts"}
                  </div>
                  <div className="mt-3 space-y-2">
                    {governanceFeedArtifacts.map((artifact) => (
                      <div key={artifact.id} className="rounded-lg border border-slate-800 bg-slate-950/80 p-3">
                        <div className="flex items-center justify-between">
                          <div className="font-medium text-slate-100">{artifact.artifactType}</div>
                          <div className="text-xs text-slate-500">{formatTimestamp(artifact.timestamp)}</div>
                        </div>
                      <div className="mt-1 text-xs text-slate-400">
                          {artifact.id}
                          {artifact.warrantId ? ` | warrant ${artifact.warrantId}` : ""}
                          {artifact.missionId ? ` | mission ${artifact.missionId}` : ""}
                          {artifact.subjectType ? ` | ${artifact.subjectType} ${artifact.subjectId ?? "unresolved"}` : ""}
                          {artifact.scope ? ` | ${artifact.scope}${artifact.scopeRef ? `:${artifact.scopeRef}` : ""}` : ""}
                          {artifact.autonomyMode ? ` | autonomy ${artifact.autonomyMode}` : ""}
                          {artifact.delegatedAuthorityAnchor ? ` | delegated ${artifact.delegatedAuthorityAnchor}` : ""}
                        </div>
                        {artifact.summary && <div className="mt-1 text-xs text-slate-500">{artifact.summary}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {governanceFeedEvents.length > 0 ? (
                governanceFeedEvents.slice(0, focusedTask ? 6 : 4).map((item) => (
                  <div key={item.id} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/80 p-3">
                    <div>
                      <div>{item.eventKind}</div>
                      <div className="mt-1 text-xs text-slate-500">{formatTimestamp(item.timestamp)}</div>
                    </div>
                    <span className="text-slate-500">{item.committed ? "committed" : "hypothetical"}</span>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-slate-500">
                  No ledger events have been recorded yet.
                </div>
              )}
            </div>
          </section>

          <section className="col-span-12 rounded-2xl border border-slate-700 bg-slate-900/70 p-5 shadow-xl lg:col-span-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-medium">Authority Envelope Viewer</h2>
              <span className="text-xs text-slate-400">governance-kernel</span>
            </div>
            <div className="space-y-3">
              <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/80 p-4 text-sm text-slate-300">
                <div>Envelope ID: {focusedEnvelopeArtifact?.id ?? "env-awaiting"}</div>
                <div>Issuer: {focusedEnvelopeArtifact?.issuer ?? primaryMission?.requiredAuthorities[0] ?? "mission.command"}</div>
                <div>Subject: {focusedEnvelopeArtifact?.subject ?? "edge.actor.alpha"}</div>
                <div>Domain: {focusedEnvelopeArtifact?.domain ?? "mission"}</div>
                <div>Action: {focusedEnvelopeArtifact?.action ?? "governed execution"}</div>
                <div className="text-emerald-300">
                  Verification: {focusedEnvelopeArtifact?.verification?.reason ?? focusedEnvelopeArtifact?.verification?.status ?? "awaiting validated meta-authority chain"}
                </div>
                {focusedAuthorityRoute && (
                  <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 p-3 text-xs text-cyan-100">
                    <div className="uppercase tracking-widest text-cyan-200">Authority Route</div>
                    <div className="mt-1">{focusedAuthorityRoute.selectedPath.join(" -> ")}</div>
                    <div className="mt-1 text-slate-400">
                      {focusedAuthorityRoute.mode} | continuity {focusedAuthorityRoute.continuity} | phase {focusedAuthorityRoute.phase} | domain {focusedAuthorityRoute.domain}
                    </div>
                    <div className="mt-1 text-slate-400">
                      Authority {focusedAuthorityRoute.delegatedAuthorityAnchor ?? focusedAuthorityRoute.authorityAnchor}
                      {focusedAuthorityRoute.alternateAuthorityAnchor
                        ? ` | alternate ${focusedAuthorityRoute.alternateAuthorityAnchor}`
                        : ""}
                    </div>
                    <div className="mt-1 text-slate-400">{focusedAuthorityRoute.failoverReasoning}</div>
                    <div className="mt-1 text-slate-400">{focusedAuthorityRoute.delegationReasoning}</div>
                    <div className="mt-1 text-slate-500">{focusedAuthorityRoute.continuityReasoning}</div>
                  </div>
                )}
              </div>
              <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-4">
                <div className="text-xs uppercase tracking-widest text-cyan-200">Live Commit Chain</div>
                {focusedTask ? (
                  <div className="mt-3 space-y-2 text-sm text-slate-300">
                    <div className="font-medium text-slate-100">{focusedTask.title}</div>
                    <div className="text-xs text-slate-400">
                      {formatTaskPhase(focusedTask.coordination?.phase)} phase | {focusedTask.status} | {focusedTask.assignedAgentId}
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3 text-xs text-slate-500">
                      <div>Policy compile {compactId(focusedTask.governance?.policyCompileId)}</div>
                      <div className="mt-1">Envelope {compactId(focusedEnvelopeArtifact?.id ?? focusedTask.governance?.envelopeId)}</div>
                      <div className="mt-1">Warrant {compactId(focusedWarrantArtifact?.id ?? focusedTask.governance?.warrantId)}</div>
                      <div className="mt-1">Commit decision {compactId(focusedDecisionArtifact?.id ?? focusedTask.governance?.commitDecisionId)}</div>
                      <div className="mt-1">Finality {compactId(focusedFinalityArtifact?.id ?? focusedTask.governance?.finalityCertificateId)}</div>
                      <div className="mt-1">Agent identity {compactId(focusedAgentIdentityArtifact?.id ?? focusedTask.governance?.agentIdentityRef)} | {focusedAgentVerification}</div>
                      <div className="mt-1">Device identity {compactId(focusedDeviceIdentityArtifact?.id ?? focusedTask.governance?.deviceIdentityRef)} | {focusedDeviceVerification}</div>
                      {focusedKillScope && <div className="mt-1">Sovereign halt {describeKillScope(focusedKillScope.scope, focusedKillScope.scopeRef)}</div>}
                      {focusedAuthorityRoute && <div className="mt-1">Route {focusedAuthorityRoute.selectedPath.join(" -> ")}</div>}
                      {focusedAuthorityRoute && (
                        <div className="mt-1">
                          Authority anchor {focusedAuthorityRoute.delegatedAuthorityAnchor ?? focusedAuthorityRoute.authorityAnchor}
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-slate-400">
                      {focusedTask.governance?.reasons.join(" ") || "Governance reasons will appear here once the task is evaluated."}
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/80 p-3 text-sm text-slate-500">
                    No active governed task is holding the commit chain yet.
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="col-span-12 rounded-2xl border border-indigo-500/20 bg-slate-900/70 p-5 shadow-xl lg:col-span-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-medium">Time Machine Replay Engine</h2>
              <span className="text-xs text-slate-400">ledger + simulation</span>
            </div>
            <div className="space-y-3">
              <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-4">
                <div className="text-sm text-slate-300">
                  Replay state tracks {snapshot?.ledger.committed.length ?? 0} committed events across {snapshot?.ledger.branches.length ?? 0} counterfactual branches.
                </div>
                <input
                  type="range"
                  className="mt-4 w-full"
                  min={0}
                  max={Math.max(1, snapshot?.mesh.tick ?? 1)}
                  value={Math.min(snapshot?.mesh.tick ?? 1, Math.max(1, snapshot?.mesh.tick ?? 1))}
                  readOnly
                />
                <div className="mt-3 text-xs text-slate-500">
                  Latest replay marker: {formatTimestamp(snapshot?.mesh.missionTimeline.at(-1)?.timestamp)}
                </div>
                {focusedTask && (
                  <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/80 p-3">
                    <div className="text-xs uppercase tracking-widest text-slate-400">Counterfactual Controls</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        onClick={() => void handleProjectCounterfactual("reroute")}
                        disabled={isProjectingCounterfactual}
                        className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100 disabled:opacity-50"
                      >
                        PROJECT REROUTE
                      </button>
                      <button
                        onClick={() => void handleProjectCounterfactual("halt")}
                        disabled={isProjectingCounterfactual}
                        className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100 disabled:opacity-50"
                      >
                        PROJECT HALT
                      </button>
                      <button
                        onClick={() => void handleProjectCounterfactual("agent-halt")}
                        disabled={isProjectingCounterfactual}
                        className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100 disabled:opacity-50"
                      >
                        PROJECT AGENT HALT
                      </button>
                      <button
                        onClick={() => void handleProjectCounterfactual("device-halt")}
                        disabled={isProjectingCounterfactual}
                        className="rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-2 text-xs text-fuchsia-100 disabled:opacity-50"
                      >
                        PROJECT DEVICE HALT
                      </button>
                    </div>
                    {counterfactualProjection && (
                      <div className="mt-3 rounded-lg border border-indigo-500/20 bg-indigo-500/10 p-3 text-xs text-indigo-100">
                        {(() => {
                          const branchArtifactCount = counterfactualArtifacts?.items.length ?? 0;
                          const projectedHaltArtifacts =
                            counterfactualArtifacts?.items.filter((artifact) => artifact.artifactType === "kill-switch-event") ?? [];
                          const projectedEnvelopeArtifacts =
                            counterfactualArtifacts?.items.filter((artifact) => artifact.artifactType === "authority-envelope") ?? [];
                          const projectedRecoveryPaths =
                            counterfactualProjection.projection.projectedRecoveryPaths ?? [];
                          const projectedBranchPosture = counterfactualProjection.projection.scenario.injectKillSwitch
                            ? "Projected sovereign interruption"
                            : "Projected authority reroute";
                          return (
                            <>
                        <div>
                          Branch {counterfactualProjection.branch.label} | {counterfactualProjection.projection.projectedOutcome}
                        </div>
                        <div className="mt-1 text-slate-400">
                          {counterfactualProjection.projection.scenario.injectKillSwitch
                            ? `Injected sovereign halt ${describeKillScope(
                                typeof counterfactualProjection.projection.scenario.scope === "string"
                                  ? counterfactualProjection.projection.scenario.scope
                                  : undefined,
                                typeof counterfactualProjection.projection.scenario.scopeRef === "string"
                                  ? counterfactualProjection.projection.scenario.scopeRef
                                  : undefined
                              )}`
                            : "Injected route degradation"}
                        </div>
                        <div className="mt-2 grid gap-2 md:grid-cols-3">
                          <div className="rounded-lg border border-indigo-500/20 bg-slate-950/70 p-2">
                            <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Branch Posture</div>
                            <div className="mt-1 text-indigo-100">{projectedBranchPosture}</div>
                          </div>
                          <div className="rounded-lg border border-indigo-500/20 bg-slate-950/70 p-2">
                            <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Authority Artifacts</div>
                            <div className="mt-1 text-indigo-100">{projectedEnvelopeArtifacts.length} envelope artifacts</div>
                          </div>
                          <div className="rounded-lg border border-indigo-500/20 bg-slate-950/70 p-2">
                            <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Sovereign Artifacts</div>
                            <div className="mt-1 text-indigo-100">
                              {projectedHaltArtifacts.length > 0
                                ? `${projectedHaltArtifacts.length} halt artifacts`
                                : "No projected halt artifacts"}
                            </div>
                          </div>
                        </div>
                        {counterfactualProjection.projection.projectedRoute && (
                          <div className="mt-2 rounded-lg border border-indigo-500/20 bg-slate-950/70 p-2 text-indigo-100">
                            <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
                              Active authority path at projected {" "}
                              {counterfactualProjection.projection.projectedOutcome === "halt" ? "interruption" : "reroute"}
                            </div>
                            <div>{counterfactualProjection.projection.projectedRoute.selectedPath.join(" -> ")}</div>
                            <div className="mt-1 text-slate-400">
                              {counterfactualProjection.projection.projectedRoute.mode} | {counterfactualProjection.projection.projectedRoute.failoverReasoning}
                            </div>
                          </div>
                        )}
                        <div className="mt-1 text-slate-400">
                          Hypothetical event {compactId(counterfactualProjection.hypothetical.id)}
                        </div>
                        {projectedRecoveryPaths.length > 0 && (
                          <div className="mt-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-2">
                            <div className="text-emerald-100">Remaining governed futures</div>
                            <div className="mt-1 space-y-1 text-slate-300">
                              {projectedRecoveryPaths.slice(0, 3).map((path) => (
                                <div key={`${path.mode}-${path.label}`} className="rounded-md border border-emerald-500/10 bg-slate-950/60 p-2">
                                  <div className="text-emerald-100">
                                    {path.label} | {path.mode}
                                    {path.scope ? ` | ${describeKillScope(path.scope as "global" | "mission" | "domain" | "agent" | "device", path.scopeRef)}` : ""}
                                  </div>
                                  <div className="mt-1 text-slate-400">{path.summary}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {counterfactualArtifacts && counterfactualArtifacts.items.length > 0 && (
                          <div className="mt-2 rounded-lg border border-indigo-500/20 bg-slate-950/70 p-2">
                            <div className="flex items-center justify-between gap-2 text-indigo-100">
                              <span>Branch artifacts</span>
                              <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{branchArtifactCount} indexed</span>
                            </div>
                            <div className="mt-1 text-slate-400">
                              {counterfactualArtifacts.items
                                .slice(0, 3)
                                .map((artifact) => `${artifact.artifactType} ${compactId(artifact.id)}`)
                                .join(" | ")}
                            </div>
                            {projectedHaltArtifacts.length > 0 && (
                              <div className="mt-2 rounded-lg border border-rose-500/20 bg-rose-500/10 p-2 text-rose-100">
                                Sovereign halt memory {projectedHaltArtifacts.map((artifact) => compactId(artifact.id)).join(" | ")}
                              </div>
                            )}
                          </div>
                        )}
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {focusedTask && (
                <FocusBanner
                  tone="cyan"
                  title={`Replay focus ${focusedTask.title} | ${formatTaskPhase(focusedTask.coordination?.phase)} phase`}
                  subtitle={`${focusedCommitPosture} | ${focusedCommitRefs} authority refs | witness ${focusedTask.governance?.witnessStatus ?? "pending"}${focusedKillScope ? ` | ${describeKillScope(focusedKillScope.scope, focusedKillScope.scopeRef)}` : ""}`}
                />
              )}
              <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/10 p-4">
                <div className="text-xs uppercase tracking-widest text-indigo-200">Commit-Point Timeline</div>
                {focusedTask && (
                  <div className="mt-2 text-xs text-slate-400">
                    Focused task trace {compactId(focusedTask.id)}
                  </div>
                )}
                <div className="mt-3 space-y-2 text-sm">
                  {focusedTaskTimeline.length > 0 ? (
                    focusedTaskTimeline.map((event) => {
                      const route = eventAuthorityRoute(event.payload);
                      const payload = event.payload as {
                        state?: string;
                        scope?: string;
                        scopeRef?: string;
                        reason?: string;
                      };
                      return (
                        <div key={event.id} className="rounded-lg border border-slate-800 bg-slate-950/80 p-3">
                          <div className="flex items-center justify-between">
                            <div className="font-medium text-slate-100">{event.eventKind}</div>
                            <div className="text-xs text-slate-500">{formatTimestamp(event.timestamp)}</div>
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            Trace {compactId(event.traceId)} | Event {compactId(event.id)}
                          </div>
                          {route && (
                            <div className="mt-2 rounded-lg border border-indigo-500/20 bg-indigo-500/10 p-2 text-xs text-indigo-100">
                              <div>{route.selectedPath.join(" -> ")}</div>
                              <div className="mt-1 text-slate-400">
                                {route.mode} | continuity {route.continuity} | phase {route.phase} | degraded nodes {route.degradedNodes.join(", ") || "none"}
                              </div>
                            </div>
                          )}
                          {event.eventKind === "governance.kill-switch.updated" && (
                            <div className="mt-2 rounded-lg border border-rose-500/20 bg-rose-500/10 p-2 text-xs text-rose-100">
                              <div>
                                {(payload.state ?? "unknown").toUpperCase()} {describeKillScope(payload.scope, payload.scopeRef)}
                              </div>
                              <div className="mt-1 text-rose-100/70">{payload.reason ?? "no reason recorded"}</div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3 text-slate-500">
                      Mission-specific replay events will appear here as the governance cycle advances.
                    </div>
                  )}
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-4">
                <div className="text-xs uppercase tracking-widest text-slate-400">Mission Artifact Timeline</div>
                {focusedTask && (
                  <div className="mt-2 text-xs text-slate-400">
                    Focused task artifact chain {compactId(focusedTask.id)}
                  </div>
                )}
                <div className="mt-3 space-y-2 text-sm">
                  {focusedTaskArtifactTimeline.length > 0 ? (
                    focusedTaskArtifactTimeline.map((artifact) => (
                      <div key={artifact.id} className="rounded-lg border border-slate-800 bg-slate-900/80 p-3">
                        <div className="flex items-center justify-between">
                          <div className="font-medium text-slate-100">{artifact.artifactType}</div>
                          <div className="text-xs text-slate-500">{formatTimestamp(artifact.timestamp)}</div>
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {compactId(artifact.id)}
                          {artifact.decisionId ? ` | decision ${compactId(artifact.decisionId)}` : ""}
                          {artifact.warrantId ? ` | warrant ${compactId(artifact.warrantId)}` : ""}
                          {artifact.reportScope ? ` | ${artifact.reportScope} assurance` : ""}
                          {artifact.assurancePosture ? ` | posture ${artifact.assurancePosture}` : ""}
                          {artifact.systemPosture ? ` | system ${artifact.systemPosture}` : ""}
                        </div>
                        {artifact.summary && <div className="mt-1 text-xs text-slate-400">{artifact.summary}</div>}
                        {artifact.reasons && artifact.reasons.length > 0 && (
                          <div className="mt-2 space-y-1 text-[11px] text-slate-500">
                            {artifact.reasons.slice(0, 3).map((reason) => (
                              <div key={reason}>• {reason}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3 text-slate-500">
                      {focusedTask
                        ? "No artifact chain recorded for the focused task yet."
                        : "Mission-linked artifacts will accumulate here as commit-point governance emits envelopes, warrants, decisions, and certificates."}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="col-span-12 rounded-2xl border border-amber-500/20 bg-slate-900/70 p-5 shadow-xl lg:col-span-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-medium">Agent Mission Orchestrator</h2>
              <span className="text-xs text-slate-400">agent-os</span>
            </div>
            <div className="space-y-3">
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
                {primaryMission
                  ? `${primaryMission.title} is ${primaryMission.status} with ${primaryMission.steps.filter((step) => step.status === "completed").length} completed steps.${focusedTask ? ` Focused thread: ${focusedTask.title} in ${formatTaskPhase(focusedTask.coordination?.phase)} phase with ${focusedCommitPosture} posture.` : ""}`
                  : "No governed mission has been created yet. The runtime is standing by for operator intent."}
              </div>
              {primaryMission && (
                <div className="rounded-xl border border-cyan-500/20 bg-slate-950/80 p-4">
                  <div className="text-xs uppercase tracking-widest text-cyan-200">Governance Spine</div>
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3">
                      <div className="text-xs text-slate-500">Mission Phases</div>
                      <div className="mt-3 space-y-2">
                        {primaryMission.steps.map((step) => (
                          <div
                            key={step.id}
                            className={cn(
                              "flex items-center justify-between rounded-lg border bg-slate-950/80 px-3 py-2",
                              (focusedTask?.coordination?.phase === "prepare" && step.ownerRole === "planner") ||
                                (focusedTask?.coordination?.phase === "prepare" && step.ownerRole === "executor" && /Prepare workspace/i.test(step.title)) ||
                                (focusedTask?.coordination?.phase === "execute" && step.ownerRole === "executor" && /Execute mission loop/i.test(step.title)) ||
                                (focusedTask?.coordination?.phase === "audit" && step.ownerRole === "auditor")
                                ? "border-cyan-500/40"
                                : "border-slate-800"
                            )}
                          >
                            <div>
                              <div className="text-sm font-medium text-slate-100">{step.title}</div>
                              <div className="text-xs text-slate-500">
                                {step.ownerRole}
                                {((focusedTask?.coordination?.phase === "prepare" && step.ownerRole === "planner") ||
                                  (focusedTask?.coordination?.phase === "prepare" && step.ownerRole === "executor" && /Prepare workspace/i.test(step.title)) ||
                                  (focusedTask?.coordination?.phase === "execute" && step.ownerRole === "executor" && /Execute mission loop/i.test(step.title)) ||
                                  (focusedTask?.coordination?.phase === "audit" && step.ownerRole === "auditor")) && (
                                  <span className="ml-2 uppercase tracking-wide text-cyan-200">focused phase</span>
                                )}
                              </div>
                            </div>
                            <div
                              className={cn(
                                "rounded-full border px-2 py-0.5 text-xs",
                                step.status === "completed" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
                                step.status === "in_progress" && "border-cyan-500/30 bg-cyan-500/10 text-cyan-200",
                                step.status === "pending" && "border-slate-700 bg-slate-800/80 text-slate-300",
                                step.status === "blocked" && "border-rose-500/30 bg-rose-500/10 text-rose-300"
                              )}
                            >
                              {step.status}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3">
                      <div className="text-xs text-slate-500">Current Governed Focus</div>
                      {focusedTask ? (
                        <div className="mt-3 space-y-2">
                          <div className="text-sm font-medium text-slate-100">{focusedTask.title}</div>
                          <div className="text-xs text-slate-400">
                            {formatTaskPhase(focusedTask.coordination?.phase)} phase | {focusedTask.status} | {focusedTask.assignedAgentId}
                          </div>
                          <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3 text-xs text-slate-400">
                            <div>Release condition {focusedTask.coordination?.releaseCondition ?? "none recorded"}</div>
                            <div className="mt-1">
                              Blockers {focusedTask.coordination?.blockedByTaskIds?.join(", ") || "none"}
                            </div>
                            <div className="mt-1">
                              Governance {focusedTask.governance?.status ?? "pending"} | Witness {focusedTask.governance?.witnessStatus ?? "pending"}
                            </div>
                            {focusedAutonomyArtifact && (
                              <div className="mt-1">
                                Autonomy {focusedAutonomySummary}
                              </div>
                            )}
                            {focusedKillScope && (
                              <div className="mt-1">
                                Sovereign halt {describeKillScope(focusedKillScope.scope, focusedKillScope.scopeRef)}
                              </div>
                            )}
                            {focusedAuthorityRoute && (
                              <div className="mt-1">
                                Route {focusedAuthorityRoute.selectedPath.join(" -> ")} | {focusedAuthorityRoute.mode}
                              </div>
                            )}
                            <div className="mt-1">
                              Agent identity {focusedAgentVerification} | Device identity {focusedDeviceVerification}
                            </div>
                          </div>
                          <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3 text-xs text-slate-500">
                            {[ 
                              focusedTask.governance?.policyCompileId && `policy ${compactId(focusedTask.governance.policyCompileId)}`,
                              focusedTask.governance?.envelopeId && `envelope ${compactId(focusedTask.governance.envelopeId)}`,
                              focusedTask.governance?.warrantId && `warrant ${compactId(focusedTask.governance.warrantId)}`,
                              focusedTask.governance?.commitDecisionId && `commit ${compactId(focusedTask.governance.commitDecisionId)}`,
                              focusedTask.governance?.finalityCertificateId && `finality ${compactId(focusedTask.governance.finalityCertificateId)}`,
                              focusedTask.governance?.agentIdentityRef && `agent ${compactId(focusedTask.governance.agentIdentityRef)}`,
                              focusedTask.governance?.deviceIdentityRef && `device ${compactId(focusedTask.governance.deviceIdentityRef)}`
                            ].filter(Boolean).join(" | ") || "No current governance artifacts recorded"}
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/80 p-3 text-sm text-slate-500">
                          No governed focus task yet. The runtime will surface the next admissible task here.
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900/80 p-3">
                    <div className="text-xs text-slate-500">
                      {focusedTask ? "Focused Institutional Memory" : "Mission Institutional Memory"}
                    </div>
                    <div className="mt-3 space-y-2">
                      {focusedMemoryHighlights.length > 0 ? (
                        focusedMemoryHighlights.map((record) => (
                          <div key={record.id} className="rounded-lg border border-slate-800 bg-slate-950/80 p-3 text-sm text-slate-300">
                            <div className="font-medium text-slate-100">{record.kind}</div>
                            <div className="mt-1">{record.summary}</div>
                            <div className="mt-2 text-xs text-slate-500">
                              {record.tags.join(" | ") || "memory"} | {formatTimestamp(record.createdAt)}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3 text-sm text-slate-500">
                          {focusedTask
                            ? "No focused institutional memory linked to this governed task yet."
                            : "Mission memory will accumulate here as the Agent OS advances work."}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {memoryHighlights.map((record) => (
                <div key={record.id} className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-sm text-slate-300">
                  <div className="font-medium text-slate-100">{record.kind}</div>
                  <div className="mt-1">{record.summary}</div>
                  <div className="mt-2 text-xs text-slate-500">{formatTimestamp(record.createdAt)}</div>
                </div>
              ))}
              {memoryHighlights.length === 0 && (
                <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-sm text-slate-500">
                  Mission memory will appear here as the Agent OS starts scheduling and advancing work.
                </div>
              )}
            </div>
          </section>

          <section className="col-span-12 rounded-2xl border border-emerald-500/20 bg-slate-900/70 p-5 shadow-xl lg:col-span-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-medium">Execution Queue</h2>
              <span className="text-xs text-slate-400">agent-os runtime loop</span>
            </div>
            {focusedTask && (
              <FocusBanner
                tone="emerald"
                title={`Focused thread ${focusedTask.title} | ${focusedCommitPosture}`}
                subtitle={
                  focusedTask.coordination?.releaseReady
                    ? `release-ready${focusedAuthorityRoute ? ` | route ${focusedAuthorityRoute.mode}` : ""}`
                    : `waiting on release conditions${focusedAuthorityRoute ? ` | route ${focusedAuthorityRoute.mode}` : ""}`
                }
              />
            )}
            <div className="mb-4 flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs text-slate-300">
              <div className="flex flex-wrap gap-2">
                {([
                  ["live", `Live ${runningTaskCount + readyTaskCount}`],
                  ["waiting", `Waiting ${waitingTaskCount}`],
                  ["blocked", `Blocked ${blockedTaskCount}`],
                  ["completed", `Completed ${completedTaskCount}`],
                  ["all", `All ${missionExecutionTasks.length}`]
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setTaskFilter(value)}
                    className={cn(
                      "rounded-full border px-3 py-1 transition-colors",
                      taskFilter === value
                        ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-100"
                        : "border-slate-700 bg-slate-900/80 text-slate-400 hover:border-slate-500 hover:text-slate-200"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <input
                value={taskQuery}
                onChange={(event) => setTaskQuery(event.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                placeholder="Filter by task, phase, agent, blocker, or tool"
              />
            </div>
            <div className="space-y-3 text-sm">
              {filteredMissionExecutionTasks.length > 0 ? (
                filteredMissionExecutionTasks.map((task) => (
                  <button
                    key={task.id}
                    onClick={() => setSelectedTaskId(task.id)}
                    className={cn(
                      "w-full rounded-xl border bg-slate-950/80 p-3 text-left",
                      focusedTask?.id === task.id ? "border-cyan-500/40 bg-cyan-500/5" : "border-slate-800"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-slate-100">{task.title}</div>
                        {focusedTask?.id === task.id && (
                          <div className="mt-1 text-[11px] uppercase tracking-wide text-cyan-200">Focused governed thread</div>
                        )}
                      </div>
                      <div
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-xs",
                          task.status === "completed" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
                          task.status === "running" && "border-cyan-500/30 bg-cyan-500/10 text-cyan-200",
                          task.status === "queued" && "border-slate-700 bg-slate-800/80 text-slate-300",
                          (task.status === "blocked" || task.status === "cancelled") && "border-rose-500/30 bg-rose-500/10 text-rose-300"
                        )}
                      >
                        {task.status}
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-slate-400">
                      Agent {task.assignedAgentId} | Role {task.ownerRole} | Tools {task.requiredTools.join(", ")}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Identity refs {compactId(task.governance?.agentIdentityRef)} | {compactId(task.governance?.deviceIdentityRef)}
                    </div>
                    {task.coordination && (
                      <div className="mt-2 rounded-lg border border-slate-800 bg-slate-900/70 p-2 text-xs text-slate-300">
                        <div className="font-medium text-cyan-200">
                          Release {formatTaskPhase(task.coordination.phase)} phase
                        </div>
                        <div className="mt-1 text-slate-400">
                          Condition {task.coordination.releaseCondition}
                        </div>
                        <div className="mt-1 text-slate-500">
                          Dependencies {task.coordination.dependsOnTaskIds.join(", ") || "none"}
                        </div>
                        <div className="mt-1 text-slate-500">
                          Blocked by {task.coordination.blockedByTaskIds?.join(", ") || "none"}
                        </div>
                        <div className="mt-1 text-slate-500">
                          Release posture {task.coordination.releaseReady ? "ready" : "waiting"} | Ready at{" "}
                          {formatTimestamp(task.coordination.readyAt)}
                        </div>
                      </div>
                    )}
                    {task.execution && (
                      <div className="mt-2 rounded-lg border border-slate-800 bg-slate-900/70 p-2 text-xs text-slate-400">
                        <div>Workspace {task.execution.workspaceId ?? "unassigned"} | CWD {task.execution.cwd ?? "/workspace"}</div>
                        <div className="mt-1">Hints {task.execution.commandHints.join(" | ")}</div>
                        <div className="mt-1">
                          Claim {task.execution.claimedBy ?? "unclaimed"} | Attempts {task.execution.attemptCount}
                        </div>
                      </div>
                    )}
                    {task.governance && (
                      <div className="mt-2 rounded-lg border border-slate-800 bg-slate-900/80 p-2 text-xs text-slate-300">
                        <div
                          className={cn(
                            "font-medium",
                            task.governance.status === "approved"
                              ? "text-emerald-300"
                              : task.governance.status === "blocked"
                                ? "text-rose-300"
                                : "text-amber-200"
                          )}
                        >
                          Governance {task.governance.status}
                        </div>
                        <div className="mt-1 text-slate-400">{task.governance.reasons.join(" ")}</div>
                        <div className="mt-1 text-slate-500">
                          Commit posture{" "}
                          {killSwitch
                            ? "halted"
                            : task.governance.status === "approved"
                              ? "admissible"
                              : task.governance.status === "blocked"
                                ? "blocked"
                                : "evaluating"}
                        </div>
                        <div className="mt-1 text-slate-500">
                          {[
                            task.governance.policyCompileId,
                            task.governance.envelopeId,
                            task.governance.warrantId,
                            task.governance.commitDecisionId,
                            task.governance.witnessReceiptId,
                            task.governance.decisionId,
                            task.governance.finalityCertificateId
                          ]
                            .filter(Boolean)
                            .join(" | ") || "No governance refs recorded"}
                        </div>
                        <div className="mt-1 text-slate-500">
                          Witness {task.governance.witnessStatus ?? "pending"}
                        </div>
                      </div>
                    )}
                    <div className="mt-1 text-xs text-slate-500">Updated {formatTimestamp(task.updatedAt)}</div>
                  </button>
                ))
              ) : (
                <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-slate-500">
                  {missionExecutionTasks.length > 0
                    ? "No tasks match the current filter."
                    : "Execution tasks will appear here once a mission enters the execution loop."}
                </div>
              )}
            </div>
          </section>

          <section className="col-span-12 rounded-2xl border border-emerald-500/20 bg-slate-900/70 p-5 shadow-xl lg:col-span-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-medium">Execution Receipts</h2>
              <span className="text-xs text-slate-400">agent-os evidence</span>
            </div>
            {focusedTask && (
              <FocusBanner
                tone="emerald"
                title={`Focused on ${focusedTask.title} | ${compactId(focusedTask.id)}`}
                subtitle={`Commit ${compactId(focusedDecisionArtifact?.id ?? focusedTask.governance?.commitDecisionId)} | Witness ${focusedTask.governance?.witnessStatus ?? "pending"}${focusedAuthorityRoute ? ` | Route ${focusedAuthorityRoute.mode}` : ""} | ${focusedIdentitySummary}`}
              />
            )}
            {focusedTask && (
              <div className="mb-4 grid grid-cols-1 gap-3 text-xs md:grid-cols-4">
                <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-slate-300">
                  <div className="text-slate-500">Commit chain</div>
                  <div className="mt-1 text-slate-100">
                    {compactId(focusedDecisionArtifact?.id ?? focusedTask.governance?.commitDecisionId)}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-slate-300">
                  <div className="text-slate-500">Witness</div>
                  <div className="mt-1 text-slate-100">{focusedTask.governance?.witnessStatus ?? "pending"}</div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-slate-300">
                  <div className="text-slate-500">Receipt posture</div>
                  <div className="mt-1 text-slate-100">
                    {focusedAuthorityRoute ? focusedAuthorityRoute.selectedPath.join(" -> ") : `${focusedTaskReceipts.length} receipts linked`}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-slate-300">
                  <div className="text-slate-500">Identity posture</div>
                  <div className="mt-1 text-slate-100">
                    agent {focusedAgentVerification} | device {focusedDeviceVerification}
                  </div>
                </div>
              </div>
            )}
            <div className="space-y-3 text-sm">
              {missionExecutionReceipts.length > 0 ? (
                focusedTaskReceipts.map((receipt) => (
                  <div key={receipt.id} className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-slate-100">{receipt.summary}</div>
                      <div className="text-xs text-slate-400">{receipt.outcome}</div>
                    </div>
                    <div className="mt-2 text-xs text-slate-500">
                      Agent {receipt.agentId} | Evidence {receipt.evidenceRefs.join(", ")}
                    </div>
                    {receipt.governanceRefs && receipt.governanceRefs.length > 0 && (
                      <div className="mt-1 text-xs text-slate-500">
                        Governance {receipt.governanceRefs.join(", ")}
                      </div>
                    )}
                    <div className="mt-1 text-xs text-slate-500">{formatTimestamp(receipt.createdAt)}</div>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-slate-500">
                  {focusedTask ? "No receipts recorded for the focused task yet." : "Execution receipts will appear here as tasks complete or halt."}
                </div>
              )}
            </div>
          </section>

          <section className="col-span-12 rounded-2xl border border-cyan-500/20 bg-slate-900/70 p-5 shadow-xl lg:col-span-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-medium">Tool Actions</h2>
              <span className="text-xs text-slate-400">agent-os adapter loop</span>
            </div>
            {focusedTask && (
              <FocusBanner
                tone="cyan"
                title={`Focused on ${focusedTask.title} | ${compactId(focusedTask.id)}`}
                subtitle={`Envelope ${compactId(focusedEnvelopeArtifact?.id ?? focusedTask.governance?.envelopeId)} | Warrant ${compactId(focusedWarrantArtifact?.id ?? focusedTask.governance?.warrantId)}${focusedAuthorityRoute ? ` | Route ${focusedAuthorityRoute.mode}` : ""} | ${focusedIdentitySummary}`}
              />
            )}
            {focusedTask && (
              <div className="mb-4 grid grid-cols-1 gap-3 text-xs md:grid-cols-4">
                <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-slate-300">
                  <div className="text-slate-500">Envelope</div>
                  <div className="mt-1 text-slate-100">
                    {compactId(focusedEnvelopeArtifact?.id ?? focusedTask.governance?.envelopeId)}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-slate-300">
                  <div className="text-slate-500">Warrant</div>
                  <div className="mt-1 text-slate-100">
                    {compactId(focusedWarrantArtifact?.id ?? focusedTask.governance?.warrantId)}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-slate-300">
                  <div className="text-slate-500">Action posture</div>
                  <div className="mt-1 text-slate-100">{focusedTaskToolActions.length} tool actions linked</div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-slate-300">
                  <div className="text-slate-500">Verified identity</div>
                  <div className="mt-1 text-slate-100">
                    {compactId(focusedTask.governance?.agentIdentityRef)} | {compactId(focusedTask.governance?.deviceIdentityRef)}
                  </div>
                </div>
              </div>
            )}
            <div className="space-y-3 text-sm">
              {focusedTaskToolActions.length > 0 ? (
                focusedTaskToolActions.map((action) => (
                  <div key={action.id} className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-slate-100">{action.summary}</div>
                      <div className="text-xs text-slate-400">{action.status}</div>
                    </div>
                    <div className="mt-2 text-xs text-slate-500">
                      Tool {action.toolId} | Kind {action.kind} | Agent {action.agentId}
                    </div>
                    {action.governance && (
                      <div className="mt-1 text-xs text-slate-500">
                        Governance {action.governance.status}: {action.governance.reasons.join(" ")}
                        <div className="mt-1 text-slate-600">
                          {[
                            action.governance.policyCompileId,
                            action.governance.envelopeId,
                            action.governance.warrantId,
                            action.governance.commitDecisionId
                          ]
                            .filter(Boolean)
                            .join(" | ") || "No governance refs recorded"}
                        </div>
                      </div>
                    )}
                    <div className="mt-1 text-xs text-slate-500">{formatTimestamp(action.updatedAt)}</div>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-slate-500">
                  {focusedTask
                    ? "No tool actions recorded for the focused task yet."
                    : "Governed shell, edit, read, and write actions will appear here as workers use tool adapters."}
                </div>
              )}
            </div>
          </section>

          <section className="col-span-12 rounded-2xl border border-cyan-500/20 bg-slate-900/70 p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-medium">Operator Actions</h2>
              <span className="text-xs text-slate-400">console-ui to gateway</span>
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-4">
                <div className="text-sm font-medium text-slate-100">Create Mission</div>
                <div className="mt-3 space-y-3">
                  <input
                    value={missionDraft.title}
                    onChange={(event) => setMissionDraft((current) => ({ ...current, title: event.target.value }))}
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                    placeholder="Mission title"
                  />
                  <textarea
                    value={missionDraft.objective}
                    onChange={(event) => setMissionDraft((current) => ({ ...current, objective: event.target.value }))}
                    className="min-h-24 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                    placeholder="Mission objective"
                  />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <select
                      value={missionDraft.targetSystem}
                      onChange={(event) => {
                        const nextTarget = event.target.value as (typeof MISSION_TARGET_OPTIONS)[number]["value"];
                        const option = MISSION_TARGET_OPTIONS.find((item) => item.value === nextTarget);
                        setMissionDraft((current) => ({
                          ...current,
                          targetSystem: nextTarget,
                          objective:
                            current.objective === "Create the first governed delivery mission for the AI operating system." ||
                            current.objective === "Validate a high-integrity safety intervention path under sovereign governance." ||
                            current.objective === "Audit evidence continuity and finality posture across the governance ledger."
                              ? (option?.objectiveHint ?? current.objective)
                              : current.objective,
                          riskLevel: nextTarget === "safety" ? "high" : nextTarget === "ledger" ? "medium" : current.riskLevel
                        }));
                      }}
                      className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                    >
                      {MISSION_TARGET_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={missionDraft.riskLevel}
                      onChange={(event) =>
                        setMissionDraft((current) => ({
                          ...current,
                          riskLevel: event.target.value as "low" | "medium" | "high"
                        }))
                      }
                      className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                    >
                      <option value="low">low risk</option>
                      <option value="medium">medium risk</option>
                      <option value="high">high risk</option>
                    </select>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3 text-xs text-slate-400">
                    {(() => {
                      const option =
                        MISSION_TARGET_OPTIONS.find((item) => item.value === missionDraft.targetSystem) ?? MISSION_TARGET_OPTIONS[0];
                      return (
                        <>
                          <div className="text-slate-200">Governed domain {option.label}</div>
                          <div className="mt-1">Authority lane {option.authorityHint}</div>
                          <div className="mt-1">Routing posture {option.routeHint}</div>
                        </>
                      );
                    })()}
                  </div>
                  <button
                    onClick={() => void handleCreateMission()}
                    disabled={isSubmittingAction}
                    className="w-full rounded-lg bg-cyan-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                  >
                    {isSubmittingAction ? "SUBMITTING" : "CREATE GOVERNED MISSION"}
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-4">
                <div className="text-sm font-medium text-slate-100">Register Agent</div>
                <div className="mt-3 space-y-3">
                  <input
                    value={agentDraft.name}
                    onChange={(event) => setAgentDraft((current) => ({ ...current, name: event.target.value }))}
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                    placeholder="Agent name"
                  />
                  <select
                    value={agentDraft.role}
                    onChange={(event) =>
                      setAgentDraft((current) => ({
                        ...current,
                        role: event.target.value as "planner" | "executor" | "reviewer" | "auditor" | "operator"
                      }))
                    }
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                  >
                    <option value="operator">operator</option>
                    <option value="planner">planner</option>
                    <option value="executor">executor</option>
                    <option value="auditor">auditor</option>
                    <option value="reviewer">reviewer</option>
                  </select>
                  <button
                    onClick={() => void handleRegisterAgent()}
                    disabled={isSubmittingAction}
                    className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                  >
                    {isSubmittingAction ? "SUBMITTING" : "REGISTER AGENT"}
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-4">
                <div className="text-sm font-medium text-slate-100">Advance Mission</div>
                <div className="mt-2 text-xs text-slate-400">
                  {primaryMission ? `Current mission: ${primaryMission.title}` : "No active mission available yet."}
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  Commit posture {focusedCommitPosture} | Next admissible {nextReadyTask?.title ?? "none"}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {(["progress", "execute", "complete", "halt"] as const).map((action) => (
                    <div key={action} className="space-y-1">
                      <button
                        onClick={() => void handleAdvanceMission(action)}
                        disabled={isSubmittingAction || !primaryMission || !missionActionReadiness[action].enabled}
                        className={cn(
                          "w-full rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-40",
                          action === "halt" ? "bg-rose-600" : action === "complete" ? "bg-emerald-600" : "bg-slate-700"
                        )}
                      >
                        {action.toUpperCase()}
                      </button>
                      <div className="px-1 text-[11px] text-slate-500">{missionActionReadiness[action].reason}</div>
                    </div>
                  ))}
                </div>
                {actionMessage && (
                  <div className="mt-3 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100">
                    {actionMessage}
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
