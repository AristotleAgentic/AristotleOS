import test from "node:test";
import assert from "node:assert/strict";
import {
  type CommandRunner,
  collectObservations,
  kubernetesCollector,
  normalizeObservations,
  parseKubernetesPods,
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
