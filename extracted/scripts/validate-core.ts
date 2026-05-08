const gatewayBaseUrl = process.env.GATEWAY_BASE_URL ?? "http://localhost:8080";

type Json = Record<string, unknown>;

const toUrl = (path: string) => `${gatewayBaseUrl}${path}`;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(toUrl(path), init);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${path} failed with ${response.status}${body ? `: ${body}` : ""}`);
  }
  return response.json() as Promise<T>;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const runId = `core-${Date.now().toString(36)}`;
  console.log(`[core] validating against ${gatewayBaseUrl}`);

  const health = await request<{ ok: boolean; services: Array<{ status: string; value?: { service?: string } }> }>("/health");
  assert(health.ok, "gateway health is not ok");
  console.log(`[core] health ok`);

  const missionCreated = await request<{
    mission: { id: string; title: string };
  }>("/operator/os/missions", {
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

  const state = await request<{
    executionTasks: Array<{
      id: string;
      missionId: string;
      status: string;
      governance?: {
        route?: {
          selectedPath: string[];
          mode: string;
        };
      };
    }>;
  }>("/operator/os/state");
  const governedTask = state.executionTasks.find(
    (task) => task.missionId === missionId && task.governance?.route?.selectedPath?.length
  );
  assert(governedTask, "no governed task with authority route was created");
  console.log(`[core] dispatch route ${governedTask.governance?.route?.selectedPath.join(" -> ")}`);

  await request("/operator/kill-switch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      actor: "validate-core",
      reason: "core validation scoped halt",
      scope: "mission",
      scopeRef: missionId,
      state: "active"
    })
  });
  console.log(`[core] activated mission scoped halt`);

  await request(`/operator/os/missions/${missionId}/advance`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "execute", actor: "validate-core" })
  });

  const haltedState = await request<{
    executionTasks: Array<{
      id: string;
      missionId: string;
      status: string;
      governance?: { reasons?: string[] };
    }>;
  }>("/operator/os/state");
  const blockedTask = haltedState.executionTasks.find(
    (task) => task.missionId === missionId && task.status === "blocked" && task.governance?.reasons?.some((reason) => reason.includes("Kill switch active"))
  );
  assert(blockedTask, "scoped halt did not block mission task");
  console.log(`[core] scoped halt blocked ${blockedTask.id}`);

  const replay = await request<{ committed: Array<{ eventKind: string }> }>(`/operator/ledger?traceId=${encodeURIComponent(missionId)}`);
  assert(replay.committed.some((event) => event.eventKind === "governance.kill-switch.updated"), "kill-switch replay event missing");
  console.log(`[core] sovereign halt recorded in replay`);

  const projection = await request<{
    branch: { id: string };
    projection: { projectedOutcome: string; projectedRoute?: { selectedPath: string[] } };
  }>("/operator/replay/counterfactual", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      parentTraceId: missionId,
      label: `Core reroute ${runId}`,
      missionId,
      taskId: governedTask.id,
      injectKillSwitch: false,
      degradedNodes: ["mesh.alpha"],
      route: governedTask.governance?.route
    satisfies Json)
  });
  assert(projection.projection.projectedOutcome === "reroute", "counterfactual reroute projection did not reroute");

  const branchArtifacts = await request<{ items: Array<{ artifactType: string }> }>(
    `/operator/ledger/artifacts?branchId=${encodeURIComponent(projection.branch.id)}`
  );
  assert(branchArtifacts.items.some((artifact) => artifact.artifactType === "authority-envelope"), "counterfactual branch artifacts missing authority envelope");
  console.log(`[core] counterfactual branch ${projection.branch.id} has projected route artifacts`);

  await request("/operator/kill-switch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      actor: "validate-core",
      reason: "core validation reset",
      scope: "mission",
      scopeRef: missionId,
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
