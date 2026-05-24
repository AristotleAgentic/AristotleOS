import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { verifyEd25519 } from "@aristotle/execution-control-runtime";
import { createSecretsManagerSigner, secretsManagerKeyProvider, type SecretReader } from "./secrets-manager-signer.js";

function keypair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString()
  };
}

/** A fake secrets manager: an in-memory map, recording reads. */
function fakeReader(secrets: Record<string, string>) {
  const reads: string[] = [];
  const reader: SecretReader = {
    async getSecret(name: string) {
      reads.push(name);
      if (!(name in secrets)) throw new Error(`no such secret: ${name}`);
      return secrets[name];
    }
  };
  return { reader, reads };
}

test("secrets-manager signer fetches the key by name and produces a verifiable signer", async () => {
  const kp = keypair();
  const { reader, reads } = fakeReader({ "aristotle/warrant-key": kp.privateKeyPem });

  const signer = await createSecretsManagerSigner(reader, {
    privateKeySecret: "aristotle/warrant-key",
    keyId: "ed25519:prod-2026q2"
  });

  assert.deepEqual(reads, ["aristotle/warrant-key"], "reads only the configured secret");
  assert.equal(signer.ephemeral, false);
  assert.equal(signer.key_id, "ed25519:prod-2026q2");
  const message = "evidence-bundle-hash";
  assert.equal(verifyEd25519(signer.public_key_pem, message, signer.sign(message)), true);
});

test("secrets-manager key provider uses the public-key secret when supplied", async () => {
  const kp = keypair();
  const { reader, reads } = fakeReader({ priv: kp.privateKeyPem, pub: kp.publicKeyPem });
  const provider = secretsManagerKeyProvider(reader, { privateKeySecret: "priv", publicKeySecret: "pub" });

  assert.equal(await provider.getPrivateKeyPem(), kp.privateKeyPem);
  assert.equal(await provider.getPublicKeyPem?.(), kp.publicKeyPem);
  assert.ok(reads.includes("priv") && reads.includes("pub"));
});
