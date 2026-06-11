import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type AuthorityEnvelope,
  type WardManifest,
  evaluateExecutionControl,
  exportTelecomEvidenceBundle,
  gnmiSetToAction,
  loadAuthorityEnvelope,
  loadCanonicalAction,
  loadWardManifest,
  netconfEditConfigToAction,
  oranPolicyToAction,
  runCarrierScaleBenchmark,
  runReconnectStormSimulation,
  simulateMultiRegionLedgerSoak,
  telecomAdapterToAction,
  tmfOpenApiToAction,
  verifyTelecomEvidenceBundle
} from "./index.js";

const now = "2026-05-25T15:00:00.000Z";

const ward: WardManifest = {
  ward_id: "ward-ran-region-west",
  name: "RAN Region West",
  sovereignty_context: "csp-west-market-network-operations",
  authority_domain: "autonomous-network-ran",
  policy_version: "0.1.0",
  permitted_subjects: ["agent:noc-change-orchestrator"],
  physical_bounds: { permitted_boundary_id: "ran-market-west" },
  criticality: "mission_critical",
  classification: { level: "CUI", caveats: ["CPNI"] }
};

const envelope: AuthorityEnvelope = {
  envelope_id: "ae-telecom-noc-change-001",
  ward_id: ward.ward_id,
  subject: "agent:noc-change-orchestrator",
  allowed_actions: ["tmf.service-order.patch", "netconf.edit-config", "gnmi.set", "oran.a1.policy.put"],
  denied_actions: ["ran.cell.shutdown", "lawful_intercept.modify"],
  constraints: {
    required_runtime_registers: ["telemetry.change_ticket", "telemetry.maintenance_window", "telemetry.noc_operator", "telemetry.precheck_passed"],
    permitted_boundary_id: "ran-market-west"
  },
  expires_at: "2026-12-31T23:59:59Z",
  issuer: "aristotle-telecom-root",
  classification: { level: "CUI", caveats: ["CPNI"] }
};

const ctx = {
  action_id: "act-telecom-001",
  ward_id: ward.ward_id,
  subject: envelope.subject,
  requested_at: now,
  request_id: "req-telecom-001",
  telemetry: {
    change_ticket: "CHG-2026-0517",
    maintenance_window: "approved",
    noc_operator: "operator:netops-west",
    precheck_passed: true
  },
  classification: { level: "CUI" as const, caveats: ["CPNI"] }
};

function ledgerPath() {
  return path.join(mkdtempSync(path.join(tmpdir(), "aos-telecom-")), "gel.jsonl");
}

test("telecom adapter builders produce Canonical Governed Actions", () => {
  const tmf = tmfOpenApiToAction({
    api: "TMF641",
    operation: "service-order",
    method: "PATCH",
    path: "/tmf-api/serviceOrdering/v4/serviceOrder/SO-1",
    action_type: "tmf.service-order.patch",
    body: { state: "inProgress" }
  }, ctx);
  assert.equal(tmf.action_type, "tmf.service-order.patch");
  assert.equal(tmf.params.adapter, "tmf-open-api");

  const netconf = netconfEditConfigToAction({
    datastore: "candidate",
    device_id: "du-west-17",
    yang_module: "o-ran-uplane-conf",
    operation: "merge",
    patch: { tx_power_offset_db: -1 }
  }, { ...ctx, action_id: "act-telecom-002" });
  assert.equal(netconf.action_type, "netconf.edit-config");

  const gnmi = gnmiSetToAction({ device_id: "upf-west-03", path: "/qos/policies", operation: "update", value: { policy: "relief" } }, { ...ctx, action_id: "act-telecom-003" });
  assert.equal(gnmi.action_type, "gnmi.set");

  const oran = telecomAdapterToAction({
    kind: "oran-a1-r1",
    request: { ric_id: "non-rt-ric-west", interface: "A1", policy_type_id: "energy", policy_instance_id: "cell-dtx", operation: "create" }
  }, { ...ctx, action_id: "act-telecom-004" });
  assert.equal(oran.action_type, "oran.a1.policy.put");

  const r1 = oranPolicyToAction({ ric_id: "non-rt-ric-west", interface: "R1", policy_type_id: "model", policy_instance_id: "m1", operation: "deploy-model" }, { ...ctx, action_id: "act-telecom-005" });
  assert.equal(r1.action_type, "oran.r1.service.deploy-model");
});

test("sample telecom Ward and action fixtures load and drive the real gate", () => {
  const base = path.resolve(process.cwd(), "examples", "telecom");
  const sampleWard = loadWardManifest(path.join(base, "ward.ran_region_west.yaml"));
  const sampleEnvelope = loadAuthorityEnvelope(path.join(base, "authority_envelope.noc_change_orchestrator.yaml"));
  const allowed = loadCanonicalAction(path.join(base, "actions", "tmf_service_order_patch.json"));
  const denied = loadCanonicalAction(path.join(base, "actions", "refuse_cell_shutdown.json"));

  const ok = evaluateExecutionControl({ ward: sampleWard, authorityEnvelope: sampleEnvelope, action: allowed, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(ok.decision, "ALLOW");
  assert.ok(ok.warrant);
  assert.equal(ok.ledger_verification.ok, true);

  const blocked = evaluateExecutionControl({ ward: sampleWard, authorityEnvelope: sampleEnvelope, action: denied, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(blocked.decision, "REFUSE");
  assert.equal(blocked.warrant, undefined);
  assert.ok(blocked.reason_codes.includes("ACTION_DENIED"));
});

test("telecom evidence bundle wraps execution evidence with NOC context", () => {
  const action = tmfOpenApiToAction({
    api: "TMF641",
    operation: "service-order",
    method: "PATCH",
    path: "/tmf-api/serviceOrdering/v4/serviceOrder/SO-1",
    action_type: "tmf.service-order.patch"
  }, ctx);
  const ledger = ledgerPath();
  const result = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledger, now, replayProtection: false });
  const bundle = exportTelecomEvidenceBundle({
    ledgerPath: ledger,
    ward,
    authorityEnvelope: envelope,
    recordId: result.gel_record.record_id,
    warrant: result.warrant,
    exportedAt: now,
    telecom: {
      change_ticket: "CHG-2026-0517",
      noc_operator: "operator:netops-west",
      network_domain: "ran",
      network_scope: "ran-market-west",
      impacted_services: ["mobile-broadband"],
      customer_impact: "low",
      rollback_plan: "confirmed rollback in change ticket",
      pre_checks: [{ name: "maintenance window", ok: true }],
      post_checks: [{ name: "service alarms", ok: true }],
      standards_profile: ["TMF_OPEN_API", "ORAN_A1_R1", "3GPP_NWDAF"],
      redacted_fields: ["subscriber_id", "imsi"]
    }
  });
  assert.equal(bundle.bundle_version, "aristotle.telecom-evidence.v1");
  assert.equal(bundle.verification.ok, true);
  assert.equal(verifyTelecomEvidenceBundle(bundle).ok, true);
});

test("carrier benchmark, reconnect storm, and multi-region soak are deterministic enough for CI", () => {
  const bench = runCarrierScaleBenchmark({ ward, authorityEnvelope: envelope, actionCount: 16, now });
  assert.equal(bench.action_count, 16);
  assert.equal(bench.ledger_verification.ok, true);
  assert.equal(bench.refused, 0);

  const storm = runReconnectStormSimulation({ ward, authorityEnvelope: envelope, edgeNodes: 3, recordsPerNode: 10, now });
  assert.equal(storm.total_records, 30);
  assert.ok(storm.conflicts > 0);
  assert.ok(storm.records_per_second > 0);

  const soak = simulateMultiRegionLedgerSoak({ ward, authorityEnvelope: envelope, regions: ["east", "west"], decisionsPerRegion: 8, now });
  assert.equal(soak.total_decisions, 16);
  assert.equal(soak.ledger_verification.ok, true);
  assert.deepEqual(soak.region_counts, { east: 8, west: 8 });
});
