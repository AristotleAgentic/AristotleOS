import { getFips } from "node:crypto";

/**
 * Crypto posture guard.
 *
 * Defense-review finding 2.3: Ed25519/SHA-256 are sound choices, but for most
 * programs the *module* must be FIPS 140-3 validated. Node only reports FIPS when it
 * is built/linked against a FIPS-validated OpenSSL. This guard lets a deployment
 * **fail closed at boot** unless FIPS is actually active, so you can't accidentally
 * run a "FIPS-required" workload on a non-validated provider.
 *
 * This switch does NOT make a non-validated build compliant — see docs/crypto-posture.md.
 * It enforces the operator's stated requirement; the validated module is a deployment
 * obligation (Tier C).
 */

export function isFipsActive(): boolean {
  try {
    return getFips() === 1;
  } catch {
    return false;
  }
}

export interface CryptoPostureOptions {
  /** When true, refuse to proceed unless the crypto provider is in FIPS mode. */
  requireFips?: boolean;
}

/** Throws when `requireFips` is set but the provider is not in FIPS mode. No-op otherwise. */
export function assertCryptoPosture(options: CryptoPostureOptions): void {
  if (options.requireFips && !isFipsActive()) {
    throw new Error(
      "crypto posture: FIPS mode is required but not active. Run Node against a FIPS-validated OpenSSL " +
      "(e.g. a FIPS build + `--enable-fips`/`--force-fips`), or unset ARISTOTLE_REQUIRE_FIPS. " +
      "See docs/crypto-posture.md."
    );
  }
}

/** Read the requirement from the environment (ARISTOTLE_REQUIRE_FIPS=1). */
export function cryptoPostureFromEnv(env: NodeJS.ProcessEnv = process.env): CryptoPostureOptions {
  return { requireFips: env.ARISTOTLE_REQUIRE_FIPS === "1" };
}
