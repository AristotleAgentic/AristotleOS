import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAudit, parseAuditReport } from "./audit-deps.mjs";

const v6Report = {
  advisories: {
    "1100": { id: 1100, github_advisory_id: "GHSA-aaaa-bbbb-cccc", severity: "high", module_name: "left-pad", title: "ReDoS", url: "https://example/ghsa" },
    "1101": { id: 1101, severity: "moderate", module_name: "qs", title: "Prototype pollution", url: "https://example/qs" },
    "1102": { id: 1102, github_advisory_id: "GHSA-dddd-eeee-ffff", severity: "critical", module_name: "evil", title: "RCE", url: "https://example/evil" }
  }
};

test("parseAuditReport normalizes the v6 advisories map", () => {
  const advisories = parseAuditReport(v6Report);
  assert.equal(advisories.length, 3);
  const high = advisories.find((a) => a.module === "left-pad");
  assert.equal(high.severity, "high");
  assert.ok(high.ids.includes("GHSA-aaaa-bbbb-cccc"));
});

test("parseAuditReport normalizes the v7+ vulnerabilities map", () => {
  const v7 = { vulnerabilities: { axios: { severity: "high", via: [{ source: 1234, name: "axios", title: "SSRF", url: "https://example/axios" }] } } };
  const advisories = parseAuditReport(v7);
  assert.equal(advisories.length, 1);
  assert.equal(advisories[0].module, "axios");
  assert.equal(advisories[0].severity, "high");
});

test("evaluateAudit blocks high+critical advisories by default", () => {
  const result = evaluateAudit({ advisories: parseAuditReport(v6Report) });
  assert.equal(result.ok, false);
  assert.equal(result.blocking.length, 2); // high + critical; moderate is below threshold
});

test("evaluateAudit ignores advisories below the fail threshold", () => {
  const moderateOnly = { advisories: { "1": { id: 1, severity: "moderate", module_name: "qs", title: "x", url: "" } } };
  const result = evaluateAudit({ advisories: parseAuditReport(moderateOnly) });
  assert.equal(result.ok, true);
  assert.equal(result.blocking.length, 0);
});

test("evaluateAudit honors a non-expired allowlist entry by GHSA id", () => {
  const allowlist = [
    { id: "GHSA-aaaa-bbbb-cccc", reason: "no exploit path in our usage", expires: "2999-01-01" },
    { id: "GHSA-dddd-eeee-ffff", reason: "patch pending upstream", expires: "2999-01-01" }
  ];
  const result = evaluateAudit({ advisories: parseAuditReport(v6Report), allowlist });
  assert.equal(result.ok, true);
  assert.equal(result.blocking.length, 0);
  assert.equal(result.allowlisted.length, 2);
});

test("evaluateAudit treats an expired allowlist entry as blocking", () => {
  const allowlist = [{ id: "GHSA-aaaa-bbbb-cccc", reason: "temporary", expires: "2020-01-01" }];
  const result = evaluateAudit({ advisories: parseAuditReport(v6Report), allowlist, now: new Date("2026-05-24") });
  assert.equal(result.ok, false);
  assert.equal(result.expired.length, 1);
  // the critical is still unlisted → also blocking
  assert.equal(result.blocking.length, 1);
});

test("evaluateAudit --fail-on critical lets a high advisory pass", () => {
  const result = evaluateAudit({ advisories: parseAuditReport(v6Report), failOn: "critical" });
  assert.equal(result.blocking.length, 1); // only the critical
});

test("evaluateAudit is clean on an empty report", () => {
  assert.equal(evaluateAudit({ advisories: [] }).ok, true);
  assert.equal(parseAuditReport({ advisories: {} }).length, 0);
});

test("network errors and unsupported audit JSON cannot masquerade as a clean scan", () => {
  for (const report of [undefined, null, {}, [], { error: { code: "ENETUNREACH" } }, { code: "ERR_PNPM_AUDIT_BAD_RESPONSE" }, { advisories: [] }, { vulnerabilities: [] }, { advisories: {}, vulnerabilities: {} }, { advisories: [], vulnerabilities: {} }]) {
    assert.throws(() => parseAuditReport(report), /invalid audit report/);
  }
});

test("malformed advisory records and unknown severities fail closed", () => {
  for (const advisory of [null, {}, { severity: "catastrophic" }]) {
    assert.throws(() => parseAuditReport({ advisories: { a: advisory } }), /invalid audit/);
    assert.throws(() => parseAuditReport({ vulnerabilities: { a: advisory } }), /invalid audit/);
  }
});

test("audit exceptions cannot be unreasoned or permanent through an invalid expiry", () => {
  for (const expires of [undefined, "", "not-a-date"]) {
    assert.throws(() => evaluateAudit({ advisories: parseAuditReport(v6Report), allowlist: [{ id: "GHSA-aaaa-bbbb-cccc", reason: "triage", expires }] }), /finite expiry/);
  }
  assert.throws(() => evaluateAudit({ failOn: "typo" }), /failure threshold/);
  assert.throws(() => evaluateAudit({ now: "not-a-date" }), /audit clock/);
});
