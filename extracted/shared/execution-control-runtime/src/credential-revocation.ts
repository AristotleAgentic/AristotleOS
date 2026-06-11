import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface CredentialRevocationEntry {
  credential_ref: string;
  revoked_at: string;
  reason: string;
  source: "ward-marshal" | "operator" | "import";
  warrant_id?: string;
  gel_record_id?: string;
  finding_id?: string;
  evidence_hash?: string;
}

export interface CredentialRevocationList {
  list_version: "aristotle.credential-revocations.v1";
  revoked_credentials: CredentialRevocationEntry[];
}

export const EMPTY_CREDENTIAL_REVOCATION_LIST: CredentialRevocationList = {
  list_version: "aristotle.credential-revocations.v1",
  revoked_credentials: []
};

export function loadCredentialRevocations(file?: string): CredentialRevocationList {
  if (!file || !existsSync(file)) return { ...EMPTY_CREDENTIAL_REVOCATION_LIST, revoked_credentials: [] };
  const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<CredentialRevocationList>;
  return {
    list_version: "aristotle.credential-revocations.v1",
    revoked_credentials: Array.isArray(raw.revoked_credentials) ? raw.revoked_credentials as CredentialRevocationEntry[] : []
  };
}

export function saveCredentialRevocations(file: string, list: CredentialRevocationList): void {
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const normalized = {
    list_version: "aristotle.credential-revocations.v1" as const,
    revoked_credentials: [...list.revoked_credentials].sort((left, right) => left.credential_ref.localeCompare(right.credential_ref))
  };
  writeFileSync(file, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}

export function addCredentialRevocation(file: string, entry: CredentialRevocationEntry): CredentialRevocationList {
  const list = loadCredentialRevocations(file);
  const existing = list.revoked_credentials.find((item) => item.credential_ref === entry.credential_ref);
  if (existing) {
    Object.assign(existing, {
      reason: entry.reason || existing.reason,
      source: entry.source,
      warrant_id: entry.warrant_id ?? existing.warrant_id,
      gel_record_id: entry.gel_record_id ?? existing.gel_record_id,
      finding_id: entry.finding_id ?? existing.finding_id,
      evidence_hash: entry.evidence_hash ?? existing.evidence_hash
    });
  } else {
    list.revoked_credentials.push(entry);
  }
  saveCredentialRevocations(file, list);
  return loadCredentialRevocations(file);
}

export function credentialRevocationReason(list: CredentialRevocationList | undefined, credentialRef: string): CredentialRevocationEntry | undefined {
  return list?.revoked_credentials.find((entry) => entry.credential_ref === credentialRef);
}
