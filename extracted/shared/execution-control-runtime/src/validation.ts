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
      for (const numKey of [
        "max_altitude_m",
        "battery_minimum_pct",
        "max_speed_mps",
        "min_map_confidence",
        "min_localization_confidence",
        "min_perception_confidence"
      ]) {
        const v = value.physical_bounds[numKey];
        if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v))) {
          issues.push({ path: `ward.physical_bounds.${numKey}`, message: "must be a finite number when present" });
        }
      }
      for (const strKey of ["permitted_boundary_id", "permitted_odd_id"]) {
        const v = value.physical_bounds[strKey];
        if (v !== undefined && (typeof v !== "string" || v.trim() === "")) {
          issues.push({ path: `ward.physical_bounds.${strKey}`, message: "must be a non-empty string when present" });
        }
      }
      for (const arrKey of ["permitted_road_classes", "permitted_drive_states"]) {
        const v = value.physical_bounds[arrKey];
        if (v !== undefined && (!Array.isArray(v) || !v.every((item) => typeof item === "string" && item.trim() !== ""))) {
          issues.push({ path: `ward.physical_bounds.${arrKey}`, message: "must be an array of non-empty strings when present" });
        }
      }
      const mrc = value.physical_bounds.require_mrc_available;
      if (mrc !== undefined && typeof mrc !== "boolean") {
        issues.push({ path: "ward.physical_bounds.require_mrc_available", message: "must be a boolean when present" });
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
