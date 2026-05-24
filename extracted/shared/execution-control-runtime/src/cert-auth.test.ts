import test from "node:test";
import assert from "node:assert/strict";
import {
  type CertAuthConfig,
  type ClientCertificate,
  authEnabled,
  certCommonName,
  resolvePrincipal,
  resolvePrincipalFromCert
} from "./index.js";

const PIV_DN = "CN=DOE.JANE.A.1234567890,OU=PKI,OU=DoD,O=U.S. Government,C=US";
const cert = (over: Partial<ClientCertificate> = {}): ClientCertificate => ({
  subject: PIV_DN,
  sans: ["jane.doe@army.mil"],
  fingerprint: "ab12cd34",
  verified: true,
  ...over
});

test("certCommonName extracts the CN from a DN", () => {
  assert.equal(certCommonName(PIV_DN), "DOE.JANE.A.1234567890");
  assert.equal(certCommonName("OU=PKI,O=Gov"), undefined);
});

test("a verified cert matching a CN rule resolves to an mTLS principal", () => {
  const config: CertAuthConfig = { rules: [{ cn: "DOE.JANE.A.1234567890", role: "operator", subject: "jane.doe" }] };
  const out = resolvePrincipalFromCert(cert(), config);
  assert.equal(out.status, "authenticated");
  if (out.status === "authenticated") {
    assert.equal(out.principal.auth, "mtls");
    assert.equal(out.principal.role, "operator");
    assert.equal(out.principal.subject, "jane.doe");
    assert.equal(out.principal.key_id, "ab12cd34");
  }
});

test("a PIV UPN SAN rule matches and defaults the subject to the CN", () => {
  const config: CertAuthConfig = { rules: [{ sanRegex: "@army\\.mil$", role: "admin" }] };
  const out = resolvePrincipalFromCert(cert(), config);
  assert.equal(out.status, "authenticated");
  if (out.status === "authenticated") {
    assert.equal(out.principal.role, "admin");
    assert.equal(out.principal.subject, "DOE.JANE.A.1234567890");
  }
});

test("an unverified chain is rejected (requireVerified default true)", () => {
  const out = resolvePrincipalFromCert(cert({ verified: false }), { rules: [{ cn: "DOE.JANE.A.1234567890", role: "operator" }] });
  assert.equal(out.status, "rejected");
});

test("fingerprint pinning rejects an untrusted cert", () => {
  const config: CertAuthConfig = { rules: [{ cn: "DOE.JANE.A.1234567890", role: "operator" }], trustedFingerprints: ["deadbeef"] };
  assert.equal(resolvePrincipalFromCert(cert(), config).status, "rejected");
  assert.equal(resolvePrincipalFromCert(cert({ fingerprint: "deadbeef" }), config).status, "authenticated");
});

test("a cert matching no rule is forbidden", () => {
  const out = resolvePrincipalFromCert(cert(), { rules: [{ cn: "SOMEONE.ELSE", role: "operator" }] });
  assert.equal(out.status, "forbidden");
  if (out.status === "forbidden") assert.equal(out.subject, "DOE.JANE.A.1234567890");
});

test("requireStrongAuth disables the standing admin api key", () => {
  const apiKey = "super-admin-key";
  assert.equal(resolvePrincipal(apiKey, { apiKey }).status, "authenticated"); // default: honored
  const locked = resolvePrincipal(apiKey, { apiKey, requireStrongAuth: true });
  assert.equal(locked.status, "rejected");
  if (locked.status === "rejected") assert.match(locked.reason, /api key is disabled/);
});

test("authEnabled is true when only cert auth is configured", () => {
  assert.equal(authEnabled({ cert: { rules: [{ cn: "x", role: "viewer" }] } }), true);
  assert.equal(authEnabled({ cert: { rules: [] } }), false);
});
