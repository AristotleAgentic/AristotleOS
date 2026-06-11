import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  type ConflictStatus,
  type ReconciliationItem,
  type ReconciliationReport,
  type ReconcileInput,
  type ResolutionAction,
  applyResolution,
  reconcileEdgeRecords
} from "./reconcile.js";

/**
 * Edge Conflict Inbox — stateful backend.
 *
 * The reconcile engine (reconcile.ts) is pure: it classifies edge decisions vs
 * current/execution-time policy but holds no state. This store gives the operator
 * console a durable inbox: it ingests edge records (running them through the real
 * Commit Gate via reconcileEdgeRecords), persists the resulting items keyed by
 * action_id, and tracks each item through the operator-resolution state machine
 * (open → accepted/rejected/escalated/reconciled).
 *
 * Doctrine: this decides nothing on the operator's behalf. Ingest only observes
 * and classifies; a status change requires an explicit, attributed resolve() call.
 * Re-ingesting refreshes an item's replay evidence but never reopens or overwrites
 * a resolution an operator already made.
 *
 * Backed by a JSON file (durable across restarts) or in-memory (per-process).
 */

export interface ConflictInboxRecord extends ReconciliationItem {
  /** Operator who resolved the conflict (subject), if resolved. */
  resolved_by?: string;
  /** ISO time the resolution was recorded. */
  resolved_at?: string;
  /** The operator action applied (accept/reject/escalate/reconcile). */
  resolution_action?: ResolutionAction;
  /** Free-text operator justification. */
  resolution_reason?: string;
  /** First time this item was seen in the inbox. */
  first_seen_at?: string;
}

export interface ConflictInboxSummary {
  total: number;
  open: number;
  conflicts: number;
  by_status: Record<ConflictStatus, number>;
}

const RESOLVED_STATES: ConflictStatus[] = ["accepted", "rejected", "escalated", "reconciled"];

function emptyByStatus(): Record<ConflictStatus, number> {
  return { open: 0, accepted: 0, rejected: 0, escalated: 0, reconciled: 0 };
}

interface InboxFile {
  version: "aristotle.conflict-inbox.v1";
  items: Record<string, ConflictInboxRecord>;
}

export class ConflictInboxStore {
  private mem: Map<string, ConflictInboxRecord> | null;

  constructor(private readonly file: string | null) {
    this.mem = file ? null : new Map();
  }

  /** In-memory store (per-process; not durable). */
  static memory(): ConflictInboxStore {
    return new ConflictInboxStore(null);
  }

  private read(): Map<string, ConflictInboxRecord> {
    if (this.mem) return this.mem;
    if (existsSync(this.file!)) {
      try {
        const parsed = JSON.parse(readFileSync(this.file!, "utf8")) as Partial<InboxFile>;
        return new Map(Object.entries(parsed.items ?? {}));
      } catch {
        /* corrupt file => start clean rather than throw */
      }
    }
    return new Map();
  }

  private persist(map: Map<string, ConflictInboxRecord>): void {
    if (this.mem) {
      this.mem = map;
      return;
    }
    mkdirSync(path.dirname(path.resolve(this.file!)), { recursive: true });
    const payload: InboxFile = { version: "aristotle.conflict-inbox.v1", items: Object.fromEntries(map) };
    writeFileSync(this.file!, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  /**
   * Ingest a batch of edge records: re-evaluate through the real Commit Gate and
   * upsert the inbox. New items take their status from reconciliation (open for a
   * conflict, reconciled for an agreement). An existing item that an operator has
   * already resolved keeps its resolution; its replay evidence is refreshed.
   * Returns the reconciliation report for the batch.
   */
  ingest(input: ReconcileInput): ReconciliationReport {
    const report = reconcileEdgeRecords(input);
    const map = this.read();
    const now = input.now ?? new Date().toISOString();
    for (const item of report.items) {
      const existing = map.get(item.action_id);
      if (existing && existing.resolution_action && RESOLVED_STATES.includes(existing.status)) {
        // Preserve the operator's resolution; refresh the replay/current evidence.
        map.set(item.action_id, {
          ...item,
          status: existing.status,
          first_seen_at: existing.first_seen_at ?? now,
          resolved_by: existing.resolved_by,
          resolved_at: existing.resolved_at,
          resolution_action: existing.resolution_action,
          resolution_reason: existing.resolution_reason
        });
      } else {
        map.set(item.action_id, { ...item, first_seen_at: existing?.first_seen_at ?? now });
      }
    }
    this.persist(map);
    return report;
  }

  /** All inbox items, conflicts first, then most-recently-occurred. */
  list(): ConflictInboxRecord[] {
    return [...this.read().values()].sort((a, b) => {
      if (a.agrees !== b.agrees) return a.agrees ? 1 : -1;
      return (b.occurred_at ?? "").localeCompare(a.occurred_at ?? "");
    });
  }

  get(actionId: string): ConflictInboxRecord | undefined {
    return this.read().get(actionId);
  }

  /**
   * Apply an attributed operator resolution to one conflict. Throws if the item is
   * unknown or already resolved (the pure state machine only permits open/escalated).
   */
  resolve(actionId: string, action: ResolutionAction, by: string, reason?: string, now: string = new Date().toISOString()): ConflictInboxRecord {
    const map = this.read();
    const existing = map.get(actionId);
    if (!existing) throw new Error(`unknown conflict: ${actionId}`);
    const resolved = applyResolution(existing, action);
    const record: ConflictInboxRecord = {
      ...resolved,
      resolved_by: by,
      resolved_at: now,
      resolution_action: action,
      resolution_reason: reason,
      first_seen_at: existing.first_seen_at
    };
    map.set(actionId, record);
    this.persist(map);
    return record;
  }

  summary(): ConflictInboxSummary {
    const items = this.list();
    const by_status = emptyByStatus();
    for (const item of items) by_status[item.status] += 1;
    return {
      total: items.length,
      open: by_status.open + by_status.escalated,
      conflicts: items.filter((i) => !i.agrees).length,
      by_status
    };
  }
}
