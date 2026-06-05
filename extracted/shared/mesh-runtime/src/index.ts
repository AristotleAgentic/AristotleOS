/**
 * @aristotle/mesh-runtime — multi-process governance mesh.
 *
 * Three node roles communicate over HTTP localhost:
 *
 *   ROOT      — holds the Meta Authority Envelope, signs authority envelopes,
 *               originates revocations.
 *   WITNESS   — replicates the MAE + envelope state, gossips revocations,
 *               counter-signs decisions for quorum.
 *   EDGE      — runs a Disconnected Commit Gate, issues Warrants up to the
 *               current Fluidity Token TTL while disconnected from root,
 *               drains and refuses on TTL expiry.
 *
 * Protocols implemented in this module:
 *
 *   - Authority envelope propagation        root --> witnesses --> edges
 *   - Revocation gossip                     root --> witnesses --> edges
 *   - Fluidity Token issuance               root --> edges (time-bounded)
 *   - Disconnected commit gate              edge issues warrants locally on
 *                                            cached envelope + Fluidity Token
 *   - Partition reconciliation              edge decisions submitted upstream
 *                                            on reconnect; conflicts go to the
 *                                            existing Conflict Inbox shape
 *
 * Partition behavior:
 *   - Each node has a `partitions: Set<string>` of node ids it will refuse
 *     traffic to/from. Test harness mutates this to simulate split-brain.
 *   - On partition, edges keep operating until their Fluidity Token TTL
 *     expires (or until they receive a revocation via a witness that survived
 *     the partition), then fail-closed.
 *
 * The mesh runtime is intentionally minimal: HTTP/JSON, no external broker,
 * runs cleanly under `node --import tsx` for tests. Production wiring would
 * swap the in-process HTTP for NATS / mTLS / whatever — the protocol layer
 * sits above the transport.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHash, randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NodeRole = "root" | "witness" | "edge";

export interface NodeId {
  id: string;
  role: NodeRole;
  host: string;
  port: number;
}

export interface AuthorityEnvelope {
  envelope_id: string;
  mae_id: string;
  ward_id: string;
  subject: string;
  allowed_action_types: string[];
  /** Soft expiry on the envelope itself. */
  expires_at: string;
  /** Monotonic version counter. */
  version: number;
  issued_by: string;
  issued_at: string;
  signature: string;
}

export interface Revocation {
  revocation_id: string;
  /** Either envelope_id or warrant_id depending on `kind`. */
  target_id: string;
  kind: "envelope" | "warrant" | "subject";
  reason: string;
  /** ISO timestamp the root authoritatively revoked at. */
  revoked_at: string;
  issued_by: string;
  /**
   * Optional witness co-signatures. When edges are configured with
   * `requireRevocationQuorum: N`, a revocation is only cached / acted on
   * after N distinct witness signatures from the configured witness set
   * verify. Defends against a single compromised root authority issuing
   * arbitrary revocations.
   *
   * Field is optional and unset by `root.revoke()` (backwards compat);
   * `root.revokeWithQuorum()` populates it.
   */
  signing_quorum?: QuorumSignature[];
  signature: string;
}

export interface FluidityToken {
  token_id: string;
  edge_id: string;
  envelope_id: string;
  /** ISO timestamp at which the edge MUST stop issuing warrants. */
  expires_at: string;
  issued_at: string;
  issued_by: string;
  /** Maximum revocation gossip age the edge will accept while disconnected. */
  max_revocation_age_ms: number;
  signature: string;
}

export interface Warrant {
  warrant_id: string;
  envelope_id: string;
  action_type: string;
  action_hash: string;
  issued_by_edge: string;
  issued_at: string;
  /** Edge's view of the Fluidity Token TTL at issue time. */
  under_fluidity_token: string;
  /** Was root reachable when this warrant was issued? */
  root_reachable_at_issue: boolean;
  signature: string;
}

export interface CommitRequest {
  action_id: string;
  action_type: string;
  envelope_id: string;
  /** Subject of the action — must match the envelope's subject. */
  subject: string;
  params: Record<string, unknown>;
  presented_at: string;
}

export type CommitDecision =
  | { decision: "ALLOW"; warrant: Warrant }
  | { decision: "REFUSE"; reason_codes: string[] }
  | { decision: "EXPIRE"; reason_codes: string[] }
  | { decision: "ESCALATE"; reason_codes: string[] };

// ---------------------------------------------------------------------------
// Light cryptographic helpers
// ---------------------------------------------------------------------------

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function stableStringify(o: unknown): string {
  if (o === null || typeof o !== "object") return JSON.stringify(o);
  if (Array.isArray(o)) return "[" + (o as unknown[]).map((x) => stableStringify(x)).join(",") + "]";
  const obj = o as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

function sign(secret: string, payload: unknown): string {
  return sha256Hex(secret + ":" + stableStringify(payload));
}

function verify(secret: string, payload: unknown, sig: string): boolean {
  return sign(secret, payload) === sig;
}

// ---------------------------------------------------------------------------
// Mesh trust: per-node Ed25519 keypairs (additive over the legacy shared-HMAC
// path).
//
// Until this section landed, every mesh node shared one HMAC secret. That
// works for clarity in tests but it means: one compromised node = entire
// mesh compromise; no per-node accountability; no MAE-style allowlist of
// who is allowed to issue what.
//
// The new model:
//
//   MeshSigner    — wraps "how I sign". Each node has exactly one. The
//                   signerId is included so message receivers can look up
//                   the right verifying key.
//
//   MeshVerifier  — wraps "given a signature claimed by signerId X, does
//                   it verify?". A node's verifier holds the trust anchors
//                   for every signerId it's willing to accept signatures
//                   from. Unknown signerId -> reject.
//
// Backwards compatibility: MeshNodeOptions still accepts `secret`. When
// only secret is provided, both signer and verifier are constructed as
// HMAC wrappers so the existing in-process tests behave exactly as before.
// Production deployments should provide signer + verifier explicitly and
// drop secret entirely.
// ---------------------------------------------------------------------------

import {
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify
} from "node:crypto";

export interface MeshSigner {
  /** Stable id this signer signs under — typically the NodeId. */
  readonly signerId: string;
  /** Sign a payload. Returns an opaque string (hex for HMAC, base64 for Ed25519). */
  sign(payload: unknown): string;
  /** Algorithm tag. "hmac-sha256" or "ed25519". Useful for diagnostics. */
  readonly alg: string;
}

export interface MeshVerifier {
  /**
   * Verify a payload's signature against the trust-anchor for the
   * declared signerId. Unknown signerId, mismatched signature, or
   * malformed signature MUST return false.
   *
   * Implementations must be constant-time-safe vs naive string compare
   * where applicable; HMAC verifier uses hex-string equality which is
   * timing-leak-tolerable for non-secret hash values, but Ed25519 uses
   * the native crypto.verify which is constant-time by construction.
   */
  verify(payload: unknown, signature: string, signerId: string): boolean;
  /** List the signer ids this verifier trusts. Useful for diagnostics. */
  trustedSignerIds(): string[];
}

/**
 * Set of HMAC secrets known to be shipped as defaults / examples in this
 * repo. A MeshNode constructed with any of these will log a one-time
 * WARN to stderr unless the operator explicitly opts out via
 * MeshNodeOptions.suppressDemoSecretWarning. Defends against the silent-
 * deployment-with-demo-secret failure mode.
 *
 * Add new known-demo strings here if they ever appear in docs / examples.
 */
export const KNOWN_DEMO_MESH_SECRETS: ReadonlySet<string> = new Set([
  "demo-mesh-secret",
  "aos-demo-mesh-secret",
  "aristotle-demo-secret",
  "test-secret",
  "live-secret"
]);

/** Track which demo secrets have already warned, to keep stderr clean. */
const _warnedDemoSecrets: Set<string> = new Set();

/**
 * Build a signer + verifier pair from a single shared HMAC secret.
 * This is the legacy / demo path. Every node calling this with the same
 * secret will trust every other node's signatures. Suitable for tests
 * and local development; NOT suitable for production.
 */
export function createHmacMeshSigner(opts: { signerId: string; secret: string }): MeshSigner {
  return {
    signerId: opts.signerId,
    alg: "hmac-sha256",
    sign(payload: unknown): string { return sign(opts.secret, payload); }
  };
}

export function createHmacMeshVerifier(opts: { secret: string }): MeshVerifier {
  return {
    verify(payload: unknown, signature: string, _signerId: string): boolean {
      // Shared-secret model: every signerId verifies against the same key.
      return verify(opts.secret, payload, signature);
    },
    trustedSignerIds(): string[] { return ["*"]; }
  };
}

/**
 * Build an Ed25519 signer keyed to one NodeId. The privateKeyPem must be
 * a PKCS#8 PEM (the format `crypto.generateKeyPairSync("ed25519")` emits
 * by default).
 */
export function createEd25519MeshSigner(opts: { signerId: string; privateKeyPem: string }): MeshSigner {
  const key = createPrivateKey({ key: opts.privateKeyPem, format: "pem" });
  return {
    signerId: opts.signerId,
    alg: "ed25519",
    sign(payload: unknown): string {
      const sig = cryptoSign(null, Buffer.from(stableStringify(payload)), key);
      return "ed25519:" + sig.toString("base64");
    }
  };
}

/**
 * Build an Ed25519 verifier with an explicit allowlist of trusted
 * (signerId -> publicKeyPem) bindings. Any signerId not in the
 * allowlist is REJECTED — this is the "MAE-style signing-key allowlist"
 * mentioned in ROADMAP_TO_100.md Category 1.
 *
 * Adding / removing trust anchors at runtime is supported via
 * addTrustAnchor() / removeTrustAnchor(). That mirrors the operator
 * workflow for rotating per-node keys.
 */
export interface Ed25519MeshVerifier extends MeshVerifier {
  addTrustAnchor(signerId: string, publicKeyPem: string): void;
  removeTrustAnchor(signerId: string): void;
}

// ---------------------------------------------------------------------------
// Mesh anti-replay cache
//
// Defends against capture-and-replay of a legitimate mesh message. A
// reasonable threat: an attacker who can observe network traffic between
// two nodes captures a signed PROPAGATE_ENVELOPE or GOSSIP_REVOCATION
// and re-emits it later (or floods it) to try to confuse caches /
// timing-dependent state. Signature alone would let the replay through;
// the cache rejects it as a duplicate.
//
// The cache hashes (signer_id || sha256(body_bytes)) and rejects an
// inbound request whose hash is already in the window. TTL bounds memory
// and lets stale entries fall out.
//
// Opt-in via MeshNodeOptions.replayCache. Default mesh stays exactly as
// it was — no behavior change unless an operator wires a cache in.
// ---------------------------------------------------------------------------

export interface MeshReplayCache {
  /**
   * Record an inbound message hash. Returns `true` if it was already
   * seen within the window (caller should reject as replay), `false` if
   * newly recorded.
   */
  seen(messageHash: string): boolean;
  /** Number of entries currently held (post-eviction). */
  size(): number;
}

export interface MeshReplayCacheOptions {
  /** TTL for each entry in ms. Default 60_000. */
  ttlMs?: number;
  /** Max entries; oldest get evicted past this. Default 10_000. */
  maxSize?: number;
  /** Clock for tests. Defaults to Date.now. */
  now?: () => number;
}

export function createMeshReplayCache(opts: MeshReplayCacheOptions = {}): MeshReplayCache {
  const ttlMs = opts.ttlMs ?? 60_000;
  const maxSize = opts.maxSize ?? 10_000;
  const now = opts.now ?? Date.now;
  const entries: Map<string, number> = new Map(); // hash -> addedAt
  function evictExpired(cutoff: number): void {
    // Map preserves insertion order; sweep oldest first.
    for (const [hash, at] of entries) {
      if (at <= cutoff) entries.delete(hash); else break;
    }
  }
  return {
    seen(messageHash: string): boolean {
      const t = now();
      evictExpired(t - ttlMs);
      const existing = entries.get(messageHash);
      if (existing !== undefined && existing > t - ttlMs) return true;
      entries.set(messageHash, t);
      // Cap memory.
      if (entries.size > maxSize) {
        const drop = entries.size - maxSize;
        const it = entries.keys();
        for (let i = 0; i < drop; i++) {
          const k = it.next().value as string | undefined;
          if (k === undefined) break;
          entries.delete(k);
        }
      }
      return false;
    },
    size(): number {
      evictExpired(now() - ttlMs);
      return entries.size;
    }
  };
}

export function createEd25519MeshVerifier(opts: {
  trustedKeys: Record<string, string> | Map<string, string>;
}): Ed25519MeshVerifier {
  const keys = new Map<string, ReturnType<typeof createPublicKey>>();
  const seed = opts.trustedKeys instanceof Map
    ? opts.trustedKeys
    : new Map(Object.entries(opts.trustedKeys));
  for (const [id, pem] of seed) keys.set(id, createPublicKey({ key: pem, format: "pem" }));
  return {
    addTrustAnchor(signerId: string, publicKeyPem: string): void {
      keys.set(signerId, createPublicKey({ key: publicKeyPem, format: "pem" }));
    },
    removeTrustAnchor(signerId: string): void {
      keys.delete(signerId);
    },
    verify(payload: unknown, signature: string, signerId: string): boolean {
      if (!signature.startsWith("ed25519:")) return false;
      const key = keys.get(signerId);
      if (!key) return false; // Unknown signerId: reject.
      try {
        const sig = Buffer.from(signature.slice("ed25519:".length), "base64");
        return cryptoVerify(null, Buffer.from(stableStringify(payload)), key, sig);
      } catch {
        return false;
      }
    },
    trustedSignerIds(): string[] { return [...keys.keys()]; }
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}

// ---------------------------------------------------------------------------
// Node base — shared HTTP plumbing + partition simulation
// ---------------------------------------------------------------------------

export interface MeshNodeOptions {
  id: string;
  host: string;
  port: number;
  /**
   * Shared HMAC secret across the mesh — legacy / demo path.
   *
   * If `secret` is provided and `signer`/`verifier` are not, both will
   * be constructed as HMAC wrappers automatically (existing behavior).
   *
   * If `signer` and `verifier` ARE provided (the per-node Ed25519 path),
   * `secret` may be omitted; if it is also provided, it is ignored.
   *
   * Production deployments should leave `secret` unset and provide
   * `signer` + `verifier` explicitly (e.g. createEd25519MeshSigner +
   * createEd25519MeshVerifier with a MAE-style trust-anchor allowlist).
   */
  secret?: string;
  /** Per-node signer. Defaults to HMAC built from `secret`. */
  signer?: MeshSigner;
  /** Per-node verifier with trust anchors. Defaults to HMAC built from `secret`. */
  verifier?: MeshVerifier;
  /**
   * Production-mode lockdown. When true:
   *   - constructing with `secret` (HMAC) throws — production must use
   *     explicit signer + verifier.
   *   - signer alg must NOT be "hmac-sha256".
   *   - demo-secret WARN is irrelevant because HMAC is rejected outright.
   * Defaults to false so existing demos / tests keep working.
   */
  productionMode?: boolean;
  /**
   * Suppress the one-time stderr WARN that fires when the constructed
   * signer is HMAC using a known demo secret. Useful in tests that
   * intentionally use a demo secret and want clean stderr.
   */
  suppressDemoSecretWarning?: boolean;
  /**
   * Optional anti-replay cache. Every inbound mesh request that carries
   * a signer-tagged signature is hashed; duplicate hashes within the
   * cache's TTL are rejected with HTTP 409. Defends against
   * capture-and-replay of legitimate mesh messages on the wire. Defaults
   * to no anti-replay (backwards compat); opt in with createMeshReplayCache(...).
   */
  replayCache?: MeshReplayCache;
  /**
   * Maximum request body size in bytes accepted by the HTTP ingress.
   * Defaults to 1 MiB. Oversized requests are rejected with HTTP 413
   * (Payload Too Large) before any signature work. Defends against DoS
   * via giant payloads.
   */
  maxRequestBodyBytes?: number;
  /**
   * If true (default), the HTTP ingress rejects any request whose
   * content-type is not `application/json` (or absent on simple POSTs)
   * with HTTP 415. Set to false ONLY when proxying through a layer that
   * strips content-type.
   */
  requireJsonContentType?: boolean;
  peers?: NodeId[];
  /**
   * Pluggable HTTP client used for inter-node calls. Defaults to the global
   * `fetch`. Production deployments inject a TLS-enabled fetch (mTLS, peer
   * cert pinning, custom CA bundle) — e.g. a wrapper that uses
   * undici.Agent({ connect: { ca, cert, key, rejectUnauthorized: true } }).
   * The mesh uses this for cross-process traffic only; in-process tests use
   * the bindRegistry fast-path and never hit the network.
   */
  httpClient?: typeof fetch;
  /**
   * Pluggable URL builder. Defaults to `http://${target.host}:${target.port}/`.
   * Production deployments override to inject `https://` and/or a service-mesh
   * path prefix (e.g. `https://${target.id}.mesh.svc.cluster.local/`).
   */
  urlFor?: (target: NodeId) => string;
}

export abstract class MeshNode {
  protected readonly id: string;
  protected readonly host: string;
  protected readonly port: number;
  /**
   * Retained for backwards compatibility (some test paths still read it
   * via the legacy `secret` constructor option). New code should always
   * go through this.signer / this.verifier.
   */
  protected readonly secret: string;
  protected readonly signer: MeshSigner;
  protected readonly verifier: MeshVerifier;
  protected readonly replayCache: MeshReplayCache | null;
  protected readonly maxRequestBodyBytes: number;
  protected readonly requireJsonContentType: boolean;
  protected peers: NodeId[];
  protected server: Server | null = null;
  protected readonly httpClient: typeof fetch;
  protected readonly urlFor: (target: NodeId) => string;
  /** Node ids this node will refuse traffic to/from (partition simulation). */
  public readonly partitions: Set<string> = new Set();
  /** Callable for testing in-process — bypasses HTTP. */
  public direct = (msg: MeshMessage): Promise<unknown> => this.handle(msg);

  abstract readonly role: NodeRole;

  constructor(opts: MeshNodeOptions) {
    this.id = opts.id;
    this.host = opts.host;
    this.port = opts.port;
    // Resolve signer/verifier. Three valid configurations:
    //   1. opts.secret only             -> build HMAC pair (legacy default)
    //   2. opts.signer + opts.verifier  -> use both (new Ed25519 path)
    //   3. opts.secret AND signer/verifier -> use signer/verifier; secret
    //      is retained only for legacy this.secret reads
    if (opts.signer && opts.verifier) {
      if (opts.productionMode && opts.signer.alg === "hmac-sha256") {
        throw new Error(
          "MeshNode: productionMode=true forbids the HMAC signer. Use createEd25519MeshSigner / createEd25519MeshVerifier."
        );
      }
      this.signer = opts.signer;
      this.verifier = opts.verifier;
      this.secret = opts.secret ?? "";
    } else if (opts.signer || opts.verifier) {
      throw new Error("MeshNode: signer and verifier must be provided together");
    } else if (opts.secret !== undefined) {
      if (opts.productionMode) {
        throw new Error(
          "MeshNode: productionMode=true forbids the shared-HMAC `secret` constructor path. Provide explicit { signer, verifier } using createEd25519MeshSigner / createEd25519MeshVerifier."
        );
      }
      // Demo / legacy path. Warn on known demo secrets unless suppressed.
      if (
        !opts.suppressDemoSecretWarning
        && KNOWN_DEMO_MESH_SECRETS.has(opts.secret)
        && !_warnedDemoSecrets.has(opts.secret)
      ) {
        _warnedDemoSecrets.add(opts.secret);
        console.warn(
          `[aristotle/mesh-runtime] WARNING: MeshNode "${opts.id}" constructed with a known demo HMAC secret. ` +
          `This is not safe for production. Use createEd25519MeshSigner + createEd25519MeshVerifier and pass { signer, verifier } to the MeshNode constructor. ` +
          `See ROADMAP_TO_100.md Category 1 and LIMITATIONS.md.`
        );
      }
      this.signer = createHmacMeshSigner({ signerId: opts.id, secret: opts.secret });
      this.verifier = createHmacMeshVerifier({ secret: opts.secret });
      this.secret = opts.secret;
    } else {
      throw new Error("MeshNode: must provide either { secret } or { signer, verifier }");
    }
    this.replayCache = opts.replayCache ?? null;
    this.maxRequestBodyBytes = opts.maxRequestBodyBytes ?? 1024 * 1024; // 1 MiB
    this.requireJsonContentType = opts.requireJsonContentType ?? true;
    this.peers = opts.peers ?? [];
    this.httpClient = opts.httpClient ?? fetch;
    this.urlFor = opts.urlFor ?? ((t: NodeId) => `http://${t.host}:${t.port}/`);
  }

  setPeers(peers: NodeId[]): void {
    this.peers = peers;
  }

  partitionFrom(otherId: string): void { this.partitions.add(otherId); }
  healPartition(otherId: string): void { this.partitions.delete(otherId); }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req: IncomingMessage, res: ServerResponse) => this.onRequest(req, res));
      this.server.listen(this.port, this.host, () => resolve());
      this.server.on("error", reject);
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
  }

  protected async onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // (1) Content-type check — reject anything not application/json.
    if (this.requireJsonContentType) {
      const ct = (req.headers["content-type"] ?? "").toString().toLowerCase();
      // Allow `application/json` with optional charset; allow empty CT only on GET.
      const isJson = ct.startsWith("application/json");
      if (req.method === "POST" && !isJson) {
        res.statusCode = 415;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: false, reason: "unsupported-media-type" }));
        return;
      }
    }
    // (2) Stream body with hard size cap. As soon as we'd exceed the
    // configured maximum, return 413 and stop reading. Defends against
    // single-request DoS via huge payloads.
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    try {
      for await (const c of req) {
        const buf = c as Buffer;
        totalBytes += buf.length;
        if (totalBytes > this.maxRequestBodyBytes) {
          res.statusCode = 413;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({
            ok: false,
            reason: "payload-too-large",
            limit_bytes: this.maxRequestBodyBytes
          }));
          // Best-effort: drain remaining bytes silently to avoid client
          // hangs on partial reads.
          try { req.destroy(); } catch { /* ignore */ }
          return;
        }
        chunks.push(buf);
      }
    } catch {
      res.statusCode = 400;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: false, reason: "body-read-error" }));
      return;
    }
    const body = chunks.length ? Buffer.concat(chunks).toString("utf8") : "";
    // (3) JSON parse with structured error.
    let parsed: MeshMessage;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.statusCode = 400;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: false, reason: "bad-json" }));
      return;
    }
    // (4) Partition simulation — unchanged from before.
    if (parsed.from && this.partitions.has(parsed.from)) {
      res.statusCode = 504;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: false, reason: "partitioned" }));
      return;
    }
    // (5) Anti-replay — opt-in. Hash (signer || body); reject if seen.
    if (this.replayCache) {
      const senderId = parsed.from ?? "";
      const replayHash = sha256Hex(senderId + ":" + body);
      if (this.replayCache.seen(replayHash)) {
        res.statusCode = 409;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: false, reason: "replay-detected" }));
        return;
      }
    }
    // (6) Dispatch.
    try {
      const out = await this.handle(parsed);
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(out));
    } catch (err) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: false, reason: "handler-error", detail: (err as Error).message }));
    }
  }

  protected abstract handle(msg: MeshMessage): Promise<unknown>;

  /** Send a message to another node by id; honors partition set. */
  protected async sendTo(target: NodeId, msg: MeshMessage): Promise<unknown> {
    if (this.partitions.has(target.id)) {
      throw new Error(`partitioned-from:${target.id}`);
    }
    msg.from = this.id;
    // In-process fast-path: when running in the same process, peers may expose
    // a `direct` callable on a shared registry. Tests do this for determinism.
    const registry = (globalThis as { __aos_mesh_registry?: Map<string, MeshNode> }).__aos_mesh_registry;
    if (registry?.has(target.id)) {
      const node = registry.get(target.id)!;
      if (node.partitions.has(this.id)) throw new Error(`partitioned-from:${this.id}`);
      return node.handle(msg);
    }
    const url = this.urlFor(target);
    const res = await this.httpClient(url, { method: "POST", body: JSON.stringify(msg), headers: { "content-type": "application/json" } });
    if (!res.ok) throw new Error(`${target.id} returned ${res.status}`);
    return res.json();
  }

  getId(): string { return this.id; }
  asNodeId(): NodeId { return { id: this.id, role: this.role, host: this.host, port: this.port }; }
}

// ---------------------------------------------------------------------------
// Mesh message envelope
// ---------------------------------------------------------------------------

export type MeshMessage =
  | { kind: "PROPAGATE_ENVELOPE"; from?: string; envelope: AuthorityEnvelope }
  | { kind: "GOSSIP_REVOCATION"; from?: string; revocation: Revocation }
  | { kind: "ISSUE_FLUIDITY_TOKEN"; from?: string; token: FluidityToken }
  | { kind: "RECONCILE_DECISION"; from?: string; decision: SubmittedEdgeDecision }
  | { kind: "QUERY_LATEST_ENVELOPE"; from?: string; envelope_id: string }
  | { kind: "QUERY_REVOCATIONS"; from?: string; since_ms: number }
  | { kind: "PING"; from?: string };

export interface SubmittedEdgeDecision {
  warrant: Warrant;
  request: CommitRequest;
  decision: CommitDecision;
  observed_revocations_at_issue: string[]; // ids
}

// ---------------------------------------------------------------------------
// Root authority node
// ---------------------------------------------------------------------------

export class RootNode extends MeshNode {
  readonly role: NodeRole = "root";
  private envelopes: Map<string, AuthorityEnvelope> = new Map();
  private revocations: Map<string, Revocation> = new Map();
  private issuedFluidityTokens: Map<string, FluidityToken> = new Map();
  private submittedEdgeDecisions: SubmittedEdgeDecision[] = [];

  issueEnvelope(args: {
    envelope_id: string; mae_id: string; ward_id: string; subject: string;
    allowed_action_types: string[]; expires_at: string; version: number;
  }): AuthorityEnvelope {
    const partial = {
      ...args, issued_by: this.id, issued_at: nowIso(), signature: ""
    };
    partial.signature = this.signer.sign({ ...partial, signature: "" });
    this.envelopes.set(partial.envelope_id, partial);
    // Async-fire propagation; ignore errors (partitions will recover later).
    void this.propagateEnvelope(partial);
    return partial;
  }

  async revoke(target_id: string, kind: Revocation["kind"], reason: string): Promise<Revocation> {
    const partial: Revocation = {
      revocation_id: newId("rev"),
      target_id, kind, reason,
      revoked_at: nowIso(), issued_by: this.id, signature: ""
    };
    partial.signature = this.signer.sign({ ...partial, signature: "" });
    this.revocations.set(partial.revocation_id, partial);
    await this.gossipRevocation(partial);
    return partial;
  }

  /**
   * Issue a revocation backed by N witness co-signatures.
   *
   * Defends against a single compromised root authority issuing
   * arbitrary revocations. With requireRevocationQuorum: N set on
   * downstream edges, a revocation under quorum requires the attacker
   * to compromise the root AND collude with N distinct witnesses.
   *
   * The pre-quorum revocation is signed by root (same as `revoke()`).
   * Each witness signs `(quorum:revocation, revocation_id, target_id,
   * root_signature)` so the witness's signature binds to the exact
   * revocation it co-signed — substituting a different revocation under
   * the same revocation_id invalidates the witness sigs.
   *
   * Throws if fewer than `requiredQuorum` valid witness signatures can
   * be collected.
   */
  async revokeWithQuorum(args: {
    target_id: string;
    kind: Revocation["kind"];
    reason: string;
    /** Witness MeshSigners that will co-sign. Pass at least requiredQuorum of them. */
    witnesses: MeshSigner[];
    /** How many distinct witness co-signatures are required. */
    requiredQuorum: number;
  }): Promise<Revocation> {
    if (args.requiredQuorum < 1) {
      throw new Error("revokeWithQuorum: requiredQuorum must be >= 1");
    }
    if (args.witnesses.length < args.requiredQuorum) {
      throw new Error(
        `revokeWithQuorum: only ${args.witnesses.length} witnesses provided, need ${args.requiredQuorum}`
      );
    }
    // Build the base revocation signed by root.
    const partial: Revocation = {
      revocation_id: newId("rev"),
      target_id: args.target_id,
      kind: args.kind,
      reason: args.reason,
      revoked_at: nowIso(),
      issued_by: this.id,
      signature: ""
    };
    partial.signature = this.signer.sign({ ...partial, signature: "" });
    // Collect witness co-signatures, deduping by witness_id.
    const collectedBy: Map<string, QuorumSignature> = new Map();
    for (const witness of args.witnesses) {
      if (collectedBy.has(witness.signerId)) continue;
      collectedBy.set(witness.signerId, witnessCoSignRevocation(witness, partial));
      if (collectedBy.size >= args.requiredQuorum) break;
    }
    if (collectedBy.size < args.requiredQuorum) {
      throw new Error(
        `revokeWithQuorum: collected ${collectedBy.size} distinct witness signatures, need ${args.requiredQuorum}`
      );
    }
    partial.signing_quorum = [...collectedBy.values()];
    this.revocations.set(partial.revocation_id, partial);
    await this.gossipRevocation(partial);
    return partial;
  }

  issueFluidityToken(args: {
    edge_id: string; envelope_id: string; ttl_ms: number; max_revocation_age_ms?: number;
  }): FluidityToken {
    const expires_at = new Date(Date.now() + args.ttl_ms).toISOString();
    const partial: FluidityToken = {
      token_id: newId("flt"),
      edge_id: args.edge_id,
      envelope_id: args.envelope_id,
      expires_at,
      issued_at: nowIso(),
      issued_by: this.id,
      max_revocation_age_ms: args.max_revocation_age_ms ?? 60_000,
      signature: ""
    };
    partial.signature = this.signer.sign({ ...partial, signature: "" });
    this.issuedFluidityTokens.set(partial.token_id, partial);
    return partial;
  }

  async propagateEnvelope(env: AuthorityEnvelope): Promise<void> {
    for (const peer of this.peers) {
      if (peer.role !== "witness" && peer.role !== "edge") continue;
      try { await this.sendTo(peer, { kind: "PROPAGATE_ENVELOPE", envelope: env }); }
      catch { /* tolerate partition */ }
    }
  }

  async gossipRevocation(rev: Revocation): Promise<void> {
    for (const peer of this.peers) {
      if (peer.role === "root") continue;
      try { await this.sendTo(peer, { kind: "GOSSIP_REVOCATION", revocation: rev }); }
      catch { /* tolerate partition */ }
    }
  }

  protected async handle(msg: MeshMessage): Promise<unknown> {
    switch (msg.kind) {
      case "PING": return { id: this.id, role: this.role, ok: true };
      case "QUERY_LATEST_ENVELOPE": {
        const env = this.envelopes.get(msg.envelope_id);
        return { envelope: env ?? null };
      }
      case "QUERY_REVOCATIONS": {
        const since = msg.since_ms;
        const out = [...this.revocations.values()].filter(
          (r) => Date.parse(r.revoked_at) >= since
        );
        return { revocations: out };
      }
      case "RECONCILE_DECISION": {
        // Edge has come back online with a decision it made while
        // disconnected. Validate it against current root state and either
        // accept or flag a conflict.
        const submitted = msg.decision;
        const env = this.envelopes.get(submitted.warrant.envelope_id);
        if (!env) return { ok: false, reason: "unknown-envelope" };
        // Was the envelope revoked before the warrant was issued?
        const earlierRevocation = [...this.revocations.values()].find(
          (r) =>
            r.target_id === submitted.warrant.envelope_id &&
            r.kind === "envelope" &&
            Date.parse(r.revoked_at) <= Date.parse(submitted.warrant.issued_at)
        );
        const conflict = earlierRevocation
          ? { conflict_kind: "warrant_issued_after_revocation", revocation_id: earlierRevocation.revocation_id }
          : null;
        this.submittedEdgeDecisions.push(submitted);
        return { ok: !conflict, conflict };
      }
      default:
        return { ok: false, reason: "unknown-kind" };
    }
  }

  getSubmittedEdgeDecisions(): SubmittedEdgeDecision[] {
    return [...this.submittedEdgeDecisions];
  }
}

// ---------------------------------------------------------------------------
// Witness node
// ---------------------------------------------------------------------------

export class WitnessNode extends MeshNode {
  readonly role: NodeRole = "witness";
  private cachedEnvelopes: Map<string, AuthorityEnvelope> = new Map();
  private cachedRevocations: Map<string, Revocation> = new Map();

  protected async handle(msg: MeshMessage): Promise<unknown> {
    switch (msg.kind) {
      case "PING": return { id: this.id, role: this.role, ok: true };
      case "PROPAGATE_ENVELOPE": {
        const env = msg.envelope;
        if (!this.verifier.verify({ ...env, signature: "" }, env.signature, env.issued_by)) {
          return { ok: false, reason: "bad-signature" };
        }
        // Accept only newer or equal version.
        const existing = this.cachedEnvelopes.get(env.envelope_id);
        if (!existing || env.version >= existing.version) {
          this.cachedEnvelopes.set(env.envelope_id, env);
        }
        // Forward to edge peers (gossip).
        for (const peer of this.peers) {
          if (peer.role === "edge") {
            try { await this.sendTo(peer, { kind: "PROPAGATE_ENVELOPE", envelope: env }); } catch {}
          }
        }
        return { ok: true };
      }
      case "GOSSIP_REVOCATION": {
        const rev = msg.revocation;
        // Strip both `signature` (so it doesn't appear in its own preimage)
        // and `signing_quorum` (which witnesses add AFTER root signs).
        // Using destructuring instead of `{ ...rev, signing_quorum: undefined }`
        // because the latter leaves an explicit-undefined key that
        // stableStringify mangles into a different preimage than what
        // root actually signed over.
        const { signing_quorum: _quorum, signature: _sig, ...rootSigMaterial } = rev;
        const rootSigPayload = { ...rootSigMaterial, signature: "" };
        if (!this.verifier.verify(rootSigPayload, rev.signature, rev.issued_by)) {
          return { ok: false, reason: "bad-signature" };
        }
        this.cachedRevocations.set(rev.revocation_id, rev);
        // Forward to edge peers. Quorum enforcement happens at edges,
        // not witnesses (witnesses pass-through the revocation including
        // its signing_quorum so edges can verify locally).
        for (const peer of this.peers) {
          if (peer.role === "edge") {
            try { await this.sendTo(peer, { kind: "GOSSIP_REVOCATION", revocation: rev }); } catch {}
          }
        }
        return { ok: true };
      }
      case "QUERY_LATEST_ENVELOPE": {
        return { envelope: this.cachedEnvelopes.get(msg.envelope_id) ?? null };
      }
      case "QUERY_REVOCATIONS": {
        const out = [...this.cachedRevocations.values()].filter(
          (r) => Date.parse(r.revoked_at) >= msg.since_ms
        );
        return { revocations: out };
      }
      default:
        return { ok: false, reason: "unknown-kind" };
    }
  }

  cachedEnvelopeCount(): number { return this.cachedEnvelopes.size; }
  cachedRevocationCount(): number { return this.cachedRevocations.size; }
}

// ---------------------------------------------------------------------------
// Edge gate node
// ---------------------------------------------------------------------------

export interface EdgeOptions extends MeshNodeOptions {
  /** Cap on warrants the edge will issue before requiring root reachability. */
  maxWarrantsWhileDisconnected?: number;
  /**
   * Minimum number of distinct, valid witness co-signatures required
   * before this edge will cache a Revocation. Defaults to 0 (no quorum
   * requirement — backwards compat). When > 0, edges refuse revocations
   * that don't carry enough valid witness sigs from peers the verifier
   * trusts.
   *
   * Production deployments using `productionMode: true` should set this
   * to at least 1 (typically ceil(witnesses/2) + 1 for byzantine
   * tolerance).
   *
   * Revocations failing the quorum check are dropped silently from
   * gossip and counted as `rejected` from pullRevocations(). The reason
   * is surfaced in the HTTP response body when gossip is the path.
   */
  requireRevocationQuorum?: number;
}

export class EdgeNode extends MeshNode {
  readonly role: NodeRole = "edge";
  private cachedEnvelopes: Map<string, AuthorityEnvelope> = new Map();
  private cachedRevocations: Map<string, Revocation> = new Map();
  private fluidityTokens: Map<string, FluidityToken> = new Map();
  private localDecisions: SubmittedEdgeDecision[] = [];
  private lastRootContactMs: number = Date.now();
  private warrantsSinceContact: number = 0;
  private readonly maxWarrantsDisconnected: number;
  // Tracks whether the most recent pingRoot succeeded. Used to detect the
  // disconnected -> reconnected edge and auto-pull any revocations the
  // root issued during the partition.
  private lastRootReachable: boolean = true;
  // Counter for how many auto-pulls have fired since boot. Useful as a
  // testable signal that the post-heal pull path activated.
  private autoPullCount: number = 0;
  /** Minimum distinct valid witness sigs required on a Revocation. 0 = no quorum. */
  private readonly requireRevocationQuorum: number;
  /** Count of revocations rejected for failing the quorum check. */
  private quorumRejectedCount: number = 0;

  constructor(opts: EdgeOptions) {
    super(opts);
    this.maxWarrantsDisconnected = opts.maxWarrantsWhileDisconnected ?? 100;
    this.requireRevocationQuorum = opts.requireRevocationQuorum ?? 0;
  }

  receiveFluidityToken(token: FluidityToken): void {
    if (token.edge_id !== this.id) return;
    if (!this.verifier.verify({ ...token, signature: "" }, token.signature, token.issued_by)) return;
    this.fluidityTokens.set(token.token_id, token);
  }

  /** Disconnected Commit Gate. */
  async evaluate(req: CommitRequest): Promise<CommitDecision> {
    const env = this.cachedEnvelopes.get(req.envelope_id);
    if (!env) {
      return { decision: "REFUSE", reason_codes: ["UNKNOWN_ENVELOPE"] };
    }
    // Envelope expiry.
    if (Date.parse(env.expires_at) <= Date.now()) {
      return { decision: "EXPIRE", reason_codes: ["ENVELOPE_EXPIRED"] };
    }
    // Subject check.
    if (env.subject !== req.subject) {
      return { decision: "REFUSE", reason_codes: ["SUBJECT_MISMATCH"] };
    }
    // Action class.
    if (!env.allowed_action_types.includes(req.action_type)) {
      return { decision: "REFUSE", reason_codes: ["ACTION_OUTSIDE_ENVELOPE"] };
    }
    // Revocations the edge already knows about.
    const revoked = [...this.cachedRevocations.values()].find(
      (r) => r.kind === "envelope" && r.target_id === req.envelope_id
    );
    if (revoked) {
      return { decision: "REFUSE", reason_codes: ["ENVELOPE_REVOKED"] };
    }
    // Fluidity Token: must have at least one unexpired token for this
    // envelope.
    const validTokens = [...this.fluidityTokens.values()].filter(
      (t) => t.envelope_id === req.envelope_id && Date.parse(t.expires_at) > Date.now()
    );
    if (!validTokens.length) {
      return { decision: "EXPIRE", reason_codes: ["FLUIDITY_TOKEN_EXPIRED"] };
    }
    const token = validTokens[0];
    // Disconnected-issue cap.
    const rootReachable = await this.pingRoot();
    if (!rootReachable && this.warrantsSinceContact >= this.maxWarrantsDisconnected) {
      return { decision: "REFUSE", reason_codes: ["DISCONNECTED_QUOTA_EXCEEDED"] };
    }
    if (rootReachable) this.warrantsSinceContact = 0;

    // Issue warrant.
    const action_hash = "sha256:" + sha256Hex(stableStringify({
      action_type: req.action_type, params: req.params, presented_at: req.presented_at
    }));
    const partial: Warrant = {
      warrant_id: newId("wrt"),
      envelope_id: env.envelope_id,
      action_type: req.action_type,
      action_hash,
      issued_by_edge: this.id,
      issued_at: nowIso(),
      under_fluidity_token: token.token_id,
      root_reachable_at_issue: rootReachable,
      signature: ""
    };
    partial.signature = this.signer.sign({ ...partial, signature: "" });
    this.warrantsSinceContact++;
    const decision: CommitDecision = { decision: "ALLOW", warrant: partial };
    this.localDecisions.push({
      warrant: partial,
      request: req,
      decision,
      observed_revocations_at_issue: [...this.cachedRevocations.keys()]
    });
    return decision;
  }

  private async pingRoot(): Promise<boolean> {
    const root = this.peers.find((p) => p.role === "root");
    if (!root) return false;
    try {
      await this.sendTo(root, { kind: "PING" });
      const reconnected = !this.lastRootReachable;
      const prevContactMs = this.lastRootContactMs;
      this.lastRootReachable = true;
      this.lastRootContactMs = Date.now();
      if (reconnected) {
        // Disconnected -> reconnected transition. Auto-pull any revocations
        // gossiped during the gap. Fire-and-forget; partition recurrence
        // is tolerated (we'll retry on the next reconnect transition).
        // Pull a small safety margin (1s) before the last known contact to
        // cover gossip-in-flight that the witness may not have caught.
        const since_ms = Math.max(0, prevContactMs - 1000);
        void this.pullRevocations(since_ms).catch(() => { /* tolerate */ });
      }
      return true;
    } catch {
      this.lastRootReachable = false;
      return false;
    }
  }

  /**
   * Pull revocations from the root authority since the given timestamp
   * (ms epoch). Verified revocations are cached; signature failures are
   * dropped silently and counted in the rejected total.
   *
   * Called automatically after pingRoot() detects a disconnected ->
   * reconnected transition. Also exposed publicly so operators (and
   * tests) can force a pull at any time, e.g. after a manual partition
   * heal or to bootstrap a cold edge.
   *
   * Closes LIMITATIONS.md § 5 ("Edge has no automatic pull of missed
   * revocations") with the fix path documented in ROADMAP_TO_100.md
   * Category 1: edge calls QUERY_REVOCATIONS after pingRoot() succeeds.
   */
  async pullRevocations(sinceMs?: number): Promise<{ pulled: number; rejected: number }> {
    const root = this.peers.find((p) => p.role === "root");
    if (!root) return { pulled: 0, rejected: 0 };
    const since_ms = sinceMs ?? this.lastRootContactMs;
    let pulled = 0;
    let rejected = 0;
    try {
      const resp = (await this.sendTo(root, { kind: "QUERY_REVOCATIONS", since_ms })) as { revocations?: Revocation[] };
      for (const rev of resp.revocations ?? []) {
        // Strip both `signature` (so it doesn't appear in its own preimage)
        // and `signing_quorum` (which witnesses add AFTER root signs).
        // Using destructuring instead of `{ ...rev, signing_quorum: undefined }`
        // because the latter leaves an explicit-undefined key that
        // stableStringify mangles into a different preimage than what
        // root actually signed over.
        const { signing_quorum: _quorum, signature: _sig, ...rootSigMaterial } = rev;
        const rootSigPayload = { ...rootSigMaterial, signature: "" };
        if (!this.verifier.verify(rootSigPayload, rev.signature, rev.issued_by)) {
          rejected++;
          continue;
        }
        if (this.requireRevocationQuorum > 0) {
          const validCount = countValidRevocationQuorum(this.verifier, rev);
          if (validCount < this.requireRevocationQuorum) {
            rejected++;
            this.quorumRejectedCount++;
            continue;
          }
        }
        if (!this.cachedRevocations.has(rev.revocation_id)) {
          this.cachedRevocations.set(rev.revocation_id, rev);
          pulled++;
        }
      }
      this.autoPullCount++;
    } catch {
      // Partition recurred mid-pull. The next reconnect will retry.
    }
    return { pulled, rejected };
  }

  /** Test/operator hook: number of times pullRevocations has completed. */
  getAutoPullCount(): number { return this.autoPullCount; }

  /** Test/operator hook: revocations dropped for failing the quorum check. */
  getQuorumRejectedCount(): number { return this.quorumRejectedCount; }

  /** Reconcile local decisions with root. Returns conflict list. */
  async reconcile(): Promise<Array<{ warrant_id: string; conflict: unknown }>> {
    const root = this.peers.find((p) => p.role === "root");
    if (!root) return [];
    const conflicts: Array<{ warrant_id: string; conflict: unknown }> = [];
    for (const submitted of this.localDecisions) {
      try {
        const resp = (await this.sendTo(root, { kind: "RECONCILE_DECISION", decision: submitted })) as { ok: boolean; conflict?: unknown };
        if (!resp.ok && resp.conflict) {
          conflicts.push({ warrant_id: submitted.warrant.warrant_id, conflict: resp.conflict });
        }
      } catch { /* partition: defer */ }
    }
    this.localDecisions = [];
    return conflicts;
  }

  protected async handle(msg: MeshMessage): Promise<unknown> {
    switch (msg.kind) {
      case "PING": return { id: this.id, role: this.role, ok: true };
      case "PROPAGATE_ENVELOPE": {
        const env = msg.envelope;
        if (!this.verifier.verify({ ...env, signature: "" }, env.signature, env.issued_by)) {
          return { ok: false, reason: "bad-signature" };
        }
        const existing = this.cachedEnvelopes.get(env.envelope_id);
        if (!existing || env.version >= existing.version) {
          this.cachedEnvelopes.set(env.envelope_id, env);
        }
        return { ok: true };
      }
      case "GOSSIP_REVOCATION": {
        const rev = msg.revocation;
        // Verify root signature over the revocation. Strip signing_quorum
        // so adding witness sigs after root signs doesn't invalidate
        // the root sig.
        // Strip both `signature` (so it doesn't appear in its own preimage)
        // and `signing_quorum` (which witnesses add AFTER root signs).
        // Using destructuring instead of `{ ...rev, signing_quorum: undefined }`
        // because the latter leaves an explicit-undefined key that
        // stableStringify mangles into a different preimage than what
        // root actually signed over.
        const { signing_quorum: _quorum, signature: _sig, ...rootSigMaterial } = rev;
        const rootSigPayload = { ...rootSigMaterial, signature: "" };
        if (!this.verifier.verify(rootSigPayload, rev.signature, rev.issued_by)) {
          return { ok: false, reason: "bad-signature" };
        }
        // Enforce witness quorum if configured.
        if (this.requireRevocationQuorum > 0) {
          const validCount = countValidRevocationQuorum(this.verifier, rev);
          if (validCount < this.requireRevocationQuorum) {
            this.quorumRejectedCount++;
            return {
              ok: false,
              reason: "quorum-insufficient",
              required: this.requireRevocationQuorum,
              observed: validCount
            };
          }
        }
        this.cachedRevocations.set(rev.revocation_id, rev);
        return { ok: true };
      }
      case "ISSUE_FLUIDITY_TOKEN": {
        this.receiveFluidityToken(msg.token);
        return { ok: true };
      }
      default:
        return { ok: false, reason: "unknown-kind" };
    }
  }

  cachedEnvelopeCount(): number { return this.cachedEnvelopes.size; }
  cachedRevocationCount(): number { return this.cachedRevocations.size; }
  localDecisionCount(): number { return this.localDecisions.length; }
  validFluidityTokens(): FluidityToken[] {
    return [...this.fluidityTokens.values()].filter((t) => Date.parse(t.expires_at) > Date.now());
  }
}

// ---------------------------------------------------------------------------
// Quorum signing — a decision is admissible only after m of n witnesses
// co-sign. High-consequence action classes can require quorum signatures
// before the consumer (or replay verifier) accepts the warrant.
// ---------------------------------------------------------------------------

export interface QuorumSignature {
  witness_id: string;
  signature: string;
  signed_at: string;
  /**
   * Which artifact this signature attests to. Optional with default
   * "warrant" for backwards compat — the original quorum scheme only
   * covered Warrants. `revocation` is the new path used by
   * RootNode.revokeWithQuorum() so revocation quorum sigs can't be
   * confused with warrant quorum sigs at verify time.
   */
  artifact_kind?: "warrant" | "revocation";
}

export class QuorumCollector {
  private collected: Map<string, QuorumSignature[]> = new Map();
  constructor(public readonly required: number, public readonly witnessIds: string[]) {}
  /** Add a witness's signature for a warrant. Returns the running count. */
  add(warrant_id: string, sig: QuorumSignature): number {
    if (!this.witnessIds.includes(sig.witness_id)) return this.count(warrant_id);
    const sigs = this.collected.get(warrant_id) ?? [];
    if (sigs.some((s) => s.witness_id === sig.witness_id)) return sigs.length; // de-dup
    sigs.push(sig);
    this.collected.set(warrant_id, sigs);
    return sigs.length;
  }
  count(warrant_id: string): number { return this.collected.get(warrant_id)?.length ?? 0; }
  satisfied(warrant_id: string): boolean { return this.count(warrant_id) >= this.required; }
  signatures(warrant_id: string): QuorumSignature[] { return [...(this.collected.get(warrant_id) ?? [])]; }
}

/** Ask a witness to co-sign a warrant (deterministic for the demo: signs
 *  shared secret + warrant payload). Production swaps to Ed25519 per witness. */
export function witnessCoSign(secret: string, witness_id: string, warrant: Warrant): QuorumSignature {
  const signed_at = nowIso();
  const sig = sha256Hex(secret + ":quorum:" + witness_id + ":" + sha256Hex(stableStringify(warrant)));
  return { witness_id, signature: sig, signed_at };
}

/**
 * Have a witness co-sign a Revocation. The signing material binds to
 * the revocation_id AND the root's signature, so a witness can never
 * be tricked into co-signing a substituted revocation under the same
 * revocation_id. Uses the witness's MeshSigner — same key infrastructure
 * the rest of the mesh trust uses.
 *
 * Used by RootNode.revokeWithQuorum() to collect the N signatures it
 * needs before gossiping. Edges configured with requireRevocationQuorum
 * call verifyRevocationQuorumSignature() to verify each one.
 */
export function witnessCoSignRevocation(signer: MeshSigner, revocation: Revocation): QuorumSignature {
  const payload = {
    kind: "quorum:revocation" as const,
    revocation_id: revocation.revocation_id,
    target_id: revocation.target_id,
    root_signature: revocation.signature
  };
  return {
    witness_id: signer.signerId,
    signature: signer.sign(payload),
    signed_at: nowIso(),
    artifact_kind: "revocation"
  };
}

/**
 * Verify a single quorum signature against a Revocation. Uses the
 * passed MeshVerifier to look up the witness's trust anchor by
 * witness_id and verify the signature.
 *
 * Returns false on:
 *   - signature mismatch
 *   - witness_id not in the verifier's trust anchor set
 *   - signature was issued over a different revocation
 *   - artifact_kind is not "revocation" (defends against confusing a
 *     warrant quorum sig for a revocation quorum sig)
 */
export function verifyRevocationQuorumSignature(
  verifier: MeshVerifier,
  revocation: Revocation,
  sig: QuorumSignature
): boolean {
  if (sig.artifact_kind !== "revocation") return false;
  const payload = {
    kind: "quorum:revocation" as const,
    revocation_id: revocation.revocation_id,
    target_id: revocation.target_id,
    root_signature: revocation.signature
  };
  return verifier.verify(payload, sig.signature, sig.witness_id);
}

/**
 * Count distinct, valid witness signatures on a Revocation. Strips
 * duplicates by witness_id so an attacker can't pad the count by
 * re-submitting the same witness's signature.
 *
 * Returns 0 for revocations without a signing_quorum or whose witnesses
 * aren't in the verifier's trust anchor set.
 */
export function countValidRevocationQuorum(
  verifier: MeshVerifier,
  revocation: Revocation
): number {
  const sigs = revocation.signing_quorum ?? [];
  const witnesses = new Set<string>();
  for (const sig of sigs) {
    if (witnesses.has(sig.witness_id)) continue;
    if (!verifyRevocationQuorumSignature(verifier, revocation, sig)) continue;
    witnesses.add(sig.witness_id);
  }
  return witnesses.size;
}

/** Verify a quorum signature. */
export function verifyQuorumSignature(secret: string, warrant: Warrant, sig: QuorumSignature): boolean {
  return sig.signature === sha256Hex(secret + ":quorum:" + sig.witness_id + ":" + sha256Hex(stableStringify(warrant)));
}

// ---------------------------------------------------------------------------
// Persistent state — allows mesh nodes to survive restarts.
// ---------------------------------------------------------------------------

export interface MeshPersistence {
  loadEnvelopes(): AuthorityEnvelope[];
  loadRevocations(): Revocation[];
  saveEnvelope(env: AuthorityEnvelope): void;
  saveRevocation(rev: Revocation): void;
}

/** In-memory persistence — useful for tests + demos. Swap for SQLite / Postgres
 *  in production by implementing the MeshPersistence interface. */
export class InMemoryMeshPersistence implements MeshPersistence {
  private readonly envelopes: Map<string, AuthorityEnvelope> = new Map();
  private readonly revocations: Map<string, Revocation> = new Map();
  loadEnvelopes(): AuthorityEnvelope[] { return [...this.envelopes.values()]; }
  loadRevocations(): Revocation[] { return [...this.revocations.values()]; }
  saveEnvelope(env: AuthorityEnvelope): void { this.envelopes.set(env.envelope_id, env); }
  saveRevocation(rev: Revocation): void { this.revocations.set(rev.revocation_id, rev); }
}

// ---------------------------------------------------------------------------
// Sovereign routing — when a request references a foreign MAE, the node
// looks up its trust anchor and routes the request to that mesh's witness
// or root. Anchors are configured statically here; production deployments
// would gate this with the issuer→key binding from governance-core.
// ---------------------------------------------------------------------------

export interface TrustAnchor {
  mae_id: string;
  target: NodeId;
}

export interface SovereignRouter {
  /** Returns the route target for a given MAE id, or undefined if local. */
  route(mae_id: string): TrustAnchor | undefined;
}

export class StaticSovereignRouter implements SovereignRouter {
  constructor(
    private readonly localMaeId: string,
    private readonly trustAnchors: TrustAnchor[]
  ) {}
  route(mae_id: string): TrustAnchor | undefined {
    if (mae_id === this.localMaeId) return undefined;
    return this.trustAnchors.find((a) => a.mae_id === mae_id);
  }
  isLocal(mae_id: string): boolean { return mae_id === this.localMaeId; }
  anchorIds(): string[] { return this.trustAnchors.map((a) => a.mae_id); }
}

// ---------------------------------------------------------------------------
// Test-helper: in-process registry so nodes can call each other without HTTP
// (deterministic, partition-aware, used by the integration tests).
// ---------------------------------------------------------------------------

export function bindRegistry(nodes: MeshNode[]): () => void {
  const map = new Map<string, MeshNode>();
  for (const n of nodes) map.set(n.getId(), n);
  (globalThis as { __aos_mesh_registry?: Map<string, MeshNode> }).__aos_mesh_registry = map;
  return () => { delete (globalThis as { __aos_mesh_registry?: Map<string, MeshNode> }).__aos_mesh_registry; };
}
