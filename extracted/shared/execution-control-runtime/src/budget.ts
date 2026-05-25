import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Budget / quota governance.
 *
 * Most governance is binary — may this action happen? AristotleOS also governs *how
 * much*: an Authority Envelope may cap a subject's spend (cost) and/or call count
 * within a rolling window. A runaway or compromised agent that stays within its
 * allow-list can still be stopped before it burns the budget. Enforced at the same
 * execution boundary, before the irreversible action, and recorded in the GEL like
 * any other refusal — so "you hit your limit" is itself evidence.
 *
 * The check is pure and testable; the governor holds the per-subject spend window
 * (in-memory per-process, or file-backed and durable across restarts so a bounced
 * agent cannot reset its own quota).
 */

export interface BudgetPolicy {
  /** Rolling window in milliseconds. */
  windowMs: number;
  /** Max summed cost (e.g. dollars/tokens) per window. Cost comes from action.params.cost. */
  maxCostPerWindow?: number;
  /** Max admitted calls per window (each admitted action counts once). */
  maxCallsPerWindow?: number;
}

export interface BudgetEntry {
  at: number;
  cost: number;
}

export type BudgetCheck = { ok: true } | { ok: false; reason: string };

/** Read + validate a BudgetPolicy from an envelope constraint blob. Returns undefined when absent/invalid. */
export function budgetPolicyFrom(raw: unknown): BudgetPolicy | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const b = raw as Record<string, unknown>;
  const windowMs = typeof b.windowMs === "number" ? b.windowMs : typeof b.window_ms === "number" ? b.window_ms : undefined;
  if (windowMs === undefined || windowMs <= 0) return undefined;
  const maxCost = typeof b.maxCostPerWindow === "number" ? b.maxCostPerWindow : typeof b.max_cost_per_window === "number" ? b.max_cost_per_window : undefined;
  const maxCalls = typeof b.maxCallsPerWindow === "number" ? b.maxCallsPerWindow : typeof b.max_calls_per_window === "number" ? b.max_calls_per_window : undefined;
  if (maxCost === undefined && maxCalls === undefined) return undefined;
  return { windowMs, ...(maxCost !== undefined ? { maxCostPerWindow: maxCost } : {}), ...(maxCalls !== undefined ? { maxCallsPerWindow: maxCalls } : {}) };
}

/**
 * Pure: would admitting an action of `cost` keep the subject within budget, given its
 * prior spend `history`? Counts/sums only entries inside the rolling window.
 */
export function checkBudget(policy: BudgetPolicy, history: BudgetEntry[], now: number, cost: number): BudgetCheck {
  const windowStart = now - policy.windowMs;
  const inWindow = history.filter((e) => e.at >= windowStart);
  if (policy.maxCallsPerWindow !== undefined && inWindow.length + 1 > policy.maxCallsPerWindow) {
    return { ok: false, reason: `call budget exceeded: ${inWindow.length + 1} > ${policy.maxCallsPerWindow} per ${Math.round(policy.windowMs / 1000)}s` };
  }
  if (policy.maxCostPerWindow !== undefined) {
    const spent = inWindow.reduce((acc, e) => acc + e.cost, 0);
    if (spent + cost > policy.maxCostPerWindow) {
      return { ok: false, reason: `cost budget exceeded: ${spent + cost} > ${policy.maxCostPerWindow} per ${Math.round(policy.windowMs / 1000)}s` };
    }
  }
  return { ok: true };
}

interface BudgetFile {
  version: "aristotle.budget.v1";
  subjects: Record<string, BudgetEntry[]>;
}

/** Per-subject rolling spend, in-memory or file-backed (durable so a restart can't reset a quota). */
export class BudgetGovernor {
  private mem: Map<string, BudgetEntry[]> | null;

  constructor(private readonly file: string | null) {
    this.mem = file ? null : new Map();
  }

  static memory(): BudgetGovernor {
    return new BudgetGovernor(null);
  }

  private read(): Map<string, BudgetEntry[]> {
    if (this.mem) return this.mem;
    if (existsSync(this.file!)) {
      try {
        const parsed = JSON.parse(readFileSync(this.file!, "utf8")) as Partial<BudgetFile>;
        return new Map(Object.entries(parsed.subjects ?? {}));
      } catch {
        /* corrupt => start clean */
      }
    }
    return new Map();
  }

  private persist(map: Map<string, BudgetEntry[]>): void {
    if (this.mem) { this.mem = map; return; }
    mkdirSync(path.dirname(path.resolve(this.file!)), { recursive: true });
    const payload: BudgetFile = { version: "aristotle.budget.v1", subjects: Object.fromEntries(map) };
    writeFileSync(this.file!, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  /** Would admitting `cost` for `subject` stay within `policy`? Does not mutate state. */
  check(subject: string, policy: BudgetPolicy, now: number, cost: number): BudgetCheck {
    return checkBudget(policy, this.read().get(subject) ?? [], now, cost);
  }

  /** Record an admitted action's spend, pruning entries older than the window. */
  record(subject: string, cost: number, now: number, windowMs: number): void {
    const map = this.read();
    const windowStart = now - windowMs;
    const next = [...(map.get(subject) ?? []).filter((e) => e.at >= windowStart), { at: now, cost }];
    map.set(subject, next);
    this.persist(map);
  }

  /** Current windowed spend snapshot for a subject (for /metrics or display). */
  spent(subject: string, windowMs: number, now: number): { calls: number; cost: number } {
    const windowStart = now - windowMs;
    const inWindow = (this.read().get(subject) ?? []).filter((e) => e.at >= windowStart);
    return { calls: inWindow.length, cost: inWindow.reduce((acc, e) => acc + e.cost, 0) };
  }
}
