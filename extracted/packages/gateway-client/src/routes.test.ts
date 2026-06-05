import test from "node:test";
import assert from "node:assert/strict";
import type {
  AristotleClient,
  CanonicalAction,
  EvaluateResponse,
  GovernanceManifest,
  GovernanceDiffResult,
  PolicyExplanation,
  ShadowReport
} from "@aristotle/os-sdk";
import { createTypedRoutes, type TypedRoutes } from "./routes.js";

// ---------------------------------------------------------------------------
// A stub client that records every call. Lets us assert the typed-routes
// wrapper delegates to the right underlying method with the right args.
// ---------------------------------------------------------------------------

function recordingClient() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const allowResponse: EvaluateResponse = {
    decision: "ALLOW",
    reason_codes: [],
    canonical_action_hash: "sha256:typed-route-test",
    warrant: { warrant_id: "wrt-1", signature: "ed25519:opaque" },
    gel_record: { record_id: "rec-1", record_hash: "rh-1" }
  };
  const stub: Record<string, unknown> = {
    baseUrl: "https://gate.test",
    evaluate(action: CanonicalAction, options: Record<string, unknown>) {
      calls.push({ method: "evaluate", args: [action, options] });
      return Promise.resolve(allowResponse);
    },
    replay(input: { record_id: string }) {
      calls.push({ method: "replay", args: [input] });
      return Promise.resolve({ ...allowResponse, replay: true } as EvaluateResponse & { replay: true });
    },
    compileGovernance(draft: unknown) {
      calls.push({ method: "compileGovernance", args: [draft] });
      const m: GovernanceManifest = {
        manifest_version: "1.0.0",
        hashes: { ward_hash: "wh", authority_envelope_hash: "aeh", manifest_hash: "mh" },
        validation: { ok: true, errors: [] }
      };
      return Promise.resolve(m);
    },
    diffGovernance(input: unknown) {
      calls.push({ method: "diffGovernance", args: [input] });
      const r: GovernanceDiffResult = {
        entries: [],
        summary: { total: 0, weakening: 0, requires_review: false }
      };
      return Promise.resolve(r);
    },
    explainPolicy(input: unknown) {
      calls.push({ method: "explainPolicy", args: [input] });
      const e: PolicyExplanation = {
        ward_id: "w",
        authority_envelope_id: "ae",
        allowed_actions: [],
        denied_actions: [],
        samples: []
      };
      return Promise.resolve(e);
    },
    shadowReplay(actions: CanonicalAction[]) {
      calls.push({ method: "shadowReplay", args: [actions] });
      const r: ShadowReport = {
        ward_id: "w",
        authority_envelope_id: "ae",
        count: actions.length,
        decisions: {}
      };
      return Promise.resolve(r);
    }
  };
  return { client: stub as unknown as AristotleClient, calls, allowResponse };
}

const NOOP_ACTION: CanonicalAction = {
  action_id: "a-typed-1",
  ward_id: "w-typed",
  subject: "agent:typed",
  action_type: "test.echo",
  params: { x: 1 },
  requested_at: "2026-06-05T00:00:00.000Z"
};

// ---------------------------------------------------------------------------
// Happy path: each typed-route method delegates to the underlying client
// ---------------------------------------------------------------------------

test("createTypedRoutes: returns an object with every documented route", () => {
  const { client } = recordingClient();
  const routes: TypedRoutes = createTypedRoutes(client);
  assert.equal(typeof routes.evaluate, "function");
  assert.equal(typeof routes.replay, "function");
  assert.equal(typeof routes.compileGovernance, "function");
  assert.equal(typeof routes.diffGovernance, "function");
  assert.equal(typeof routes.explainPolicy, "function");
  assert.equal(typeof routes.shadowReplay, "function");
  assert.equal(typeof routes.health, "function");
});

test("routes.evaluate delegates to client.evaluate with action + options", async () => {
  const { client, calls, allowResponse } = recordingClient();
  const routes = createTypedRoutes(client);
  const result = await routes.evaluate(NOOP_ACTION, { now: "2026-06-05T00:00:00Z" });
  assert.equal(result.decision, "ALLOW");
  assert.equal(result.canonical_action_hash, allowResponse.canonical_action_hash);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "evaluate");
  assert.deepEqual(calls[0].args[0], NOOP_ACTION);
  assert.deepEqual(calls[0].args[1], { now: "2026-06-05T00:00:00Z" });
});

test("routes.evaluate: omitted options defaults to empty object", async () => {
  const { client, calls } = recordingClient();
  const routes = createTypedRoutes(client);
  await routes.evaluate(NOOP_ACTION);
  assert.deepEqual(calls[0].args[1], {});
});

test("routes.replay delegates to client.replay", async () => {
  const { client, calls } = recordingClient();
  const routes = createTypedRoutes(client);
  const result = await routes.replay({ record_id: "rec-x" });
  assert.equal(result.replay, true);
  assert.equal(calls[0].method, "replay");
  assert.deepEqual(calls[0].args[0], { record_id: "rec-x" });
});

test("routes.compileGovernance delegates to client.compileGovernance", async () => {
  const { client, calls } = recordingClient();
  const routes = createTypedRoutes(client);
  const draft = { ward: {}, envelope: {} };
  const manifest = await routes.compileGovernance(draft);
  assert.equal(manifest.validation.ok, true);
  assert.equal(calls[0].method, "compileGovernance");
});

test("routes.diffGovernance delegates to client.diffGovernance", async () => {
  const { client, calls } = recordingClient();
  const routes = createTypedRoutes(client);
  const result = await routes.diffGovernance({ base: {}, target: {} });
  assert.equal(result.summary.total, 0);
  assert.equal(calls[0].method, "diffGovernance");
});

test("routes.explainPolicy delegates to client.explainPolicy", async () => {
  const { client, calls } = recordingClient();
  const routes = createTypedRoutes(client);
  const result = await routes.explainPolicy({ ward: {}, envelope: {} });
  assert.equal(result.ward_id, "w");
  assert.equal(calls[0].method, "explainPolicy");
});

test("routes.shadowReplay delegates to client.shadowReplay", async () => {
  const { client, calls } = recordingClient();
  const routes = createTypedRoutes(client);
  const result = await routes.shadowReplay([NOOP_ACTION, NOOP_ACTION]);
  assert.equal(result.count, 2);
  assert.equal(calls[0].method, "shadowReplay");
});

// ---------------------------------------------------------------------------
// Missing-method failure mode
// ---------------------------------------------------------------------------

test("routes.evaluate: throws a clear error if client.evaluate is missing", async () => {
  const broken = { baseUrl: "https://gate.test" } as unknown as AristotleClient;
  const routes = createTypedRoutes(broken);
  await assert.rejects(
    () => routes.evaluate(NOOP_ACTION),
    /evaluate is not a function/
  );
});

test("routes.compileGovernance: rejects with a clear error when method missing", async () => {
  const broken = { evaluate: () => Promise.resolve({}) } as unknown as AristotleClient;
  const routes = createTypedRoutes(broken);
  await assert.rejects(
    () => routes.compileGovernance({}),
    /compileGovernance is not available/
  );
});

// ---------------------------------------------------------------------------
// Health route — uses fetch directly
// ---------------------------------------------------------------------------

test("routes.health: GETs <baseUrl>/health and parses ok+service", async () => {
  let calledUrl = "";
  const mockFetch = async (url: string) => {
    calledUrl = url;
    return {
      ok: true,
      async json() { return { ok: true, service: "gateway" }; }
    } as unknown as Response;
  };
  const client = {
    baseUrl: "https://gate.test/",
    fetch: mockFetch
  } as unknown as AristotleClient;
  const routes = createTypedRoutes(client);
  const result = await routes.health();
  assert.equal(result.ok, true);
  assert.equal(result.service, "gateway");
  assert.equal(calledUrl, "https://gate.test/health");
});

test("routes.health: !res.ok -> { ok: false }", async () => {
  const mockFetch = async () => ({ ok: false } as unknown as Response);
  const client = {
    baseUrl: "https://gate.test",
    fetch: mockFetch
  } as unknown as AristotleClient;
  const routes = createTypedRoutes(client);
  const result = await routes.health();
  assert.equal(result.ok, false);
});
