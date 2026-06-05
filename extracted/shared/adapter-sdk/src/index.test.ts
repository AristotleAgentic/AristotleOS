import test from "node:test";
import assert from "node:assert/strict";
import type { AristotleClient, CanonicalAction, EvaluateResponse } from "@aristotle/os-sdk";
import {
  AristotleApiError,
  type AdapterAuthorization,
  DemonstrationTransport,
  RecordingTransport,
  governThroughAdapter
} from "./index.js";

// ---------------------------------------------------------------------------
// A toy third-party adapter built entirely on this SDK.
// ---------------------------------------------------------------------------

interface NoopOp {
  command: string;
  target: string;
  requested_at: string;
}

interface NoopReceipt {
  receipt_id: string;
  command: string;
  warrant_id: string;
}

class NoopDemoTransport extends DemonstrationTransport<NoopOp, AdapterAuthorization, NoopReceipt> {
  constructor() { super("noop-demo"); }
  protected buildReceipt(op: NoopOp, authz: AdapterAuthorization, seq: number): NoopReceipt {
    return {
      receipt_id: `noop-${seq.toString(16)}`,
      command: op.command,
      warrant_id: authz.warrant_id
    };
  }
}

function allowingClient(): AristotleClient {
  const stub = {
    evaluate: async (_action: CanonicalAction): Promise<EvaluateResponse> => ({
      decision: "ALLOW",
      reason_codes: [],
      canonical_action_hash: "sha256:adapter-sdk-test",
      warrant: { warrant_id: "warrant:adapter-sdk", signature: "ed25519:opaque" },
      gel_record: { record_id: "rec", record_hash: "rh" }
    })
  };
  return stub as unknown as AristotleClient;
}

function refusingClient(): AristotleClient {
  const stub = {
    evaluate: async (_action: CanonicalAction): Promise<EvaluateResponse> => ({
      decision: "REFUSE",
      reason_codes: ["FORBIDDEN"],
      canonical_action_hash: "sha256:refused",
      gel_record: { record_id: "rec", record_hash: "rh" }
    })
  };
  return stub as unknown as AristotleClient;
}

function unreachableClient(): AristotleClient {
  const stub = {
    evaluate: async (_action: CanonicalAction): Promise<EvaluateResponse> => {
      throw new Error("ECONNREFUSED");
    }
  };
  return stub as unknown as AristotleClient;
}

function httpErroringClient(status: number): AristotleClient {
  const stub = {
    evaluate: async (_action: CanonicalAction): Promise<EvaluateResponse> => {
      throw new AristotleApiError(status, "gate said no", { status });
    }
  };
  return stub as unknown as AristotleClient;
}

const NOOP_OP: NoopOp = {
  command: "ECHO",
  target: "stub",
  requested_at: "2026-05-24T00:00:00.000Z"
};

function buildAction(op: NoopOp): CanonicalAction {
  return {
    action_id: `noop-${Date.now().toString(16)}`,
    ward_id: "w-noop",
    subject: "agent:noop",
    action_type: `noop.${op.command.toLowerCase()}`,
    params: { target: op.target },
    requested_at: op.requested_at
  };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

test("governThroughAdapter: ALLOW + production_validated true emits and returns ok", async () => {
  const transport = new RecordingTransport<NoopOp, AdapterAuthorization, NoopReceipt>({
    id: "noop-prod",
    productionValidated: true,
    onEmit: (op, authz) => ({ ok: true, receipt: { receipt_id: "r-1", command: op.command, warrant_id: authz.warrant_id } })
  });
  const result = await governThroughAdapter(NOOP_OP, {
    client: allowingClient(),
    buildAction,
    transport
  });
  assert.equal(result.ok, true, `should succeed: ${JSON.stringify(result.refusal)}`);
  assert.equal(transport.emitCalls.length, 1);
  if (result.ok && result.outcome?.ok) {
    const r = result.outcome.receipt as NoopReceipt;
    assert.equal(r.warrant_id, "warrant:adapter-sdk");
  }
});

test("governThroughAdapter: ALLOW + demo transport + allowDemonstrationTransport: true succeeds", async () => {
  const transport = new NoopDemoTransport();
  const result = await governThroughAdapter(NOOP_OP, {
    client: allowingClient(),
    buildAction,
    transport,
    allowDemonstrationTransport: true
  });
  assert.equal(result.ok, true);
  assert.equal(transport.emitted.length, 1);
  assert.equal(transport.emitted[0].command, "ECHO");
});

// ---------------------------------------------------------------------------
// Refusal codes — each branch
// ---------------------------------------------------------------------------

test("governThroughAdapter: REFUSE -> GATE_REFUSED, no emit", async () => {
  const transport = new RecordingTransport<NoopOp, AdapterAuthorization, NoopReceipt>({ productionValidated: true });
  const result = await governThroughAdapter(NOOP_OP, { client: refusingClient(), buildAction, transport });
  assert.equal(result.ok, false);
  assert.equal(result.refusal?.code, "GATE_REFUSED");
  assert.ok(result.refusal?.detail.includes("REFUSE"));
  assert.equal(transport.emitCalls.length, 0, "transport must NOT be called on REFUSE");
});

test("governThroughAdapter: HTTP 403 -> GATE_HTTP_403, no emit", async () => {
  const transport = new RecordingTransport<NoopOp, AdapterAuthorization, NoopReceipt>({ productionValidated: true });
  const result = await governThroughAdapter(NOOP_OP, { client: httpErroringClient(403), buildAction, transport });
  assert.equal(result.ok, false);
  assert.equal(result.refusal?.code, "GATE_HTTP_403");
  assert.equal(transport.emitCalls.length, 0);
});

test("governThroughAdapter: network error -> GATE_UNREACHABLE", async () => {
  const transport = new RecordingTransport<NoopOp, AdapterAuthorization, NoopReceipt>({ productionValidated: true });
  const result = await governThroughAdapter(NOOP_OP, { client: unreachableClient(), buildAction, transport });
  assert.equal(result.ok, false);
  assert.equal(result.refusal?.code, "GATE_UNREACHABLE");
  assert.ok(result.refusal?.detail.includes("ECONNREFUSED"));
  assert.equal(transport.emitCalls.length, 0);
});

test("governThroughAdapter: ALLOW + demo transport + !allowDemonstrationTransport -> DEMONSTRATION_ONLY_BLOCKED", async () => {
  const transport = new NoopDemoTransport();
  const result = await governThroughAdapter(NOOP_OP, {
    client: allowingClient(),
    buildAction,
    transport
    // allowDemonstrationTransport omitted -> default false
  });
  assert.equal(result.ok, false);
  assert.equal(result.refusal?.code, "DEMONSTRATION_ONLY_BLOCKED");
  assert.equal(transport.emitted.length, 0, "demo transport must NOT be called when not allowed");
});

test("governThroughAdapter: ALLOW + transport returns ok:false -> TRANSPORT_REFUSED", async () => {
  const transport = new RecordingTransport<NoopOp, AdapterAuthorization, NoopReceipt>({
    productionValidated: true,
    onEmit: () => ({ ok: false, refusal: { code: "DEVICE_BUSY", detail: "PLC slot 3 is busy" } })
  });
  const result = await governThroughAdapter(NOOP_OP, { client: allowingClient(), buildAction, transport });
  assert.equal(result.ok, false);
  assert.equal(result.refusal?.code, "TRANSPORT_REFUSED");
  assert.ok(result.refusal?.detail.includes("DEVICE_BUSY"));
  // emit DID happen (transport refused after being called).
  assert.equal(transport.emitCalls.length, 1);
});

test("governThroughAdapter: ALLOW without a warrant -> MISSING_WARRANT (defensive)", async () => {
  const client = {
    evaluate: async (_: CanonicalAction): Promise<EvaluateResponse> => ({
      decision: "ALLOW",
      reason_codes: [],
      canonical_action_hash: "sha256:no-warrant",
      // intentionally omit warrant
      gel_record: { record_id: "rec", record_hash: "rh" }
    } as EvaluateResponse)
  } as unknown as AristotleClient;
  const transport = new RecordingTransport<NoopOp, AdapterAuthorization, NoopReceipt>({ productionValidated: true });
  const result = await governThroughAdapter(NOOP_OP, { client, buildAction, transport });
  assert.equal(result.ok, false);
  assert.equal(result.refusal?.code, "MISSING_WARRANT");
  assert.equal(transport.emitCalls.length, 0);
});

// ---------------------------------------------------------------------------
// buildAuthorization callback
// ---------------------------------------------------------------------------

interface ExtendedAuthz extends AdapterAuthorization {
  permitted_targets: string[];
}

test("governThroughAdapter: buildAuthorization extends the base authz with adapter-specific fields", async () => {
  const transport = new RecordingTransport<NoopOp, ExtendedAuthz, NoopReceipt>({
    productionValidated: true,
    onEmit: (op, authz) => {
      // Verify the extended field came through.
      if (!authz.permitted_targets.includes(op.target)) {
        return { ok: false, refusal: { code: "TARGET_OUTSIDE_AUTHZ", detail: op.target } };
      }
      return { ok: true, receipt: { receipt_id: "r", command: op.command, warrant_id: authz.warrant_id } };
    }
  });
  const result = await governThroughAdapter(NOOP_OP, {
    client: allowingClient(),
    buildAction,
    transport,
    buildAuthorization: (decision, op): ExtendedAuthz => {
      const w = decision.warrant!;
      return {
        warrant_id: w.warrant_id,
        warrant_signature: (w.signature as string) ?? "ed25519:opaque",
        consumed: true,
        consumed_at: new Date().toISOString(),
        action_hash: decision.canonical_action_hash,
        permitted_targets: [op.target]
      };
    }
  });
  assert.equal(result.ok, true, `should succeed: ${JSON.stringify(result.refusal)}`);
  assert.equal(transport.emitCalls.length, 1);
  assert.deepEqual(transport.emitCalls[0].authz.permitted_targets, ["stub"]);
});

// ---------------------------------------------------------------------------
// DemonstrationTransport base class invariants
// ---------------------------------------------------------------------------

test("DemonstrationTransport: production_validated is always false", () => {
  const t = new NoopDemoTransport();
  assert.equal(t.production_validated, false);
});

test("DemonstrationTransport: emit appends to emitted[] and increments seq", async () => {
  const t = new NoopDemoTransport();
  const authz: AdapterAuthorization = {
    warrant_id: "w-1", warrant_signature: "sig", consumed: true,
    consumed_at: "2026-05-24T00:00:00Z", action_hash: "sha256:x"
  };
  const a = await t.emit({ command: "A", target: "t", requested_at: "x" }, authz);
  const b = await t.emit({ command: "B", target: "t", requested_at: "x" }, authz);
  assert.equal(t.emitted.length, 2);
  assert.equal(t.emitted[0].command, "A");
  assert.equal(t.emitted[1].command, "B");
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  if (a.ok && b.ok) {
    assert.notEqual((a.receipt as NoopReceipt).receipt_id, (b.receipt as NoopReceipt).receipt_id);
  }
});
