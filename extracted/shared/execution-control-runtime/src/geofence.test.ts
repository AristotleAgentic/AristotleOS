import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePhysicalInvariants, type CanonicalActionInput, type PhysicalBounds } from "./index.js";

function actionWith(params: Record<string, unknown>): CanonicalActionInput {
  return {
    action_id: "act-1",
    ward_id: "w",
    subject: "s",
    action_type: "demo.run",
    target: "t",
    params,
    requested_at: "2026-05-26T15:00:00.000Z"
  };
}

test("geofence_polygon: action inside the polygon passes", () => {
  // Square around Montana-ish coordinates.
  const bounds: PhysicalBounds = {
    geofence_polygon: [[44, -116], [44, -104], [49, -104], [49, -116]]
  };
  const result = evaluatePhysicalInvariants(actionWith({ lat: 46.6, lon: -110.5 }), bounds);
  assert.equal(result.ok, true);
});

test("geofence_polygon: action outside the polygon REFUSEs with named reason", () => {
  const bounds: PhysicalBounds = {
    geofence_polygon: [[44, -116], [44, -104], [49, -104], [49, -116]]
  };
  const result = evaluatePhysicalInvariants(actionWith({ lat: 41.0, lon: -110.5 }), bounds);
  assert.equal(result.ok, false);
  assert.ok(result.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));
  assert.match(result.detail, /outside geofence_polygon/);
});

test("geofence_center + radius_km: inside radius passes", () => {
  const bounds: PhysicalBounds = {
    geofence_center: [46.595, -112.027],   // Helena, MT
    geofence_radius_km: 50
  };
  const result = evaluatePhysicalInvariants(actionWith({ lat: 46.7, lon: -112.1 }), bounds);
  assert.equal(result.ok, true);
});

test("geofence_center + radius_km: outside radius REFUSEs", () => {
  const bounds: PhysicalBounds = {
    geofence_center: [46.595, -112.027],
    geofence_radius_km: 50
  };
  // Bozeman, MT is ~135 km from Helena.
  const result = evaluatePhysicalInvariants(actionWith({ lat: 45.679, lon: -111.044 }), bounds);
  assert.equal(result.ok, false);
  assert.match(result.detail, /outside.*km radius/);
});

test("geofence configured but no lat/lon in action -> REFUSE", () => {
  const bounds: PhysicalBounds = { geofence_center: [0, 0], geofence_radius_km: 1 };
  const result = evaluatePhysicalInvariants(actionWith({ something_else: 1 }), bounds);
  assert.equal(result.ok, false);
  assert.match(result.detail, /no lat\/lon/);
});

test("supports latitude/longitude as aliases for lat/lon", () => {
  const bounds: PhysicalBounds = {
    geofence_center: [46.595, -112.027],
    geofence_radius_km: 50
  };
  const result = evaluatePhysicalInvariants(actionWith({ latitude: 46.7, longitude: -112.1 }), bounds);
  assert.equal(result.ok, true);
});

test("permitted_model_ids: matching model passes", () => {
  const bounds: PhysicalBounds = { permitted_model_ids: ["claude-3.5-sonnet", "gpt-4o"] };
  const result = evaluatePhysicalInvariants(actionWith({ model_id: "claude-3.5-sonnet" }), bounds);
  assert.equal(result.ok, true);
});

test("permitted_model_ids: non-matching model REFUSEs", () => {
  const bounds: PhysicalBounds = { permitted_model_ids: ["claude-3.5-sonnet", "gpt-4o"] };
  const result = evaluatePhysicalInvariants(actionWith({ model_id: "random-llm-3.1" }), bounds);
  assert.equal(result.ok, false);
  assert.match(result.detail, /model_id.*not in permitted_model_ids/);
});

test("permitted_model_hashes: matching hash passes", () => {
  const bounds: PhysicalBounds = { permitted_model_hashes: ["sha256:abc123", "sha256:def456"] };
  const result = evaluatePhysicalInvariants(actionWith({ model_hash: "sha256:abc123" }), bounds);
  assert.equal(result.ok, true);
});

test("permitted_model_hashes: non-matching hash REFUSEs", () => {
  const bounds: PhysicalBounds = { permitted_model_hashes: ["sha256:abc123"] };
  const result = evaluatePhysicalInvariants(actionWith({ model_hash: "sha256:evil-hash" }), bounds);
  assert.equal(result.ok, false);
  assert.match(result.detail, /model_hash.*not in permitted_model_hashes/);
});
