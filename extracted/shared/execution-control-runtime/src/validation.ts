/**
 * Fail-fast structural validation for AristotleOS configuration. A malformed Ward
 * Manifest or Authority Envelope should be rejected at load with a clear,
 * actionable message instead of producing a cryptic failure deep in the gate.
 */

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(obj: Record<string, unknown>, key: string, issues: ValidationIssue[], where: string): void {
  const value = obj[key];
  if (typeof value !== "string" || value.trim() === "") {
    issues.push({ path: `${where}.${key}`, message: `must be a non-empty string` });
  }
}

function requireStringArray(obj: Record<string, unknown>, key: string, issues: ValidationIssue[], where: string, opts: { nonEmpty?: boolean } = {}): void {
  const value = obj[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    issues.push({ path: `${where}.${key}`, message: `must be an array of strings` });
    return;
  }
  if (opts.nonEmpty && value.length === 0) {
    issues.push({ path: `${where}.${key}`, message: `must not be empty` });
  }
}

export function validateWardManifest(value: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) return { ok: false, issues: [{ path: "ward", message: "must be an object" }] };
  requireString(value, "ward_id", issues, "ward");
  requireString(value, "name", issues, "ward");
  requireString(value, "sovereignty_context", issues, "ward");
  requireString(value, "authority_domain", issues, "ward");
  requireString(value, "policy_version", issues, "ward");
  requireStringArray(value, "permitted_subjects", issues, "ward", { nonEmpty: true });
  if (value.physical_bounds !== undefined) {
    if (!isRecord(value.physical_bounds)) {
      issues.push({ path: "ward.physical_bounds", message: "must be an object when present" });
    } else {
      for (const numKey of ["max_altitude_m", "battery_minimum_pct"]) {
        const v = value.physical_bounds[numKey];
        if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v))) {
          issues.push({ path: `ward.physical_bounds.${numKey}`, message: "must be a finite number when present" });
        }
      }
    }
  }
  return { ok: issues.length === 0, issues };
}

export function validateAuthorityEnvelope(value: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) return { ok: false, issues: [{ path: "envelope", message: "must be an object" }] };
  requireString(value, "envelope_id", issues, "envelope");
  requireString(value, "ward_id", issues, "envelope");
  requireString(value, "subject", issues, "envelope");
  requireString(value, "issuer", issues, "envelope");
  requireStringArray(value, "allowed_actions", issues, "envelope");
  requireStringArray(value, "denied_actions", issues, "envelope");
  if (value.constraints !== undefined && !isRecord(value.constraints)) {
    issues.push({ path: "envelope.constraints", message: "must be an object when present" });
  }
  const expires = value.expires_at;
  if (typeof expires !== "string" || Number.isNaN(Date.parse(expires))) {
    issues.push({ path: "envelope.expires_at", message: "must be an ISO-8601 date-time string" });
  }
  return { ok: issues.length === 0, issues };
}

export function formatValidationIssues(kind: string, result: ValidationResult): string {
  return `${kind} is invalid:\n${result.issues.map((issue) => `  - ${issue.path}: ${issue.message}`).join("\n")}`;
}

export function assertValidWardManifest(value: unknown): void {
  const result = validateWardManifest(value);
  if (!result.ok) throw new Error(formatValidationIssues("Ward Manifest", result));
}

export function assertValidAuthorityEnvelope(value: unknown): void {
  const result = validateAuthorityEnvelope(value);
  if (!result.ok) throw new Error(formatValidationIssues("Authority Envelope", result));
}
