import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Revocation for AristotleOS trust roots. A compromised signing key, a withdrawn
 * Authority Envelope, or a specific bad Warrant can be revoked; the boundary then
 * refuses to issue against it and verifiers reject anything bound to it.
 *
 * File-backed so a running boundary honors revocations live (re-read per request),
 * the same way the kill switch works.
 */
export interface RevocationList {
  revoked_key_ids: string[];
  revoked_envelope_ids: string[];
  revoked_warrant_ids: string[];
}

export const EMPTY_REVOCATION_LIST: RevocationList = {
  revoked_key_ids: [],
  revoked_envelope_ids: [],
  revoked_warrant_ids: []
};

export type RevocationKind = "key" | "envelope" | "warrant";

const FIELD_BY_KIND: Record<RevocationKind, keyof RevocationList> = {
  key: "revoked_key_ids",
  envelope: "revoked_envelope_ids",
  warrant: "revoked_warrant_ids"
};

export function loadRevocationList(file?: string): RevocationList {
  if (!file || !existsSync(file)) return { ...EMPTY_REVOCATION_LIST, revoked_key_ids: [], revoked_envelope_ids: [], revoked_warrant_ids: [] };
  const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<RevocationList>;
  return {
    revoked_key_ids: Array.isArray(raw.revoked_key_ids) ? raw.revoked_key_ids : [],
    revoked_envelope_ids: Array.isArray(raw.revoked_envelope_ids) ? raw.revoked_envelope_ids : [],
    revoked_warrant_ids: Array.isArray(raw.revoked_warrant_ids) ? raw.revoked_warrant_ids : []
  };
}

export function saveRevocationList(file: string, list: RevocationList): void {
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  writeFileSync(file, `${JSON.stringify(list, null, 2)}\n`, "utf8");
}

/** Add an id to the revocation file (idempotent). Returns the updated list. */
export function addRevocation(file: string, kind: RevocationKind, id: string): RevocationList {
  const list = loadRevocationList(file);
  const field = FIELD_BY_KIND[kind];
  if (!list[field].includes(id)) list[field] = [...list[field], id];
  saveRevocationList(file, list);
  return list;
}

export interface RevocationTarget {
  signing_key_id?: string;
  authority_envelope_id?: string;
  warrant_id?: string;
}

/** Returns the reason a target is revoked, or undefined when it is not revoked. */
export function revocationReason(list: RevocationList, target: RevocationTarget): "REVOKED_KEY" | "REVOKED_ENVELOPE" | "REVOKED_WARRANT" | undefined {
  if (target.warrant_id && list.revoked_warrant_ids.includes(target.warrant_id)) return "REVOKED_WARRANT";
  if (target.signing_key_id && list.revoked_key_ids.includes(target.signing_key_id)) return "REVOKED_KEY";
  if (target.authority_envelope_id && list.revoked_envelope_ids.includes(target.authority_envelope_id)) return "REVOKED_ENVELOPE";
  return undefined;
}
