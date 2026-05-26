import test from "node:test";
import assert from "node:assert/strict";
import { AristotleClient } from "@aristotle/os-sdk";
import { aristotleGuard, type PreToolUseHookInput } from "./index.js";

interface Recorded { url: string; method?: string; body?: string }

function mockFetch(handler: (rec: Recorded) => { status: number; body: unknown }) {
  const calls: Recorded[] = [];
  const fn = (async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
    const rec: Recorded = { url, method: init.method, body: init.body };
    calls.push(rec);
    const { status, body } = handler(rec);
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function makeGuard(handler: (rec: Recorded) => { status: number; body: unknown }, overrides: Partial<Parameters<typeof aristotleGuard>[0]> = {}) {
  const { fn, calls } = mockFetch(handler);
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  const guard = aristotleGuard({ client, wardId: "ward-agent-ops", subject: "agent:assistant-1", ...overrides });
  return { guard, client, calls };
}

const PRE_TOOL_USE: PreToolUseHookInput = {
  hook_event_name: "PreToolUse",
  tool_name: "Bash",
  tool_input: { command: "ls -la" },
  session_id: "sess-123",
  cwd: "/tmp/agent-workspace"
};

const CTX = { signal: new AbortController().signal };

test("hook returns permissionDecision:allow on ALLOW and surfaces the warrant id in the reason", async () => {
  const { guard, calls } = makeGuard(() => ({
    status: 200,
    body: { decision: "ALLOW", reason_codes: [], canonical_action_hash: "h", warrant: { warrant_id: "wr-9" }, gel_record: { record_id: "rec-9", record_hash: "rh" } }
  }));
  const out = await guard.hook(PRE_TOOL_USE, "tool-use-1", CTX);
  assert.equal(out.hookSpecificOutput?.permissionDecision, "allow");
  assert.match(out.hookSpecificOutput?.permissionDecisionReason ?? "", /wr-9/);
  assert.match(out.hookSpecificOutput?.permissionDecisionReason ?? "", /rec-9/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://gate.internal/v1/execution-control/evaluate");
});

test("hook returns permissionDecision:deny on REFUSE and includes reason codes", async () => {
  const { guard } = makeGuard(() => ({
    status: 200,
    body: { decision: "REFUSE", reason_codes: ["ACTION_DENIED", "PHYSICAL_INVARIANT_FAILED"], canonical_action_hash: "h", gel_record: { record_id: "rec-9", record_hash: "rh" } }
  }));
  const out = await guard.hook(PRE_TOOL_USE, "tool-use-1", CTX);
  assert.equal(out.hookSpecificOutput?.permissionDecision, "deny");
  assert.match(out.hookSpecificOutput?.permissionDecisionReason ?? "", /ACTION_DENIED/);
  assert.match(out.hookSpecificOutput?.permissionDecisionReason ?? "", /PHYSICAL_INVARIANT_FAILED/);
});

test("hook returns permissionDecision:ask on ESCALATE so the SDK can route to a human", async () => {
  const { guard } = makeGuard(() => ({
    status: 200,
    body: { decision: "ESCALATE", reason_codes: ["DUAL_CONTROL_REQUIRED"], canonical_action_hash: "h", gel_record: { record_id: "rec-9", record_hash: "rh" } }
  }));
  const out = await guard.hook(PRE_TOOL_USE, "tool-use-1", CTX);
  assert.equal(out.hookSpecificOutput?.permissionDecision, "ask");
  assert.match(out.hookSpecificOutput?.permissionDecisionReason ?? "", /DUAL_CONTROL_REQUIRED/);
});

test("default action_type is tool.<toolname-lowercased>; the gate sees the canonical action with the tool input as params", async () => {
  const { guard, calls } = makeGuard(() => ({
    status: 200,
    body: { decision: "ALLOW", reason_codes: [], canonical_action_hash: "h", warrant: { warrant_id: "wr-9" }, gel_record: { record_id: "rec-9", record_hash: "rh" } }
  }));
  await guard.hook(PRE_TOOL_USE, "tool-use-1", CTX);
  const body = JSON.parse(calls[0].body!) as { action: { action_type: string; ward_id: string; subject: string; params: Record<string, unknown>; request_id: string; action_id: string } };
  assert.equal(body.action.action_type, "tool.bash");
  assert.equal(body.action.ward_id, "ward-agent-ops");
  assert.equal(body.action.subject, "agent:assistant-1");
  assert.deepEqual(body.action.params, { command: "ls -la" });
  assert.equal(body.action.request_id, "sess-123");
  assert.equal(body.action.action_id, "tool-use-1");
});

test("custom actionTypeFor routes specific tools into a vertical namespace", async () => {
  const { guard, calls } = makeGuard(
    () => ({ status: 200, body: { decision: "ALLOW", reason_codes: [], canonical_action_hash: "h", warrant: { warrant_id: "wr" }, gel_record: { record_id: "r", record_hash: "rh" } } }),
    { actionTypeFor: (t) => (t === "Bash" ? "infra.shell.run" : `tool.${t.toLowerCase()}`) }
  );
  await guard.hook(PRE_TOOL_USE, "tu-1", CTX);
  const body = JSON.parse(calls[0].body!) as { action: { action_type: string } };
  assert.equal(body.action.action_type, "infra.shell.run");
});

test("custom buildAction takes full control over the canonical action shape", async () => {
  const { guard, calls } = makeGuard(
    () => ({ status: 200, body: { decision: "ALLOW", reason_codes: [], canonical_action_hash: "h", warrant: { warrant_id: "wr" }, gel_record: { record_id: "r", record_hash: "rh" } } }),
    {
      buildAction: ({ toolName, toolInput, sessionId, toolUseId }) => ({
        action_id: toolUseId ?? "fallback",
        ward_id: "ward-custom",
        subject: "agent:custom",
        action_type: `custom.${toolName}`,
        params: { wrapped: toolInput },
        request_id: sessionId,
        target: "custom-target"
      })
    }
  );
  await guard.hook(PRE_TOOL_USE, "tu-1", CTX);
  const body = JSON.parse(calls[0].body!) as { action: { action_type: string; ward_id: string; params: Record<string, unknown>; target: string } };
  assert.equal(body.action.action_type, "custom.Bash");
  assert.equal(body.action.ward_id, "ward-custom");
  assert.deepEqual(body.action.params, { wrapped: { command: "ls -la" } });
  assert.equal(body.action.target, "custom-target");
});

test("passthroughTools allows specified tools without calling the gate", async () => {
  const { guard, calls } = makeGuard(
    () => ({ status: 200, body: { decision: "REFUSE", reason_codes: [], canonical_action_hash: "h", gel_record: { record_id: "r", record_hash: "rh" } } }),
    { passthroughTools: ["Read", "Glob"] }
  );
  const out = await guard.hook(
    { ...PRE_TOOL_USE, tool_name: "Read", tool_input: { file_path: "/etc/hosts" } },
    "tu-1",
    CTX
  );
  assert.equal(out.hookSpecificOutput?.permissionDecision, "allow");
  assert.match(out.hookSpecificOutput?.permissionDecisionReason ?? "", /passthrough/);
  assert.equal(calls.length, 0, "gate must not be called for a passthrough tool");
});

test("onDecision telemetry fires with the gate verdict + elapsed time", async () => {
  type DecisionInfo = Parameters<NonNullable<Parameters<typeof aristotleGuard>[0]["onDecision"]>>[0];
  const seen: DecisionInfo[] = [];
  const { guard } = makeGuard(
    () => ({ status: 200, body: { decision: "ALLOW", reason_codes: [], canonical_action_hash: "h", warrant: { warrant_id: "wr" }, gel_record: { record_id: "r", record_hash: "rh" } } }),
    { onDecision: (info) => { seen.push(info); } }
  );
  await guard.hook(PRE_TOOL_USE, "tu-1", CTX);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].toolName, "Bash");
  assert.equal(seen[0].action.action_type, "tool.bash");
  if ("warrant" in seen[0].decision) {
    assert.equal(seen[0].decision.warrant?.warrant_id, "wr");
  }
  assert.ok(typeof seen[0].elapsedMs === "number");
});

test("gate-unreachable fails closed with permissionDecision:deny by default", async () => {
  const guard = aristotleGuard({
    client: new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: ((async () => { throw new Error("network down"); }) as unknown as typeof fetch) }),
    wardId: "w",
    subject: "s"
  });
  const out = await guard.hook(PRE_TOOL_USE, "tu-1", CTX);
  assert.equal(out.hookSpecificOutput?.permissionDecision, "deny");
  assert.match(out.hookSpecificOutput?.permissionDecisionReason ?? "", /network down|unreachable/i);
});

test("onError:ask routes gate failures to the user instead of failing closed", async () => {
  const guard = aristotleGuard({
    client: new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: ((async () => { throw new Error("network down"); }) as unknown as typeof fetch) }),
    wardId: "w",
    subject: "s",
    onError: "ask"
  });
  const out = await guard.hook(PRE_TOOL_USE, "tu-1", CTX);
  assert.equal(out.hookSpecificOutput?.permissionDecision, "ask");
});

test("hook is a no-op for non-PreToolUse events (defensive guard)", async () => {
  const { guard, calls } = makeGuard(() => ({ status: 200, body: { decision: "ALLOW", reason_codes: [], canonical_action_hash: "h", warrant: { warrant_id: "wr" }, gel_record: { record_id: "r", record_hash: "rh" } } }));
  const out = await guard.hook({ hook_event_name: "PostToolUse" }, "tu-1", CTX);
  assert.deepEqual(out, {});
  assert.equal(calls.length, 0);
});

test("hooksConfig is a ready-made PreToolUse registration", async () => {
  const { guard } = makeGuard(() => ({ status: 200, body: { decision: "ALLOW", reason_codes: [], canonical_action_hash: "h", warrant: { warrant_id: "wr" }, gel_record: { record_id: "r", record_hash: "rh" } } }));
  assert.ok(Array.isArray(guard.hooksConfig.PreToolUse));
  assert.equal(guard.hooksConfig.PreToolUse.length, 1);
  assert.equal(guard.hooksConfig.PreToolUse[0].hooks.length, 1);
  assert.equal(guard.hooksConfig.PreToolUse[0].hooks[0], guard.hook);
});

test("constructor refuses missing required options", () => {
  assert.throws(() => aristotleGuard({ client: undefined as unknown as AristotleClient, wardId: "w", subject: "s" }), /client/);
  assert.throws(() => aristotleGuard({ client: new AristotleClient({ baseUrl: "x", fetch: (async () => ({ ok: true, status: 200, text: async () => "" })) as unknown as typeof fetch }), wardId: "", subject: "s" }), /wardId/);
  assert.throws(() => aristotleGuard({ client: new AristotleClient({ baseUrl: "x", fetch: (async () => ({ ok: true, status: 200, text: async () => "" })) as unknown as typeof fetch }), wardId: "w", subject: "" }), /subject/);
});
