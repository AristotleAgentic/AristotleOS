import test from "node:test";
import assert from "node:assert/strict";
import { AristotleClient } from "@aristotle/os-sdk";
import {
  governAdmissionReview,
  createAdmissionHandler,
  type AdmissionReviewRequest
} from "./index.js";

function mockFetch(h: (req: { url: string; body?: string }) => { status: number; body: unknown }) {
  const calls: Array<{ url: string; body?: string }> = [];
  const fn = (async (url: string, init: { method?: string; body?: string } = {}) => {
    const r = { url, body: init.body };
    calls.push(r);
    const { status, body } = h(r);
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const ALLOW = { decision: "ALLOW", reason_codes: [], canonical_action_hash: "sha256:bound", warrant: { warrant_id: "warrant:from-gate" }, gel_record: { record_id: "r", record_hash: "rh" } };
const REFUSE = { decision: "REFUSE", reason_codes: ["IMAGE_NOT_IN_ALLOWLIST"], canonical_action_hash: "h", gel_record: { record_id: "r", record_hash: "rh" } };
const ESCALATE = { decision: "ESCALATE", reason_codes: ["MANUAL_REVIEW_REQUIRED"], canonical_action_hash: "h", gel_record: { record_id: "r", record_hash: "rh" } };

function pod(name: string, image: string, namespace = "demo"): AdmissionReviewRequest {
  return {
    apiVersion: "admission.k8s.io/v1",
    kind: "AdmissionReview",
    request: {
      uid: "uid-" + name,
      kind: { group: "", version: "v1", kind: "Pod" },
      resource: { group: "", version: "v1", resource: "pods" },
      name, namespace,
      operation: "CREATE",
      userInfo: { username: "alice@example.com", groups: ["dev"] },
      object: {
        metadata: { name, namespace, labels: { app: name } },
        spec: { containers: [{ name: "main", image, securityContext: { privileged: false } }] }
      }
    }
  };
}

test("ALLOW path returns allowed:true and includes warrant warning", async () => {
  let lastBody = "";
  const { fn } = mockFetch((r) => { lastBody = r.body ?? ""; return { status: 200, body: ALLOW }; });
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  const resp = await governAdmissionReview(pod("nginx", "nginx:1.27"), {
    client, wardId: "ward-platform"
  });
  assert.equal(resp.response.allowed, true);
  assert.equal(resp.response.uid, "uid-nginx");
  assert.match(lastBody, /"action_type":"k8s\.create\.pod"/);
  assert.match(lastBody, /"image":\["nginx:1\.27"\]/);
  assert.ok(resp.response.warnings?.[0]?.includes("warrant:from-gate"));
});

test("default subject derives from userInfo.username", async () => {
  let lastBody = "";
  const { fn } = mockFetch((r) => { lastBody = r.body ?? ""; return { status: 200, body: ALLOW }; });
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  await governAdmissionReview(pod("a", "nginx"), { client, wardId: "w" });
  assert.match(lastBody, /"subject":"agent:k8s\.alice@example\.com"/);
});

test("REFUSE returns allowed:false with code 403 and reason carried", async () => {
  const { fn } = mockFetch(() => ({ status: 200, body: REFUSE }));
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  const resp = await governAdmissionReview(pod("evil", "evil:latest"), { client, wardId: "w" });
  assert.equal(resp.response.allowed, false);
  assert.equal(resp.response.status?.code, 403);
  assert.equal(resp.response.status?.reason, "REFUSE");
  assert.match(resp.response.status?.message ?? "", /IMAGE_NOT_IN_ALLOWLIST/);
});

test("ESCALATE blocks admission by default (code 409)", async () => {
  const { fn } = mockFetch(() => ({ status: 200, body: ESCALATE }));
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  const resp = await governAdmissionReview(pod("x", "nginx"), { client, wardId: "w" });
  assert.equal(resp.response.allowed, false);
  assert.equal(resp.response.status?.code, 409);
  assert.equal(resp.response.status?.reason, "ESCALATE");
});

test("ESCALATE with escalateBlocksAdmission:false returns code 202", async () => {
  const { fn } = mockFetch(() => ({ status: 200, body: ESCALATE }));
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  const resp = await governAdmissionReview(pod("x", "nginx"), {
    client, wardId: "w", escalateBlocksAdmission: false
  });
  assert.equal(resp.response.allowed, false);
  assert.equal(resp.response.status?.code, 202);
});

test("Gate unreachable fail-closes with code 503", async () => {
  const fn = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  const resp = await governAdmissionReview(pod("x", "nginx"), { client, wardId: "w" });
  assert.equal(resp.response.allowed, false);
  assert.equal(resp.response.status?.code, 503);
  assert.equal(resp.response.status?.reason, "GATE_UNREACHABLE");
});

test("privileged container surfaces in params.privileged", async () => {
  let lastBody = "";
  const { fn } = mockFetch((r) => { lastBody = r.body ?? ""; return { status: 200, body: ALLOW }; });
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  const review = pod("priv", "alpine");
  (review.request.object as Record<string, unknown>)["spec"] = {
    containers: [{ name: "c", image: "alpine", securityContext: { privileged: true } }]
  };
  await governAdmissionReview(review, { client, wardId: "w" });
  assert.match(lastBody, /"privileged":true/);
});

test("Deployment template container images are extracted recursively", async () => {
  let lastBody = "";
  const { fn } = mockFetch((r) => { lastBody = r.body ?? ""; return { status: 200, body: ALLOW }; });
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  const deploy: AdmissionReviewRequest = {
    apiVersion: "admission.k8s.io/v1",
    kind: "AdmissionReview",
    request: {
      uid: "uid-deploy",
      kind: { group: "apps", version: "v1", kind: "Deployment" },
      resource: { group: "apps", version: "v1", resource: "deployments" },
      name: "web", namespace: "demo",
      operation: "CREATE",
      userInfo: { username: "bob@example.com" },
      object: {
        metadata: { name: "web" },
        spec: {
          template: {
            spec: { containers: [{ name: "web", image: "myapp:v2" }] }
          }
        }
      }
    }
  };
  await governAdmissionReview(deploy, { client, wardId: "w" });
  assert.match(lastBody, /"action_type":"k8s\.create\.deployment"/);
  assert.match(lastBody, /"image":\["myapp:v2"\]/);
});

test("createAdmissionHandler parses JSON and returns a JSON response string", async () => {
  const { fn } = mockFetch(() => ({ status: 200, body: ALLOW }));
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  const h = createAdmissionHandler({ client, wardId: "w" });
  const out = await h.handle(JSON.stringify(pod("n", "nginx")));
  const parsed = JSON.parse(out) as { response: { allowed: boolean; uid: string } };
  assert.equal(parsed.response.allowed, true);
  assert.equal(parsed.response.uid, "uid-n");
});

test("createAdmissionHandler returns MALFORMED_REQUEST on bad JSON", async () => {
  const { fn } = mockFetch(() => ({ status: 200, body: ALLOW }));
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  const h = createAdmissionHandler({ client, wardId: "w" });
  const out = await h.handle("not-json");
  const parsed = JSON.parse(out) as { response: { allowed: boolean; status?: { reason?: string } } };
  assert.equal(parsed.response.allowed, false);
  assert.equal(parsed.response.status?.reason, "MALFORMED_REQUEST");
});
