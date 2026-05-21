import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gatewaySource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

test("gateway exposes public trial API routes", () => {
  for (const route of [
    '"/v1/actions/evaluate"',
    '"/v1/actions/execute"',
    '"/v1/audit/tail"',
    '"/v1/audit/:recordId"',
    '"/v1/replay"',
    '"/v1/approvals"',
    '"/v1/approvals/:id/approve"',
    '"/v1/approvals/:id/deny"',
    '"/v1/policy/check"',
    '"/v1/policy/plan"',
    '"/v1/policy/apply"',
    '"/v1/status"'
  ]) {
    assert.ok(gatewaySource.includes(route), `${route} route should be present`);
  }
});

test("trial API shares deterministic evaluator", () => {
  assert.ok(gatewaySource.includes("evaluateTrialAction"));
  assert.ok(gatewaySource.includes("validateGovernanceSource"));
  assert.ok(gatewaySource.includes("planGovernanceChange"));
});
