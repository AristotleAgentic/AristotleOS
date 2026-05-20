/**
 * Integration test for the kernel's GOVERNANCE_CHAIN_V2 routes. Boots the express
 * routes on an ephemeral port and drives the full chain over HTTP:
 *   create MAE -> Ward -> Authority Envelope -> Warrant -> commit (Allow,
 *   warrant consumed) -> re-commit (denied, single-use) -> GEL chain intact.
 *
 * Run: `tsx src/governance-chain.test.ts` (or `corepack pnpm --filter
 * @aristotle/governance-kernel test`). Requires @aristotle/governance-core to be
 * built (dist) and linked.
 */

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  commitRequestFor,
  constituteWard,
  createAuthorityEnvelope,
  createMae,
  evaluateCommit,
  issueWarrant,
  verifyGelChain,
} from "@aristotle/governance-core";
import { createGovernanceChain, registerGovernanceChainRoutes } from "./governance-chain.js";

async function boot() {
  const app = express();
  app.use(express.json());
  const chain = createGovernanceChain({ signingSecret: "test-secret", keyId: "test-key" });
  registerGovernanceChainRoutes(app, chain);
  return await new Promise<{ base: string; close: () => Promise<void> }>((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

async function post(base: string, path: string, body: unknown) {
  const r = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as any };
}
async function get(base: string, path: string) {
  const r = await fetch(base + path);
  return { status: r.status, body: (await r.json()) as any };
}

const past = new Date(Date.now() - 3_600_000).toISOString();

const maeBody = () => ({
  version: "1.0.0",
  issuer: "treasury.constitution",
  constitutional_scope: ["treasury"],
  ward_creation_rules: {
    allowed_ward_types: ["Institutional"],
    require_human_origin_act: true,
    allowed_origin_methods: ["institutional-charter"],
    allowed_domains: ["treasury"],
  },
  ward_amendment_rules: { authorized_amenders: ["board"] },
  ward_revocation_rules: { authorized_revokers: ["board"], cascade: true },
  authority_envelope_rules: { max_delegation_depth: 3, permitted_action_classes: ["payment.refund"], prohibited_action_classes: [], require_telemetry: true },
  federation_rules: { federation_allowed: false, trusted_mae_ids: [], exportable_evidence: false },
  signing_keys: [{ key_id: "test-key", algorithm: "hmac-sha256" }],
  effective_from: past,
});

const wardBody = (maeId: string) => ({
  mae_id: maeId,
  ward_type: "Institutional",
  name: "Company Treasury Domain",
  description: "treasury domain",
  sovereign_root: "board",
  human_origin_act: { actor: "board", actor_kind: "institution", method: "institutional-charter", attested_at: past, attestation_ref: "charter-1" },
  accountable_party: "board",
  protected_interest: "company funds",
  boundary_definition: { kind: "organizational", description: "treasury", predicates: [] },
  consequence_domain: "treasury",
  attribution_rule: { attributes_to: "accountable_party", description: "to the board" },
  governor_registry: ["controller"],
  delegation_rules: { who_may_create_authority_envelopes: ["board", "controller"], who_may_issue_warrants: ["controller"], max_delegation_depth: 3, may_federate: false },
  authority_envelope_constraints: { permitted_action_classes: ["payment.refund"], prohibited_action_classes: [], max_monetary_limit: { currency: "USD", max_amount: 5000 } },
  warrant_constraints: { max_validity_seconds: 600, require_nonce: true, require_telemetry_snapshot: true, single_use: true },
  revocation_rules: { authorized_revokers: ["board"], cascade: true },
  evidence_requirements: { require_gel_record: true, hash_chained: true, record_denials: true, record_escalations: true },
  effective_from: past,
});

const envBody = (maeId: string, wardId: string) => ({
  ward_id: wardId,
  mae_id: maeId,
  subject: "agent.payments",
  actor_type: "Agent",
  authored_by: "controller",
  allowed_action_classes: ["payment.refund"],
  prohibited_action_classes: [],
  resource_scope: ["customer:X"],
  temporal_scope: { from: past },
  monetary_limits: { currency: "USD", max_amount: 500 },
  operational_limits: [],
  telemetry_requirements: [{ key: "fraud_score", op: "lt", value: 0.8 }],
  escalation_requirements: [],
  warrant_issuance_rules: { require_nonce: true, require_parameters_hash: true, require_context_hash: true, require_telemetry_snapshot_hash: true, max_validity_seconds: 600 },
  delegation_allowed: false,
  delegation_depth: 1,
  revocation_state: "active",
  effective_from: past,
});

test("kernel /v2 chain: create -> commit allows and consumes -> reuse denied -> GEL intact", async () => {
  const { base, close } = await boot();
  try {
    const gate = (await get(base, "/v2/commit-gate")).body;
    assert.ok(gate.commit_gate_id, "commit gate exists");

    const mae = (await post(base, "/v2/meta-authority-envelope", maeBody())).body;
    assert.ok(mae.mae_id);

    const ward = (await post(base, "/v2/ward", wardBody(mae.mae_id))).body;
    assert.ok(ward.ward_id);

    const env = (await post(base, "/v2/authority-envelope", envBody(mae.mae_id, ward.ward_id))).body;
    assert.ok(env.authority_envelope_id);

    const action = { proposed_action_id: "act-1", action_type: "payment.refund", actor: "agent.payments", resource: "customer:X", parameters: { amount: 412, currency: "USD" } };
    const context = { ticket: "T-1042" };
    const telemetry = { fraud_score: 0.1 };

    const warrant = (await post(base, "/v2/warrant", {
      mae_id: mae.mae_id,
      ward_id: ward.ward_id,
      authority_envelope_id: env.authority_envelope_id,
      issued_by: "controller",
      action,
      context,
      telemetry,
      validity_seconds: 300,
    })).body;
    assert.ok(warrant.warrant_id);
    assert.equal(warrant.consumption_state, "Unused");

    const request = {
      request_id: "req-1",
      mae_id: mae.mae_id,
      ward_id: ward.ward_id,
      authority_envelope_id: env.authority_envelope_id,
      warrant_id: warrant.warrant_id,
      commit_gate_id: gate.commit_gate_id,
      action,
      context,
      telemetry,
      presented_at: new Date().toISOString(),
    };

    const first = (await post(base, "/v2/commit", request)).body;
    assert.equal(first.decision, "Allow");
    assert.equal(first.warrant_consumed, true);
    assert.ok(first.gel_record_id);

    const second = (await post(base, "/v2/commit", request)).body;
    assert.notEqual(second.decision, "Allow");
    assert.ok(second.violated_invariants.includes("warrant-non-replayable"));

    const consumed = (await get(base, `/v2/warrants/${warrant.warrant_id}`)).body;
    assert.equal(consumed.consumption_state, "Consumed");

    const gel = (await get(base, "/v2/gel")).body;
    assert.ok(gel.count >= 2, "ledger recorded allow + denial");
    assert.equal(gel.integrity.ok, true, "GEL chain verifies");

    const metrics = (await get(base, "/v2/metrics")).body;
    assert.equal(metrics.wards, 1);
    assert.ok(metrics.warrants.consumed >= 1);
    assert.ok(metrics.gel.by_decision.Allow >= 1);
    assert.equal(metrics.gel.integrity_ok, true);
  } finally {
    await close();
  }
});

test("kernel /v2 chain state survives a restart (durable store)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gov-chain-"));
  const statePath = join(dir, "chain.json");
  try {
    // Boot 1: build the chain and consume a warrant.
    const c1 = createGovernanceChain({ signingSecret: "test-secret", keyId: "governance-kernel-key", statePath });
    const mae = createMae(c1.store, c1.keyring, c1.signKeyId, maeBody());
    const ward = constituteWard(c1.store, c1.keyring, c1.signKeyId, wardBody(mae.mae_id));
    const env = createAuthorityEnvelope(c1.store, c1.keyring, c1.signKeyId, envBody(mae.mae_id, ward.ward_id));
    const action = { proposed_action_id: "act-d", action_type: "payment.refund", actor: "agent.payments", resource: "customer:X", parameters: { amount: 100, currency: "USD" } };
    const context = { ticket: "T-durable" };
    const telemetry = { fraud_score: 0.1 };
    const warrant = issueWarrant(c1.store, c1.keyring, c1.signKeyId, {
      mae_id: mae.mae_id,
      ward_id: ward.ward_id,
      authority_envelope_id: env.authority_envelope_id,
      issued_by: "controller",
      action,
      context,
      telemetry,
      validity_seconds: 300,
    });
    const request = commitRequestFor({ warrant, commit_gate_id: c1.gate.commit_gate_id, action, context, telemetry });
    assert.equal(evaluateCommit(c1.store, request, c1.options()).decision, "Allow");
    await c1.flush();

    // Boot 2: a fresh chain on the same path loads the persisted state.
    const c2 = createGovernanceChain({ signingSecret: "test-secret", keyId: "governance-kernel-key", statePath });
    assert.ok(c2.store.getWard(ward.ward_id), "ward restored");
    assert.equal(c2.store.getWarrant(warrant.warrant_id)?.consumption_state, "Consumed", "warrant consumption persisted");
    assert.equal(verifyGelChain(c2.store.getGelChain(), c2.keyring).ok, true, "GEL chain intact after restart");

    // The consumed warrant cannot be replayed against the restored store.
    const replay = evaluateCommit(c2.store, request, c2.options());
    assert.notEqual(replay.decision, "Allow");
    assert.ok(replay.violated_invariants.includes("warrant-non-replayable"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("kernel /v2 chain signs and verifies with ed25519 when key paths are provided", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gov-chain-ed-"));
  try {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const privPath = join(dir, "priv.pem");
    const pubPath = join(dir, "pub.pem");
    writeFileSync(privPath, privateKey.export({ type: "pkcs8", format: "pem" }) as string);
    writeFileSync(pubPath, publicKey.export({ type: "spki", format: "pem" }) as string);

    const c = createGovernanceChain({ keyId: "governance-kernel-key", signingPrivateKeyPath: privPath, signingPublicKeyPath: pubPath });
    assert.equal(c.signingMode, "ed25519");

    const mae = createMae(c.store, c.keyring, c.signKeyId, maeBody());
    const ward = constituteWard(c.store, c.keyring, c.signKeyId, wardBody(mae.mae_id));
    const env = createAuthorityEnvelope(c.store, c.keyring, c.signKeyId, envBody(mae.mae_id, ward.ward_id));
    const action = { proposed_action_id: "act-ed", action_type: "payment.refund", actor: "agent.payments", resource: "customer:X", parameters: { amount: 50, currency: "USD" } };
    const warrant = issueWarrant(c.store, c.keyring, c.signKeyId, {
      mae_id: mae.mae_id,
      ward_id: ward.ward_id,
      authority_envelope_id: env.authority_envelope_id,
      issued_by: "controller",
      action,
      context: {},
      telemetry: { fraud_score: 0.1 },
      validity_seconds: 300,
    });
    const request = commitRequestFor({ warrant, commit_gate_id: c.gate.commit_gate_id, action, context: {}, telemetry: { fraud_score: 0.1 } });
    const decision = evaluateCommit(c.store, request, c.options());
    assert.equal(decision.decision, "Allow", `reasons=${JSON.stringify(decision.violated_invariants)}`);
    assert.equal(verifyGelChain(c.store.getGelChain(), c.keyring).ok, true, "ed25519-signed GEL verifies");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("kernel /v2 commit fails closed on a missing warrant", async () => {
  const { base, close } = await boot();
  try {
    const gate = (await get(base, "/v2/commit-gate")).body;
    const mae = (await post(base, "/v2/meta-authority-envelope", maeBody())).body;
    const ward = (await post(base, "/v2/ward", wardBody(mae.mae_id))).body;
    const env = (await post(base, "/v2/authority-envelope", envBody(mae.mae_id, ward.ward_id))).body;
    const action = { proposed_action_id: "act-x", action_type: "payment.refund", actor: "agent.payments", resource: "customer:X", parameters: { amount: 10 } };
    const decision = (await post(base, "/v2/commit", {
      request_id: "req-x",
      mae_id: mae.mae_id,
      ward_id: ward.ward_id,
      authority_envelope_id: env.authority_envelope_id,
      warrant_id: "warrant-does-not-exist",
      commit_gate_id: gate.commit_gate_id,
      action,
      context: {},
      telemetry: {},
      presented_at: new Date().toISOString(),
    })).body;
    assert.equal(decision.decision, "FailClosed");
    assert.ok(decision.reasons.includes("warrant-not-found"));
  } finally {
    await close();
  }
});
