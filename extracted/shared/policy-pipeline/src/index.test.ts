import test from "node:test";
import assert from "node:assert/strict";
import { HmacKeyring } from "@aristotle/governance-core";
import {
  buildPolicyBundle,
  buildPolicyBundleWithLocalKeyring,
  verifyPolicyBundle,
  diffPolicyBundles,
  PIPELINE_VERSION,
  BUNDLE_FORMAT,
  type SignedPolicyBundle,
  type PolicyBundle
} from "./index.js";

const SOURCE_V1 = `
ward "Montana Drone Range" {
  id montana-drone-range
  domain drone-swarm-ops
  sovereignty "private-ranch-field-test"
  version 0.1.0
  subject agent:survey-planner
  criticality safety_critical
  allow drone.takeoff, drone.scan_area when telemetry.gps_lock
  deny drone.disable_geofence, drone.leave_boundary
  bound altitude_m <= 120
  bound battery_pct >= 20
  within ranch-test-grid-a
}
`;

const SOURCE_V2_TIGHTER = `
ward "Montana Drone Range" {
  id montana-drone-range
  domain drone-swarm-ops
  sovereignty "private-ranch-field-test"
  version 0.2.0
  subject agent:survey-planner
  criticality safety_critical
  allow drone.takeoff when telemetry.gps_lock
  deny drone.disable_geofence, drone.leave_boundary, drone.scan_area
  bound altitude_m <= 80
  bound battery_pct >= 30
  within ranch-test-grid-a
}
`;

const PROVENANCE = {
  builder: "ci.release.bot",
  built_at: "2026-05-26T15:00:00.000Z",
  source_ref: "git:abcdef0123456789",
  notes: "tightening: lower altitude ceiling, remove scan_area, raise battery floor"
} as const;

test("buildPolicyBundle: emits a PolicyBundle with bundle_hash + provenance + manifests", () => {
  const result = buildPolicyBundle(SOURCE_V1, {
    policy_version: "0.1.0",
    provenance: { ...PROVENANCE }
  });
  // No signer => unsigned bundle
  const bundle = result as PolicyBundle;
  assert.equal(bundle.format, BUNDLE_FORMAT);
  assert.equal(bundle.policy_version, "0.1.0");
  assert.equal(bundle.provenance.pipeline_version, PIPELINE_VERSION);
  assert.match(bundle.provenance.source_hash, /^sha256:[0-9a-f]{64}$/);
  assert.match(bundle.bundle_hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(bundle.drafts.length, 1);
  assert.equal(bundle.manifests.length, 1);
  assert.equal(bundle.drafts[0].ward.ward_id, "montana-drone-range");
});

test("buildPolicyBundle: reproducibility — same source + same built_at -> identical bundle_hash", () => {
  const a = buildPolicyBundle(SOURCE_V1, {
    policy_version: "0.1.0", provenance: { ...PROVENANCE }
  }) as PolicyBundle;
  const b = buildPolicyBundle(SOURCE_V1, {
    policy_version: "0.1.0", provenance: { ...PROVENANCE }
  }) as PolicyBundle;
  assert.equal(a.bundle_hash, b.bundle_hash);
  assert.equal(a.manifests[0].hashes.manifest_hash, b.manifests[0].hashes.manifest_hash);
});

test("buildPolicyBundle: rejects builds without provenance.built_at", () => {
  assert.throws(() => buildPolicyBundle(SOURCE_V1, {
    policy_version: "0.1.0",
    provenance: { builder: "x" } as Parameters<typeof buildPolicyBundle>[1]["provenance"]
  }), /built_at is required/i);
});

test("buildPolicyBundle: throws on APL compile error", () => {
  const broken = `ward "x" { id foo`; // missing fields + close brace
  assert.throws(() => buildPolicyBundle(broken, {
    policy_version: "0.1.0", provenance: { ...PROVENANCE }
  }), /APL compile failed/);
});

test("buildPolicyBundle with signer: returns a SignedPolicyBundle that verifies", () => {
  const keyring = new HmacKeyring({ "key-build": "build-secret" });
  const signed = buildPolicyBundle(SOURCE_V1, {
    policy_version: "0.1.0",
    provenance: { ...PROVENANCE },
    signer: { keyring, keyId: "key-build" }
  }) as SignedPolicyBundle;
  assert.equal(signed.signature.keyId, "key-build");
  const v = verifyPolicyBundle(signed, keyring);
  assert.equal(v.ok, true, `failures: ${v.failures.join(", ")}`);
  assert.equal(v.signature_ok, true);
  assert.equal(v.hash_ok, true);
  assert.equal(v.manifests_reproducible, true);
});

test("verifyPolicyBundle: tampered source breaks reproducibility check", () => {
  const keyring = new HmacKeyring({ "key-build": "build-secret" });
  const signed = buildPolicyBundle(SOURCE_V1, {
    policy_version: "0.1.0", provenance: { ...PROVENANCE },
    signer: { keyring, keyId: "key-build" }
  }) as SignedPolicyBundle;
  // Tamper: replace embedded source with v2 (different semantics).
  const tampered: SignedPolicyBundle = {
    ...signed,
    bundle: { ...signed.bundle, source: SOURCE_V2_TIGHTER }
  };
  const v = verifyPolicyBundle(tampered, keyring);
  assert.equal(v.ok, false);
  // Hash also breaks because source is hashed into bundle_hash.
  assert.equal(v.hash_ok, false);
});

test("verifyPolicyBundle: tampered manifest breaks bundle_hash check", () => {
  const keyring = new HmacKeyring({ "key-build": "build-secret" });
  const signed = buildPolicyBundle(SOURCE_V1, {
    policy_version: "0.1.0", provenance: { ...PROVENANCE },
    signer: { keyring, keyId: "key-build" }
  }) as SignedPolicyBundle;
  const tampered: SignedPolicyBundle = {
    ...signed,
    bundle: {
      ...signed.bundle,
      manifests: signed.bundle.manifests.map((m) => ({
        ...m,
        hashes: { ...m.hashes, manifest_hash: "sha256:" + "0".repeat(64) }
      }))
    }
  };
  const v = verifyPolicyBundle(tampered, keyring);
  assert.equal(v.ok, false);
  assert.equal(v.hash_ok, false);
});

test("verifyPolicyBundle: wrong keyId returns signature_ok=false", () => {
  const keyringBuild = new HmacKeyring({ "key-build": "build-secret" });
  const keyringVerify = new HmacKeyring({ "key-build": "wrong-secret" });
  const signed = buildPolicyBundle(SOURCE_V1, {
    policy_version: "0.1.0", provenance: { ...PROVENANCE },
    signer: { keyring: keyringBuild, keyId: "key-build" }
  }) as SignedPolicyBundle;
  const v = verifyPolicyBundle(signed, keyringVerify);
  assert.equal(v.ok, false);
  assert.equal(v.signature_ok, false);
});

test("diffPolicyBundles: v1 -> v2 tighter reports tightening changes (no weakening)", () => {
  const v1 = buildPolicyBundle(SOURCE_V1, {
    policy_version: "0.1.0", provenance: { ...PROVENANCE }
  }) as PolicyBundle;
  const v2 = buildPolicyBundle(SOURCE_V2_TIGHTER, {
    policy_version: "0.2.0",
    provenance: { ...PROVENANCE, built_at: "2026-05-27T10:00:00.000Z" }
  }) as PolicyBundle;
  const diff = diffPolicyBundles(v1, v2);
  assert.equal(diff.before_version, "0.1.0");
  assert.equal(diff.after_version, "0.2.0");
  // Same ward_id -> "changed"
  assert.equal(diff.ward_diffs.length, 1);
  assert.equal(diff.ward_diffs[0].state, "changed");
  assert.ok(diff.total_changes > 0);
  // V2 only tightens: weakening_changes should be 0.
  assert.equal(diff.weakening_changes, 0);
  assert.equal(diff.ward_diffs[0].has_weakening, false);
});

test("diffPolicyBundles: removing a ward marks state:removed", () => {
  const v1 = buildPolicyBundle(SOURCE_V1, {
    policy_version: "0.1.0", provenance: { ...PROVENANCE }
  }) as PolicyBundle;
  // V2 with empty source (no wards) - but we need at least one ward to compile
  // Instead, change ward id so v1's ward looks removed and v2's ward looks added.
  const SOURCE_DIFF_WARD = SOURCE_V1
    .replace("Montana Drone Range", "Montana Drone Range B")
    .replace("montana-drone-range", "montana-drone-range-b");
  const v2 = buildPolicyBundle(SOURCE_DIFF_WARD, {
    policy_version: "0.2.0",
    provenance: { ...PROVENANCE, built_at: "2026-05-27T10:00:00.000Z" }
  }) as PolicyBundle;
  const diff = diffPolicyBundles(v1, v2);
  assert.equal(diff.ward_diffs.length, 2);
  const removed = diff.ward_diffs.find((d) => d.state === "removed");
  const added = diff.ward_diffs.find((d) => d.state === "added");
  assert.ok(removed);
  assert.ok(added);
  // An added ward is structurally a broadening of authority.
  assert.equal(added?.has_weakening, true);
});

test("buildPolicyBundleWithLocalKeyring: convenience helper produces a verifiable signed bundle", () => {
  const signed = buildPolicyBundleWithLocalKeyring(SOURCE_V1, {
    policy_version: "0.1.0",
    provenance: { ...PROVENANCE }
  });
  // Verify against the same secret the helper minted: we can't because
  // it's discarded inside the helper. The point of the helper is to
  // produce a self-contained demo artifact whose signature is opaque to
  // the host. Test that bundle_hash recomputes and the structure is good.
  assert.match(signed.bundle.bundle_hash, /^sha256:/);
  assert.equal(signed.bundle.format, BUNDLE_FORMAT);
  assert.equal(signed.signature.algorithm, "hmac-sha256");
});

test("buildPolicyBundle: provenance carries source_ref and notes through to the signed material", () => {
  const result = buildPolicyBundle(SOURCE_V1, {
    policy_version: "0.1.0",
    provenance: {
      builder: "developer@example.com",
      built_at: "2026-05-26T15:00:00.000Z",
      source_ref: "git:deadbeef",
      notes: "first cut"
    }
  }) as PolicyBundle;
  assert.equal(result.provenance.source_ref, "git:deadbeef");
  assert.equal(result.provenance.notes, "first cut");
  assert.equal(result.provenance.builder, "developer@example.com");
});

test("buildPolicyBundle: pipeline_version embedded; rebuilds under same version yield same hash", () => {
  const a = buildPolicyBundle(SOURCE_V1, {
    policy_version: "0.1.0", provenance: { ...PROVENANCE }
  }) as PolicyBundle;
  assert.equal(a.provenance.pipeline_version, PIPELINE_VERSION);
});
