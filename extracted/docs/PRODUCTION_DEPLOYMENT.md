# Production deployment runbook

This document walks an operator through deploying AristotleOS in
production posture — every fail-closed switch enabled, every demo
default replaced, every trust anchor explicit. Read [LIMITATIONS.md](../LIMITATIONS.md)
first; that document describes what AristotleOS does NOT do. This one
describes what an operator must do.

Audience: operators with admin access to the deployment environment and
key custody for the keypairs that anchor the governance chain.

---

## 0. Pre-flight: what you need before you start

| Requirement | Why |
|---|---|
| One ed25519 keypair per mesh node (root, every witness, every edge) | Per-node trust anchor; replaces shared HMAC |
| One ed25519 keypair for the Warrant signer (per tenant or per ward) | Signs every issued Warrant; key for offline verifyWarrant |
| A KMS / HSM / Vault deployment OR a documented decision to skip it | Custody of the Warrant signing private key |
| One ed25519 keypair for the Timestamp Authority (separate operational domain from the Warrant signer) | External timestamp anchoring on GEL records |
| TLS certificates for every mesh node | mTLS at the HTTP layer (the substrate provides `httpClient` + `urlFor` hooks; bring your own TLS) |
| A reverse-proxy or service mesh fronting `/mesh` | Rate limiting, source-IP allowlist, request body size cap at the edge |
| At least 2 witness nodes per ward (3+ for byzantine tolerance) | Multi-witness quorum on revocations |

If any of these are missing, you are NOT in production posture. Stop and
acquire them; the substrate cannot manufacture trust assumptions for you.

---

## 1. Generate per-node Ed25519 keypairs

Every node — root, every witness, every edge — gets its own keypair.
Never share keypairs across nodes.

```js
// scripts/gen-mesh-keypair.mjs
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const nodeId = process.argv[2];
const outDir = process.argv[3] ?? `./keys/${nodeId}`;
if (!nodeId) { console.error("usage: node gen-mesh-keypair.mjs <node-id> [outdir]"); process.exit(2); }
mkdirSync(outDir, { recursive: true });
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
writeFileSync(join(outDir, "private.pem"), privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
writeFileSync(join(outDir, "public.pem"),  publicKey.export({ type: "spki", format: "pem" }));
console.log(`wrote ${outDir}/{private,public}.pem`);
```

Distribute every node's **public** key to every other node's trust
anchor allowlist. Never distribute private keys.

---

## 2. Construct the MeshNode in production posture

Replace the legacy `{ secret }` constructor path with explicit
`{ signer, verifier, productionMode: true }`. The `productionMode` flag
makes the constructor THROW if you accidentally fall back to HMAC.

```ts
import { RootNode, createEd25519MeshSigner, createEd25519MeshVerifier } from "@aristotle/mesh-runtime";
import { readFileSync } from "node:fs";

const privateKeyPem = readFileSync("./keys/root-mae/private.pem", "utf8");
const trustAnchors = {
  "root-mae":       readFileSync("./keys/root-mae/public.pem", "utf8"),
  "witness-mae-1":  readFileSync("./keys/witness-mae-1/public.pem", "utf8"),
  "witness-mae-2":  readFileSync("./keys/witness-mae-2/public.pem", "utf8"),
  "witness-mae-3":  readFileSync("./keys/witness-mae-3/public.pem", "utf8"),
  "edge-mae-1":     readFileSync("./keys/edge-mae-1/public.pem", "utf8"),
  // ...
};

const root = new RootNode({
  id: "root-mae",
  host: "0.0.0.0",
  port: 7004,
  productionMode: true,                                       // refuses HMAC outright
  signer: createEd25519MeshSigner({ signerId: "root-mae", privateKeyPem }),
  verifier: createEd25519MeshVerifier({ trustedKeys: trustAnchors }),
  replayCache: createMeshReplayCache({ ttlMs: 60_000, maxSize: 10_000 }),
  maxRequestBodyBytes: 1024 * 1024,                           // 1 MiB ingress cap
  requireJsonContentType: true                                // reject non-JSON POSTs
});
```

Same pattern for every Witness and Edge node. The Edge gets an extra
flag: `requireRevocationQuorum: N`.

```ts
const edge = new EdgeNode({
  id: "edge-mae-1",
  host: "0.0.0.0",
  port: 7009,
  productionMode: true,
  signer: createEd25519MeshSigner({ signerId: "edge-mae-1", privateKeyPem: edgePriv }),
  verifier: createEd25519MeshVerifier({ trustedKeys: trustAnchors }),
  replayCache: createMeshReplayCache({ ttlMs: 60_000, maxSize: 10_000 }),
  requireRevocationQuorum: 2,                                 // 2 of 3 witnesses must co-sign
  maxWarrantsWhileDisconnected: 50                            // disconnected cap
});
```

**Sizing `requireRevocationQuorum`:** with `W` witnesses, use
`floor(W / 2) + 1` for simple-majority quorum, or `floor((2W) / 3) + 1`
for byzantine-tolerant quorum (1 byzantine witness tolerated for every 3).

---

## 3. Issue revocations with witness quorum

Replace `root.revoke(target, kind, reason)` with `root.revokeWithQuorum`.

```ts
import { createEd25519MeshSigner } from "@aristotle/mesh-runtime";

const witnessSigners = [
  createEd25519MeshSigner({ signerId: "witness-mae-1", privateKeyPem: w1Priv }),
  createEd25519MeshSigner({ signerId: "witness-mae-2", privateKeyPem: w2Priv }),
  createEd25519MeshSigner({ signerId: "witness-mae-3", privateKeyPem: w3Priv })
];

await root.revokeWithQuorum({
  target_id: envelope.envelope_id,
  kind: "envelope",
  reason: "operator-revoked",
  witnesses: witnessSigners,
  requiredQuorum: 2
});
```

In a real deployment, witness signers live on different hosts; the root
gets a co-signature out-of-band (signed message back, multi-party
ceremony, hardware sign-off, etc.). This package only does the
cryptographic verification; the operational signing protocol is yours
to design.

---

## 4. Wire the Warrant signer through a KMS

Replace `createEd25519Signer({ privateKeyPem })` with a KMS-backed
signer so the Warrant signing key never leaves the KMS.

```ts
import { AwsKmsKeyringStub, resolveSigner } from "@aristotle/kms-keyring";

// At service boot, construct the keyring once:
const keyring = new AwsKmsKeyringStub({
  region: "us-east-1",
  keys: { "warrant-signer-prod": "arn:aws:kms:us-east-1:123456789012:key/abcd-..." }
});

// At decision time, resolve a signer per request:
const signer = resolveSigner(keyring, "warrant-signer-prod");
const decision = evaluateExecutionControl({ ward, authorityEnvelope, action, now, ledger, ledgerPath, signer });
```

The `AwsKmsKeyringStub` documents exactly what AWS SDK calls to wire.
The `VaultKeyringStub` documents the equivalent for HashiCorp Vault
Transit. See [@aristotle/kms-keyring/src/index.ts](../shared/kms-keyring/src/index.ts).

The interface (`KmsKeyring`) is stable; swapping providers is a
constructor change, not a substrate change.

---

## 5. Anchor GEL records with an external Timestamp Authority

After every `appendGelRecord`, ask the TSA to witness the new
`record_hash`. The anchor is signed under a key in a SEPARATE
operational domain — if the same operator holds both the GEL signing
key AND the TSA signing key, you collapse back to the
[LIMITATIONS § 3](../LIMITATIONS.md#3-external-timestamp-authority--interface-ships-real-tsa-wiring-is-operator-supplied) trust model.

```ts
import { LocalTimestampAuthority, verifyTimestampAnchor } from "@aristotle/gel-timestamp";

const tsa = new LocalTimestampAuthority({
  ledgerPath: "/var/lib/aristotle/timestamp-anchors.jsonl"
  // signer: a KMS-backed AristotleSigner whose private key is in a
  // separate KMS account / Vault Transit mount from the GEL signer.
});

const record = appendGelRecord({ ... });
const anchor = tsa.anchor(record.record_hash);
// Persist `anchor` alongside `record` (e.g. side-by-side in the audit store).

// Later, at verify time:
const v = verifyTimestampAnchor(record.record_hash, anchor, tsa.publicKeyPem);
if (!v.ok) throw new Error(`backdating suspected: ${v.reason}`);
```

For higher-assurance deployments, swap `LocalTimestampAuthority` for an
RFC 3161 / Sigstore client implementing the same `TimestampAuthority`
interface.

---

## 6. Durable Warrant replay protection

Replace any in-memory `seenNonces` with a `FilesystemNonceStore` so
replay protection survives a process restart.

```ts
import { FilesystemNonceStore } from "@aristotle/nonce-store";

const seenNonces = new FilesystemNonceStore({
  path: "/var/lib/aristotle/nonces.jsonl",
  maxAgeMs: 24 * 60 * 60 * 1000,    // 24 h — match warrantTtlSeconds upper bound
  fsync: true
});

const v = verifyWarrant(warrant, canonicalActionHash, now, {
  trustedKeyIds: [signerKeyId],
  seenNonces
});
if (v.ok) seenNonces.add(warrant.nonce);
```

For multi-process deployments, use a Redis or Postgres backend that
implements the same `NonceStore` interface in a separate package
(not shipped here; one process per FilesystemNonceStore instance).

---

## 7. Pre-flight checklist before declaring production

Run through this checklist before the first real-traffic deployment.

- [ ] Every mesh node has its own Ed25519 keypair; no two nodes share a private key.
- [ ] Every node's `MeshVerifier` carries the explicit trust anchor for every node it talks to. No `KNOWN_DEMO_MESH_SECRETS` string appears in any deployment config.
- [ ] Every node constructor sets `productionMode: true`. Service start fails closed if a demo secret somehow appears.
- [ ] Every node has `maxRequestBodyBytes` set (default 1 MiB is usually fine).
- [ ] Every node has `requireJsonContentType: true` (default).
- [ ] Every edge has `replayCache` set to a sized `MeshReplayCache`.
- [ ] Every edge has `requireRevocationQuorum >= floor(W/2) + 1` where `W` is the witness count.
- [ ] Every edge has `maxWarrantsWhileDisconnected` set to a value justified by your operational SLO. Default 100 is rarely correct for safety-critical paths; lower it.
- [ ] All revocations issued via `revokeWithQuorum`, not `revoke`. The legacy `revoke` is fine for testing but must not appear in production code paths.
- [ ] Warrant signer is KMS-backed (`KmsKeyring`-resolved) — the Warrant private key never lives on disk as a PEM file.
- [ ] Every `appendGelRecord` is followed by a TSA anchor whose signing key is in a separate operational domain.
- [ ] `FilesystemNonceStore` (or a Redis/Postgres equivalent) is the seenNonces backend in every Warrant-verifying service.
- [ ] mTLS or service-mesh-level peer cert pinning on every `/mesh` request via the `httpClient` + `urlFor` hooks. The substrate ships these hooks; YOU bring the TLS context (CA bundle, cert, key, `rejectUnauthorized: true`).
- [ ] A reverse-proxy fronts `/mesh` with rate limiting, source-IP allowlist, request body size cap, and metrics. The substrate's defenses are belt; the proxy is suspenders.
- [ ] OTel tracing wired: a real `@opentelemetry/api` Tracer adapter passed to every `evaluateExecutionControl` call. Spans land in your APM.
- [ ] `RELEASE_CHECKLIST.md` items all green for the version you're deploying.
- [ ] A documented operator runbook for: revocation under emergency, key rotation, recovery from partition, and rollback.
- [ ] An incident response plan that includes "what if the Warrant signing key is compromised" and "what if a witness key is compromised".
- [ ] You have read [LIMITATIONS.md](../LIMITATIONS.md) and have an explicit, written acceptance of each item that does NOT apply to your deployment.

---

## 8. Things that intentionally don't get a default

The substrate refuses to provide a "production default" for these because
the right answer depends on the operator's threat model:

- **mTLS configuration.** The `httpClient` and `urlFor` hooks let you
  inject `undici.Agent({ connect: { ca, cert, key, rejectUnauthorized: true } })`.
  We won't ship a "secure default" that might be wrong for your CA layout.
- **Source-IP allowlists.** Operator's network topology.
- **Rate limiting thresholds.** Operator's traffic profile.
- **GEL retention policy.** Operator's regulatory environment.
- **The disconnected-warrant cap.** Operator's risk tolerance.

If you want a default for any of these, the right place to put it is an
operator-specific service that wraps the substrate, not the substrate
itself.

---

## 9. Where to push back on this document

This document describes the production posture the substrate can
support. It is NOT a substitute for:

- An external security audit. See [LIMITATIONS § 2](../LIMITATIONS.md#2-no-external-security-audit).
- A certification (SOC 2, ISO 27001, FedRAMP, IEC 62443, DO-178C, FDA). See [LIMITATIONS § 7](../LIMITATIONS.md#7-no-certification).
- Hardware validation against your specific equipment. See [LIMITATIONS § 8](../LIMITATIONS.md#8-adapter-wire-level-validation).
- A formal correctness proof. See [ROADMAP_TO_100.md Category 1](../ROADMAP_TO_100.md#category-1--technical-seriousness).

If your bar requires any of those, this runbook gets you to the line
where the bar can credibly be evaluated. It does not cross the line for
you.
