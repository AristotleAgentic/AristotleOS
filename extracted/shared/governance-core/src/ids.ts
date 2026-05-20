import { randomUUID } from "node:crypto";

/** Stable id helper: "<prefix>_<uuid>". */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function isoPlusSeconds(base: Date | string, seconds: number): string {
  const t = typeof base === "string" ? Date.parse(base) : base.getTime();
  return new Date(t + seconds * 1000).toISOString();
}
