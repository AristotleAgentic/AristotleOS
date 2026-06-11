import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { type DegradationCondition } from "./fail-mode.js";
import { type EdgeContainmentTracker } from "./edge-containment.js";

/**
 * Real degradation detectors for the per-Ward fail-mode policy (B3).
 *
 * `fail-mode.ts` is the *policy*: given degradation conditions, what does a Ward of
 * a given criticality do? This module is the *sensing* — composable probes that
 * actually detect the conditions, so the boundary is self-driving rather than fed
 * conditions by hand. The probes are deliberately cheap and synchronous (the gate
 * hot path is synchronous); an async dependency check is provided via `runWithTimeout`
 * for callers that fold its result into a probe.
 *
 * Each probe returns the condition it detects, or `null` when healthy.
 */

export type DegradationProbe = () => DegradationCondition | null;

/**
 * True when the ledger's directory accepts a write. A real canary: create the dir
 * if needed, write a tiny unique file, then remove it. Any failure ⇒ not writable,
 * which the boundary treats as `ledger_unavailable` (no evidence ⇒ no irreversible
 * action). Cheap enough for the request path; for very hot paths cache the result.
 */
export function probeLedgerWritable(ledgerPath: string): boolean {
  const dir = path.dirname(path.resolve(ledgerPath));
  const canary = path.join(dir, `.aos-canary-${randomUUID()}`);
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(canary, "ok", "utf8");
    return true;
  } catch {
    return false;
  } finally {
    try { if (existsSync(canary)) rmSync(canary); } catch { /* best effort */ }
  }
}

/** Probe: reports `ledger_unavailable` when the ledger directory is not writable. */
export function ledgerUnavailableProbe(ledgerPath: string): DegradationProbe {
  return () => (probeLedgerWritable(ledgerPath) ? null : "ledger_unavailable");
}

/**
 * Probe: reports `control_plane_stale` when an edge node has not refreshed
 * control-plane state (revocations/time) within budget. Reuses the DDIL
 * containment tracker (B2) so the two controls share one freshness anchor.
 */
export function controlPlaneStaleProbe(tracker: EdgeContainmentTracker, now?: string): DegradationProbe {
  return () => {
    const check = tracker.check(now);
    return !check.ok && check.reason === "REVOCATION_STALE" ? "control_plane_stale" : null;
  };
}

/** A probe wrapping a caller-supplied health predicate (true = healthy). */
export function predicateProbe(condition: DegradationCondition, healthy: () => boolean): DegradationProbe {
  return () => {
    try {
      return healthy() ? null : condition;
    } catch {
      return condition; // a throwing health check is, itself, a degradation signal
    }
  };
}

export interface TimeoutResult<T> {
  timedOut: boolean;
  value?: T;
  error?: unknown;
}

/**
 * Run an async dependency check with a hard timeout. Callers fold the result into a
 * `dependency_timeout` (or `quorum_lost`) condition: e.g. probe a durable ledger /
 * control-plane heartbeat and, if `timedOut`, raise the condition. Kept off the
 * synchronous gate path; run it on a monitor interval and cache the latest verdict.
 */
export async function runWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<TimeoutResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<TimeoutResult<T>>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
  });
  try {
    const value = await Promise.race([fn().then((v) => ({ timedOut: false, value: v })).catch((error) => ({ timedOut: false, error })), timeout]);
    return value;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Run all probes and return the de-duplicated set of detected conditions. */
export function collectDegradation(probes: DegradationProbe[]): DegradationCondition[] {
  const seen = new Set<DegradationCondition>();
  for (const probe of probes) {
    let result: DegradationCondition | null = null;
    try {
      result = probe();
    } catch {
      // A probe that throws cannot vouch for health — fail safe by treating the
      // dependency it watches as degraded is the caller's call; here we skip it and
      // let other probes report. (Use predicateProbe to convert a throw to a signal.)
      result = null;
    }
    if (result) seen.add(result);
  }
  return [...seen];
}
