import test from "node:test";
import assert from "node:assert/strict";
import { HmacKeyring } from "@aristotle/governance-core";
import {
  buildPolicyBundle,
  verifyPolicyBundle,
  toOciBundle,
  fromOciBundle,
  OCI_MEDIA_TYPE_MANIFEST,
  OCI_ARTIFACT_TYPE,
  OCI_MEDIA_TYPE_POLICY_SOURCE,
  OCI_MEDIA_TYPE_POLICY_MANIFESTS,
  OCI_MEDIA_TYPE_POLICY_SIGNATURE,
  type SignedPolicyBundle
} from "./index.js";

const SOURCE = `
ward "OCI Bundle Test" {
  id oci-bundle-test
  domain test-domain
  sovereignty "test"
  version 0.1.0
  subject agent:test
  criticality routine
  allow test.do
  bound altitude_m <= 100
}
`;

const PROVENANCE = {
  builder: "ci.test", built_at: "2026-05-26T15:00:00.000Z",
  source_ref: "git:abcdef", notes: "oci test"
};

function freshSigned(): { signed: SignedPolicyBundle; keyring: HmacKeyring } {
  const keyring = new HmacKeyring({ "key-oci": "oci-secret" });
  const signed = buildPolicyBundle(SOURCE, {
    policy_version: "0.1.0",
    provenance: { ...PROVENANCE },
    signer: { keyring, keyId: "key-oci" }
  }) as SignedPolicyBundle;
  return { signed, keyring };
}

test("toOciBundle: produces a valid OCI image manifest with the four expected layers", () => {
  const { signed } = freshSigned();
  const oci = toOciBundle(signed);
  assert.equal(oci.manifest.schemaVersion, 2);
  assert.equal(oci.manifest.mediaType, OCI_MEDIA_TYPE_MANIFEST);
  assert.equal(oci.manifest.artifactType, OCI_ARTIFACT_TYPE);
  assert.equal(oci.manifest.layers.length, 3);
  const layerTypes = oci.manifest.layers.map((l) => l.mediaType).sort();
  assert.deepEqual(layerTypes, [OCI_MEDIA_TYPE_POLICY_MANIFESTS, OCI_MEDIA_TYPE_POLICY_SIGNATURE, OCI_MEDIA_TYPE_POLICY_SOURCE].sort());
  // Every layer's digest must exist as a blob in the bundle.
  for (const layer of [oci.manifest.config, ...oci.manifest.layers]) {
    assert.ok(oci.blobs[layer.digest], `blob ${layer.digest} missing`);
  }
  // Annotations carry policy_version, builder, bundle_hash, pipeline_version.
  assert.equal(oci.manifest.annotations?.["org.aristotle.policy.version"], "0.1.0");
  assert.match(oci.manifest.annotations?.["org.aristotle.policy.bundle_hash"] ?? "", /^sha256:/);
  assert.equal(oci.manifest.annotations?.["org.aristotle.policy.builder"], "ci.test");
});

test("fromOciBundle: round-trips toOciBundle preserving signature and bundle_hash", () => {
  const { signed, keyring } = freshSigned();
  const oci = toOciBundle(signed);
  const back = fromOciBundle(oci);
  assert.equal(back.ok, true, `failures: ${back.failures.join("; ")}`);
  assert.ok(back.bundle);
  assert.equal(back.bundle?.bundle.bundle_hash, signed.bundle.bundle_hash);
  assert.equal(back.bundle?.bundle.policy_version, signed.bundle.policy_version);
  assert.equal(back.bundle?.signature.keyId, signed.signature.keyId);
  // And the reconstructed bundle should still verify under the
  // original keyring.
  const v = verifyPolicyBundle(back.bundle!, keyring);
  assert.equal(v.ok, true, `verify failures: ${v.failures.join("; ")}`);
});

test("fromOciBundle: detects blob tampering via digest mismatch", () => {
  const { signed } = freshSigned();
  const oci = toOciBundle(signed);
  // Pick a layer blob and corrupt one byte.
  const layerDigest = oci.manifest.layers[0].digest;
  const original = oci.blobs[layerDigest];
  const tampered = new Uint8Array(original);
  tampered[0] = (tampered[0] + 1) % 256;
  oci.blobs[layerDigest] = tampered;
  const back = fromOciBundle(oci);
  assert.equal(back.ok, false);
  assert.ok(back.failures.some((f) => f.includes("blob digest mismatch")));
});

test("fromOciBundle: rejects wrong manifest mediaType / artifactType", () => {
  const { signed } = freshSigned();
  const oci = toOciBundle(signed);
  oci.manifest.mediaType = "application/garbage" as typeof OCI_MEDIA_TYPE_MANIFEST;
  const back = fromOciBundle(oci);
  assert.equal(back.ok, false);
  assert.ok(back.failures.some((f) => f.includes("manifest mediaType")));
});

test("fromOciBundle: rejects bundle when a layer's blob is missing", () => {
  const { signed } = freshSigned();
  const oci = toOciBundle(signed);
  const srcLayer = oci.manifest.layers.find((l) => l.mediaType === OCI_MEDIA_TYPE_POLICY_SOURCE)!;
  delete oci.blobs[srcLayer.digest];
  const back = fromOciBundle(oci);
  assert.equal(back.ok, false);
  assert.ok(back.failures.some((f) => f.includes("source layer not present")));
});
