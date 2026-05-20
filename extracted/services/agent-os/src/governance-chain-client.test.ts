/**
 * Integration test for the agent-os -> kernel /v2 chain client. Boots the REAL
 * kernel /v2 routes on an ephemeral port (so this exercises the actual HTTP
 * contract, not a stub) and drives the agent-os mapping through them.
 *
 * Run: `tsx src/governance-chain-client.test.ts` (or `corepack pnpm --filter
 * @aristotle/agent-os test`). Requires @aristotle/governance-core built + linked.
 */

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { createGovernanceChain, registerGovernanceChainRoutes } from "../../governance-kernel/src/governance-chain.js";
import { createChainClient, type CommitTaskInput } from "./governance-chain-client.js";

async function bootKernel() {
  const app = express();
  app.use(express.json());
  registerGovernanceChainRoutes(app, createGovernanceChain({ signingSecret: "test-secret", keyId: "governance-kernel-key" }));
  return await new Promise<{ base: string; close: () => Promise<void> }>((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({ base: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}

const iso = () => new Date().toISOString();
const mission = {
  id: "m-1",
  title: "Ship feature",
  objective: "implement and verify",
  status: "active",
  priority: "medium",
  riskLevel: "low",
  requestedBy: "acme.corp",
  targetSystem: "payments",
  governanceProfile: "default",
  assignedAgents: ["agent-executor"],
  workspaceId: "ws-1",
  requiredAuthorities: ["mission.command"],
  requiredTools: [],
  successMetrics: [],
  steps: [],
  createdAt: iso(),
  updatedAt: iso(),
} as any;
const task = {
  id: "t-1",
  missionId: "m-1",
  title: "build",
  status: "queued",
  assignedAgentId: "agent-executor",
  ownerRole: "executor",
  requiredTools: [],
  input: {},
  createdAt: iso(),
  updatedAt: iso(),
} as any;

const toolAction = {
  id: "ta-1",
  missionId: "m-1",
  taskId: "t-1",
  agentId: "agent-executor",
  kind: "shell",
  toolId: "shell",
  status: "proposed",
  summary: "run build",
  payload: { command: "npm run build" },
  constraints: [],
  createdAt: iso(),
  updatedAt: iso(),
} as any;

const baseInput = (over: Partial<CommitTaskInput> = {}): CommitTaskInput => ({
  mission,
  task,
  phase: "dispatch",
  killSwitchActive: false,
  witnessRequired: false,
  witnessAccepted: true,
  missingLeaseTools: [],
  ...over,
});

test("agent-os enforce mode: a normal task act flows through the chain and is allowed", async () => {
  const { base, close } = await bootKernel();
  try {
    const client = createChainClient({ kernelBase: base, mode: "enforce", keyId: "governance-kernel-key" });
    const r = await client.commitTaskAct(baseInput());
    assert.equal(r.ran, true);
    assert.equal(r.decision, "Allow");
    assert.ok(r.ward_id);
    assert.ok(r.warrant_id);
    assert.ok(r.gel_record_id);
  } finally {
    await close();
  }
});

test("agent-os: an active kill switch makes the act inadmissible at the Commit Gate", async () => {
  const { base, close } = await bootKernel();
  try {
    const client = createChainClient({ kernelBase: base, mode: "enforce" });
    const r = await client.commitTaskAct(baseInput({ killSwitchActive: true }));
    assert.equal(r.ran, true);
    assert.notEqual(r.decision, "Allow");
    assert.ok((r.violated_invariants ?? []).includes("envelope-operational-limit"), "kill switch denied via operational limit");
  } finally {
    await close();
  }
});

test("agent-os shadow mode: the chain runs and records a decision", async () => {
  const { base, close } = await bootKernel();
  try {
    const client = createChainClient({ kernelBase: base, mode: "shadow" });
    const r = await client.commitTaskAct(baseInput({ phase: "completion" }));
    assert.equal(r.ran, true);
    assert.equal(r.mode, "shadow");
    assert.equal(r.decision, "Allow");
  } finally {
    await close();
  }
});

test("completion acts are accepted by the same mission chain", async () => {
  const { base, close } = await bootKernel();
  try {
    const client = createChainClient({ kernelBase: base, mode: "enforce" });
    const dispatch = await client.commitTaskAct(baseInput({ phase: "dispatch" }));
    const completion = await client.commitTaskAct(baseInput({ phase: "completion" }));
    assert.equal(dispatch.decision, "Allow");
    assert.equal(completion.decision, "Allow");
    // Distinct single-use warrants per act.
    assert.notEqual(dispatch.warrant_id, completion.warrant_id);
  } finally {
    await close();
  }
});

test("agent-os: a tool action flows through the chain and is allowed", async () => {
  const { base, close } = await bootKernel();
  try {
    const client = createChainClient({ kernelBase: base, mode: "enforce", keyId: "governance-kernel-key" });
    const r = await client.commitToolAct({ mission, task, action: toolAction, killSwitchActive: false });
    assert.equal(r.ran, true);
    assert.equal(r.decision, "Allow");
    assert.ok(r.warrant_id);
  } finally {
    await close();
  }
});

test("agent-os: a tool action is denied at the gate when the kill switch is active", async () => {
  const { base, close } = await bootKernel();
  try {
    const client = createChainClient({ kernelBase: base, mode: "enforce" });
    const r = await client.commitToolAct({ mission, task, action: toolAction, killSwitchActive: true });
    assert.equal(r.ran, true);
    assert.notEqual(r.decision, "Allow");
    assert.ok((r.violated_invariants ?? []).includes("envelope-operational-limit"));
  } finally {
    await close();
  }
});

test("agent-os: witness obligation is enforced — required+accepted allows, required+unaccepted denies", async () => {
  const { base, close } = await bootKernel();
  try {
    const client = createChainClient({ kernelBase: base, mode: "enforce" });
    const satisfied = await client.commitTaskAct(baseInput({ witnessRequired: true, witnessAccepted: true }));
    assert.equal(satisfied.decision, "Allow");

    const unsatisfied = await client.commitTaskAct(baseInput({ witnessRequired: true, witnessAccepted: false }));
    assert.notEqual(unsatisfied.decision, "Allow");
    assert.ok((unsatisfied.violated_invariants ?? []).includes("envelope-operational-limit"));
  } finally {
    await close();
  }
});
