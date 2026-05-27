/**
 * OCI-style policy bundle for @aristotle/policy-pipeline.
 *
 * Substrate audit #8's last gap was distribution: APL bundles must be
 * shippable through the same supply-chain infrastructure as container
 * images so operators can use existing tooling (cosign, registries,
 * promotion policies, RBAC).
 *
 * This module repackages a `SignedPolicyBundle` into an OCI Image
 * Manifest v1.1-shaped artifact:
 *
 *   - config blob   (application/vnd.aristotle.policy.config.v1+json)
 *                    carries provenance + version + bundle_hash.
 *   - source layer  (application/vnd.aristotle.policy.source.v1+text)
 *                    the raw APL source.
 *   - manifests layer (application/vnd.aristotle.policy.manifests.v1+json)
 *                    the array of compiled GovernanceManifests.
 *   - signature layer (application/vnd.aristotle.policy.signature.v1+json)
 *                    the bundle signature (key id + algorithm + value).
 *
 * Each blob's digest is sha256:<hex>. The `OciPolicyBundle` returned
 * is an in-memory object with `{ manifest, blobs }`; serialization to
 * a tarball / push to a registry is the caller's responsibility (the
 * standard OCI distribution-spec layout is straightforward to write
 * once you have the blobs).
 */

import { createHash } from "node:crypto";
import type { SignedPolicyBundle } from "./index.js";

export const OCI_MEDIA_TYPE_MANIFEST = "application/vnd.oci.image.manifest.v1+json";
export const OCI_MEDIA_TYPE_POLICY_CONFIG = "application/vnd.aristotle.policy.config.v1+json";
export const OCI_MEDIA_TYPE_POLICY_SOURCE = "application/vnd.aristotle.policy.source.v1+text";
export const OCI_MEDIA_TYPE_POLICY_MANIFESTS = "application/vnd.aristotle.policy.manifests.v1+json";
export const OCI_MEDIA_TYPE_POLICY_SIGNATURE = "application/vnd.aristotle.policy.signature.v1+json";

export const OCI_ARTIFACT_TYPE = "application/vnd.aristotle.policy.v1";

export interface OciDescriptor {
  mediaType: string;
  digest: string;          // "sha256:<hex>"
  size: number;            // bytes
  annotations?: Record<string, string>;
}

export interface OciManifest {
  schemaVersion: 2;
  mediaType: typeof OCI_MEDIA_TYPE_MANIFEST;
  artifactType: typeof OCI_ARTIFACT_TYPE;
  config: OciDescriptor;
  layers: OciDescriptor[];
  annotations?: Record<string, string>;
}

export interface OciPolicyBundle {
  manifest: OciManifest;
  /** Keyed by digest (e.g. "sha256:abcd..."). Each value is the raw
   *  bytes of that blob, as the OCI distribution spec stores them. */
  blobs: Record<string, Uint8Array>;
}

function sha256(bytes: Uint8Array): string {
  return "sha256:" + createHash("sha256").update(bytes).digest("hex");
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function decodeUtf8(b: Uint8Array): string {
  return new TextDecoder("utf-8").decode(b);
}

/** Repackage a signed policy bundle as an OCI artifact. */
export function toOciBundle(signed: SignedPolicyBundle): OciPolicyBundle {
  const blobs: Record<string, Uint8Array> = {};

  // Source layer
  const sourceBytes = utf8(signed.bundle.source);
  const sourceDigest = sha256(sourceBytes);
  blobs[sourceDigest] = sourceBytes;
  const sourceLayer: OciDescriptor = {
    mediaType: OCI_MEDIA_TYPE_POLICY_SOURCE,
    digest: sourceDigest,
    size: sourceBytes.length
  };

  // Manifests layer
  const manifestsBytes = utf8(JSON.stringify(signed.bundle.manifests));
  const manifestsDigest = sha256(manifestsBytes);
  blobs[manifestsDigest] = manifestsBytes;
  const manifestsLayer: OciDescriptor = {
    mediaType: OCI_MEDIA_TYPE_POLICY_MANIFESTS,
    digest: manifestsDigest,
    size: manifestsBytes.length
  };

  // Signature layer
  const sigBytes = utf8(JSON.stringify(signed.signature));
  const sigDigest = sha256(sigBytes);
  blobs[sigDigest] = sigBytes;
  const sigLayer: OciDescriptor = {
    mediaType: OCI_MEDIA_TYPE_POLICY_SIGNATURE,
    digest: sigDigest,
    size: sigBytes.length
  };

  // Config blob — provenance + version + bundle_hash + format tag.
  // Diagnostics are dropped; they're advisory, not part of the
  // signed material that downstream gates care about.
  const config = {
    format: signed.bundle.format,
    policy_version: signed.bundle.policy_version,
    bundle_hash: signed.bundle.bundle_hash,
    provenance: signed.bundle.provenance
  };
  const configBytes = utf8(JSON.stringify(config));
  const configDigest = sha256(configBytes);
  blobs[configDigest] = configBytes;
  const configDesc: OciDescriptor = {
    mediaType: OCI_MEDIA_TYPE_POLICY_CONFIG,
    digest: configDigest,
    size: configBytes.length
  };

  const manifest: OciManifest = {
    schemaVersion: 2,
    mediaType: OCI_MEDIA_TYPE_MANIFEST,
    artifactType: OCI_ARTIFACT_TYPE,
    config: configDesc,
    layers: [sourceLayer, manifestsLayer, sigLayer],
    annotations: {
      "org.aristotle.policy.format": signed.bundle.format,
      "org.aristotle.policy.version": signed.bundle.policy_version,
      "org.aristotle.policy.bundle_hash": signed.bundle.bundle_hash,
      "org.aristotle.policy.builder": signed.bundle.provenance.builder,
      "org.aristotle.policy.pipeline_version": signed.bundle.provenance.pipeline_version
    }
  };

  return { manifest, blobs };
}

/** Reverse: rebuild a signed policy bundle from an OCI artifact.
 *  Validates that every layer's digest matches the stored blob bytes
 *  and that diagnostics is reconstructed empty (the diagnostics field
 *  is not preserved in OCI form). */
export interface OciBundleReadResult {
  ok: boolean;
  failures: string[];
  bundle?: SignedPolicyBundle;
}

export function fromOciBundle(oci: OciPolicyBundle): OciBundleReadResult {
  const failures: string[] = [];

  // Validate every blob digest.
  for (const [digest, bytes] of Object.entries(oci.blobs)) {
    const recomputed = sha256(bytes);
    if (recomputed !== digest) {
      failures.push(`blob digest mismatch: declared ${digest}, recomputed ${recomputed}`);
    }
  }

  // Validate manifest's media + artifact types.
  if (oci.manifest.mediaType !== OCI_MEDIA_TYPE_MANIFEST) {
    failures.push(`unexpected manifest mediaType: ${oci.manifest.mediaType}`);
  }
  if (oci.manifest.artifactType !== OCI_ARTIFACT_TYPE) {
    failures.push(`unexpected artifactType: ${oci.manifest.artifactType}`);
  }

  // Pull config
  const configBlob = oci.blobs[oci.manifest.config.digest];
  if (!configBlob) {
    failures.push(`config blob ${oci.manifest.config.digest} not present in bundle.blobs`);
    return { ok: false, failures };
  }
  let config: { format: string; policy_version: string; bundle_hash: string; provenance: SignedPolicyBundle["bundle"]["provenance"] };
  try { config = JSON.parse(decodeUtf8(configBlob)); }
  catch (err) {
    failures.push(`config blob is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, failures };
  }

  // Pull source + manifests + signature layers by mediaType.
  const findLayer = (mt: string): Uint8Array | undefined => {
    const layer = oci.manifest.layers.find((l) => l.mediaType === mt);
    return layer ? oci.blobs[layer.digest] : undefined;
  };
  const sourceBlob = findLayer(OCI_MEDIA_TYPE_POLICY_SOURCE);
  const manifestsBlob = findLayer(OCI_MEDIA_TYPE_POLICY_MANIFESTS);
  const sigBlob = findLayer(OCI_MEDIA_TYPE_POLICY_SIGNATURE);
  if (!sourceBlob) failures.push("source layer not present");
  if (!manifestsBlob) failures.push("manifests layer not present");
  if (!sigBlob) failures.push("signature layer not present");
  if (failures.length) return { ok: false, failures };

  let manifests: SignedPolicyBundle["bundle"]["manifests"];
  try { manifests = JSON.parse(decodeUtf8(manifestsBlob!)); }
  catch (err) {
    failures.push(`manifests blob is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, failures };
  }
  let signature: SignedPolicyBundle["signature"];
  try { signature = JSON.parse(decodeUtf8(sigBlob!)); }
  catch (err) {
    failures.push(`signature blob is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, failures };
  }
  const source = decodeUtf8(sourceBlob!);

  // Rebuild drafts from manifests' wards + envelopes. (OCI bundling
  // drops the diagnostics field because it's advisory only.)
  const drafts = manifests.map((m) => ({
    ward: m.ward,
    authorityEnvelope: m.authority_envelope,
    now: m.compiled_at
  }));

  const bundle: SignedPolicyBundle = {
    bundle: {
      format: config.format as SignedPolicyBundle["bundle"]["format"],
      policy_version: config.policy_version,
      provenance: config.provenance,
      source,
      drafts,
      manifests,
      diagnostics: [],
      bundle_hash: config.bundle_hash
    },
    signature
  };

  return { ok: true, failures, bundle };
}
