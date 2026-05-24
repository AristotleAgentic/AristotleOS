import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { type GelRecord, type LedgerBackend, GENESIS_HASH, verifyGelRecords } from "./index.js";

/**
 * Durable, ACID ledger backend built on Node's built-in `node:sqlite` (no native
 * dependency, no build step). Replay lookups use a SQL index (O(log n), bounded
 * memory) and records survive process restarts.
 *
 * `node:sqlite` is loaded lazily via createRequire so importing this module never
 * forces the dependency on Node versions that lack it — it is only required when a
 * SqliteLedgerBackend is actually constructed (Node >= 22.5).
 */

interface SqliteRow {
  json: string;
}

interface DatabaseSyncLike {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): SqliteRow | undefined;
    all(...params: unknown[]): SqliteRow[];
  };
  close(): void;
}

export class SqliteLedgerBackend implements LedgerBackend {
  private readonly db: DatabaseSyncLike;
  private _tip: string;
  private _count: number;
  private readonly _ok: boolean;
  private readonly _failure?: string;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
    const require = createRequire(import.meta.url);
    const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: new (p: string) => DatabaseSyncLike };
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS gel_records (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        record_hash TEXT NOT NULL,
        previous_hash TEXT NOT NULL,
        canonical_action_hash TEXT NOT NULL,
        decision TEXT NOT NULL,
        json TEXT NOT NULL
      );`
    );
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_gel_admitted ON gel_records(canonical_action_hash, decision);");

    const chain = this.records();
    const verification = verifyGelRecords(chain);
    this._ok = verification.ok;
    this._failure = verification.failure;
    this._count = chain.length;
    this._tip = chain.at(-1)?.record_hash ?? GENESIS_HASH;
  }

  get tipHash(): string {
    return this._tip;
  }

  get count(): number {
    return this._count;
  }

  hasAdmitted(canonicalActionHash: string): boolean {
    const row = this.db
      .prepare("SELECT 1 AS json FROM gel_records WHERE canonical_action_hash = ? AND decision = 'ALLOW' LIMIT 1")
      .get(canonicalActionHash);
    return row !== undefined;
  }

  verification(): { ok: boolean; count: number; failure?: string } {
    return this._ok ? { ok: true, count: this._count } : { ok: false, count: this._count, failure: this._failure };
  }

  persist(record: GelRecord): void {
    this.db
      .prepare("INSERT INTO gel_records (record_hash, previous_hash, canonical_action_hash, decision, json) VALUES (?, ?, ?, ?, ?)")
      .run(record.record_hash, record.previous_hash, record.canonical_action_hash, record.decision, JSON.stringify(record));
    this._tip = record.record_hash;
    this._count += 1;
  }

  records(): GelRecord[] {
    return this.db
      .prepare("SELECT json FROM gel_records ORDER BY seq ASC")
      .all()
      .map((row) => JSON.parse(row.json) as GelRecord);
  }

  tail(limit: number): GelRecord[] {
    return this.db
      .prepare("SELECT json FROM gel_records ORDER BY seq DESC LIMIT ?")
      .all(limit)
      .map((row) => JSON.parse(row.json) as GelRecord)
      .reverse();
  }

  close(): void {
    this.db.close();
  }
}
