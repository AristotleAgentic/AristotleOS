import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyEgressUrl, blockedCategory } from "./egress-guard.js";

test("blocks the cloud metadata IP by default (no opt-in needed)", () => {
  const v = classifyEgressUrl("http://169.254.169.254/latest/meta-data/iam/security-credentials/");
  assert.equal(v.ok, false);
});

test("blocks the metadata hostname and non-http schemes by default", () => {
  assert.equal(classifyEgressUrl("http://metadata.google.internal/computeMetadata/v1/").ok, false);
  assert.equal(classifyEgressUrl("file:///etc/passwd").ok, false);
  assert.equal(classifyEgressUrl("gopher://10.0.0.1/").ok, false);
});

test("blocks the unspecified address and IPv6 link-local by default", () => {
  assert.equal(classifyEgressUrl("http://0.0.0.0/").ok, false);
  assert.equal(classifyEgressUrl("http://[fe80::1]/").ok, false);
});

test("allows loopback by default but blocks it when blockPrivateNetworks is set", () => {
  // Default keeps loopback usable (test servers / sidecars / explicit local use).
  assert.equal(classifyEgressUrl("http://127.0.0.1:8080/x").ok, true);
  // Hardened deployments opt in to full private-network blocking.
  assert.equal(classifyEgressUrl("http://127.0.0.1:8080/x", { blockPrivateNetworks: true }).ok, false);
  assert.equal(classifyEgressUrl("http://10.1.2.3/x", { blockPrivateNetworks: true }).ok, false);
  assert.equal(classifyEgressUrl("http://192.168.1.1/x", { blockPrivateNetworks: true }).ok, false);
  assert.equal(classifyEgressUrl("http://[::1]/x", { blockPrivateNetworks: true }).ok, false);
});

test("IPv4-mapped IPv6 metadata is still blocked", () => {
  assert.equal(blockedCategory("::ffff:169.254.169.254", false), "link-local");
});

test("allows ordinary public destinations", () => {
  assert.equal(classifyEgressUrl("https://api.stripe.com/v1/charges").ok, true);
  assert.equal(classifyEgressUrl("https://authorized.example.com/ok").ok, true);
});
