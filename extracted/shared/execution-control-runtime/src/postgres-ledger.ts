import { type AsyncLedgerBackend, type GelRecord, GENESIS_HASH, verifyGelRecords } from "./index.js";

/**
 * Durable, network-backed ledger backend on PostgreSQL — the basis for
 * horizontal availability: replay state lives in the shared database, so multiple
 * boundary instances pointed at the same database refuse replays consistently.
 *
 * Driver-agnostic: it accepts any `Queryable` with a node-postgres-style
 * `query(text, params)`. Production passes a `pg` Pool; tests use PGlite. The
 * runtime package therefore carries no database driver dependency.
 *
 * Chain linkage uses the in-memory tip; for active-active multi-writer chain
 * integrity, serialize appends (single writer / leader). Replay protection,
 * the security-critical shared state, is always read from the database.
 */
export interface QueryRunner {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export interface Queryable extends QueryRunner {
  /**
   * Run `fn` inside a single-connection transaction, when the driver supports it.
   * Enables serialized, chain-correct appends for active-active multi-writer
   * deployments. When absent, the backend falls back to single-writer linkage.
   */
  transaction?<T>(fn: (tx: QueryRunner) => Promise<T>): Promise<T>;
}

/** Stable 64-bit-ish advisory lock key for serializing ledger appends. */
const APPEND_LOCK_KEY = 0x4f534147; // "OSAG"

const DDL_TABLE = `CREATE TABLE IF NOT EXISTS gel_records (
  seq bigserial PRIMARY KEY,
  record_hash text NOT NULL,
  previous_hash text NOT NULL,
  canonical_action_hash text NOT NULL,
  decision text NOT NULL,
  json jsonb NOT NULL
)`;

const DDL_INDEX = "CREATE INDEX IF NOT EXISTS idx_gel_admitted ON gel_records (canonical_action_hash) WHERE decision = 'ALLOW'";

function toRecord(value: unknown): GelRecord {
  return (typeof value === "string" ? JSON.parse(value) : value) as GelRecord;
}

export class PostgresLedgerBackend implements AsyncLedgerBackend {
  private _tip = GENESIS_HASH;
  private _count = 0;
  private _ok = true;
  private _failure?: string;

  private constructor(private readonly db: Queryable, private readonly onClose?: () => Promise<void>) {}

  /** Create the schema, seed the in-memory tip/count/integrity, and return the backend. */
  static async create(db: Queryable, options: { onClose?: () => Promise<void> } = {}): Promise<PostgresLedgerBackend> {
    await db.query(DDL_TABLE);
    await db.query(DDL_INDEX);
    const backend = new PostgresLedgerBackend(db, options.onClose);
    const chain = await backend.records();
    const verification = verifyGelRecords(chain);
    backend._ok = verification.ok;
    backend._failure = verification.failure;
    backend._count = chain.length;
    backend._tip = chain.at(-1)?.record_hash ?? GENESIS_HASH;
    return backend;
  }

  get tipHash(): string {
    return this._tip;
  }

  get count(): number {
    return this._count;
  }

  /** Replay lookup against the shared database — consistent across boundary instances. */
  async hasAdmitted(canonicalActionHash: string): Promise<boolean> {
    const result = await this.db.query(
      "SELECT 1 FROM gel_records WHERE canonical_action_hash = $1 AND decision = 'ALLOW' LIMIT 1",
      [canonicalActionHash]
    );
    return result.rows.length > 0;
  }

  verification(): { ok: boolean; count: number; failure?: string } {
    return this._ok ? { ok: true, count: this._count } : { ok: false, count: this._count, failure: this._failure };
  }

  async appendChained(build: (previousHash: string) => GelRecord): Promise<GelRecord> {
    const insert = async (tx: QueryRunner, record: GelRecord) => {
      await tx.query(
        "INSERT INTO gel_records (record_hash, previous_hash, canonical_action_hash, decision, json) VALUES ($1, $2, $3, $4, $5)",
        [record.record_hash, record.previous_hash, record.canonical_action_hash, record.decision, JSON.stringify(record)]
      );
    };

    let record: GelRecord;
    if (this.db.transaction) {
      // Serialized path: lock, read the authoritative tip from the DB, build, insert.
      // Concurrent appenders across nodes block on the advisory lock, so the chain
      // never forks.
      record = await this.db.transaction(async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock($1)", [APPEND_LOCK_KEY]);
        const tipRow = await tx.query("SELECT record_hash FROM gel_records ORDER BY seq DESC LIMIT 1");
        const previousHash = (tipRow.rows[0]?.record_hash as string | undefined) ?? GENESIS_HASH;
        const built = build(previousHash);
        await insert(tx, built);
        return built;
      });
    } else {
      // Single-writer fallback: link to the in-memory tip.
      record = build(this._tip);
      await insert(this.db, record);
    }
    this._tip = record.record_hash;
    this._count += 1;
    return record;
  }

  async records(): Promise<GelRecord[]> {
    const result = await this.db.query("SELECT json FROM gel_records ORDER BY seq ASC");
    return result.rows.map((row) => toRecord(row.json));
  }

  async tail(limit: number): Promise<GelRecord[]> {
    const result = await this.db.query("SELECT json FROM gel_records ORDER BY seq DESC LIMIT $1", [limit]);
    return result.rows.map((row) => toRecord(row.json)).reverse();
  }

  async close(): Promise<void> {
    await this.onClose?.();
  }
}
