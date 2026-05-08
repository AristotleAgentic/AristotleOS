const gatewayBaseUrl = process.env.GATEWAY_BASE_URL ?? "http://localhost:8080";
const operatorApiKey = process.env.OPERATOR_API_KEY?.trim();
const operatorActor = process.env.OPERATOR_ACTOR?.trim();
const operatorRole = process.env.OPERATOR_ROLE?.trim();
let operatorSessionToken = "";
let operatorSessionExpiresAt = 0;

const toUrl = (path) => `${gatewayBaseUrl}${path}`;

async function request(path, init) {
  const headers = new Headers(init?.headers);
  const sessionToken = await ensureOperatorSession();
  if (sessionToken) {
    headers.set("authorization", `Bearer ${sessionToken}`);
  } else if (operatorApiKey) {
    headers.set("x-operator-key", operatorApiKey);
  }
  if (operatorActor) {
    headers.set("x-operator-actor", operatorActor);
  }
  if (operatorRole) {
    headers.set("x-operator-role", operatorRole);
  }
  const response = await fetch(toUrl(path), { ...init, headers });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${path} failed with ${response.status}${body ? `: ${body}` : ""}`);
  }
  return response.json();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson(path, init) {
  const headers = new Headers(init?.headers);
  const sessionToken = await ensureOperatorSession();
  if (sessionToken) {
    headers.set("authorization", `Bearer ${sessionToken}`);
  } else if (operatorApiKey) {
    headers.set("x-operator-key", operatorApiKey);
  }
  if (operatorActor) {
    headers.set("x-operator-actor", operatorActor);
  }
  if (operatorRole) {
    headers.set("x-operator-role", operatorRole);
  }
  const response = await fetch(toUrl(path), { ...init, headers });
  const text = await response.text().catch(() => "");
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: response.ok, status: response.status, json, text };
}

async function ensureOperatorSession() {
  if (!operatorApiKey || !operatorActor || !operatorRole) {
    return "";
  }
  if (operatorSessionToken && operatorSessionExpiresAt > Date.now() + 30_000) {
    return operatorSessionToken;
  }
  const headers = new Headers();
  headers.set("x-operator-key", operatorApiKey);
  headers.set("x-operator-actor", operatorActor);
  headers.set("x-operator-role", operatorRole);
  const response = await fetch(toUrl("/operator/auth/session"), {
    method: "POST",
    headers
  });
  if (!response.ok) {
    return "";
  }
  const session = await response.json();
  operatorSessionToken = session.token ?? "";
  operatorSessionExpiresAt = Date.parse(session.expiresAt ?? "") || 0;
  return operatorSessionToken;
}

async function main() {
  const runId = `core-${Date.now().toString(36)}`;
  console.log(`[core] validating against ${gatewayBaseUrl}`);

  const health = await request("/health");
  assert(health.ok, "gateway health is not ok");
  console.log("[core] health ok");

  await request("/operator/kill-switch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      actor: "validate-core",
      reason: "core validation preflight reset",
      scope: "domain",
      scopeRef: "workspace",
      state: "inactive"
    })
  });
  for (const agentId of ["agent-planner", "agent-executor", "agent-auditor"]) {
    await request("/operator/kill-switch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actor: "validate-core",
        reason: "core validation agent preflight reset",
        scope: "agent",
        scopeRef: agentId,
        state: "inactive"
      })
    });
  }

  const missionCreated = await request("/operator/os/missions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: `Core Validation ${runId}`,
      objective: "Validate governed dispatch, scoped halt, replay memory, and counterfactual routing",
      requestedBy: "validate-core",
      targetSystem: "workspace",
      governanceProfile: "supervised-build",
      riskLevel: "medium",
      requiredAuthorities: ["mission.command"],
      requiredTools: ["shell", "editor", "ledger"],
      successMetrics: ["core governance path validated"]
    })
  });
  const missionId = missionCreated.mission.id;
  console.log(`[core] created mission ${missionId}`);

  await request(`/operator/os/missions/${missionId}/advance`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "execute", actor: "validate-core" })
  });

  const state = await request("/operator/os/state");
  const governedTask = state.executionTasks.find(
    (task) => task.missionId === missionId && task.governance?.route?.selectedPath?.length
  );
  assert(governedTask, "no governed task with authority route was created");
  console.log(`[core] dispatch route ${governedTask.governance.route.selectedPath.join(" -> ")}`);

  if (governedTask.status === "running") {
    await request(`/operator/os/tasks/${governedTask.id}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actor: "validate-core",
        summary: "Advance validator mission to shell-capable phase",
        output: { validator: true },
        evidenceRefs: ["validate-core-advance"]
      })
    });
  }

  const stateAfterAdvance = await request("/operator/os/state");
  const toolActionTask = stateAfterAdvance.executionTasks.find(
    (task) =>
      task.missionId === missionId &&
      task.status === "running" &&
      Array.isArray(task.requiredTools) &&
      task.requiredTools.includes("shell")
  );
  assert(toolActionTask, "no running task with shell authorization was created");

  const toolAction = await request(`/operator/os/tasks/${toolActionTask.id}/actions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agentId: toolActionTask.assignedAgentId,
      kind: "shell",
      toolId: "shell",
      summary: "Validate governed shell actuation",
      payload: { command: "Get-ChildItem -Force" }
    })
  });
  assert(toolAction.status === "approved", "tool action proposal was not approved");

  const executedToolAction = await request(
    `/operator/os/tasks/${toolActionTask.id}/actions/${toolAction.id}/execute`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        executionResult: { exitCode: 0, stdout: "validation ok" },
        evidenceRefs: ["validate-core-tool-action"]
      })
    }
  );
  assert(executedToolAction.status === "executed", "tool action did not execute");
  assert(executedToolAction.governance?.route?.selectedPath?.length, "tool action route missing");
  assert(executedToolAction.governance?.commitDecisionId, "tool action commit decision missing");
  console.log(`[core] tool action route ${executedToolAction.governance.route.selectedPath.join(" -> ")}`);

  await request("/operator/kill-switch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      actor: "validate-core",
      reason: "core validation agent halt",
      scope: "agent",
      scopeRef: toolActionTask.assignedAgentId,
      state: "active"
    })
  });

  const agentScopedAction = await request(`/operator/os/tasks/${toolActionTask.id}/actions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agentId: toolActionTask.assignedAgentId,
      kind: "shell",
      toolId: "shell",
      summary: "Validate agent scoped halt",
      payload: { command: "Get-ChildItem -Force" }
    })
  });
  const blockedAgentAction = await requestJson(
    `/operator/os/tasks/${toolActionTask.id}/actions/${agentScopedAction.id}/execute`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        executionResult: { exitCode: 0, stdout: "agent halt should block" },
        evidenceRefs: ["validate-core-agent-halt"]
      })
    }
  );
  assert(!blockedAgentAction.ok, "agent-scoped halt did not block governed tool execution");
  assert(
    JSON.stringify(blockedAgentAction.json ?? blockedAgentAction.text).includes("Kill switch active"),
    "agent-scoped halt response missing sovereign halt reason"
  );
  const agentReplay = await request(
    `/operator/ledger?traceId=${encodeURIComponent(`scope:agent:${toolActionTask.assignedAgentId}`)}`
  );
  assert(
    agentReplay.committed.some((event) => event.eventKind === "governance.kill-switch.updated"),
    "agent-scoped halt replay event missing"
  );
  console.log(`[core] agent scoped halt blocked ${toolActionTask.assignedAgentId}`);

  await request("/operator/kill-switch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      actor: "validate-core",
      reason: "core validation agent reset",
      scope: "agent",
      scopeRef: toolActionTask.assignedAgentId,
      state: "inactive"
    })
  });

  await request("/operator/kill-switch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      actor: "validate-core",
      reason: "core validation device halt",
      scope: "device",
      scopeRef: toolActionTask.execution?.workspaceId ?? missionCreated.workspace.id,
      state: "active"
    })
  });

  const deviceScopedAction = await request(`/operator/os/tasks/${toolActionTask.id}/actions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agentId: toolActionTask.assignedAgentId,
      kind: "shell",
      toolId: "shell",
      summary: "Validate device scoped halt",
      payload: { command: "Get-ChildItem -Force" }
    })
  });
  const blockedDeviceAction = await requestJson(
    `/operator/os/tasks/${toolActionTask.id}/actions/${deviceScopedAction.id}/execute`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        executionResult: { exitCode: 0, stdout: "device halt should block" },
        evidenceRefs: ["validate-core-device-halt"]
      })
    }
  );
  assert(!blockedDeviceAction.ok, "device-scoped halt did not block governed tool execution");
  assert(
    JSON.stringify(blockedDeviceAction.json ?? blockedDeviceAction.text).includes("Kill switch active"),
    "device-scoped halt response missing sovereign halt reason"
  );
  const deviceScopeRef = toolActionTask.execution?.workspaceId ?? missionCreated.workspace.id;
  const deviceReplay = await request(
    `/operator/ledger?traceId=${encodeURIComponent(`scope:device:${deviceScopeRef}`)}`
  );
  assert(
    deviceReplay.committed.some((event) => event.eventKind === "governance.kill-switch.updated"),
    "device-scoped halt replay event missing"
  );
  console.log(`[core] device scoped halt blocked ${toolActionTask.execution?.workspaceId ?? missionCreated.workspace.id}`);

  await request("/operator/kill-switch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      actor: "validate-core",
      reason: "core validation device reset",
      scope: "device",
      scopeRef: toolActionTask.execution?.workspaceId ?? missionCreated.workspace.id,
      state: "inactive"
    })
  });

  const safetyMissionCreated = await request("/operator/os/missions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: `Safety Validation ${runId}`,
      objective: "Validate the sovereign safety route at governed dispatch",
      requestedBy: "validate-core",
      targetSystem: "safety",
      governanceProfile: "supervised-build",
      riskLevel: "high",
      requiredAuthorities: ["mission.command", "safety.council"],
      requiredTools: ["shell", "editor", "ledger"],
      successMetrics: ["safety route selects the high-integrity relay"]
    })
  });
  const safetyMissionId = safetyMissionCreated.mission.id;

  await request(`/operator/os/missions/${safetyMissionId}/advance`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "execute", actor: "validate-core" })
  });

  const safetyState = await request("/operator/os/state");
  const safetyTask = safetyState.executionTasks.find(
    (task) => task.missionId === safetyMissionId && task.governance?.route?.selectedPath?.length
  );
  assert(safetyTask, "safety mission did not produce a governed route");
  assert(safetyTask.governance.route.domain === "safety", "safety mission route domain mismatch");
  assert(safetyTask.governance.route.selectedPath[1] === "mesh.delta", "safety mission did not select safety relay");
  console.log(`[core] safety dispatch route ${safetyTask.governance.route.selectedPath.join(" -> ")}`);

  const interdomainMissionCreated = await request("/operator/os/missions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: `Interdomain Continuity ${runId}`,
      objective: "Validate delegated authority continuity for workspace execution",
      requestedBy: "validate-core",
      targetSystem: "workspace",
      governanceProfile: "supervised-build",
      riskLevel: "medium",
      requiredAuthorities: ["mission.command", "evidence.steward"],
      requiredTools: ["shell", "editor", "ledger"],
      successMetrics: ["delegated authority lane remains available under degraded continuity"]
    })
  });
  const interdomainMissionId = interdomainMissionCreated.mission.id;

  await request(`/operator/os/missions/${interdomainMissionId}/advance`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "execute", actor: "validate-core" })
  });

  const interdomainState = await request("/operator/os/state");
  const interdomainTask = interdomainState.executionTasks.find(
    (task) => task.missionId === interdomainMissionId && task.governance?.route?.selectedPath?.length
  );
  assert(interdomainTask, "interdomain continuity mission did not produce a governed route");
  assert(
    interdomainTask.governance.route.authorityAnchor === "mission.command",
    "interdomain continuity mission did not start from mission.command"
  );
  assert(
    interdomainTask.governance.route.alternateAuthorityAnchor === "evidence.steward",
    "interdomain continuity mission did not preserve alternate authority lane"
  );

  const delegatedProjection = await request("/operator/replay/counterfactual", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      parentTraceId: interdomainMissionId,
      label: `Core delegated continuity ${runId}`,
      missionId: interdomainMissionId,
      taskId: interdomainTask.id,
      injectKillSwitch: false,
      degradedNodes: ["mesh.alpha"],
      route: interdomainTask.governance.route
    })
  });
  assert(
    delegatedProjection.projection.projectedOutcome === "reroute",
    "delegated continuity projection did not reroute under degraded continuity"
  );
  assert(
    delegatedProjection.projection.projectedRoute?.delegatedAuthorityAnchor === "evidence.steward",
    "delegated continuity projection did not shift authority to evidence.steward"
  );
  assert(
    delegatedProjection.projection.projectedRoute?.selectedPath?.[0] === "evidence.steward",
    "delegated continuity projection did not re-anchor the selected path"
  );
  assert(
    Array.isArray(delegatedProjection.projection.projectedRecoveryPaths) &&
      delegatedProjection.projection.projectedRecoveryPaths.some((path) => path.mode === "delegate"),
    "delegated continuity projection missing delegated recovery future"
  );
  console.log(
    `[core] delegated continuity route ${delegatedProjection.projection.projectedRoute.selectedPath.join(" -> ")}`
  );

  const actionTimeline = await request(
    `/operator/ledger?traceId=${encodeURIComponent(missionId)}&relatedId=${encodeURIComponent(executedToolAction.id)}`
  );
  assert(
    actionTimeline.committed.some((event) => event.eventKind === "agent-os.execution.tool-action.executed"),
    "tool action replay event missing"
  );
  const identityArtifacts = await request(
    `/operator/ledger/artifacts?traceId=${encodeURIComponent(missionId)}&relatedId=${encodeURIComponent(executedToolAction.id)}&artifactType=${encodeURIComponent("identity-attestation")}`
  );
  assert(
    identityArtifacts.items.some((artifact) => artifact.subjectType === "agent"),
    "governed tool action missing agent identity attestation"
  );
  assert(
    identityArtifacts.items.some(
      (artifact) => artifact.subjectType === "agent" && artifact.verification?.status === "verified" && artifact.signature && artifact.digest
    ),
    "governed tool action missing verified agent identity attestation"
  );
  assert(
    identityArtifacts.items.some((artifact) => artifact.subjectType === "device"),
    "governed tool action missing device identity attestation"
  );
  assert(
    identityArtifacts.items.some(
      (artifact) => artifact.subjectType === "device" && artifact.verification?.status === "verified" && artifact.signature && artifact.digest
    ),
    "governed tool action missing verified device identity attestation"
  );
  const taskIdentityArtifacts = await request(
    `/operator/ledger/artifacts?traceId=${encodeURIComponent(missionId)}&relatedId=${encodeURIComponent(toolActionTask.id)}&artifactType=${encodeURIComponent("identity-attestation")}`
  );
  assert(
    taskIdentityArtifacts.items.some((artifact) => artifact.subjectType === "agent"),
    "governed task lifecycle missing agent identity attestation"
  );
  assert(
    taskIdentityArtifacts.items.some((artifact) => artifact.subjectType === "device"),
    "governed task lifecycle missing device identity attestation"
  );
  console.log("[core] governed tool action recorded in replay");

  await request(`/operator/os/tasks/${toolActionTask.id}/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agentId: toolActionTask.assignedAgentId,
      summary: "Advance validator mission into audit autonomy phase",
      output: { validator: "implementation-complete" },
      evidenceRefs: ["validate-core-implementation-complete"]
    })
  });

  let stateAfterAutonomy = null;
  let completedAuditTask = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await request("/operator/os/autonomy/tick", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    await sleep(400);
    stateAfterAutonomy = await request("/operator/os/state");
    completedAuditTask = stateAfterAutonomy.executionTasks.find(
      (task) =>
        task.missionId === missionId &&
        task.coordination?.phase === "audit" &&
        task.status === "completed"
    );
    if (completedAuditTask) {
      break;
    }
  }
  assert(completedAuditTask, "autonomy tick did not complete the governed audit task");
  const autonomyArtifacts = await request(
    `/operator/ledger/artifacts?traceId=${encodeURIComponent(missionId)}&relatedId=${encodeURIComponent(completedAuditTask.id)}&artifactType=${encodeURIComponent("autonomy-attestation")}`
  );
  assert(
    autonomyArtifacts.items.some((artifact) => artifact.autonomyMode === "non-actuating"),
    "autonomous governed audit missing autonomy attestation"
  );
  assert(
    autonomyArtifacts.items.some(
      (artifact) => artifact.autonomyMode === "non-actuating" && artifact.verification?.status === "verified" && artifact.signature && artifact.digest
    ),
    "autonomous governed audit missing verified autonomy attestation"
  );
  console.log(`[core] autonomous governed audit completed ${completedAuditTask.id}`);

  await request("/operator/kill-switch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      actor: "validate-core",
      reason: "core validation domain halt",
      scope: "domain",
      scopeRef: "workspace",
      state: "active"
    })
  });
  console.log("[core] activated domain scoped halt");

  const blockedMissionCreated = await request("/operator/os/missions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: `Blocked Validation ${runId}`,
      objective: "Validate scoped sovereign halt at dispatch",
      requestedBy: "validate-core",
      targetSystem: "workspace",
      governanceProfile: "supervised-build",
      riskLevel: "medium",
      requiredAuthorities: ["mission.command"],
      requiredTools: ["shell", "editor", "ledger"],
      successMetrics: ["scoped halt blocks new workspace mission dispatch"]
    })
  });
  const blockedMissionId = blockedMissionCreated.mission.id;

  await request(`/operator/os/missions/${blockedMissionId}/advance`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "execute", actor: "validate-core" })
  });

  const haltedState = await request("/operator/os/state");
  const blockedTask = haltedState.executionTasks.find(
    (task) =>
      task.missionId === blockedMissionId &&
      task.status === "blocked" &&
      task.governance?.reasons?.some((reason) => reason.includes("Kill switch active"))
  );
  assert(blockedTask, "scoped halt did not block mission task");
  console.log(`[core] scoped halt blocked ${blockedTask.id}`);

  const replay = await request(`/operator/ledger?traceId=${encodeURIComponent("scope:domain:workspace")}`);
  assert(replay.committed.some((event) => event.eventKind === "governance.kill-switch.updated"), "kill-switch replay event missing");
  console.log("[core] sovereign halt recorded in replay");

  const projection = await request("/operator/replay/counterfactual", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      parentTraceId: missionId,
      label: `Core reroute ${runId}`,
      missionId,
      taskId: governedTask.id,
      injectKillSwitch: false,
      degradedNodes: ["mesh.alpha"],
      route: governedTask.governance.route
    })
  });
  assert(projection.projection.projectedOutcome === "reroute", "counterfactual reroute projection did not reroute");
  assert(
    Array.isArray(projection.projection.projectedRecoveryPaths) && projection.projection.projectedRecoveryPaths.length > 0,
    "counterfactual reroute projection missing governed futures"
  );

  const branchArtifacts = await request(`/operator/ledger/artifacts?branchId=${encodeURIComponent(projection.branch.id)}`);
  assert(
    branchArtifacts.items.some((artifact) => artifact.artifactType === "authority-envelope"),
    "counterfactual branch artifacts missing authority envelope"
  );
  assert(
    branchArtifacts.items.some((artifact) => artifact.artifactType === "recovery-plan"),
    "counterfactual reroute branch artifacts missing recovery plan"
  );
  console.log(`[core] counterfactual branch ${projection.branch.id} has projected route artifacts`);

  const disconnectedProjection = await request("/operator/replay/counterfactual", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      parentTraceId: missionId,
      label: `Core disconnected continuity ${runId}`,
      missionId,
      taskId: governedTask.id,
      injectKillSwitch: false,
      degradedNodes: ["mesh.alpha", "mesh.delta"],
      route: governedTask.governance.route
    })
  });
  assert(
    disconnectedProjection.projection.projectedOutcome === "halt",
    "counterfactual disconnected projection did not halt"
  );
  assert(
    disconnectedProjection.projection.projectedRoute?.mode === "disconnected",
    "counterfactual disconnected projection did not expose disconnected continuity"
  );
  assert(
    Array.isArray(disconnectedProjection.projection.projectedRecoveryPaths) &&
      disconnectedProjection.projection.projectedRecoveryPaths.length > 0,
    "counterfactual disconnected projection missing governed futures"
  );
  const disconnectedArtifacts = await request(
    `/operator/ledger/artifacts?branchId=${encodeURIComponent(disconnectedProjection.branch.id)}`
  );
  assert(
    disconnectedArtifacts.items.some((artifact) => artifact.artifactType === "authority-envelope"),
    "counterfactual disconnected branch missing authority envelope"
  );
  assert(
    disconnectedArtifacts.items.some((artifact) => artifact.artifactType === "recovery-plan"),
    "counterfactual disconnected branch missing recovery plan"
  );
  console.log(
    `[core] counterfactual branch ${disconnectedProjection.branch.id} has disconnected continuity artifacts`
  );

  const agentProjection = await request("/operator/replay/counterfactual", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      parentTraceId: missionId,
      label: `Core agent halt ${runId}`,
      missionId,
      taskId: toolActionTask.id,
      injectKillSwitch: true,
      scope: "agent",
      scopeRef: toolActionTask.assignedAgentId,
      route: executedToolAction.governance.route
    })
  });
  assert(agentProjection.projection.projectedOutcome === "halt", "agent halt projection did not halt");
  const agentBranchArtifacts = await request(`/operator/ledger/artifacts?branchId=${encodeURIComponent(agentProjection.branch.id)}`);
  assert(
    Array.isArray(agentProjection.projection.projectedRecoveryPaths) &&
      agentProjection.projection.projectedRecoveryPaths.length > 0,
    "agent halt projection missing governed futures"
  );
  assert(
    agentBranchArtifacts.items.some(
      (artifact) => artifact.artifactType === "kill-switch-event" && artifact.id.startsWith("kse-")
    ),
    "agent halt counterfactual branch missing kill-switch artifact"
  );
  assert(
    agentBranchArtifacts.items.some((artifact) => artifact.artifactType === "authority-envelope"),
    "agent halt counterfactual branch missing authority envelope"
  );
  assert(
    agentBranchArtifacts.items.some((artifact) => artifact.artifactType === "recovery-plan"),
    "agent halt counterfactual branch missing recovery plan"
  );
  console.log(`[core] counterfactual branch ${agentProjection.branch.id} has projected sovereign halt artifacts`);

  const deviceProjection = await request("/operator/replay/counterfactual", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      parentTraceId: missionId,
      label: `Core device halt ${runId}`,
      missionId,
      taskId: toolActionTask.id,
      injectKillSwitch: true,
      scope: "device",
      scopeRef: toolActionTask.execution?.workspaceId ?? workspaceId,
      route: executedToolAction.governance.route
    })
  });
  assert(deviceProjection.projection.projectedOutcome === "halt", "device halt projection did not halt");
  const deviceBranchArtifacts = await request(
    `/operator/ledger/artifacts?branchId=${encodeURIComponent(deviceProjection.branch.id)}`
  );
  assert(
    Array.isArray(deviceProjection.projection.projectedRecoveryPaths) &&
      deviceProjection.projection.projectedRecoveryPaths.length > 0,
    "device halt projection missing governed futures"
  );
  assert(
    deviceBranchArtifacts.items.some(
      (artifact) => artifact.artifactType === "kill-switch-event" && artifact.id.startsWith("kse-")
    ),
    "device halt counterfactual branch missing kill-switch artifact"
  );
  assert(
    deviceBranchArtifacts.items.some((artifact) => artifact.artifactType === "authority-envelope"),
    "device halt counterfactual branch missing authority envelope"
  );
  assert(
    deviceBranchArtifacts.items.some((artifact) => artifact.artifactType === "recovery-plan"),
    "device halt counterfactual branch missing recovery plan"
  );
  console.log(`[core] counterfactual branch ${deviceProjection.branch.id} has projected device halt artifacts`);

  const assuranceReport = await request("/operator/assurance/report");
  assert(
    typeof assuranceReport.systemPosture === "string" && Array.isArray(assuranceReport.systemReasons),
    "assurance report missing system posture or reasons"
  );
  const validatedMissionAssurance = assuranceReport.missions.find((mission) => mission.missionId === missionId);
  assert(validatedMissionAssurance, "assurance report missing validated mission");
  assert(
    Array.isArray(validatedMissionAssurance.reasons) && validatedMissionAssurance.reasons.length > 0,
    "validated mission missing assurance reasons"
  );
  console.log(
    `[core] assurance report posture ${validatedMissionAssurance.assurancePosture} with ${validatedMissionAssurance.reasons.length} reason(s)`
  );
  await request("/operator/assurance/attest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ actor: "validate-core", missionId })
  });
  const assuranceArtifacts = await request(
    `/operator/ledger/artifacts?traceId=${encodeURIComponent(missionId)}&artifactType=${encodeURIComponent("assurance-attestation")}`
  );
  assert(
    assuranceArtifacts.items.some((artifact) => artifact.artifactType === "assurance-attestation"),
    "mission assurance attestation missing immutable artifact"
  );
  assert(
    assuranceArtifacts.items.some(
      (artifact) => artifact.artifactType === "assurance-attestation" && Array.isArray(artifact.reasons) && artifact.reasons.length > 0
    ),
    "mission assurance attestation missing explicit reasons"
  );
  assert(
    assuranceArtifacts.items.some(
      (artifact) =>
        artifact.artifactType === "assurance-attestation" &&
        artifact.verification?.status === "verified" &&
        artifact.signature &&
        artifact.digest
    ),
    "mission assurance attestation missing verified immutable evidence"
  );
  console.log("[core] assurance attestation committed to immutable evidence");
  await request("/operator/assurance/attest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ actor: "validate-core" })
  });
  const systemAssuranceArtifacts = await request(
    `/operator/ledger/artifacts?traceId=${encodeURIComponent("system-assurance")}&artifactType=${encodeURIComponent("assurance-attestation")}`
  );
  assert(
    systemAssuranceArtifacts.items.some(
      (artifact) =>
        artifact.artifactType === "assurance-attestation" &&
        artifact.reportScope === "system" &&
        Array.isArray(artifact.reasons) &&
        artifact.reasons.length > 0
    ),
    "system assurance attestation missing immutable artifact or reasons"
  );
  assert(
    systemAssuranceArtifacts.items.some(
      (artifact) =>
        artifact.artifactType === "assurance-attestation" &&
        artifact.reportScope === "system" &&
        artifact.verification?.status === "verified" &&
        artifact.signature &&
        artifact.digest
    ),
    "system assurance attestation missing verified immutable evidence"
  );
  console.log("[core] system assurance attestation committed to immutable evidence");

  await request("/operator/kill-switch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      actor: "validate-core",
      reason: "core validation reset",
      scope: "domain",
      scopeRef: "workspace",
      state: "inactive"
    })
  });

  console.log("[core] validation passed");
}

main().catch((error) => {
  console.error("[core] validation failed");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
