// End-to-end validation of the GOVERNANCE_CHAIN_V2 Ward/Warrant chain through the
// gateway front door (/operator/governance-chain/* -> kernel /v2/*). Mirrors
// validate-core.mjs for the new chain: constitute MAE -> Ward -> Authority
// Envelope -> single-use Warrant -> Commit Gate -> hash-chained GEL, and assert
// the load-bearing invariants (allow + consume, single-use replay denial, chain
// integrity, fail-closed on a missing warrant).
//
// If GOVERNANCE_CHAIN_V2 is disabled the gateway returns 501; this script then
// SKIPS (exit 0) so it can sit in stack:verify regardless of the flag.

const gatewayBaseUrl = process.env.GATEWAY_BASE_URL ?? "http://localhost:8080";
const operatorApiKey = process.env.OPERATOR_API_KEY?.trim();
const operatorActor = process.env.OPERATOR_ACTOR?.trim();
const operatorRole = process.env.OPERATOR_ROLE?.trim();
let operatorSessionToken = "";
let operatorSessionExpiresAt = 0;

const toUrl = (path) => `${gatewayBaseUrl}${path}`;
const P = "/operator/governance-chain";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function ensureOperatorSession() {
  if (!operatorApiKey || !operatorActor || !operatorRole) return "";
  if (operatorSessionToken && operatorSessionExpiresAt > Date.now() + 30_000) return operatorSessionToken;
  const headers = new Headers();
  headers.set("x-operator-key", operatorApiKey);
  headers.set("x-operator-actor", operatorActor);
  headers.set("x-operator-role", operatorRole);
  const response = await fetch(toUrl("/operator/auth/session"), { method: "POST", headers });
  if (!response.ok) return "";
  const session = await response.json();
  operatorSessionToken = session.token ?? "";
  operatorSessionExpiresAt = Date.parse(session.expiresAt ?? "") || 0;
  return operatorSessionToken;
}

async function req(path, init) {
  const headers = new Headers(init?.headers);
  const sessionToken = await ensureOperatorSession();
  if (sessionToken) headers.set("authorization", `Bearer ${sessionToken}`);
  else if (operatorApiKey) headers.set("x-operator-key", operatorApiKey);
  if (operatorActor) headers.set("x-operator-actor", operatorActor);
  if (operatorRole) headers.set("x-operator-role", operatorRole);
  const response = await fetch(toUrl(path), { ...init, headers });
  const text = await response.text().catch(() => "");
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: response.ok, status: response.status, json };
}

const post = (path, body) => req(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const past = new Date(Date.now() - 3_600_000).toISOString();

const maeBody = () => ({
  version: "1.0.0",
  issuer: "validate-chain.constitution",
  constitutional_scope: ["treasury"],
  ward_creation_rules: { allowed_ward_types: ["Institutional"], require_human_origin_act: true, allowed_origin_methods: ["institutional-charter"], allowed_domains: ["treasury"] },
  ward_amendment_rules: { authorized_amenders: ["board"] },
  ward_revocation_rules: { authorized_revokers: ["board"], cascade: true },
  authority_envelope_rules: { max_delegation_depth: 3, permitted_action_classes: ["payment.refund"], prohibited_action_classes: [], require_telemetry: true },
  federation_rules: { federation_allowed: false, trusted_mae_ids: [], exportable_evidence: false },
  signing_keys: [{ key_id: process.env.GOVERNANCE_CHAIN_KEY_ID ?? "governance-kernel-key", algorithm: "hmac-sha256" }],
  effective_from: past
});

const wardBody = (maeId) => ({
  mae_id: maeId,
  ward_type: "Institutional",
  name: "validate-chain treasury",
  description: "validation domain",
  sovereign_root: "board",
  human_origin_act: { actor: "board", actor_kind: "institution", method: "institutional-charter", attested_at: past, attestation_ref: "validate-chain" },
  accountable_party: "board",
  protected_interest: "funds",
  boundary_definition: { kind: "organizational", description: "treasury", predicates: [] },
  consequence_domain: "treasury",
  attribution_rule: { attributes_to: "accountable_party", description: "board" },
  governor_registry: ["controller"],
  delegation_rules: { who_may_create_authority_envelopes: ["board", "controller"], who_may_issue_warrants: ["controller"], max_delegation_depth: 3, may_federate: false },
  authority_envelope_constraints: { permitted_action_classes: ["payment.refund"], prohibited_action_classes: [], max_monetary_limit: { currency: "USD", max_amount: 5000 } },
  warrant_constraints: { max_validity_seconds: 600, require_nonce: true, require_telemetry_snapshot: true, single_use: true },
  revocation_rules: { authorized_revokers: ["board"], cascade: true },
  evidence_requirements: { require_gel_record: true, hash_chained: true, record_denials: true, record_escalations: true },
  effective_from: past
});

const envBody = (maeId, wardId) => ({
  ward_id: wardId,
  mae_id: maeId,
  subject: "agent.payments",
  actor_type: "Agent",
  authored_by: "controller",
  allowed_action_classes: ["payment.refund"],
  prohibited_action_classes: [],
  resource_scope: ["customer:X"],
  temporal_scope: { from: past },
  monetary_limits: { currency: "USD", max_amount: 500 },
  operational_limits: [],
  telemetry_requirements: [],
  escalation_requirements: [],
  warrant_issuance_rules: { require_nonce: true, require_parameters_hash: true, require_context_hash: true, require_telemetry_snapshot_hash: true, max_validity_seconds: 600 },
  delegation_allowed: false,
  delegation_depth: 1,
  revocation_state: "active",
  effective_from: past
});

async function main() {
  console.log(`[chain] validating against ${gatewayBaseUrl}${P}`);

  const gate = await req(`${P}/commit-gate`);
  if (gate.status === 501) {
    console.log("[chain] GOVERNANCE_CHAIN_V2 is disabled (gateway 501) — skipping chain validation.");
    return;
  }
  assert(gate.ok, `commit-gate failed with ${gate.status}`);
  assert(gate.json?.commit_gate_id, "commit gate missing id");
  const gateId = gate.json.commit_gate_id;

  const mae = await post(`${P}/meta-authority-envelope`, maeBody());
  assert(mae.ok && mae.json?.mae_id, `MAE creation failed with ${mae.status}`);
  const ward = await post(`${P}/ward`, wardBody(mae.json.mae_id));
  assert(ward.ok && ward.json?.ward_id, `Ward creation failed with ${ward.status}`);
  const env = await post(`${P}/authority-envelope`, envBody(mae.json.mae_id, ward.json.ward_id));
  assert(env.ok && env.json?.authority_envelope_id, `Envelope creation failed with ${env.status}`);
  console.log(`[chain] constituted MAE ${mae.json.mae_id} -> Ward ${ward.json.ward_id} -> Envelope ${env.json.authority_envelope_id}`);

  const action = { proposed_action_id: `act-${Date.now().toString(36)}`, action_type: "payment.refund", actor: "agent.payments", resource: "customer:X", parameters: { amount: 412, currency: "USD" } };
  const context = { ticket: "validate-chain" };
  const telemetry = {};
  const warrant = await post(`${P}/warrant`, {
    mae_id: mae.json.mae_id,
    ward_id: ward.json.ward_id,
    authority_envelope_id: env.json.authority_envelope_id,
    issued_by: "controller",
    action,
    context,
    telemetry,
    validity_seconds: 300
  });
  assert(warrant.ok && warrant.json?.warrant_id, `Warrant issuance failed with ${warrant.status}`);
  assert(warrant.json.consumption_state === "Unused", "issued warrant is not Unused");

  const request = {
    request_id: `req-${Date.now().toString(36)}`,
    mae_id: mae.json.mae_id,
    ward_id: ward.json.ward_id,
    authority_envelope_id: env.json.authority_envelope_id,
    warrant_id: warrant.json.warrant_id,
    commit_gate_id: gateId,
    action,
    context,
    telemetry,
    presented_at: new Date().toISOString()
  };

  const first = await post(`${P}/commit`, request);
  assert(first.ok, `commit failed with ${first.status}`);
  assert(first.json?.decision === "Allow", `expected Allow, got ${first.json?.decision}`);
  assert(first.json?.warrant_consumed === true, "warrant was not consumed on Allow");
  console.log(`[chain] commit Allow; warrant consumed; GEL ${first.json.gel_record_id}`);

  const second = await post(`${P}/commit`, request);
  assert(second.json?.decision !== "Allow", "single-use warrant was replayable");
  assert(
    Array.isArray(second.json?.violated_invariants) && second.json.violated_invariants.includes("warrant-non-replayable"),
    "replay denial missing warrant-non-replayable"
  );
  console.log("[chain] single-use enforced (replay denied)");

  const consumed = await req(`${P}/warrants/${encodeURIComponent(warrant.json.warrant_id)}`);
  assert(consumed.json?.consumption_state === "Consumed", "warrant not marked Consumed");

  const gel = await req(`${P}/gel`);
  assert(gel.ok, `gel read failed with ${gel.status}`);
  assert(gel.json?.integrity?.ok === true, "GEL chain integrity verification failed");
  assert(typeof gel.json?.count === "number" && gel.json.count >= 2, "GEL did not record allow + denial");
  console.log(`[chain] GEL hash-chain verified (${gel.json.count} records)`);

  const failClosed = await post(`${P}/commit`, { ...request, warrant_id: "warrant-does-not-exist", request_id: `req-fc-${Date.now().toString(36)}` });
  assert(failClosed.json?.decision === "FailClosed", `expected FailClosed on missing warrant, got ${failClosed.json?.decision}`);
  assert(
    Array.isArray(failClosed.json?.reasons) && failClosed.json.reasons.includes("warrant-not-found"),
    "fail-closed reason missing warrant-not-found"
  );
  console.log("[chain] commit gate fails closed on a missing warrant");

  console.log("[chain] validation passed");
}

main().catch((error) => {
  console.error("[chain] validation failed");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
