#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const failures = [];
const warnings = [];

const allowedServerRoutes = new Set([
  "/github",
  "/ui-prototype/",
  "/thank-you/",
  "/healthz",
  "/readyz",
  "/robots.txt",
  "/sitemap.xml",
  "/security.txt",
  "/.well-known/security.txt",
  "/api/inquiries",
  "/api/inquiries.csv",
  "/api/inquiries/summary",
  "/admin/",
  "/admin/login",
  "/admin/logout"
]);

const allowedSchemes = /^[a-z][a-z0-9+.-]*:/i;
const blockedPublicRefs = /\.(?:env|mjs|cjs|ts|tsx|jsx|map|ps1|bat|cmd|docx|doc|xlsx|pptx|toml|lock|log)(?:[?#]|$)/i;
const placeholderPatterns = [
  /\bTODO\b/i,
  /\blorem ipsum\b/i,
  /\bplaceholder\b/i,
  /\bcoming soon\b/i,
  /\bTBD\b/i,
  /C:\\/i,
  /file:\/\//i
];

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

function walk(dir, predicate, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".data" || entry.name === ".git" || entry.name === "dist") continue;
    const target = join(dir, entry.name);
    if (entry.isDirectory()) walk(target, predicate, files);
    else if (predicate(target)) files.push(target);
  }
  return files;
}

function localPathFromUrl(rawUrl, sourceFile) {
  if (!rawUrl || rawUrl.startsWith("#") || allowedSchemes.test(rawUrl)) return null;
  if (rawUrl.startsWith("//")) return null;
  const decodedEntities = rawUrl.replaceAll("&amp;", "&");
  const withoutFragment = decodedEntities.split("#")[0];
  const withoutQuery = withoutFragment.split("?")[0];
  if (!withoutQuery) return null;
  if (withoutQuery.startsWith("/")) return posix.normalize(withoutQuery);
  const sourceRouteDir = dirname(`/${relative(appDir, sourceFile).replaceAll("\\", "/")}`);
  return posix.normalize(posix.join(sourceRouteDir, withoutQuery));
}

function targetExists(pathname) {
  if (allowedServerRoutes.has(pathname)) return true;
  const decoded = decodeURIComponent(pathname);
  const clean = decoded.startsWith("/") ? decoded.slice(1) : decoded;
  const resolved = resolve(appDir, clean);
  if (!resolved.startsWith(appDir + sep) && resolved !== appDir) return false;
  if (existsSync(resolved) && statSync(resolved).isFile()) return true;
  if (existsSync(resolved) && statSync(resolved).isDirectory() && existsSync(join(resolved, "index.html"))) return true;
  if (pathname.endsWith("/") && existsSync(resolve(appDir, clean, "index.html"))) return true;
  return false;
}

function extractAttrs(html, attr) {
  const matches = [];
  const re = new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, "gi");
  for (const match of html.matchAll(re)) matches.push(match[1]);
  return matches;
}

function hasHomeLink(html, relFile) {
  if (relFile === "index.html") return true;
  return /href=["']\/["']/.test(html) || /href=["']\.\.\/["']/.test(html) || /href=["']\/#/.test(html);
}

const htmlFiles = walk(appDir, (file) => extname(file).toLowerCase() === ".html");
const publicHtmlFiles = htmlFiles.filter((file) => !relative(appDir, file).startsWith(`admin${sep}`));

for (const file of publicHtmlFiles) {
  const relFile = relative(appDir, file).replaceAll("\\", "/");
  const html = readFileSync(file, "utf8");

  if (!/<html\s+[^>]*lang=["']en["']/i.test(html)) fail(`${relFile}: missing html lang="en"`);
  if (!/<meta\s+[^>]*name=["']viewport["']/i.test(html)) fail(`${relFile}: missing viewport meta tag`);
  if (!/<title>[^<]{10,}<\/title>/i.test(html)) fail(`${relFile}: missing useful title`);
  if (!/<meta\s+[^>]*name=["']description["'][^>]*content=["'][^"']{40,}["']/i.test(html)) fail(`${relFile}: missing useful meta description`);
  if (!/<link\s+[^>]*rel=["']canonical["']/i.test(html)) warn(`${relFile}: missing canonical link`);
  if (!hasHomeLink(html, relFile)) fail(`${relFile}: missing link back to Aristotle Agentic home`);

  for (const pattern of placeholderPatterns) {
    if (pattern.test(html)) fail(`${relFile}: contains launch-placeholder/local-only text matching ${pattern}`);
  }

  for (const attr of ["href", "src", "action"]) {
    for (const raw of extractAttrs(html, attr)) {
      if (blockedPublicRefs.test(raw) && !raw.includes("github.com")) fail(`${relFile}: public ${attr} references non-web artifact ${raw}`);
      const localPath = localPathFromUrl(raw, file);
      if (!localPath) continue;
      if (!targetExists(localPath)) fail(`${relFile}: broken local ${attr} ${raw}`);
    }
  }
}

const pdfFiles = walk(resolve(appDir, "papers", "files"), (file) => extname(file).toLowerCase() === ".pdf");
for (const pdf of pdfFiles) {
  const relPdf = `/${relative(appDir, pdf).replaceAll("\\", "/")}`;
  const references = publicHtmlFiles.filter((file) => readFileSync(file, "utf8").includes(relPdf));
  if (references.length === 0) warn(`${relPdf}: PDF exists but is not referenced by public HTML`);
  if (statSync(pdf).size < 50_000) warn(`${relPdf}: PDF is unusually small; verify it is the intended publication`);
}

for (const message of warnings) console.warn(`warning: ${message}`);
if (failures.length > 0) {
  for (const message of failures) console.error(`error: ${message}`);
  process.exit(1);
}

console.log(`site audit passed (${publicHtmlFiles.length} pages, ${pdfFiles.length} PDFs)`);
