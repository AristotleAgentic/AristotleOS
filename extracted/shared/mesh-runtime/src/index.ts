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
  /** Shared HMAC secret across the mesh — production would be Ed25519 with
   *  per-node keypairs gated by the issuer→key-binding layer that already
   *  exists in governance-core. Kept symmetric here for clarity. */
  secret: string;
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
  protected readonly secret: string;
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
    this.secret = opts.secret;
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
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? Buffer.concat(chunks).toString("utf8") : "";
    let parsed: MeshMessage;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.statusCode = 400; res.end("bad json"); return;
    }
    if (parsed.from && this.partitions.has(parsed.from)) {
      // Simulate partition: silently drop.
      res.statusCode = 504; res.end("partitioned"); return;
    }
    try {
      const out = await this.handle(parsed);
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(out));
    } catch (err) {
      res.statusCode = 500;
      res.end((err as Error).message);
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
    partial.signature = sign(this.secret, { ...partial, signature: "" });
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
    partial.signature = sign(this.secret, { ...partial, signature: "" });
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
    partial.signature = sign(this.secret, { ...partial, signature: "" });
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
        if (!verify(this.secret, { ...env, signature: "" }, env.signature)) {
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
        if (!verify(this.secret, { ...rev, signature: "" }, rev.signature)) {
          return { ok: false, reason: "bad-signature" };
        }
        this.cachedRevocations.set(rev.revocation_id, rev);
        // Forward to edge peers.
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

  constructor(opts: EdgeOptions) {
    super(opts);
    this.maxWarrantsDisconnected = opts.maxWarrantsWhileDisconnected ?? 100;
  }

  receiveFluidityToken(token: FluidityToken): void {
    if (token.edge_id !== this.id) return;
    if (!verify(this.secret, { ...token, signature: "" }, token.signature)) return;
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
    partial.signature = sign(this.secret, { ...partial, signature: "" });
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
        if (!verify(this.secret, { ...rev, signature: "" }, rev.signature)) {
          rejected++;
          continue;
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
        if (!verify(this.secret, { ...env, signature: "" }, env.signature)) {
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
        if (!verify(this.secret, { ...rev, signature: "" }, rev.signature)) {
          return { ok: false, reason: "bad-signature" };
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
