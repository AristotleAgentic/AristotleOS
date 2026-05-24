import test from "node:test";
import assert from "node:assert/strict";
import {
  type CommandRunner,
  collectObservations,
  kubernetesCollector,
  looksLikeAgent,
  mcpCollector,
  normalizeObservations,
  parseKubernetesPods,
  parseMcpInventory,
  parseProcessList,
  parsePsText,
  processCollector,
  runWardMarshalCensus
} from "./index.js";

const NOW = "2026-05-24T12:00:00.000Z";

const podsDoc = {
  items: [
    {
      metadata: {
        namespace: "agents",
        name: "analyst-bot-7d9",
        labels: { "aristotle.agent-id": "analyst-bot", "aristotle.ward": "ward-finance", owner: "fin-team" },
        annotations: { "aristotle.io/tools": "warehouse.read, slack.post", "aristotle.io/credentials": "vault:fin-ro" }
      },
      spec: { serviceAccountName: "agent:analyst", containers: [{ name: "bot", image: "ghcr.io/acme/analyst:1.2" }] },
      status: { phase: "Running" }
    },
    {
      metadata: { namespace: "shadow", name: "mystery-runner", labels: {}, annotations: {} },
      spec: { serviceAccountName: "default", containers: [{ name: "runner", image: "python:3.12" }] },
      status: { phase: "Running" }
    }
  ]
};

test("parseKubernetesPods maps pods to observations with the aristotle.* conventions", () => {
  const observations = parseKubernetesPods(podsDoc, NOW);
  assert.equal(observations.length, 2);
  const analyst = observations.find((o) => o.observation_id === "k8s:agents/analyst-bot-7d9")!;
  assert.equal(analyst.source, "kubernetes");
  assert.equal(analyst.observed_at, NOW);
  assert.equal(analyst.declared_agent_id, "analyst-bot");
  assert.equal(analyst.ward_id, "ward-finance");
  assert.equal(analyst.service_account, "agent:analyst");
  assert.deepEqual(analyst.tool_targets, ["warehouse.read", "slack.post"]);
  assert.deepEqual(analyst.credential_refs, ["vault:fin-ro"]);
  assert.equal(analyst.container_image, "ghcr.io/acme/analyst:1.2");
  assert.equal(analyst.labels?.["k8s.phase"], "Running");
  // deterministic ordering by observation_id
  assert.deepEqual(observations.map((o) => o.observation_id), ["k8s:agents/analyst-bot-7d9", "k8s:shadow/mystery-runner"]);
});

test("kubernetesCollector uses the injected runner and parses its output", async () => {
  let calledWith: string[] = [];
  const runner: CommandRunner = ({ command, args }) => {
    calledWith = [command, ...args];
    return { status: 0, stdout: JSON.stringify(podsDoc), stderr: "" };
  };
  const collector = kubernetesCollector({ runner, now: NOW });
  const observations = await collector.collect();
  assert.equal(collector.source, "kubernetes");
  assert.deepEqual(calledWith, ["kubectl", "get", "pods", "-A", "-o", "json"]);
  assert.equal(observations.length, 2);
});

test("kubernetesCollector fails soft on a non-zero runner (no throw, empty set)", async () => {
  const runner: CommandRunner = () => ({ status: 1, stdout: "", stderr: "Unable to connect to the server" });
  const observations = await kubernetesCollector({ runner, now: NOW }).collect();
  assert.deepEqual(observations, []);
});

test("normalizeObservations maps an arbitrary feed via a field mapping", () => {
  const records = [
    { id: "run-42", repo: "acme/api", actor: "ci-agent", tools: "gh.deploy,npm.publish" },
    { id: "run-43", repo: "acme/web", actor: "ci-agent", tools: ["gh.deploy"] }
  ];
  const observations = normalizeObservations(records, {
    source: "ci",
    now: NOW,
    mapping: { observation_id: "id", location: "repo", declared_agent_id: "actor", tool_targets: "tools" }
  });
  assert.equal(observations.length, 2);
  assert.equal(observations[0].source, "ci");
  assert.equal(observations[0].location, "acme/api");
  assert.deepEqual(observations[0].tool_targets, ["gh.deploy", "npm.publish"]);
  assert.deepEqual(observations[1].tool_targets, ["gh.deploy"]);
});

test("collectObservations merges + dedupes across collectors", async () => {
  const k8s = kubernetesCollector({ runner: () => ({ status: 0, stdout: JSON.stringify(podsDoc), stderr: "" }), now: NOW });
  const dupRunner = kubernetesCollector({ runner: () => ({ status: 0, stdout: JSON.stringify(podsDoc), stderr: "" }), now: NOW });
  const merged = await collectObservations([k8s, dupRunner]);
  assert.equal(merged.length, 2, "identical observation_ids are deduped");
});

test("discovery flows into the census end-to-end (shadow pod is flagged)", async () => {
  const observations = await kubernetesCollector({ runner: () => ({ status: 0, stdout: JSON.stringify(podsDoc), stderr: "" }), now: NOW }).collect();
  const report = runWardMarshalCensus({ observations, generatedAt: NOW });
  assert.equal(report.summary.observed, 2);
  // the mystery pod with no registry entry and a default SA should not be "governed"
  const mystery = report.findings.find((f) => f.observed_locations.includes("shadow/mystery-runner"));
  assert.ok(mystery, "expected a finding for the undeclared pod");
  assert.notEqual(mystery!.status, "governed");
});

test("looksLikeAgent flags agent runtimes and LLM egress, ignores ordinary processes", () => {
  assert.equal(looksLikeAgent({ comm: "node", args: "node refund-agent.js --autonomous" }), true);
  assert.equal(looksLikeAgent({ comm: "python3", args: "python3 -m langgraph.run" }), true);
  assert.equal(looksLikeAgent({ comm: "curl", args: "curl https://api.openai.com/v1/responses" }), true); // LLM egress
  assert.equal(looksLikeAgent({ comm: "nginx", args: "nginx -g daemon off;" }), false);
  assert.equal(looksLikeAgent({ comm: "bash", args: "bash deploy.sh" }), false);
});

test("parseProcessList keeps only candidate agents and extracts LLM endpoints", () => {
  const records = [
    { pid: 100, user: "fin", comm: "node", args: "node refund-workflow.js --agent --model https://api.openai.com/v1/responses" },
    { pid: 101, user: "root", comm: "sshd", args: "sshd: accepted" },
    { pid: 102, user: "ops", comm: "python3", args: "python3 crewai_runner.py" }
  ];
  const obs = parseProcessList(records, NOW, "finance-17");
  assert.equal(obs.length, 2); // sshd dropped
  const refund = obs.find((o) => o.location === "finance-17/process/100");
  assert.equal(refund?.source, "developer-workstation");
  assert.equal(refund?.owner, "fin");
  assert.deepEqual(refund?.llm_endpoints, ["https://api.openai.com/v1/responses"]);
  assert.deepEqual(refund?.outbound_hosts, ["api.openai.com"]);
});

test("parsePsText parses `ps -eo pid,user,comm,args` output incl. header", () => {
  const stdout = [
    "  PID USER     COMMAND         COMMAND",
    "  100 fin      node            node agent.js --autonomous",
    "  101 root     sshd            sshd: listener"
  ].join("\n");
  const recs = parsePsText(stdout);
  assert.equal(recs.length, 2);
  assert.equal(recs[0].pid, "100");
  assert.equal(recs[0].comm, "node");
  assert.equal(recs[0].args, "node agent.js --autonomous");
});

test("processCollector runs ps via the injected runner and parses candidates", async () => {
  const runner: CommandRunner = ({ command }) => {
    assert.equal(command, "ps");
    return { status: 0, stdout: "PID USER COMMAND COMMAND\n200 dev node node langchain-agent.js\n201 dev vim vim notes.txt\n", stderr: "" };
  };
  const obs = await processCollector({ runner, host: "ws-1", now: NOW }).collect();
  assert.equal(obs.length, 1);
  assert.equal(obs[0].process_name, "node");
  assert.equal(obs[0].location, "ws-1/process/200");
});

test("parseMcpInventory maps MCP servers to observations", () => {
  const doc = { servers: [
    { name: "prod-shell", service_account: "cluster-admin-agent", tools: ["shell.exec", "kubectl.production.deploy"], credentials: ["kubeconfig:prod-admin"] },
    { name: "ticketing", owner: "support", tools: ["zendesk.ticket.create"] }
  ] };
  const obs = parseMcpInventory(doc, NOW);
  assert.equal(obs.length, 2);
  const shell = obs.find((o) => o.observation_id === "mcp:prod-shell");
  assert.equal(shell?.source, "mcp");
  assert.equal(shell?.service_account, "cluster-admin-agent");
  assert.deepEqual(shell?.tool_targets, ["shell.exec", "kubectl.production.deploy"]);
});

test("mcpCollector parses the injected inventory and a rogue prod-shell scores high", async () => {
  const runner: CommandRunner = () => ({ status: 0, stdout: JSON.stringify({ servers: [{ name: "prod-shell", service_account: "cluster-admin-agent", tools: ["shell.exec", "firewall.rules.write"], credentials: ["kubeconfig:prod-admin"] }] }), stderr: "" });
  const observations = await mcpCollector({ runner, now: NOW }).collect();
  const report = runWardMarshalCensus({ observations, generatedAt: NOW });
  assert.equal(report.summary.observed, 1);
  assert.ok(report.summary.rogue >= 1);
});

test("collectObservations merges host + mcp collectors into one deduped set", async () => {
  const psRunner: CommandRunner = () => ({ status: 0, stdout: "PID USER COMMAND COMMAND\n300 ops python3 python3 autogen_agent.py\n", stderr: "" });
  const mcpRunner: CommandRunner = () => ({ status: 0, stdout: JSON.stringify({ servers: [{ name: "s1", tools: ["x"] }] }), stderr: "" });
  const all = await collectObservations([
    processCollector({ runner: psRunner, host: "h1", now: NOW }),
    mcpCollector({ runner: mcpRunner, now: NOW })
  ]);
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((o) => o.source).sort(), ["developer-workstation", "mcp"]);
});
