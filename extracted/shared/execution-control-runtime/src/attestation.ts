import {
  type AristotleSigner,
  type CanonicalActionInput,
  sha256,
  stableStringify,
  verifyEd25519
} from "./index.js";

/**
 * Attested telemetry binding for physical invariants.
 *
 * Defense-review finding: `evaluatePhysicalInvariants` checks `altitude_m`,
 * `battery_pct`, `boundary_id` taken from the *action payload* — i.e. from whatever
 * the (possibly compromised) agent reported. That is a policy interlock over
 * self-reported data, not a sensor-grounded one.
 *
 * This module closes the trust gap: a sensor/device signs its readings (Ed25519);
 * `attestActionTelemetry` verifies the envelope against **pinned device keys** and a
 * freshness bound, then overwrites the safety-relevant action params with the
 * *attested* values before the action reaches the gate. Unattested or stale or
 * tampered telemetry is refused — the gate then evaluates invariants against
 * device-signed ground truth, not agent claims.
 *
 * Hardware-rooted device identity (TPM/secure element) is the operator's integration;
 * what's here is the verification + binding + freshness, with the trust roots injected.
 */

export type TelemetryReadings = Record<string, number | string | boolean>;

export interface TelemetryAttestation {
  device_id: string;
  readings: TelemetryReadings;
  /** ISO time the device signed the readings. */
  signed_at: string;
  /** base64 Ed25519 signature over the canonical (device_id, readings, signed_at). */
  signature: string;
  algorithm: "ed25519";
}

export interface AttestationTrust {
  /** Pinned device trust roots: device_id -> SPKI PEM. A device not present is untrusted. */
  trustedDeviceKeys: Record<string, string>;
  /** Reject attestations older than this (ms). Default 30s. */
  maxAgeMs?: number;
  now?: string;
}

export type AttestationVerification =
  | { ok: true; readings: TelemetryReadings; device_id: string }
  | { ok: false; reason: string };

function attestationMaterial(device_id: string, readings: TelemetryReadings, signed_at: string): string {
  return stableStringify({ device_id, readings, signed_at });
}

/** Device-side: sign a set of sensor readings. (Devices would do this with a TPM key.) */
export function signTelemetry(signer: AristotleSigner, device_id: string, readings: TelemetryReadings, signedAt?: string): TelemetryAttestation {
  const signed_at = signedAt ?? new Date().toISOString();
  return { device_id, readings, signed_at, signature: signer.sign(attestationMaterial(device_id, readings, signed_at)), algorithm: "ed25519" };
}

/** Verify an attestation against pinned device keys + a freshness bound. */
export function verifyTelemetryAttestation(attestation: TelemetryAttestation, trust: AttestationTrust): AttestationVerification {
  if (attestation.algorithm !== "ed25519") return { ok: false, reason: `unsupported attestation algorithm: ${String(attestation.algorithm)}` };
  const publicKeyPem = trust.trustedDeviceKeys[attestation.device_id];
  if (!publicKeyPem) return { ok: false, reason: `untrusted device: ${attestation.device_id}` };
  if (!verifyEd25519(publicKeyPem, attestationMaterial(attestation.device_id, attestation.readings, attestation.signed_at), attestation.signature)) {
    return { ok: false, reason: "attestation signature mismatch" };
  }
  const now = trust.now ? Date.parse(trust.now) : Date.now();
  const age = now - Date.parse(attestation.signed_at);
  const maxAge = trust.maxAgeMs ?? 30_000;
  if (!Number.isFinite(age) || age < -maxAge) return { ok: false, reason: "attestation timestamp invalid or in the future" };
  if (age > maxAge) return { ok: false, reason: `attestation stale (${age}ms > ${maxAge}ms)` };
  return { ok: true, readings: attestation.readings, device_id: attestation.device_id };
}

export interface AttestActionInput {
  action: CanonicalActionInput;
  attestation?: TelemetryAttestation;
  trust: AttestationTrust;
  /** Safety-relevant params that MUST come from attested readings (e.g. altitude_m, battery_pct, boundary_id). */
  attestedFields: string[];
}

export type AttestActionResult =
  | { ok: true; action: CanonicalActionInput; device_id: string }
  | { ok: false; reason: string; reason_code: "TELEMETRY_UNATTESTED" };

/**
 * Bind attested telemetry into an action before it reaches the gate: verify the
 * device attestation, then overwrite each `attestedFields` param with the attested
 * reading. Returns a refusal (TELEMETRY_UNATTESTED) when the attestation is missing,
 * untrusted, stale, tampered, or does not cover a required field — so the gate never
 * evaluates a hard physical invariant against self-reported data.
 */
export function attestActionTelemetry(input: AttestActionInput): AttestActionResult {
  if (!input.attestation) return { ok: false, reason: "no telemetry attestation provided", reason_code: "TELEMETRY_UNATTESTED" };
  const verified = verifyTelemetryAttestation(input.attestation, input.trust);
  if (!verified.ok) return { ok: false, reason: verified.reason, reason_code: "TELEMETRY_UNATTESTED" };
  for (const field of input.attestedFields) {
    if (!(field in verified.readings)) return { ok: false, reason: `attested telemetry missing required field: ${field}`, reason_code: "TELEMETRY_UNATTESTED" };
  }
  const params = { ...input.action.params };
  for (const field of input.attestedFields) params[field] = verified.readings[field];
  const action: CanonicalActionInput = {
    ...input.action,
    params,
    telemetry: { ...input.action.telemetry, attested_by: verified.device_id, attestation_signed_at: input.attestation.signed_at }
  };
  return { ok: true, action, device_id: verified.device_id };
}
