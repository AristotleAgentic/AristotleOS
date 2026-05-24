import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  type AuthorityEnvelope,
  type CanonicalActionInput,
  type WardManifest,
  attestActionTelemetry,
  createEd25519Signer,
  evaluateCommitGate,
  signTelemetry,
  verifyTelemetryAttestation
} from "./index.js";

const NOW = "2026-05-24T12:00:00.000Z";
function device() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const signer = createEd25519Signer({ privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), publicKeyPem: pem });
  return { signer, pem };
}

const ward: WardManifest = {
  ward_id: "w", name: "w", sovereignty_context: "t", authority_domain: "drone", policy_version: "1.0.0",
  permitted_subjects: ["agent:pilot"],
  physical_bounds: { max_altitude_m: 120, permitted_boundary_id: "zone-a", battery_minimum_pct: 20 }
};
const envelope: AuthorityEnvelope = {
  envelope_id: "ae", ward_id: "w", subject: "agent:pilot", allowed_actions: ["drone.takeoff"],
  denied_actions: [], constraints: {}, expires_at: "2099-12-31T23:59:59Z", issuer: "root"
};
const baseAction: CanonicalActionInput = {
  action_id: "a1", ward_id: "w", subject: "agent:pilot", action_type: "drone.takeoff", target: "uav-1",
  params: { altitude_m: 80, battery_pct: 90, boundary_id: "zone-a" }, requested_at: NOW, request_id: "r1"
};

test("verifyTelemetryAttestation accepts a fresh, pinned-device signature and rejects others", () => {
  const d = device();
  const att = signTelemetry(d.signer, "uav-1", { altitude_m: 80, battery_pct: 90, boundary_id: "zone-a" }, NOW);
  const trust = { trustedDeviceKeys: { "uav-1": d.pem }, now: NOW, maxAgeMs: 30000 };

  assert.equal(verifyTelemetryAttestation(att, trust).ok, true);
  // untrusted device id
  assert.equal(verifyTelemetryAttestation({ ...att, device_id: "uav-rogue" }, trust).ok, false);
  // stale
  assert.equal(verifyTelemetryAttestation(att, { ...trust, now: "2026-05-24T12:01:00.000Z", maxAgeMs: 30000 }).ok, false);
  // tampered readings (signature no longer matches)
  assert.equal(verifyTelemetryAttestation({ ...att, readings: { ...att.readings, altitude_m: 50 } }, trust).ok, false);
});

test("attested telemetry overrides a FORGED altitude, so the gate enforces ground truth", () => {
  const d = device();
  const trust = { trustedDeviceKeys: { "uav-1": d.pem }, now: NOW, maxAgeMs: 30000 };

  // Agent LIES: claims a safe 80m. The device attests the true 200m (over the 120m ceiling).
  const lyingAction = { ...baseAction, params: { ...baseAction.params, altitude_m: 80 } };
  const attestation = signTelemetry(d.signer, "uav-1", { altitude_m: 200, battery_pct: 90, boundary_id: "zone-a" }, NOW);

  const bound = attestActionTelemetry({ action: lyingAction, attestation, trust, attestedFields: ["altitude_m", "battery_pct", "boundary_id"] });
  assert.equal(bound.ok, true);
  if (!bound.ok) return;
  assert.equal(bound.action.params.altitude_m, 200, "attested value replaced the agent's claim");

  // Gate on the self-reported action would ALLOW (the lie); on the attested action it REFUSEs.
  assert.equal(evaluateCommitGate({ ward, authorityEnvelope: envelope, action: lyingAction, now: NOW }).decision, "ALLOW");
  const attested = evaluateCommitGate({ ward, authorityEnvelope: envelope, action: bound.action, now: NOW });
  assert.equal(attested.decision, "REFUSE");
  assert.ok(attested.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));
});

test("missing / untrusted / stale attestation is refused TELEMETRY_UNATTESTED", () => {
  const d = device();
  const trust = { trustedDeviceKeys: { "uav-1": d.pem }, now: NOW };
  const fields = ["altitude_m"];

  const none = attestActionTelemetry({ action: baseAction, trust, attestedFields: fields });
  assert.equal(none.ok, false);
  if (!none.ok) assert.equal(none.reason_code, "TELEMETRY_UNATTESTED");

  const rogue = device();
  const rogueAtt = signTelemetry(rogue.signer, "uav-1", { altitude_m: 80 }, NOW); // right id, wrong key
  const r = attestActionTelemetry({ action: baseAction, attestation: rogueAtt, trust, attestedFields: fields });
  assert.equal(r.ok, false);

  // attestation that omits a required field
  const att = signTelemetry(d.signer, "uav-1", { battery_pct: 90 }, NOW);
  const missing = attestActionTelemetry({ action: baseAction, attestation: att, trust, attestedFields: ["altitude_m"] });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.reason, /missing required field/);
});

test("attested action records provenance in telemetry", () => {
  const d = device();
  const att = signTelemetry(d.signer, "uav-1", { altitude_m: 80 }, NOW);
  const bound = attestActionTelemetry({ action: baseAction, attestation: att, trust: { trustedDeviceKeys: { "uav-1": d.pem }, now: NOW }, attestedFields: ["altitude_m"] });
  assert.equal(bound.ok, true);
  if (bound.ok) {
    assert.equal(bound.action.telemetry?.attested_by, "uav-1");
    assert.equal(bound.action.telemetry?.attestation_signed_at, NOW);
  }
});
