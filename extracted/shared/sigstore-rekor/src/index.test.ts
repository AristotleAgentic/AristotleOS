import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createEd25519Signer } from "@aristotle/execution-control-runtime";
import {
  PUBLIC_REKOR_URL,
  REKOR_ANCHOR_KIND,
  REKOR_HASHEDREKORD_API_VERSION,
  REKOR_HASHEDREKORD_KIND,
  RekorTimestampAuthority,
  inspectRekorAnchor
} from "./index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkSigner() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return createEd25519Signer({
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString()
  });
}

function mockRekorFetch(opts: {
  uuid?: string;
  logIndex?: number;
  integratedTime?: number;
  signedEntryTimestamp?: string;
  body?: string;
  responseStatus?: number;
  /** Captured POST for assertions. */
  capture?: { url?: string; body?: unknown; headers?: Record<string, string> };
}): typeof fetch {
  const uuid = opts.uuid ?? "deadbeef".repeat(8);
  const logIndex = opts.logIndex ?? 12345;
  const integratedTime = opts.integratedTime ?? 1717590000;
  const signedEntryTimestamp = opts.signedEntryTimestamp ?? "AAAA-SET-AAAA";
  const body = opts.body ?? "AAAA-BODY-AAAA";
  return (async (url: string | URL | Request, init?: RequestInit) => {
    if (opts.capture) {
      opts.capture.url = String(url);
      if (init?.body && typeof init.body === "string") {
        try { opts.capture.body = JSON.parse(init.body); }
        catch { opts.capture.body = init.body; }
      }
      opts.capture.headers = (init?.headers as Record<string, string>) ?? {};
    }
    const status = opts.responseStatus ?? 201;
    if (status >= 400) {
      return new Response(`error`, { status });
    }
    const entry = {
      [uuid]: {
        body,
        integratedTime,
        logIndex,
        logID: "rekor-log-id",
        verification: { signedEntryTimestamp }
      }
    };
    return new Response(JSON.stringify(entry), {
      status, headers: { "content-type": "application/json" }
    });
  }) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

test("RekorTimestampAuthority: defaults rekorUrl to the public Sigstore instance", () => {
  const tsa = new RekorTimestampAuthority({ signer: mkSigner() });
  assert.equal(tsa.kind, REKOR_ANCHOR_KIND);
  assert.ok(tsa.keyId.startsWith(`sigstore-rekor:${PUBLIC_REKOR_URL}:`));
});

test("RekorTimestampAuthority: trailing slash on rekorUrl is normalized away", () => {
  const tsa = new RekorTimestampAuthority({
    signer: mkSigner(),
    rekorUrl: "https://my-rekor.internal/"
  });
  assert.ok(tsa.keyId.startsWith("sigstore-rekor:https://my-rekor.internal:"));
});

test("RekorTimestampAuthority: tsaKeyId override is surfaced in the anchor", async () => {
  const tsa = new RekorTimestampAuthority({
    signer: mkSigner(),
    fetchImpl: mockRekorFetch({}),
    tsaKeyId: "operator-named-rekor-prod"
  });
  const anchor = await tsa.anchor("rh");
  assert.equal(anchor.tsa_key_id, "operator-named-rekor-prod");
});

// ---------------------------------------------------------------------------
// anchor() — request shape
// ---------------------------------------------------------------------------

test("anchor: POSTs to /api/v1/log/entries with hashedrekord body", async () => {
  const capture: { url?: string; body?: unknown; headers?: Record<string, string> } = {};
  const signer = mkSigner();
  const tsa = new RekorTimestampAuthority({
    signer,
    rekorUrl: "https://rekor.example",
    fetchImpl: mockRekorFetch({ capture })
  });
  await tsa.anchor("sha256:cafebabe");
  assert.equal(capture.url, "https://rekor.example/api/v1/log/entries");
  assert.equal(capture.headers?.["content-type"], "application/json");
  const body = capture.body as {
    apiVersion: string;
    kind: string;
    spec: {
      data: { hash: { algorithm: string; value: string } };
      signature: { format: string; content: string; publicKey: { content: string } };
    };
  };
  assert.equal(body.apiVersion, REKOR_HASHEDREKORD_API_VERSION);
  assert.equal(body.kind, REKOR_HASHEDREKORD_KIND);
  assert.equal(body.spec.data.hash.algorithm, "sha256");
  // The submitted hash is sha256 of the record_hash string.
  assert.equal(body.spec.data.hash.value.length, 64,
    "sha256 hex digest is 64 chars");
  assert.equal(body.spec.signature.format, "ed25519");
  assert.ok(body.spec.signature.content.length > 0);
  assert.ok(body.spec.signature.publicKey.content.length > 0);
});

// ---------------------------------------------------------------------------
// anchor() — response handling
// ---------------------------------------------------------------------------

test("anchor: granted response is parsed into anchor envelope (uuid + logIndex + SET)", async () => {
  const tsa = new RekorTimestampAuthority({
    signer: mkSigner(),
    rekorUrl: "https://rekor.example",
    fetchImpl: mockRekorFetch({
      uuid: "abc123" + "0".repeat(58),
      logIndex: 999_000,
      integratedTime: 1_725_000_000,
      signedEntryTimestamp: "SET-BLOB-XYZ"
    }),
    now: () => "2026-06-05T00:00:00.000Z"
  });
  const anchor = await tsa.anchor("sha256:rh");
  assert.equal(anchor.kind, REKOR_ANCHOR_KIND);
  assert.equal(anchor.record_hash, "sha256:rh");
  assert.equal(anchor.timestamp, "2026-06-05T00:00:00.000Z");
  // Envelope is base64-JSON-encoded.
  const envelope = JSON.parse(Buffer.from(anchor.signature, "base64").toString("utf8"));
  assert.equal(envelope.uuid, "abc123" + "0".repeat(58));
  assert.equal(envelope.log_index, 999_000);
  assert.equal(envelope.integrated_time, 1_725_000_000);
  assert.equal(envelope.signed_entry_timestamp_b64, "SET-BLOB-XYZ");
  assert.equal(envelope.rekor_url, "https://rekor.example");
});

test("anchor: Rekor HTTP error throws with status info", async () => {
  const tsa = new RekorTimestampAuthority({
    signer: mkSigner(),
    fetchImpl: mockRekorFetch({ responseStatus: 503 })
  });
  await assert.rejects(
    () => tsa.anchor("rh"),
    /Rekor POST failed: 503/
  );
});

test("anchor: empty entry map throws", async () => {
  const tsa = new RekorTimestampAuthority({
    signer: mkSigner(),
    fetchImpl: (async () =>
      new Response("{}", { status: 201, headers: { "content-type": "application/json" } })) as typeof fetch
  });
  await assert.rejects(() => tsa.anchor("rh"), /empty entry map/);
});

test("anchor: missing logIndex or integratedTime throws", async () => {
  const tsa = new RekorTimestampAuthority({
    signer: mkSigner(),
    fetchImpl: (async () =>
      new Response(
        JSON.stringify({ "uuid-xyz": { body: "B", logID: "L" } }),
        { status: 201, headers: { "content-type": "application/json" } }
      )) as typeof fetch
  });
  await assert.rejects(() => tsa.anchor("rh"), /missing logIndex or integratedTime/);
});

// ---------------------------------------------------------------------------
// inspectRekorAnchor
// ---------------------------------------------------------------------------

test("inspectRekorAnchor: returns ok + parsed envelope for a valid anchor", async () => {
  const tsa = new RekorTimestampAuthority({
    signer: mkSigner(),
    fetchImpl: mockRekorFetch({ uuid: "valid-uuid-001", logIndex: 7 })
  });
  const anchor = await tsa.anchor("sha256:rh");
  const result = inspectRekorAnchor("sha256:rh", anchor);
  assert.equal(result.ok, true, `inspect must pass; got reason=${result.reason}`);
  assert.equal(result.envelope?.uuid, "valid-uuid-001");
  assert.equal(result.envelope?.log_index, 7);
});

test("inspectRekorAnchor: wrong kind -> ok=false with reason", () => {
  const anchor = {
    kind: "rfc3161",
    timestamp: "x",
    tsa_key_id: "t",
    record_hash: "rh",
    signature: "AAAA"
  };
  const result = inspectRekorAnchor("rh", anchor);
  assert.equal(result.ok, false);
  assert.ok(result.reason?.includes("expected kind 'sigstore-rekor'"));
});

test("inspectRekorAnchor: record_hash mismatch -> ok=false", async () => {
  const tsa = new RekorTimestampAuthority({
    signer: mkSigner(),
    fetchImpl: mockRekorFetch({})
  });
  const anchor = await tsa.anchor("real-rh");
  const result = inspectRekorAnchor("WRONG-RH", anchor);
  assert.equal(result.ok, false);
  assert.ok(result.reason?.includes("record_hash mismatch"));
});

test("inspectRekorAnchor: signature is not valid base64 envelope -> ok=false", () => {
  const anchor = {
    kind: REKOR_ANCHOR_KIND,
    timestamp: "x",
    tsa_key_id: "t",
    record_hash: "rh",
    signature: Buffer.from("not json at all", "utf8").toString("base64")
  };
  const result = inspectRekorAnchor("rh", anchor);
  assert.equal(result.ok, false);
  assert.ok(result.reason?.includes("not valid JSON"));
});

test("inspectRekorAnchor: envelope missing required fields -> ok=false", () => {
  const incomplete = { rekor_url: "x" }; // missing uuid + log_index
  const anchor = {
    kind: REKOR_ANCHOR_KIND,
    timestamp: "x",
    tsa_key_id: "t",
    record_hash: "rh",
    signature: Buffer.from(JSON.stringify(incomplete), "utf8").toString("base64")
  };
  const result = inspectRekorAnchor("rh", anchor);
  assert.equal(result.ok, false);
  assert.ok(result.reason?.includes("uuid"));
});
