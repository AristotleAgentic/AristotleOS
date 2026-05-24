import test from "node:test";
import assert from "node:assert/strict";
import {
  type CredentialRevocationList,
  createHmacCredentialMinter,
  verifyMintedCredential
} from "./index.js";

const SECRET = "a-server-side-minter-secret-32-bytes!!";
const NOW = "2026-05-24T12:00:00.000Z";

test("mints a short-lived, scoped, warrant-bound credential that verifies", () => {
  const minter = createHmacCredentialMinter({ secret: SECRET, signingKeyId: "mint-1" });
  const cred = minter.mint({ subject: "agent:analyst", scope: ["warehouse:read"], audience: "warehouse", ttlSeconds: 300, warrantId: "wr-1", now: NOW });

  assert.match(cred.credential_ref, /^cred-[0-9a-f]{24}$/);
  assert.equal(cred.algorithm, "hmac-sha256");
  assert.equal(cred.warrant_id, "wr-1");
  assert.equal(cred.expires_at, "2026-05-24T12:05:00.000Z");
  assert.equal(cred.signing_key_id, "mint-1");

  const verified = verifyMintedCredential(cred.token, { secret: SECRET, now: NOW, audience: "warehouse" });
  assert.equal(verified.ok, true);
  if (verified.ok) {
    assert.equal(verified.claims.subject, "agent:analyst");
    assert.deepEqual(verified.claims.scope, ["warehouse:read"]);
  }
});

test("expired credentials are refused", () => {
  const minter = createHmacCredentialMinter({ secret: SECRET });
  const cred = minter.mint({ subject: "agent:x", scope: ["s"], ttlSeconds: 60, warrantId: "wr", now: NOW });
  const later = "2026-05-24T12:02:00.000Z"; // past the 60s TTL
  const verified = verifyMintedCredential(cred.token, { secret: SECRET, now: later });
  assert.equal(verified.ok, false);
  if (!verified.ok) assert.match(verified.reason, /expired/);
});

test("a tampered token fails the signature check (timing-safe)", () => {
  const minter = createHmacCredentialMinter({ secret: SECRET });
  const cred = minter.mint({ subject: "agent:x", scope: ["s"], ttlSeconds: 300, warrantId: "wr", now: NOW });
  const [payload] = cred.token.split(".");
  const forged = `${payload}.${Buffer.from("not-the-signature").toString("base64url")}`;
  assert.equal(verifyMintedCredential(forged, { secret: SECRET, now: NOW }).ok, false);
  // wrong secret also fails
  assert.equal(verifyMintedCredential(cred.token, { secret: "a-different-secret-that-is-32-bytes!!", now: NOW }).ok, false);
});

test("audience mismatch is refused", () => {
  const minter = createHmacCredentialMinter({ secret: SECRET });
  const cred = minter.mint({ subject: "agent:x", scope: ["s"], audience: "warehouse", ttlSeconds: 300, warrantId: "wr", now: NOW });
  const verified = verifyMintedCredential(cred.token, { secret: SECRET, now: NOW, audience: "payments" });
  assert.equal(verified.ok, false);
  if (!verified.ok) assert.match(verified.reason, /audience/);
});

test("a revoked credential_ref is refused (closes the loop with Ward Marshal revocation)", () => {
  const minter = createHmacCredentialMinter({ secret: SECRET });
  const cred = minter.mint({ subject: "agent:rogue", scope: ["prod:write"], ttlSeconds: 3600, warrantId: "wr", now: NOW });
  const revocations: CredentialRevocationList = {
    revoked_credentials: [{ credential_ref: cred.credential_ref, revoked_at: NOW, reason: "ward-marshal interdiction", source: "ward-marshal" }]
  };
  const verified = verifyMintedCredential(cred.token, { secret: SECRET, now: NOW, revocations });
  assert.equal(verified.ok, false);
  if (!verified.ok) assert.match(verified.reason, /revoked/);
});

test("minter rejects weak secrets, empty scope, and non-positive TTL", () => {
  assert.throws(() => createHmacCredentialMinter({ secret: "short" }), /at least 16 bytes/);
  const minter = createHmacCredentialMinter({ secret: SECRET });
  assert.throws(() => minter.mint({ subject: "a", scope: [], ttlSeconds: 60, warrantId: "wr" }), /at least one scope/);
  assert.throws(() => minter.mint({ subject: "a", scope: ["s"], ttlSeconds: 0, warrantId: "wr" }), /ttlSeconds must be positive/);
});
