import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * DDIL / captured-edge containment.
 *
 * Defense-review finding 2.5: a disconnected edge node governs itself with a local
 * signing key — which makes that key the node's single point of compromise. Two
 * controls bound the blast radius of a captured or long-partitioned node:
 *
 *   1. **Default-deny on staleness** — if the node has not refreshed control-plane
 *      state (revocations/time) within `maxRevocationStalenessMs`, it fails closed.
 *      A node that can't hear "you're revoked" stops issuing authority.
 *   2. **Offline warrant quota** — a node may issue at most `offlineWarrantQuota`
 *      Warrants between successful control-plane syncs; beyond that it requires a
 *      resync. A captured node cannot mint unlimited authority while dark.
 *
 * Both default to **fail-closed**: a node that has never synced (epoch lastSyncAt) is
 * stale. This is a composable precondition the boundary checks before issuing — it
 * does not replace the gate; it gates the gate. Residual: the edge signing key should
 * be hardware-rooted (TPM) so the key itself can't be exfiltrated (Tier C).
 */

export interface EdgeContainmentPolicy {
  /** Max age (ms) of the last successful control-plane sync before failing closed. */
  maxRevocationStalenessMs?: number;
  /** Max Warrants issued between syncs before requiring a resync. */
  offlineWarrantQuota?: number;
}

export interface EdgeContainmentState {
  /** ISO time of the last successful control-plane sync (revocation/time refresh). */
  lastSyncAt: string;
  offlineWarrantsIssued: number;
}

export type EdgeContainmentCheck =
  | { ok: true }
  | { ok: false; reason: "REVOCATION_STALE" | "OFFLINE_QUOTA_EXCEEDED"; detail: string };

/** Pure check of a node's containment state against a policy. */
export function checkEdgeContainment(policy: EdgeContainmentPolicy, state: EdgeContainmentState, now: string = new Date().toISOString()): EdgeContainmentCheck {
  if (policy.maxRevocationStalenessMs !== undefined) {
    const age = Date.parse(now) - Date.parse(state.lastSyncAt);
    if (!Number.isFinite(age) || age > policy.maxRevocationStalenessMs) {
      return { ok: false, reason: "REVOCATION_STALE", detail: `last control-plane sync ${Number.isFinite(age) ? `${age}ms` : "unknown"} ago exceeds ${policy.maxRevocationStalenessMs}ms — failing closed` };
    }
  }
  if (policy.offlineWarrantQuota !== undefined && state.offlineWarrantsIssued >= policy.offlineWarrantQuota) {
    return { ok: false, reason: "OFFLINE_QUOTA_EXCEEDED", detail: `${state.offlineWarrantsIssued} Warrants issued since last sync >= quota ${policy.offlineWarrantQuota} — requires resync` };
  }
  return { ok: true };
}

const EPOCH = new Date(0).toISOString();

/**
 * File-backed containment state for an edge node. State persists across restarts, so
 * a captured node cannot reset its quota by bouncing the process. Call `recordSync`
 * on a successful control-plane refresh, `recordWarrantIssued` on each issuance, and
 * `check` before issuing.
 */
export class EdgeContainmentTracker {
  constructor(private readonly file: string, private readonly policy: EdgeContainmentPolicy) {}

  state(): EdgeContainmentState {
    if (existsSync(this.file)) {
      try {
        const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Partial<EdgeContainmentState>;
        return { lastSyncAt: parsed.lastSyncAt ?? EPOCH, offlineWarrantsIssued: parsed.offlineWarrantsIssued ?? 0 };
      } catch {
        /* corrupt state => treat as never-synced (fail closed) */
      }
    }
    return { lastSyncAt: EPOCH, offlineWarrantsIssued: 0 };
  }

  private write(state: EdgeContainmentState): EdgeContainmentState {
    mkdirSync(path.dirname(path.resolve(this.file)), { recursive: true });
    writeFileSync(this.file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    return state;
  }

  /** A successful control-plane sync: refresh the freshness anchor and reset the offline window. */
  recordSync(now: string = new Date().toISOString()): EdgeContainmentState {
    return this.write({ lastSyncAt: now, offlineWarrantsIssued: 0 });
  }

  /** Count a Warrant issued from the edge. */
  recordWarrantIssued(): EdgeContainmentState {
    const state = this.state();
    return this.write({ ...state, offlineWarrantsIssued: state.offlineWarrantsIssued + 1 });
  }

  check(now: string = new Date().toISOString()): EdgeContainmentCheck {
    return checkEdgeContainment(this.policy, this.state(), now);
  }
}
