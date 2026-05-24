// Clean-room scan (enforces CLEAN_ROOM_NOTES.md).
//
// Hard-fails CI when unambiguous third-party (Faramesh) markers appear anywhere
// outside the curated set of disclaimer documents — so no source, test, example,
// schema, manifest, or doc can quietly introduce vendor material. PERMIT/DENY/
// DEFER are reported as advisory only: the legacy trial-engine uses them
// legitimately, while new execution-control work uses ALLOW/REFUSE/ESCALATE.
//
//   node scripts/clean-room-scan.mjs        (npm run clean-room)
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Files permitted to mention Faramesh — only as the clean-room disclaimer / public
// category reference required by CLEAN_ROOM_NOTES.md.
const ALLOWLIST = new Set([
  "CLEAN_ROOM_NOTES.md",
  "README.md",
  "SECURITY.md",
  "docs/THREAT_MODEL.md",
  "docs/AUDIT_SCOPE.md",
  "docs/auditor-guide.md",
  "docs/release-checklist.md",
  "docs/execution-control-runtime.md",
  "scripts/clean-room-scan.mjs"
].map((p) => p.replace(/\//g, path.sep)));

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "coverage", ".tmp", ".aristotle", "backups", "secrets"]);
const TEXT_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".yaml", ".yml", ".txt", ".tpl", ".dockerfile"]);

// Unambiguous Faramesh markers -> hard fail outside the allowlist.
const HARD_PATTERNS = [
  { label: "Faramesh reference", re: /faramesh/i },
  { label: "Faramesh 'fms' marker", re: /\bfms\b/i },
  { label: "Faramesh 'governance.fms'", re: /governance\.fms/i },
  { label: "Faramesh term 'Action Authorization Boundary'", re: /action authorization boundary/i },
  { label: "Faramesh term 'Canonical Action Representation'", re: /canonical action representation/i }
];
// Advisory only (legacy trial-engine uses these; new EC work must not).
const ADVISORY = [/\bPERMIT\b/, /\bDEFER\b/];

function isTextFile(file) {
  const ext = path.extname(file).toLowerCase();
  if (TEXT_EXT.has(ext)) return true;
  return path.basename(file).toLowerCase() === "dockerfile";
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const rel = path.relative(root, full);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) walk(full, files);
    } else if (isTextFile(full)) {
      files.push(rel);
    }
  }
  return files;
}

const violations = [];
let advisoryCount = 0;
let scanned = 0;

for (const rel of walk(root)) {
  const allowed = ALLOWLIST.has(rel);
  let text;
  try { text = readFileSync(path.join(root, rel), "utf8"); } catch { continue; }
  scanned += 1;
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!allowed) {
      for (const { label, re } of HARD_PATTERNS) {
        if (re.test(line)) violations.push({ rel, line: i + 1, label, text: line.trim().slice(0, 120) });
      }
    }
    for (const re of ADVISORY) if (re.test(line)) advisoryCount += 1;
  });
}

console.log(`Clean-room scan — ${scanned} files, ${ALLOWLIST.size} allowlisted disclaimer docs\n`);

if (!existsSync(path.join(root, "CLEAN_ROOM_NOTES.md"))) {
  console.error("FAIL — CLEAN_ROOM_NOTES.md is missing");
  process.exit(1);
}

if (violations.length) {
  console.error("FAIL — vendor (Faramesh) markers found outside the disclaimer allowlist:\n");
  for (const v of violations) console.error(`  ${v.rel}:${v.line}  [${v.label}]  ${v.text}`);
  console.error(`\n${violations.length} violation(s). Replace with AristotleOS-native designs (see CLEAN_ROOM_NOTES.md).`);
  process.exit(1);
}

console.log(`OK — no vendor markers in source/docs/manifests.`);
console.log(advisoryCount ? `  advisory: ${advisoryCount} PERMIT/DEFER occurrence(s) (legacy trial-engine; new execution-control work uses ALLOW/ESCALATE).` : "  advisory: none.");
process.exit(0);
