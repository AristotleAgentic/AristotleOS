import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  CONTENT_TYPE_TSREQ,
  CONTENT_TYPE_TSRESP,
  OID_SHA256,
  RFC3161_ANCHOR_KIND,
  Rfc3161TimestampAuthority,
  buildTimeStampReq,
  decodeTimeStampResp,
  inspectRfc3161Anchor
} from "./index.js";
import {
  encodeInteger,
  encodeNull,
  encodeObjectIdentifier,
  encodeOctetString,
  encodeSequence,
  decodeChildren,
  decodeTLV
} from "./asn1.js";

// ---------------------------------------------------------------------------
// ASN.1 encoder unit tests
// ---------------------------------------------------------------------------

test("ASN.1: encodeInteger(0) -> 02 01 00", () => {
  assert.deepEqual([...encodeInteger(0)], [0x02, 0x01, 0x00]);
});

test("ASN.1: encodeInteger(127) -> 02 01 7F (high bit clear, no padding)", () => {
  assert.deepEqual([...encodeInteger(127)], [0x02, 0x01, 0x7f]);
});

test("ASN.1: encodeInteger(128) -> 02 02 00 80 (high bit set, leading zero padding)", () => {
  assert.deepEqual([...encodeInteger(128)], [0x02, 0x02, 0x00, 0x80]);
});

test("ASN.1: encodeNull -> 05 00", () => {
  assert.deepEqual([...encodeNull()], [0x05, 0x00]);
});

test("ASN.1: encodeObjectIdentifier for SHA-256 -> well-known DER bytes", () => {
  // SHA-256 OID is 2.16.840.1.101.3.4.2.1
  // DER encoding well-known: 06 09 60 86 48 01 65 03 04 02 01
  assert.deepEqual([...encodeObjectIdentifier(OID_SHA256)],
    [0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]);
});

test("ASN.1: encodeSequence wraps children with tag 30 + correct length", () => {
  const a = encodeInteger(1);
  const b = encodeInteger(2);
  const seq = encodeSequence([a, b]);
  // 30 06 02 01 01 02 01 02
  assert.deepEqual([...seq], [0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x02]);
});

test("ASN.1: encodeSequence with long-form length (> 127 bytes content)", () => {
  // 100 INTEGER(0) children = 100 * 3 bytes = 300 bytes -> long-form length.
  const items = Array.from({ length: 100 }, () => encodeInteger(0));
  const seq = encodeSequence(items);
  assert.equal(seq[0], 0x30);
  // Length byte should signal long form (high bit set).
  assert.ok((seq[1] & 0x80) === 0x80);
});

test("ASN.1: encodeOctetString wraps bytes with tag 04 + length", () => {
  const oct = encodeOctetString(Buffer.from([0xde, 0xad, 0xbe, 0xef]));
  assert.deepEqual([...oct], [0x04, 0x04, 0xde, 0xad, 0xbe, 0xef]);
});

test("ASN.1: decodeTLV reads tag + length + valueOffset", () => {
  const buf = Buffer.from([0x02, 0x02, 0x00, 0x80]);
  const tlv = decodeTLV(buf, 0);
  assert.equal(tlv.tag, 0x02);
  assert.equal(tlv.length, 2);
  assert.equal(tlv.valueOffset, 2);
  assert.equal(tlv.totalLength, 4);
});

test("ASN.1: decodeChildren walks a SEQUENCE", () => {
  // SEQUENCE { INTEGER 1, INTEGER 2 }
  const buf = Buffer.from([0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x02]);
  const root = decodeTLV(buf, 0);
  const children = decodeChildren(buf, root);
  assert.equal(children.length, 2);
  assert.equal(children[0].tag, 0x02);
  assert.equal(children[1].tag, 0x02);
});

// ---------------------------------------------------------------------------
// buildTimeStampReq
// ---------------------------------------------------------------------------

test("buildTimeStampReq: produces a parseable SEQUENCE with version=1 and SHA-256 messageImprint", () => {
  const recordHash = "sha256:" + "ab".repeat(32);
  const { derBytes, nonce } = buildTimeStampReq({ recordHash });
  assert.equal(nonce.length, 16);
  const root = decodeTLV(derBytes, 0);
  assert.equal(root.tag, 0x30, "root is SEQUENCE");
  const children = decodeChildren(derBytes, root);
  // version (INTEGER), messageImprint (SEQUENCE), nonce (INTEGER) at minimum.
  assert.ok(children.length >= 3);
  assert.equal(children[0].tag, 0x02, "first child is version INTEGER");
  assert.equal(children[1].tag, 0x30, "second child is messageImprint SEQUENCE");

  // MessageImprint inner: AlgorithmIdentifier (SEQUENCE) + hashedMessage (OCTET STRING)
  const imprintChildren = decodeChildren(derBytes, children[1]);
  assert.equal(imprintChildren.length, 2);
  assert.equal(imprintChildren[0].tag, 0x30);
  assert.equal(imprintChildren[1].tag, 0x04);
  // hashedMessage = sha256(recordHash)
  const expectedHash = createHash("sha256").update(recordHash, "utf8").digest();
  const actualHash = derBytes.subarray(
    imprintChildren[1].valueOffset,
    imprintChildren[1].valueOffset + imprintChildren[1].length
  );
  assert.equal(Buffer.compare(actualHash, expectedHash), 0);
});

test("buildTimeStampReq: caller-supplied nonce round-trips", () => {
  const customNonce = Buffer.from("0123456789abcdef", "utf8");
  const { nonce } = buildTimeStampReq({ recordHash: "x", nonce: customNonce });
  assert.equal(Buffer.compare(nonce, customNonce), 0);
});

test("buildTimeStampReq: with reqPolicyOid adds an OID field", () => {
  const { derBytes } = buildTimeStampReq({
    recordHash: "x",
    reqPolicyOid: "1.2.3.4.5"
  });
  const root = decodeTLV(derBytes, 0);
  const children = decodeChildren(derBytes, root);
  // Look for an OBJECT_IDENTIFIER (tag 0x06) somewhere in the children.
  const hasOid = children.some((c) => c.tag === 0x06);
  assert.ok(hasOid, "reqPolicyOid must produce an OID field in the request");
});

// ---------------------------------------------------------------------------
// decodeTimeStampResp
// ---------------------------------------------------------------------------

/**
 * Build a synthetic TimeStampResp for testing.
 *   - status: PKIStatus integer (0=granted, 2=rejection, etc.)
 *   - withToken: when true, include a stub TimeStampToken (just an
 *     empty SEQUENCE — enough to test the decoder's slicing).
 */
function fakeTimeStampResp(status: number, withToken: boolean): Buffer {
  const statusInfo = encodeSequence([encodeInteger(status)]);
  const fields = [statusInfo];
  if (withToken) {
    // ContentInfo is a SEQUENCE — minimal stub for slicing test.
    const stubTst = encodeSequence([encodeObjectIdentifier("1.2.840.113549.1.7.2")]);
    fields.push(stubTst);
  }
  return encodeSequence(fields);
}

test("decodeTimeStampResp: granted (0) + token -> extracts TST bytes", () => {
  const resp = fakeTimeStampResp(0, true);
  const decoded = decodeTimeStampResp(resp);
  assert.equal(decoded.status, 0);
  assert.equal(decoded.statusName, "granted");
  assert.ok(decoded.timeStampTokenDer);
  // The extracted TST should start with the SEQUENCE tag.
  assert.equal(decoded.timeStampTokenDer![0], 0x30);
});

test("decodeTimeStampResp: rejection (2) -> no token", () => {
  const resp = fakeTimeStampResp(2, false);
  const decoded = decodeTimeStampResp(resp);
  assert.equal(decoded.status, 2);
  assert.equal(decoded.statusName, "rejection");
  assert.equal(decoded.timeStampTokenDer, null);
});

test("decodeTimeStampResp: malformed root -> throws", () => {
  const bad = Buffer.from([0x05, 0x00]); // NULL, not SEQUENCE
  assert.throws(() => decodeTimeStampResp(bad), /root must be SEQUENCE/);
});

// ---------------------------------------------------------------------------
// Rfc3161TimestampAuthority — end-to-end with a mock TSA fetch
// ---------------------------------------------------------------------------

function mockTsaFetch(opts: {
  responseBytes?: Buffer;
  responseStatus?: number;
  contentType?: string;
  /** Captured request body for assertions. */
  capture?: { body?: Buffer; url?: string; headers?: Record<string, string> };
}): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    if (opts.capture) {
      opts.capture.url = String(url);
      opts.capture.body = init?.body ? Buffer.from(init.body as ArrayBuffer | string) : undefined;
      const h = init?.headers as Record<string, string> | undefined;
      opts.capture.headers = h ?? {};
    }
    const status = opts.responseStatus ?? 200;
    const ct = opts.contentType ?? CONTENT_TYPE_TSRESP;
    const body = opts.responseBytes ?? fakeTimeStampResp(0, true);
    return new Response(body, {
      status,
      headers: { "content-type": ct }
    });
  }) as unknown as typeof fetch;
}

test("Rfc3161TimestampAuthority: anchor() POSTs DER bytes with correct content-type", async () => {
  const capture: { body?: Buffer; url?: string; headers?: Record<string, string> } = {};
  const tsa = new Rfc3161TimestampAuthority({
    endpoint: "https://tsa.example/tsr",
    fetchImpl: mockTsaFetch({ capture }),
    now: () => "2026-06-05T12:00:00.000Z"
  });
  const anchor = await tsa.anchor("sha256:cafebabe");
  assert.equal(capture.url, "https://tsa.example/tsr");
  assert.equal(capture.headers?.["content-type"], CONTENT_TYPE_TSREQ);
  // Body should be a parseable TimeStampReq.
  assert.ok(capture.body);
  const root = decodeTLV(capture.body!, 0);
  assert.equal(root.tag, 0x30);
  // Anchor shape:
  assert.equal(anchor.kind, RFC3161_ANCHOR_KIND);
  assert.equal(anchor.record_hash, "sha256:cafebabe");
  assert.equal(anchor.timestamp, "2026-06-05T12:00:00.000Z");
  assert.ok(anchor.signature.length > 0, "anchor.signature is base64 of the TST blob");
  assert.equal(anchor.tsa_key_id, "rfc3161:https://tsa.example/tsr");
});

test("Rfc3161TimestampAuthority: TSA rejects -> throws with statusName in message", async () => {
  const rejectedResp = fakeTimeStampResp(2, false);
  const tsa = new Rfc3161TimestampAuthority({
    endpoint: "https://tsa.example/tsr",
    fetchImpl: mockTsaFetch({ responseBytes: rejectedResp })
  });
  await assert.rejects(
    () => tsa.anchor("sha256:x"),
    /TSA rejected request: rejection/
  );
});

test("Rfc3161TimestampAuthority: HTTP non-2xx -> throws with status info", async () => {
  const tsa = new Rfc3161TimestampAuthority({
    endpoint: "https://tsa.example/tsr",
    fetchImpl: mockTsaFetch({ responseStatus: 502 })
  });
  await assert.rejects(
    () => tsa.anchor("sha256:x"),
    /TSA POST failed: 502/
  );
});

test("Rfc3161TimestampAuthority: granted (0) status with token -> anchor signature is the TST", async () => {
  // The mock returns fakeTimeStampResp(0, true) by default.
  const tsa = new Rfc3161TimestampAuthority({
    endpoint: "https://tsa.example/tsr",
    fetchImpl: mockTsaFetch({})
  });
  const anchor = await tsa.anchor("sha256:rh");
  // Decode the base64 signature; should start with SEQUENCE tag.
  const tstBytes = Buffer.from(anchor.signature, "base64");
  assert.equal(tstBytes[0], 0x30);
});

test("Rfc3161TimestampAuthority: tsaKeyId override is surfaced in the anchor", async () => {
  const tsa = new Rfc3161TimestampAuthority({
    endpoint: "https://tsa.example/tsr",
    fetchImpl: mockTsaFetch({}),
    tsaKeyId: "operator-named-tsa-prod"
  });
  const anchor = await tsa.anchor("rh");
  assert.equal(anchor.tsa_key_id, "operator-named-tsa-prod");
});

// ---------------------------------------------------------------------------
// inspectRfc3161Anchor
// ---------------------------------------------------------------------------

test("inspectRfc3161Anchor: returns ok + TST bytes for a valid anchor", async () => {
  const tsa = new Rfc3161TimestampAuthority({
    endpoint: "https://tsa.example/tsr",
    fetchImpl: mockTsaFetch({})
  });
  const anchor = await tsa.anchor("sha256:rh");
  const result = inspectRfc3161Anchor("sha256:rh", anchor);
  assert.equal(result.ok, true, `inspect must pass; got reason=${result.reason}`);
  assert.ok(result.timeStampTokenDer);
  assert.equal(result.timeStampTokenDer![0], 0x30);
});

test("inspectRfc3161Anchor: record_hash mismatch -> ok=false with reason", () => {
  const anchor = {
    kind: RFC3161_ANCHOR_KIND,
    timestamp: "x",
    tsa_key_id: "t",
    record_hash: "real-rh",
    signature: encodeSequence([encodeInteger(0)]).toString("base64")
  };
  const result = inspectRfc3161Anchor("WRONG-RH", anchor);
  assert.equal(result.ok, false);
  assert.ok(result.reason?.includes("record_hash mismatch"));
});

test("inspectRfc3161Anchor: wrong kind -> ok=false with reason", () => {
  const anchor = {
    kind: "local-ed25519",
    timestamp: "x",
    tsa_key_id: "t",
    record_hash: "rh",
    signature: "AAAA"
  };
  const result = inspectRfc3161Anchor("rh", anchor);
  assert.equal(result.ok, false);
  assert.ok(result.reason?.includes("expected kind 'rfc3161'"));
});

test("inspectRfc3161Anchor: malformed TST (not a SEQUENCE) -> ok=false", () => {
  const anchor = {
    kind: RFC3161_ANCHOR_KIND,
    timestamp: "x",
    tsa_key_id: "t",
    record_hash: "rh",
    signature: Buffer.from([0x05, 0x00]).toString("base64") // NULL, not SEQUENCE
  };
  const result = inspectRfc3161Anchor("rh", anchor);
  assert.equal(result.ok, false);
  assert.ok(result.reason?.includes("not SEQUENCE"));
});

test("inspectRfc3161Anchor: empty signature -> ok=false", () => {
  const anchor = {
    kind: RFC3161_ANCHOR_KIND,
    timestamp: "x",
    tsa_key_id: "t",
    record_hash: "rh",
    signature: ""
  };
  const result = inspectRfc3161Anchor("rh", anchor);
  assert.equal(result.ok, false);
  assert.ok(result.reason?.includes("empty"));
});
