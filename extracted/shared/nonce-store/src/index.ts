/**
 * @aristotle/nonce-store
 *
 * Durable replay-protection nonce store for AristotleOS.
 *
 * Closes ROADMAP_TO_100.md Category 1 item "durable NonceSeenSet
 * implementation". The substrate's NonceSeenSet interface (defined in
 * @aristotle/execution-control-runtime) is read-only — it only declares
 * `has(nonce): boolean`. The caller is responsible for ADDING nonces
 * after a Warrant verifies, so that a future replay attempt with the same
 * nonce gets WARRANT_REPLAYED on the next verifyWarrant call.
 *
 * This package ships two backends:
 *
 *   - InMemoryNonceStore    Pure in-process Set. Lost on restart.
 *                           Useful for tests and ephemeral edge nodes.
 *
 *   - FilesystemNonceStore  Append-only JSONL persistence. In-memory
 *                           Set indexes for O(1) `has()`. Hydrates on
 *                           construction. Fsync-on-write for crash
 *                           safety. Optional TTL eviction so the file
 *                           doesn't grow forever — nonces older than
 *                           `maxAgeMs` are dropped lazily on access
 *                           and on the next `compact()` call.
 *
 * Both backends implement the shared NonceStore interface which extends
 * NonceSeenSet with `add()`, `addAndCheck()` (atomic check-and-add), and
 * `size()`. This is the minimum useful surface; Redis / Postgres adapters
 * can implement the same interface in separate packages without forcing
 * those dependencies on every consumer.
 */

import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

/**
 * Read-only seen-set shape required by `verifyWarrant`'s `seenNonces`
 * option. Every NonceStore in this package satisfies this.
 */
export interface NonceSeenSet {
  has(nonce: string): boolean;
}

/**
 * Full nonce-store contract. Every backend in this package implements
 * this; external backends (Redis, Postgres) can implement it too.
 */
export interface NonceStore extends NonceSeenSet {
  /** Record a freshly-seen nonce. Idempotent — re-adding is a no-op. */
  add(nonce: string): void;
  /**
   * Atomic check-and-add. Returns `true` if the nonce was ALREADY seen
   * (the caller should reject the warrant as replayed). Returns `false`
   * if the nonce was newly added in this call.
   *
   * Prefer this over separate has() + add() when handling a single
   * warrant verify, to avoid a race window in concurrent callers.
   */
  addAndCheck(nonce: string): boolean;
  /** Number of nonces currently retained. Reflects post-eviction state. */
  size(): number;
}

// ---------------------------------------------------------------------------
// In-memory backend
// ---------------------------------------------------------------------------

export interface InMemoryNonceStoreOptions {
  /**
   * If set, drop nonces older than this many ms on access. Default = no
   * TTL (nonces live for the lifetime of the process).
   */
  maxAgeMs?: number;
  /**
   * Provide a clock for deterministic testing. Defaults to `Date.now`.
   */
  now?: () => number;
}

/**
 * Pure in-process nonce store. Memory grows linearly with the number of
 * distinct nonces seen. Use `maxAgeMs` to bound memory in a long-running
 * process.
 */
export class InMemoryNonceStore implements NonceStore {
  private readonly seen: Map<string, number> = new Map();
  private readonly maxAgeMs: number | undefined;
  private readonly now: () => number;

  constructor(opts: InMemoryNonceStoreOptions = {}) {
    this.maxAgeMs = opts.maxAgeMs;
    this.now = opts.now ?? Date.now;
  }

  has(nonce: string): boolean {
    const at = this.seen.get(nonce);
    if (at === undefined) return false;
    if (this.maxAgeMs !== undefined && this.now() - at > this.maxAgeMs) {
      this.seen.delete(nonce);
      return false;
    }
    return true;
  }

  add(nonce: string): void {
    if (!this.seen.has(nonce)) this.seen.set(nonce, this.now());
  }

  addAndCheck(nonce: string): boolean {
    const wasSeen = this.has(nonce);
    if (!wasSeen) this.seen.set(nonce, this.now());
    return wasSeen;
  }

  size(): number {
    if (this.maxAgeMs !== undefined) this.compactInternal();
    return this.seen.size;
  }

  /** Drop expired nonces. Returns the number evicted. */
  compact(): number {
    return this.compactInternal();
  }

  private compactInternal(): number {
    if (this.maxAgeMs === undefined) return 0;
    const cutoff = this.now() - this.maxAgeMs;
    let evicted = 0;
    for (const [nonce, at] of this.seen) {
      if (at <= cutoff) { this.seen.delete(nonce); evicted++; }
    }
    return evicted;
  }
}

// ---------------------------------------------------------------------------
// Filesystem backend
// ---------------------------------------------------------------------------

interface NonceRecord {
  nonce: string;
  ts: number;
}

export interface FilesystemNonceStoreOptions {
  /** Absolute or relative path to the append-only JSONL persistence file. */
  path: string;
  /**
   * If set, drop nonces older than this many ms on access AND skip them
   * during hydration. Default = no TTL (file grows forever; call
   * compact() periodically if you care about size).
   */
  maxAgeMs?: number;
  /**
   * If true, call fsync(2) after every append. Slower but survives
   * crash-during-append. Default = true.
   */
  fsync?: boolean;
  /**
   * Provide a clock for deterministic testing. Defaults to `Date.now`.
   */
  now?: () => number;
}

/**
 * Filesystem-backed nonce store. Append-only JSONL persistence; in-memory
 * Map indexes for fast `has()`. Hydrates on construction.
 *
 * Crash safety: each `add()` does a single append + fsync. If the
 * process dies mid-line, the trailing partial line is dropped at next
 * hydrate (JSON.parse throws → skip). Earlier complete lines are
 * preserved.
 *
 * Concurrency: this implementation does NOT cross-process lock. Use one
 * NonceStore instance per process. For multi-process deployments use a
 * Redis or Postgres backend (separate package, same interface).
 */
export class FilesystemNonceStore implements NonceStore {
  private readonly path: string;
  private readonly maxAgeMs: number | undefined;
  private readonly fsyncOnWrite: boolean;
  private readonly now: () => number;
  private readonly seen: Map<string, number> = new Map();
  private writerFd: number | null = null;
  private closed: boolean = false;

  constructor(opts: FilesystemNonceStoreOptions) {
    this.path = opts.path;
    this.maxAgeMs = opts.maxAgeMs;
    this.fsyncOnWrite = opts.fsync ?? true;
    this.now = opts.now ?? Date.now;
    mkdirSync(dirname(this.path), { recursive: true });
    this.hydrate();
  }

  has(nonce: string): boolean {
    const at = this.seen.get(nonce);
    if (at === undefined) return false;
    if (this.maxAgeMs !== undefined && this.now() - at > this.maxAgeMs) {
      this.seen.delete(nonce);
      return false;
    }
    return true;
  }

  add(nonce: string): void {
    if (this.closed) throw new Error("FilesystemNonceStore: add() after close()");
    if (this.seen.has(nonce)) return;
    const record: NonceRecord = { nonce, ts: this.now() };
    this.persist(record);
    this.seen.set(nonce, record.ts);
  }

  addAndCheck(nonce: string): boolean {
    const wasSeen = this.has(nonce);
    if (!wasSeen) {
      const record: NonceRecord = { nonce, ts: this.now() };
      this.persist(record);
      this.seen.set(nonce, record.ts);
    }
    return wasSeen;
  }

  size(): number {
    if (this.maxAgeMs !== undefined) this.compactInternal();
    return this.seen.size;
  }

  /**
   * Drop expired nonces from memory AND rewrite the persistence file
   * with only the surviving records. Use periodically in long-running
   * processes to bound file size.
   *
   * Returns the number of evicted records.
   */
  compact(): number {
    const evicted = this.compactInternal();
    // Rewrite the persistence file atomically.
    const lines: string[] = [];
    for (const [nonce, ts] of this.seen) lines.push(JSON.stringify({ nonce, ts }));
    const tmp = this.path + ".compact-tmp";
    writeFileSync(tmp, lines.length ? lines.join("\n") + "\n" : "");
    // Close the active writer fd, swap, reopen.
    if (this.writerFd !== null) { closeSync(this.writerFd); this.writerFd = null; }
    // rename: best-effort atomic; on Windows this can fail if antivirus
    // holds the target. Fall back to overwrite via writeFileSync.
    try {
      // node:fs renameSync is synchronous and atomic on POSIX; on
      // Windows it requires the target to not exist or be the same vol.
      // We unlink first to maximize Windows compatibility.
      try { unlinkSync(this.path); } catch { /* ignore if absent */ }
      renameSync(tmp, this.path);
    } catch {
      // Fallback: read tmp + overwrite path directly.
      const content = readFileSync(tmp);
      writeFileSync(this.path, content);
    }
    return evicted;
  }

  /** Release the writer fd. Subsequent add()/addAndCheck() will throw. */
  close(): void {
    if (this.writerFd !== null) { closeSync(this.writerFd); this.writerFd = null; }
    this.closed = true;
  }

  private hydrate(): void {
    if (!existsSync(this.path)) return;
    const data = readFileSync(this.path, "utf8");
    const cutoff = this.maxAgeMs !== undefined ? this.now() - this.maxAgeMs : -Infinity;
    for (const line of data.split("\n")) {
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as NonceRecord;
        if (typeof parsed.nonce !== "string" || typeof parsed.ts !== "number") continue;
        if (parsed.ts <= cutoff) continue;
        // Last write wins on duplicate nonces in the file (the file is
        // append-only; duplicates only happen if a caller add()s the
        // same nonce twice across runs).
        this.seen.set(parsed.nonce, parsed.ts);
      } catch {
        // Truncated / corrupted line at EOF after a crash. Skip.
      }
    }
  }

  private persist(record: NonceRecord): void {
    if (this.writerFd === null) this.writerFd = openSync(this.path, "a");
    appendFileSync(this.writerFd, JSON.stringify(record) + "\n");
    if (this.fsyncOnWrite) {
      try { fsyncSync(this.writerFd); } catch { /* tolerate on tmpfs */ }
    }
  }

  private compactInternal(): number {
    if (this.maxAgeMs === undefined) return 0;
    const cutoff = this.now() - this.maxAgeMs;
    let evicted = 0;
    for (const [nonce, ts] of this.seen) {
      if (ts <= cutoff) { this.seen.delete(nonce); evicted++; }
    }
    return evicted;
  }
}
