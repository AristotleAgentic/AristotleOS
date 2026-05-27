/**
 * @aristotle/policy-pipeline — build pipeline for Aristotle Policy
 * Language (APL).
 *
 * Substrate audit #8 was 'Policy compilation at 60%' — APL itself
 * compiles to GovernanceDraft already (`compilePolicy()` in
 * `@aristotle/execution-control-runtime`). What was missing for an
 * institutional-grade policy build pipeline:
 *
 *   - provenance (who compiled it, with what compiler, against what
 *     source, when, in what environment)
 *   - signing (the compiled bundle is signed; downstream gates verify
 *     before adopting)
 *   - reproducibility (same source + same compiler version + same now
 *     yields a byte-identical bundle_hash; a third party can verify)
 *   - structured diff between versions (already partially in builder.ts;
 *     this re-exports + wraps so that diffing operates on signed bundles)
 *   - explicit deployment metadata (policy_version, semver, rollback
 *     marker)
 *
 * The output of `buildPolicyBundle(source, opts)` is a
 * `SignedPolicyBundle` that the Commit Gate can adopt by reference
 * (`runtimeRegister.policy_version`) without trusting the build host.
 *
 * Non-goals (kept out of scope here):
 *   - storing bundles in a registry (callers can plug in S3, OCI,
 *     filesystem; we return bytes + a content-addressed id).
 *   - rendering bundles into the runtime store (callers use
 *     `@aristotle/governance-core` factories; this package only emits
 *     compiled, signed material).
 */

import {
  compilePolicy,
  compileGovernanceManifest,
  diffGovernanceManifests,
  type PolicyCompileResult,
  type GovernanceDraft,
  type GovernanceManifest,
  type GovernanceDiffEntry
} from "@aristotle/execution-control-runtime";
import { HmacKeyring, type Keyring, type Signature } from "@aristotle/governance-core";
import { createHash, randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Provenance + bundle types
// ---------------------------------------------------------------------------

/** Pipeline compiler identity. Bumped when the pipeline materially
 *  changes its output. Bundles compiled by a different
 *  PIPELINE_VERSION are not byte-identical even when the source is. */
export const PIPELINE_VERSION = "aristotle.policy-pipeline.v1.0.0";

/** Bundle wire format identifier. */
export const BUNDLE_FORMAT = "aristotle.policy-bundle.v1";

export interface PolicyProvenance {
  /** Free-form builder identifier (e.g., a CI pipeline name, a
   *  developer email, a release manager subject). */
  builder: string;
  /** Pipeline version embedded for reproducibility cross-checks. */
  pipeline_version: string;
  /** SHA-256 of the canonical source bytes (UTF-8). */
  source_hash: string;
  /** ISO timestamp the bundle was produced; flows through to the
   *  embedded GovernanceManifest compiled_at. Required to be supplied
   *  by the caller for reproducible builds — DO NOT default to
   *  new Date() inside this function. */
  built_at: string;
  /** Optional source provenance pointer (git commit, OCI digest, etc.) */
  source_ref?: string;
  /** Optional human-readable note (release notes, change ticket). */
  notes?: string;
}

export interface PolicyBundle {
  format: typeof BUNDLE_FORMAT;
  policy_version: string;
  /** Provenance — embedded into the signed material. */
  provenance: PolicyProvenance;
  /** Canonical source bytes (UTF-8) so downstream verifiers can
   *  recompile and confirm reproducibility. */
  source: string;
  /** Compiled drafts (one per `ward {}` block in source). */
  drafts: GovernanceDraft[];
  /** Per-draft compiled manifests (content-addressed). */
  manifests: GovernanceManifest[];
  /** Compile diagnostics (informational; not fatal — fatal errors throw). */
  diagnostics: PolicyCompileResult["diagnostics"];
  /** Content-addressed bundle id. */
  bundle_hash: string;
}

export interface SignedPolicyBundle {
  bundle: PolicyBundle;
  signature: Signature;
}

export interface BuildPolicyBundleOptions {
  policy_version: string;
  provenance: Omit<PolicyProvenance, "source_hash" | "pipeline_version"> & {
    source_hash?: string;
    pipeline_version?: string;
  };
  /** When provided, the bundle is signed and a SignedPolicyBundle is
   *  returned; otherwise an unsigned PolicyBundle is returned. */
  signer?: { keyring: Keyring; keyId: string };
}

// ---------------------------------------------------------------------------
// Canonical serialization for hashing — small implementation so we don't
// depend on internals of execution-control-runtime for canonicalization.
// ---------------------------------------------------------------------------

function stableStringify(value: unknown): string {
  if (value === undefined) return "null"; // match JSON.stringify drop-then-restore semantics
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const obj = value as Record<string, unknown>;
  // Skip keys whose value is undefined — JSON.stringify drops them,
  // so we must too to survive a write/parse roundtrip.
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a policy bundle from APL source. Deterministic given
 * `(source, provenance.built_at, opts.policy_version)`.
 */
export function buildPolicyBundle(
  source: string,
  opts: BuildPolicyBundleOptions
): PolicyBundle | SignedPolicyBundle {
  if (!opts.provenance.built_at) {
    throw new Error("provenance.built_at is required for a reproducible build");
  }
  const compileResult = compilePolicy(source, { now: opts.provenance.built_at });
  if (!compileResult.ok) {
    const msg = compileResult.diagnostics.map((d) => `[${d.line}:${d.column}] ${d.message}`).join("\n");
    throw new Error(`APL compile failed:\n${msg}`);
  }
  const drafts = compileResult.drafts.map((d) => ({ ...d, now: opts.provenance.built_at }));

  // Compile each draft into a content-addressed manifest. The
  // compileGovernanceManifest function already produces hashes.
  const manifests = drafts.map((d) => compileGovernanceManifest(d));
  // If any manifest fails validation, the bundle is invalid — surface
  // the errors loudly rather than silently shipping a broken bundle.
  const invalid = manifests.flatMap((m, idx) =>
    m.validation.ok ? [] : m.validation.errors.map((e) => `[manifest ${idx}] ${e}`)
  );
  if (invalid.length) {
    throw new Error(`policy bundle would ship invalid manifests:\n${invalid.join("\n")}`);
  }

  const source_hash = "sha256:" + sha256Hex(source);
  const provenance: PolicyProvenance = {
    builder: opts.provenance.builder,
    pipeline_version: opts.provenance.pipeline_version ?? PIPELINE_VERSION,
    source_hash,
    built_at: opts.provenance.built_at,
    source_ref: opts.provenance.source_ref,
    notes: opts.provenance.notes
  };

  const partial: Omit<PolicyBundle, "bundle_hash"> = {
    format: BUNDLE_FORMAT,
    policy_version: opts.policy_version,
    provenance,
    source,
    drafts,
    manifests,
    diagnostics: compileResult.diagnostics
  };
  const bundle_hash = "sha256:" + sha256Hex(stableStringify(partial));
  const bundle: PolicyBundle = { ...partial, bundle_hash };

  if (!opts.signer) return bundle;

  const signature = opts.signer.keyring.sign(opts.signer.keyId, bundle_hash);
  return { bundle, signature };
}

/**
 * Verify a signed policy bundle's signature, integrity (recomputes
 * `bundle_hash`), and reproducibility (recompiles `source` and checks
 * each manifest_hash). Returns a structured verification report.
 */
export interface BundleVerification {
  ok: boolean;
  failures: string[];
  signature_ok: boolean;
  hash_ok: boolean;
  manifests_reproducible: boolean;
}

export function verifyPolicyBundle(
  signed: SignedPolicyBundle,
  keyring: Keyring
): BundleVerification {
  const failures: string[] = [];

  // 1) Signature — verify(data, signature) signature where data is
  //    the bundle_hash that was signed at build time.
  let signature_ok = false;
  try {
    signature_ok = keyring.verify(signed.bundle.bundle_hash, signed.signature);
    if (!signature_ok) failures.push("signature does not verify against bundle_hash");
  } catch (err) {
    failures.push(`signature verify threw: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 2) Bundle hash recomputed
  const { bundle_hash: expectedHash, ...rest } = signed.bundle;
  const computedHash = "sha256:" + sha256Hex(stableStringify(rest));
  const hash_ok = computedHash === expectedHash;
  if (!hash_ok) failures.push(`bundle_hash recomputation mismatch: expected ${expectedHash}, got ${computedHash}`);

  // 3) Source-reproducibility: recompile source with the same now
  //    (=built_at) and confirm each manifest_hash matches.
  let manifests_reproducible = true;
  try {
    const rebuilt = compilePolicy(signed.bundle.source, { now: signed.bundle.provenance.built_at });
    if (!rebuilt.ok) {
      manifests_reproducible = false;
      failures.push("source no longer compiles under this pipeline version");
    } else if (rebuilt.drafts.length !== signed.bundle.manifests.length) {
      manifests_reproducible = false;
      failures.push(`draft count drift: signed ${signed.bundle.manifests.length}, rebuilt ${rebuilt.drafts.length}`);
    } else {
      for (let i = 0; i < rebuilt.drafts.length; i++) {
        const rebuiltManifest = compileGovernanceManifest({ ...rebuilt.drafts[i], now: signed.bundle.provenance.built_at });
        if (rebuiltManifest.hashes.manifest_hash !== signed.bundle.manifests[i].hashes.manifest_hash) {
          manifests_reproducible = false;
          failures.push(`manifest ${i} hash drift: signed ${signed.bundle.manifests[i].hashes.manifest_hash}, rebuilt ${rebuiltManifest.hashes.manifest_hash}`);
        }
      }
    }
  } catch (err) {
    manifests_reproducible = false;
    failures.push(`reproducibility check threw: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    ok: signature_ok && hash_ok && manifests_reproducible,
    failures,
    signature_ok,
    hash_ok,
    manifests_reproducible
  };
}

/**
 * Structural diff of two policy bundles, surfaced per ward block.
 * Reuses `diffGovernanceManifests` per matched draft (by ward_id).
 */
export interface PolicyBundleDiff {
  before_version: string;
  after_version: string;
  ward_diffs: Array<{
    ward_id: string;
    state: "added" | "removed" | "changed" | "unchanged";
    entries: GovernanceDiffEntry[];
    has_weakening: boolean;
  }>;
  total_changes: number;
  weakening_changes: number;
}

export function diffPolicyBundles(before: PolicyBundle, after: PolicyBundle): PolicyBundleDiff {
  const beforeByWard = new Map<string, GovernanceDraft>();
  for (const d of before.drafts) beforeByWard.set(d.ward.ward_id, d);
  const afterByWard = new Map<string, GovernanceDraft>();
  for (const d of after.drafts) afterByWard.set(d.ward.ward_id, d);

  const wardIds = new Set([...beforeByWard.keys(), ...afterByWard.keys()]);
  const ward_diffs: PolicyBundleDiff["ward_diffs"] = [];
  let total = 0, weakening = 0;
  for (const id of wardIds) {
    const b = beforeByWard.get(id);
    const a = afterByWard.get(id);
    if (b && !a) {
      ward_diffs.push({ ward_id: id, state: "removed", entries: [], has_weakening: false });
      total += 1;
      continue;
    }
    if (a && !b) {
      ward_diffs.push({ ward_id: id, state: "added", entries: [], has_weakening: true });
      total += 1; weakening += 1;
      continue;
    }
    if (b && a) {
      const entries = diffGovernanceManifests(b, a);
      const has_weakening = entries.some((e) => e.weakening);
      ward_diffs.push({
        ward_id: id,
        state: entries.length ? "changed" : "unchanged",
        entries,
        has_weakening
      });
      total += entries.length;
      weakening += entries.filter((e) => e.weakening).length;
    }
  }
  return {
    before_version: before.policy_version,
    after_version: after.policy_version,
    ward_diffs,
    total_changes: total,
    weakening_changes: weakening
  };
}

// ---------------------------------------------------------------------------
// Convenience: a local-keyring sign-and-build helper for tests / demos.
// ---------------------------------------------------------------------------

export function buildPolicyBundleWithLocalKeyring(
  source: string,
  opts: Omit<BuildPolicyBundleOptions, "signer"> & { keyId?: string }
): SignedPolicyBundle {
  const keyId = opts.keyId ?? `key-policy-${randomBytes(4).toString("hex")}`;
  const keyring = new HmacKeyring({ [keyId]: `secret:${keyId}` });
  const result = buildPolicyBundle(source, {
    policy_version: opts.policy_version,
    provenance: opts.provenance,
    signer: { keyring, keyId }
  });
  // buildPolicyBundle with a signer always returns SignedPolicyBundle.
  return result as SignedPolicyBundle;
}

export { compilePolicy, compileGovernanceManifest, diffGovernanceManifests };
export type { GovernanceDraft, GovernanceManifest, GovernanceDiffEntry };
