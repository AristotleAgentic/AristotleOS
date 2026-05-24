// Blocking dependency-audit gate for the AristotleOS workspace.
//
// Supply-chain finding (A4): the CI dependency audit was informational
// (continue-on-error). This makes it a *gate*: any production-dependency advisory
// at or above the fail threshold (default high+critical) fails the build, unless
// it is explicitly triaged in .audit-allowlist.json with a reason and an expiry.
// Expired allowlist entries are themselves treated as failures, so a temporary
// exception cannot silently become permanent.
//
// Usage:
//   node scripts/audit-deps.mjs                 # run `pnpm audit --prod --json`
//   node scripts/audit-deps.mjs --input a.json  # evaluate a saved audit report
//   node scripts/audit-deps.mjs --fail-on critical
//
// The allowlist (.audit-allowlist.json at the repo root) is an array of:
//   { "id": "GHSA-xxxx" | 1234567, "reason": "...", "expires": "2026-12-31" }
//
// Exit code 0 = clean (or fully triaged); 1 = blocking advisories / expired
// exceptions / the audit could not be produced.

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SEVERITY_RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

/**
 * Normalize a `pnpm audit --json` / `npm audit --json` report into a flat list of
 * advisories. Handles both the v6-style `advisories` map and the v7+ `vulnerabilities`
 * map. Returns [{ key, ids, severity, module, title, url }].
 */
export function parseAuditReport(report) {
  if (!report || typeof report !== "object") return [];
  const out = [];

  // v6 / pnpm style: { advisories: { "<id>": { id, github_advisory_id, severity, module_name, title, url } } }
  if (report.advisories && typeof report.advisories === "object") {
    for (const adv of Object.values(report.advisories)) {
      if (!adv || typeof adv !== "object") continue;
      const ids = [adv.github_advisory_id, adv.id, adv.cve].filter((v) => v !== undefined && v !== null).map(String);
      out.push({
        key: String(adv.github_advisory_id ?? adv.id ?? adv.module_name ?? "unknown"),
        ids,
        severity: String(adv.severity ?? "info").toLowerCase(),
        module: adv.module_name ?? "(unknown)",
        title: adv.title ?? "",
        url: adv.url ?? ""
      });
    }
    return out;
  }

  // v7+ style: { vulnerabilities: { "<pkg>": { severity, via: [{ source, name, url, title }] } } }
  if (report.vulnerabilities && typeof report.vulnerabilities === "object") {
    for (const [pkg, vuln] of Object.entries(report.vulnerabilities)) {
      if (!vuln || typeof vuln !== "object") continue;
      const vias = Array.isArray(vuln.via) ? vuln.via.filter((v) => typeof v === "object") : [];
      const ids = vias.flatMap((v) => [v.source, v.url].filter(Boolean).map(String));
      out.push({
        key: pkg,
        ids: ids.length ? ids : [pkg],
        severity: String(vuln.severity ?? "info").toLowerCase(),
        module: pkg,
        title: vias.map((v) => v.title).filter(Boolean).join("; "),
        url: vias.map((v) => v.url).filter(Boolean)[0] ?? ""
      });
    }
    return out;
  }

  return out;
}

/** True when any of the advisory's identifiers matches an allowlist entry id. */
function matchesAllowlist(advisory, entry) {
  const wanted = String(entry.id ?? "").toLowerCase();
  if (!wanted) return false;
  return advisory.ids.some((id) => String(id).toLowerCase() === wanted) || String(advisory.key).toLowerCase() === wanted;
}

/**
 * Pure evaluation: classify advisories against the fail threshold and the triage
 * allowlist. Returns { ok, blocking, allowlisted, expired } where `ok` is true only
 * when there are no blocking advisories and no expired allowlist exceptions.
 */
export function evaluateAudit({ advisories = [], allowlist = [], failOn = "high", now = new Date() } = {}) {
  const threshold = SEVERITY_RANK[failOn] ?? SEVERITY_RANK.high;
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();

  const blocking = [];
  const allowlisted = [];
  const expired = [];

  for (const adv of advisories) {
    const rank = SEVERITY_RANK[adv.severity] ?? 0;
    if (rank < threshold) continue; // below the gate threshold — informational only

    const entry = allowlist.find((e) => matchesAllowlist(adv, e));
    if (!entry) {
      blocking.push(adv);
      continue;
    }
    // Triaged — but honor the expiry so exceptions can't become permanent.
    const expMs = entry.expires ? new Date(entry.expires).getTime() : NaN;
    if (Number.isFinite(expMs) && expMs < nowMs) {
      expired.push({ ...adv, expires: entry.expires, reason: entry.reason });
    } else {
      allowlisted.push({ ...adv, reason: entry.reason, expires: entry.expires ?? null });
    }
  }

  return { ok: blocking.length === 0 && expired.length === 0, blocking, allowlisted, expired };
}

// --- CLI --------------------------------------------------------------------

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function loadAuditJson(root, inputPath) {
  if (inputPath) {
    return JSON.parse(readFileSync(path.resolve(inputPath), "utf8"));
  }
  // pnpm audit exits non-zero when advisories exist; capture stdout regardless.
  try {
    const raw = execSync("corepack pnpm audit --prod --json", { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return JSON.parse(raw);
  } catch (error) {
    const stdout = error?.stdout?.toString?.() ?? "";
    if (stdout.trim().startsWith("{")) {
      try { return JSON.parse(stdout); } catch { /* fall through */ }
    }
    throw new Error(`could not produce an audit report (no network or pnpm error): ${error?.message ?? error}`);
  }
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const failOn = arg("--fail-on") ?? "high";
  const inputPath = arg("--input");

  const allowlistPath = path.join(root, ".audit-allowlist.json");
  let allowlist = [];
  if (existsSync(allowlistPath)) {
    try {
      const parsed = JSON.parse(readFileSync(allowlistPath, "utf8"));
      allowlist = Array.isArray(parsed) ? parsed : Array.isArray(parsed.allow) ? parsed.allow : [];
    } catch (error) {
      console.error(`✗ .audit-allowlist.json is not valid JSON: ${error?.message ?? error}`);
      process.exit(1);
    }
  }

  let report;
  try {
    report = loadAuditJson(root, inputPath);
  } catch (error) {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  }

  const advisories = parseAuditReport(report);
  const result = evaluateAudit({ advisories, allowlist, failOn });

  console.log(`Dependency audit — ${advisories.length} advisory record(s); fail threshold: ${failOn}+`);
  if (result.allowlisted.length) {
    console.log(`  triaged (allowlisted): ${result.allowlisted.length}`);
    for (const a of result.allowlisted) console.log(`    · ${a.severity.toUpperCase()} ${a.module} ${a.key} — ${a.reason ?? "no reason"} (expires ${a.expires ?? "never"})`);
  }
  if (result.expired.length) {
    console.error(`  EXPIRED exceptions (now blocking): ${result.expired.length}`);
    for (const a of result.expired) console.error(`    · ${a.severity.toUpperCase()} ${a.module} ${a.key} — exception expired ${a.expires}`);
  }
  if (result.blocking.length) {
    console.error(`  BLOCKING: ${result.blocking.length}`);
    for (const a of result.blocking) console.error(`    · ${a.severity.toUpperCase()} ${a.module} ${a.key} — ${a.title} ${a.url}`);
  }

  if (!result.ok) {
    console.error("\n✗ dependency audit failed. Fix the dependency, or triage it in .audit-allowlist.json with a reason and expiry.");
    process.exit(1);
  }
  console.log("\n✓ no blocking production advisories.");
}

// Run only when invoked directly (not when imported by the test).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
