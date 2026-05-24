import { gatewayContract } from "../gateway-contract.js";
import type { SystemSnapshot } from "./types.js";

/**
 * Thin service layer over the AristotleOS gateway. Each call attempts the real
 * `/operator` / `/health` endpoint and resolves to `null` on any failure, so the
 * store can fall back to mock data. This is the seam to wire real services.
 */
async function getJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  try {
    const res = await fetch(url, { signal, headers: { accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export interface GatewayHealth {
  ok?: boolean;
  posture?: string;
  mode?: string;
  killSwitchArmed?: boolean;
}

export interface ChainMetrics {
  height?: number;
  intact?: boolean;
  warrantsToday?: number;
  refusalsToday?: number;
  gateLatencyMs?: number;
}

/** Probe the gateway; returns a partial snapshot when reachable, else null. */
export async function probeGateway(signal?: AbortSignal): Promise<Partial<SystemSnapshot> | null> {
  const health = await getJson<GatewayHealth>(gatewayContract.health, signal);
  if (!health) return null;
  const metrics = await getJson<ChainMetrics>(gatewayContract.governanceChainMetrics, signal);
  const snapshot: Partial<SystemSnapshot> = { source: "live" };
  if (typeof health.killSwitchArmed === "boolean") snapshot.killSwitchArmed = health.killSwitchArmed;
  if (metrics) {
    if (typeof metrics.height === "number") snapshot.ledgerHeight = metrics.height;
    if (typeof metrics.intact === "boolean") snapshot.ledgerIntact = metrics.intact;
    if (typeof metrics.warrantsToday === "number") snapshot.warrantsToday = metrics.warrantsToday;
    if (typeof metrics.refusalsToday === "number") snapshot.refusalsToday = metrics.refusalsToday;
    if (typeof metrics.gateLatencyMs === "number") snapshot.gateLatencyMs = metrics.gateLatencyMs;
  }
  return snapshot;
}

/** Post an operator command to the gateway (best-effort; returns ok flag). */
export async function postOperator(path: string, body: unknown): Promise<boolean> {
  try {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return res.ok;
  } catch {
    return false;
  }
}

export { gatewayContract };
