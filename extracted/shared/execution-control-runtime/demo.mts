/*
 * AristotleOS — self-verifying evaluator walkthrough.
 *
 * A narrated, end-to-end proof of the doctrine over the *real* code paths, with no
 * external services: it stands up a temp ledger, runs governed decisions, exports
 * an offline Evidence Bundle, then tries to tamper with the evidence and shows the
 * verification fail. Every step prints PASS/FAIL; the process exits non-zero if any
 * check fails — so it is both an evaluator demo and a full-lifecycle integration
 * test (run in CI as `pnpm test:demo`).
 *
 *   pnpm demo:evaluator     # narrated walkthrough
 *   npx tsx shared/execution-control-runtime/demo.mts
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type AuthorityEnvelope,
  type CanonicalActionInput,
  type WardManifest,
  createEd25519Signer,
  evaluateExecutionControl,
  exportEvidenceBundle,
  loadGelChain,
  verifyEvidenceBundle,
  verifyGelChain,
  verifyWarrant
} from "./src/index.js";

// --- tiny check harness -----------------------------------------------------
let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(title: string): void {
  console.log(`\n—— ${title} ——`);
}

// --- fixtures: a Montana drone test range -----------------------------------
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const signer = createEd25519Signer({
  privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString()
});

const ward: WardManifest = {
  ward_id: "montana-drone-test-range",
  name: "Montana Drone Test Range",
  sovereignty_context: "private-ranch-field-test",
  authority_domain: "drone-swarm-ops",
  policy_version: "0.1.0",
  permitted_subjects: ["agent:survey-planner"],
  physical_bounds: { max_altitude_m: 120, permitted_boundary_id: "ranch-test-grid-a", battery_minimum_pct: 20 }
};

const envelope: AuthorityEnvelope = {
  envelope_id: "ae-drone-survey-001",
  ward_id: ward.ward_id,
  subject: "agent:survey-planner",
  allowed_actions: ["drone.takeoff", "drone.scan_area", "drone.return_home"],
  denied_actions: ["drone.leave_boundary", "drone.disable_geofence"],
  constraints: { required_runtime_registers: ["telemetry.gps_lock"], max_altitude_m: 120, permitted_boundary_id: "ranch-test-grid-a" },
  expires_at: "2026-12-31T23:59:59Z",
  issuer: "aristotle-root"
};

const now = "2026-05-24T14:00:00.000Z";
const baseAction: CanonicalActionInput = {
  action_id: "act-takeoff-001",
  ward_id: ward.ward_id,
  subject: "agent:survey-planner",
  action_type: "drone.takeoff",
  target: "drone-swarm/unit-7",
  params: { altitude_m: 80, boundary_id: "ranch-test-grid-a", battery_pct: 87 },
  requested_at: now,
  request_id: "req-001",
  telemetry: { gps_lock: true, wind_speed_mps: 4 }
};

function ledger(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), "aos-demo-")), "gel.jsonl");
}

console.log("AristotleOS — evaluator walkthrough");
console.log("Doctrine: authority before consequence · warrant before execution · evidence after every decision");

// 1) A governed action is ALLOWED, issues a single-use Warrant, and is recorded.
section("1. Authority before consequence — a permitted action is admitted");
const allowFile = ledger();
const allow = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action: baseAction, ledgerPath: allowFile, now, signer });
check("permitted takeoff → ALLOW", allow.decision === "ALLOW", allow.decision);
check("a single-use Warrant is issued", Boolean(allow.warrant?.warrant_id), allow.warrant?.warrant_id);
check("Warrant verifies against the action hash", verifyWarrant(allow.warrant!, allow.canonical_action_hash, now).ok === true);
check("the decision is written to the evidence ledger", allow.ledger_verification.ok === true);

// 2) Authority is bounded — denied / out-of-envelope / unsafe actions are refused.
section("2. The boundary refuses what it must");
const denied = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action: { ...baseAction, action_id: "act-deny", action_type: "drone.disable_geofence" }, ledgerPath: ledger(), now, signer });
check("explicitly denied action → REFUSE, no Warrant", denied.decision === "REFUSE" && !denied.warrant, denied.reason_codes.join(","));

const escalate = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action: { ...baseAction, action_id: "act-esc", telemetry: undefined }, ledgerPath: ledger(), now, signer });
check("missing runtime state → ESCALATE (ambiguity goes to a human)", escalate.decision === "ESCALATE", escalate.reason_codes.join(","));

const invariant = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action: { ...baseAction, action_id: "act-oob", action_type: "drone.scan_area", params: { ...baseAction.params, boundary_id: "neighbor-grid-b" } }, ledgerPath: ledger(), now, signer });
check("out-of-bounds action → REFUSE on physical invariant", invariant.decision === "REFUSE" && invariant.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));

// 3) Single-use enforcement — replay of an admitted action is refused.
section("3. Warrants are single-use — replay is refused");
const replayFile = ledger();
const first = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action: baseAction, ledgerPath: replayFile, now, signer, replayProtection: true });
const second = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action: baseAction, ledgerPath: replayFile, now, signer, replayProtection: true });
check("first submission → ALLOW", first.decision === "ALLOW");
check("identical replay → REFUSE (REPLAY_DETECTED)", second.decision === "REFUSE" && second.reason_codes.includes("REPLAY_DETECTED"));

// 4) Degraded-mode fail policy — a safety-critical Ward fails closed.
section("4. Under degradation, criticality decides the fail mode");
const safetyWard: WardManifest = { ...ward, criticality: "safety_critical" };
const degraded = evaluateExecutionControl({ ward: safetyWard, authorityEnvelope: envelope, action: { ...baseAction, action_id: "act-degraded" }, ledgerPath: ledger(), now, signer, degradedConditions: ["ledger_unavailable"] });
check("safety-critical + ledger unavailable → REFUSE (DEGRADED_MODE)", degraded.decision === "REFUSE" && degraded.reason_codes.includes("DEGRADED_MODE"));

// 5) Evidence after every decision — export an offline-verifiable bundle.
section("5. Evidence after every decision — offline-verifiable bundle");
const bundle = exportEvidenceBundle({ ledgerPath: allowFile, ward, authorityEnvelope: envelope, recordId: allow.gel_record.record_id, warrant: allow.warrant, exportedAt: now, signer });
check("Evidence Bundle exports and self-verifies", bundle.verification.ok === true, `bundle_hash ${bundle.hashes.bundle_hash.slice(0, 12)}…`);
check("an independent re-verification agrees", verifyEvidenceBundle(bundle).ok === true);

// 6) Tamper-evidence — altering the evidence breaks verification.
section("6. Tamper-evidence — altering the record is detected");
const tamperedBundle = { ...bundle, selected_record: { ...bundle.selected_record, subject: "agent:impostor" } };
const tamperResult = verifyEvidenceBundle(tamperedBundle);
check("a forged subject in the bundle → verification FAILS", tamperResult.ok === false, tamperResult.failures[0]);

check("the GEL hash-chain verifies as written", verifyGelChain(allowFile).ok === true);
const records = loadGelChain(allowFile);
records[0].subject = "agent:impostor";
writeFileSync(allowFile, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
const chainAfter = verifyGelChain(allowFile);
check("tampering a ledger record on disk → chain verification FAILS", chainAfter.ok === false, chainAfter.failure);

// --- tally ------------------------------------------------------------------
console.log(`\n${"=".repeat(56)}`);
console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("DEMO FAILED — a governance invariant did not hold.");
  process.exit(1);
}
console.log("DEMO PASSED — authority bound, warrants issued, evidence verifiable, tampering caught.");
