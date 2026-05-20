/**
 * Integration test for the gateway -> kernel /v2 proxy. Boots the REAL kernel
 * /v2 routes and the proxy router on ephemeral ports, then drives the chain
 * through the gateway front door, asserting the upstream status + body are
 * forwarded verbatim (incl. a governed Deny) and that the disabled flag yields 501.
 *
 * Run: `tsx src/governance-chain-proxy.test.ts` (or `corepack pnpm --filter
 * @aristotle/http-gateway test`).
 */

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { createGovernanceChain, registerGovernanceChainRoutes } from "../../../services/governance-kernel/src/governance-chain.js";
import { createGovernanceChainProxy } from "./governance-chain-proxy.js";

function listen(app: express.Express): Promise<{ base: string; hostPort: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        base: `http://127.0.0.1:${port}`,
        hostPort: `127.0.0.1:${port}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

async function bootKernel() {
  const app = express();
  app.use(express.json());
  registerGovernanceChainRoutes(app, createGovernanceChain({ signingSecret: "test-secret", keyId: "governance-kernel-key" }));
  return listen(app);
}

async function bootGateway(kernelHostPort: string, enabled: boolean) {
  const app = express();
  app.use(express.json());
  app.use("/operator/governance-chain", createGovernanceChainProxy(kernelHostPort, enabled));
  return listen(app);
}

async function req(base: string, path: string, method = "GET", body?: unknown) {
  const r = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as any };
}

const past = new Date(Date.now() - 3_600_000).toISOString();
const P = "/operator/governance-chain";

const maeBody = () => ({
  version: "1.0.0",
  issuer: "treasury.constitution",
  constitutional_scope: ["treasury"],
  ward_creation_rules: { allowed_ward_types: ["Institutional"], require_human_origin_act: true, allowed_origin_methods: ["institutional-charter"], allowed_domains: ["treasury"] },
  ward_amendment_rules: { authorized_amenders: ["board"] },
  ward_revocation_rules: { authorized_revokers: ["board"], cascade: true },
  authority_envelope_rules: { max_delegation_depth: 3, permitted_action_classes: ["payment.refund"], prohibited_action_classes: [], require_telemetry: true },
  federation_rules: { federation_allowed: false, trusted_mae_ids: [], exportable_evidence: false },
  signing_keys: [{ key_id: "governance-kernel-key", algorithm: "hmac-sha256" }],
  effective_from: past,
});
const wardBody = (maeId: string) => ({
  mae_id: maeId,
  ward_type: "Institutional",
  name: "Treasury",
  description: "treasury",
  sovereign_root: "board",
  human_origin_act: { actor: "board", actor_kind: "institution", method: "institutional-charter", attested_at: past, attestation_ref: "charter" },
  accountable_party: "board",
  protected_interest: "funds",
  boundary_definition: { kind: "organizational", description: "treasury", predicates: [] },
  consequence_domain: "treasury",
  attribution_rule: { attributes_to: "accountable_party", description: "board" },
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
  telemetry_requirements: [],
  escalation_requirements: [],
  warrant_issuance_rules: { require_nonce: true, require_parameters_hash: true, require_context_hash: true, require_telemetry_snapshot_hash: true, max_validity_seconds: 600 },
  delegation_allowed: false,
  delegation_depth: 1,
  revocation_state: "active",
  effective_from: past,
});

test("gateway proxies the chain and forwards verdicts verbatim (allow then single-use deny)", async () => {
  const kernel = await bootKernel();
  const gw = await bootGateway(kernel.hostPort, true);
  try {
    const gate = await req(gw.base, `${P}/commit-gate`);
    assert.equal(gate.status, 200);
    assert.ok(gate.body.commit_gate_id);

    const mae = (await req(gw.base, `${P}/meta-authority-envelope`, "POST", maeBody())).body;
    const ward = (await req(gw.base, `${P}/ward`, "POST", wardBody(mae.mae_id))).body;
    const env = (await req(gw.base, `${P}/authority-envelope`, "POST", envBody(mae.mae_id, ward.ward_id))).body;

    const action = { proposed_action_id: "act-gw", action_type: "payment.refund", actor: "agent.payments", resource: "customer:X", parameters: { amount: 200, currency: "USD" } };
    const context = { ticket: "T-gw" };
    const telemetry = {};
    const warrant = (await req(gw.base, `${P}/warrant`, "POST", {
      mae_id: mae.mae_id, ward_id: ward.ward_id, authority_envelope_id: env.authority_envelope_id, issued_by: "controller", action, context, telemetry, validity_seconds: 300,
    })).body;

    const request = {
      request_id: "req-gw", mae_id: mae.mae_id, ward_id: ward.ward_id, authority_envelope_id: env.authority_envelope_id,
      warrant_id: warrant.warrant_id, commit_gate_id: gate.body.commit_gate_id, action, context, telemetry, presented_at: new Date().toISOString(),
    };
    const first = await req(gw.base, `${P}/commit`, "POST", request);
    assert.equal(first.status, 200);
    assert.equal(first.body.decision, "Allow");

    // A governed "no" is forwarded as 200 with the decision body (not an HTTP error).
    const second = await req(gw.base, `${P}/commit`, "POST", request);
    assert.equal(second.status, 200);
    assert.notEqual(second.body.decision, "Allow");
    assert.ok(second.body.violated_invariants.includes("warrant-non-replayable"));

    // Read the hash-chained ledger through the front door.
    const gel = await req(gw.base, `${P}/gel`);
    assert.equal(gel.status, 200);
    assert.ok(gel.body.count >= 2);
    assert.equal(gel.body.integrity.ok, true);

    // A genuine upstream not-found is forwarded as 404, not masked.
    const missing = await req(gw.base, `${P}/warrants/nope`);
    assert.equal(missing.status, 404);
  } finally {
    await gw.close();
    await kernel.close();
  }
});

test("gateway returns 501 when GOVERNANCE_CHAIN_V2 is disabled", async () => {
  const gw = await bootGateway("127.0.0.1:1", false);
  try {
    const r = await req(gw.base, `${P}/gel`);
    assert.equal(r.status, 501);
    assert.equal(r.body.error, "governance_chain_v2_disabled");
  } finally {
    await gw.close();
  }
});
