import test from "node:test";
import assert from "node:assert/strict";
import { startService } from "../../../tests/_harness.mjs";

/**
 * Witness-service /verify quorum behavior tests.
 *
 * /verify is the substrate's attest-quorum primitive: warrants are
 * admissible only if quorumReached >= quorumRequired. These tests
 * pin both the success and refusal branches and the env-override
 * path that lets operators raise the quorum bar without code.
 *
 *   (1) /verify with default body (no requestedWitnesses, no
 *       quorumRequired) uses the documented defaults: 2 witnesses,
 *       quorum 2 (or WITNESS_QUORUM env override). Accepted.
 *   (2) /verify with body.quorumRequired > #witnesses: refused.
 *       verification.status === "failed".
 *   (3) /verify with WITNESS_QUORUM=5 env + 2 witnesses + no body
 *       override: refused (env-default exceeds reached).
 *   (4) /verify with body.quorumRequired explicitly overriding env:
 *       body wins over env.
 *   (5) /receipts/:id roundtrips a freshly-issued receipt.
 *   (6) /receipts/:id returns 404 for an unknown id.
 *
 * No production code is modified.
 */

test("/verify with defaults (2 witnesses, quorum=2) is accepted", async () => {
  const svc = await startService("witness-service");
  try {
    const r = await svc.post("/verify", {
      warrantId: "war-test-1",
      envelopeId: "env-test-1"
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.accepted, true);
    assert.equal(r.body.quorumRequired, 2);
    assert.equal(r.body.quorumReached, 2);
    assert.equal(r.body.verification.status, "verified");
    assert.equal(r.body.artifactType, "witness-receipt");
    assert.equal(r.body.warrantId, "war-test-1");
    assert.equal(r.body.envelopeId, "env-test-1");
  } finally { await svc.stop(); }
});

test("/verify refuses when quorumRequired exceeds requestedWitnesses count", async () => {
  const svc = await startService("witness-service");
  try {
    const r = await svc.post("/verify", {
      warrantId: "war-fail",
      envelopeId: "env-fail",
      requestedWitnesses: ["node.a", "node.b"],
      quorumRequired: 3
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.accepted, false, "2 witnesses cannot reach a quorum of 3");
    assert.equal(r.body.quorumRequired, 3);
    assert.equal(r.body.quorumReached, 2);
    assert.equal(r.body.verification.status, "failed");
  } finally { await svc.stop(); }
});

test("/verify honors WITNESS_QUORUM env override when body omits quorumRequired", async () => {
  // Env-default quorum of 5; default requestedWitnesses is 2. Without a
  // body override, the env-default is the bar — refused.
  const svc = await startService("witness-service", { env: { WITNESS_QUORUM: "5" } });
  try {
    const r = await svc.post("/verify", {
      warrantId: "war-env",
      envelopeId: "env-env"
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.quorumRequired, 5, "WITNESS_QUORUM env must drive the default");
    assert.equal(r.body.accepted, false);
    assert.equal(r.body.verification.status, "failed");
  } finally { await svc.stop(); }
});

test("/verify body.quorumRequired overrides WITNESS_QUORUM env-default", async () => {
  const svc = await startService("witness-service", { env: { WITNESS_QUORUM: "5" } });
  try {
    // Body says quorum=1, witnesses=1 ⇒ accepted. Env default (5) ignored
    // because the body specified.
    const r = await svc.post("/verify", {
      warrantId: "war-body",
      envelopeId: "env-body",
      requestedWitnesses: ["only.witness"],
      quorumRequired: 1
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.quorumRequired, 1, "body override must beat env default");
    assert.equal(r.body.quorumReached, 1);
    assert.equal(r.body.accepted, true);
  } finally { await svc.stop(); }
});

test("/receipts/:id returns the freshly issued receipt", async () => {
  const svc = await startService("witness-service");
  try {
    const issued = await svc.post("/verify", {
      warrantId: "war-receipt",
      envelopeId: "env-receipt"
    });
    assert.equal(issued.status, 200);
    const receiptId = issued.body.id;
    assert.ok(receiptId, "receipt id must be present on the /verify response");

    const fetched = await svc.get(`/receipts/${receiptId}`);
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.id, receiptId);
    assert.equal(fetched.body.warrantId, "war-receipt");
    assert.equal(fetched.body.accepted, true);
  } finally { await svc.stop(); }
});

test("/receipts/:id returns 404 for an unknown receipt id", async () => {
  const svc = await startService("witness-service");
  try {
    const r = await svc.get("/receipts/wrc-does-not-exist");
    assert.equal(r.status, 404);
    assert.equal(r.body.error, "not_found");
  } finally { await svc.stop(); }
});
