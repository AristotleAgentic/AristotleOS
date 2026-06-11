// Shared Ward/Authority fixtures + bindings for the framework-adapter examples.
// Each adapter only has to map its framework's tool-call shape onto a ToolCall;
// these supply the AristotleOS authority context the Commit Gate evaluates against.
import type { AuthorityEnvelope, WardManifest } from "@aristotle/execution-control-runtime";
import type { GovernedToolBinding, ToolCall } from "./govern.js";

// --- Payments: refunds allowed up to a cap; payouts denied ---
export const paymentsWard: WardManifest = {
  ward_id: "payments-ward", name: "Payments Ward", sovereignty_context: "fintech-prod",
  authority_domain: "payments-ops", policy_version: "0.1.0", permitted_subjects: ["agent:payments"]
};
export const paymentsEnvelope: AuthorityEnvelope = {
  envelope_id: "ae-payments-001", ward_id: "payments-ward", subject: "agent:payments",
  allowed_actions: ["stripe.refund"], denied_actions: ["stripe.payout"],
  constraints: { max_amount: 10000 }, expires_at: "2099-12-31T23:59:59Z", issuer: "payments-root"
};
export const paymentsBinding: GovernedToolBinding = {
  ward: paymentsWard, authorityEnvelope: paymentsEnvelope, subject: "agent:payments",
  toAction: (call: ToolCall) => ({
    action_type: call.name, target: `customer/${String(call.arguments.customerId ?? "unknown")}`,
    params: { amount: call.arguments.amount, currency: call.arguments.currency }
  })
};

// --- HTTP mutation: governed downstream calls ---
export const httpWard: WardManifest = {
  ward_id: "http-ward", name: "HTTP Egress Ward", sovereignty_context: "prod",
  authority_domain: "http-ops", policy_version: "0.1.0", permitted_subjects: ["agent:http"]
};
export const httpEnvelope: AuthorityEnvelope = {
  envelope_id: "ae-http-001", ward_id: "http-ward", subject: "agent:http",
  allowed_actions: ["http.post", "http.get", "http.put"], denied_actions: ["http.delete"],
  constraints: {}, expires_at: "2099-12-31T23:59:59Z", issuer: "http-root"
};
export const httpBinding: GovernedToolBinding = {
  ward: httpWard, authorityEnvelope: httpEnvelope, subject: "agent:http",
  toAction: (call: ToolCall) => ({
    action_type: call.name, target: String(call.arguments.url ?? ""),
    params: { method: call.arguments.method, body: call.arguments.body }
  })
};

// --- Kubernetes: deploys allowed, destructive deletes denied ---
export const k8sWard: WardManifest = {
  ward_id: "k8s-ward", name: "Kubernetes Ward", sovereignty_context: "cluster-prod",
  authority_domain: "platform-ops", policy_version: "0.1.0", permitted_subjects: ["agent:platform"]
};
export const k8sEnvelope: AuthorityEnvelope = {
  envelope_id: "ae-k8s-001", ward_id: "k8s-ward", subject: "agent:platform",
  allowed_actions: ["k8s.apply"], denied_actions: ["k8s.delete_namespace"],
  constraints: {}, expires_at: "2099-12-31T23:59:59Z", issuer: "platform-root"
};
export const k8sBinding: GovernedToolBinding = {
  ward: k8sWard, authorityEnvelope: k8sEnvelope, subject: "agent:platform",
  toAction: (call: ToolCall) => ({
    action_type: call.name, target: String(call.arguments.resource ?? ""),
    params: { manifest: call.arguments.manifest }
  })
};

// --- Drone/robotics: physical invariants (altitude/boundary/battery) ---
export const droneWard: WardManifest = {
  ward_id: "drone-ward", name: "Drone Ward", sovereignty_context: "test-range",
  authority_domain: "drone-ops", policy_version: "0.1.0", permitted_subjects: ["agent:drone"],
  physical_bounds: { max_altitude_m: 120, permitted_boundary_id: "zone-a", battery_minimum_pct: 20 }
};
export const droneEnvelope: AuthorityEnvelope = {
  envelope_id: "ae-drone-001", ward_id: "drone-ward", subject: "agent:drone",
  allowed_actions: ["drone.takeoff"], denied_actions: ["drone.disable_geofence"],
  constraints: { required_runtime_registers: ["telemetry.gps_lock"] },
  expires_at: "2099-12-31T23:59:59Z", issuer: "drone-root"
};
export const droneBinding: GovernedToolBinding = {
  ward: droneWard, authorityEnvelope: droneEnvelope, subject: "agent:drone",
  runtimeRegister: { telemetry: { gps_lock: true } },
  toAction: (call: ToolCall) => ({
    action_type: call.name, target: String(call.arguments.unit ?? "unit-1"),
    params: { altitude_m: call.arguments.altitude_m, boundary_id: call.arguments.boundary_id, battery_pct: call.arguments.battery_pct },
    telemetry: { gps_lock: true }
  })
};
