#!/usr/bin/env node
/**
 * Aristotle Agentic website server.
 *
 * Zero-dependency production-capable Node server:
 * - static routes for /, /training-hub/, /montana-ai-x/, /aristotleos/
 * - security headers
 * - health endpoint
 * - form/API inquiry intake with validation, honeypot, rate limiting
 * - JSONL persistence for later CRM/email integration
 */
import { createServer } from "node:http";
import { accessSync, appendFileSync, constants as fsConstants, createReadStream, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { connect as netConnect } from "node:net";
import { dirname, extname, isAbsolute, normalize, relative, resolve } from "node:path";
import { connect as tlsConnect } from "node:tls";
import { fileURLToPath } from "node:url";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] ?? process.env.PORT ?? 5173);
const host = process.env.HOST ?? "127.0.0.1";
const dataDir = resolve(process.env.ARISTOTLE_WEBSITE_DATA_DIR ?? resolve(here, ".data"));
const inquiryLog = resolve(dataDir, "inquiries.jsonl");
const maxBodyBytes = 64 * 1024;
const rateWindowMs = 10 * 60 * 1000;
const maxSubmissionsPerWindow = 8;
const trustProxy = process.env.TRUST_PROXY === "1";
const storeRawIp = process.env.STORE_RAW_IP === "1";
const publicOrigin = process.env.PUBLIC_ORIGIN ?? "";
const adminToken = process.env.ARISTOTLE_ADMIN_TOKEN ?? "";
const adminSessionHours = Number(process.env.ADMIN_SESSION_HOURS ?? 12);
const uiPrototypeUrl = process.env.UI_PROTOTYPE_URL ?? "https://github.com/AristotleAgentic/AristotleOS/tree/main/extracted/apps/console-ui";
const smtpHost = process.env.SMTP_HOST ?? "";
const smtpPort = Number(process.env.SMTP_PORT ?? 465);
const smtpSecure = process.env.SMTP_SECURE !== "0";
const smtpStartTls = process.env.SMTP_STARTTLS === "1";
const smtpUser = process.env.SMTP_USER ?? "";
const smtpPass = process.env.SMTP_PASS ?? "";
const contactTo = process.env.CONTACT_TO ?? "";
const contactFrom = process.env.CONTACT_FROM ?? smtpUser;
const canonicalHost = (() => {
  try {
    return publicOrigin ? new URL(publicOrigin).host.toLowerCase() : "";
  } catch {
    return "";
  }
})();
const redirectHosts = new Set(
  String(process.env.REDIRECT_HOSTS ?? "aristotleagentic.org,www.aristotleagentic.org,aristotleagentic.com")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
);
const rateBuckets = new Map();
const publicStaticExtensions = new Set([".html", ".css", ".svg", ".png", ".jpg", ".jpeg", ".ico", ".webp", ".pdf", ".txt"]);
const blockedStaticExtensions = new Set([".bak", ".config", ".env", ".log", ".map", ".md", ".mjs", ".old", ".orig", ".ps1", ".sh", ".tmp", ".toml", ".ts", ".tsx", ".yaml", ".yml"]);
const allowedStaticRoots = new Set(["", "about", "admin", "aristotleos", "assets", "governance-thesis", "montana-ai-x", "papers", "privacy", "research", "scripts", "support", "training-hub"]);

function dataStoreReady() {
  try {
    mkdirSync(dataDir, { recursive: true });
    accessSync(dataDir, fsConstants.R_OK | fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function runtimeWarnings() {
  const warnings = [];
  const origin = configuredOrigin();
  if (!origin) warnings.push("PUBLIC_ORIGIN is not set or invalid; generated URLs will use the request Host header.");
  if (origin && !origin.startsWith("https://")) warnings.push("PUBLIC_ORIGIN is not HTTPS; HSTS and secure admin cookies will not be active.");
  if (!adminToken) warnings.push("ARISTOTLE_ADMIN_TOKEN is not set; admin console and exports are disabled.");
  if (adminToken && adminToken.length < 32) warnings.push("ARISTOTLE_ADMIN_TOKEN is shorter than 32 characters.");
  if (!dataStoreReady()) warnings.push(`ARISTOTLE_WEBSITE_DATA_DIR is not writable: ${dataDir}`);
  if (trustProxy && !origin) warnings.push("TRUST_PROXY=1 is set without PUBLIC_ORIGIN; origin checks may not match production expectations.");
  if ((smtpHost || smtpUser || smtpPass || contactTo) && !emailConfigured()) warnings.push("SMTP email notification settings are incomplete.");
  return warnings;
}

if (process.env.REQUIRE_PRODUCTION_CONFIG === "1") {
  const warnings = runtimeWarnings();
  if (warnings.length > 0) {
    console.error("production configuration check failed:");
    for (const warning of warnings) console.error(`- ${warning}`);
    process.exit(78);
  }
}

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8"
};

const baseSecurityHeaders = {
  "content-security-policy": [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self' mailto:",
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'none'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests"
  ].join("; "),
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "origin-agent-cluster": "?1",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "x-permitted-cross-domain-policies": "none",
  "permissions-policy": "accelerometer=(), autoplay=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()"
};

function securityHeaders() {
  return publicOrigin.startsWith("https://")
    ? { ...baseSecurityHeaders, "strict-transport-security": "max-age=31536000; includeSubDomains; preload" }
    : baseSecurityHeaders;
}

function configuredOrigin() {
  if (publicOrigin) {
    try {
      const parsed = new URL(publicOrigin);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") return parsed.origin;
    } catch {
      return "";
    }
  }
  return "";
}

function requestOrigin(req) {
  const configured = configuredOrigin();
  if (configured) return configured;
  const hostHeader = String(req.headers.host ?? "localhost").trim().toLowerCase();
  const safeHost = /^[a-z0-9.-]+(?::\d{1,5})?$/.test(hostHeader) ? hostHeader : "localhost";
  return `http://${safeHost}`;
}

function requestHost(req) {
  const forwardedHost = trustProxy ? String(req.headers["x-forwarded-host"] ?? "").split(",")[0].trim() : "";
  return String(forwardedHost || req.headers.host || "").toLowerCase();
}

function maybeRedirectAlias(req, res, url) {
  if (!canonicalHost) return false;
  const hostHeader = requestHost(req);
  if (!hostHeader || hostHeader === canonicalHost || !redirectHosts.has(hostHeader)) return false;
  const target = new URL(`${url.pathname}${url.search}`, configuredOrigin());
  send(res, 308, "", {
    location: target.href,
    "cache-control": "public, max-age=3600"
  });
  return true;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...securityHeaders(), ...headers });
  res.end(body);
}

function sendStatic(req, res, method, target) {
  const extension = extname(target);
  const stat = statSync(target);
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const downloadPdf = extension === ".pdf" && url.searchParams.get("download") === "1";
  const baseHeaders = {
    "content-type": mime[extension] ?? "application/octet-stream",
    "cache-control": extension === ".html" || extension === ".pdf" ? "no-cache" : "public, max-age=31536000, immutable",
    "content-length": String(stat.size),
    ...(extension === ".pdf" ? { "accept-ranges": "bytes", "content-disposition": downloadPdf ? `attachment; filename="${target.split(/[\\/]/).pop()}"` : "inline" } : {})
  };

  if (method === "HEAD") {
    send(res, 200, "", baseHeaders);
    return;
  }

  if (extension !== ".pdf") {
    send(res, 200, readFileSync(target), baseHeaders);
    return;
  }

  const range = String(req.headers.range ?? "");
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    res.writeHead(200, { ...securityHeaders(), ...baseHeaders });
    createReadStream(target).pipe(res);
    return;
  }

  const startText = match[1];
  const endText = match[2];
  let start = startText ? Number(startText) : 0;
  let end = endText ? Number(endText) : stat.size - 1;
  if (!startText && endText) {
    const suffixLength = Number(endText);
    start = Math.max(stat.size - suffixLength, 0);
    end = stat.size - 1;
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= stat.size) {
    send(res, 416, "", {
      ...baseHeaders,
      "content-length": "0",
      "content-range": `bytes */${stat.size}`
    });
    return;
  }

  end = Math.min(end, stat.size - 1);
  const chunkLength = end - start + 1;
  res.writeHead(206, {
    ...securityHeaders(),
    ...baseHeaders,
    "content-length": String(chunkLength),
    "content-range": `bytes ${start}-${end}/${stat.size}`
  });
  createReadStream(target, { start, end }).pipe(res);
}

function json(res, status, payload) {
  send(res, status, JSON.stringify(payload), {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
}

function htmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookies(req) {
  const header = String(req.headers.cookie ?? "");
  return Object.fromEntries(header.split(";").map((item) => item.trim()).filter(Boolean).map((item) => {
    const index = item.indexOf("=");
    if (index === -1) return [item, ""];
    return [item.slice(0, index), decodeURIComponent(item.slice(index + 1))];
  }));
}

function sign(value) {
  return createHmac("sha256", adminToken).update(value).digest("base64url");
}

function createAdminSession() {
  const expiresAt = Date.now() + adminSessionHours * 60 * 60 * 1000;
  const payload = String(expiresAt);
  return `${payload}.${sign(payload)}`;
}

function validAdminSession(req) {
  if (!adminToken) return false;
  const session = parseCookies(req).aristotle_admin;
  if (!session) return false;
  const [expiresAt, signature] = session.split(".");
  if (!expiresAt || !signature || Number(expiresAt) < Date.now()) return false;
  return safeEqual(signature, sign(expiresAt));
}

function adminCookie(session) {
  const maxAge = Math.max(60, Math.floor(adminSessionHours * 60 * 60));
  const secure = requestIsHttps() ? "; Secure" : "";
  return `aristotle_admin=${encodeURIComponent(session)}; HttpOnly; SameSite=Lax; Path=/admin/; Max-Age=${maxAge}${secure}`;
}

function requestIsHttps() {
  return configuredOrigin().startsWith("https://");
}

function thankYouPage(inquiryType) {
  const label = inquiryType === "training-hub" ? "Aristotle Training Hub" : inquiryType === "montana-ai-x" ? "Montana AI-X" : inquiryType === "aristotleos" ? "AristotleOS" : "Aristotle Agentic";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Thank you - ${htmlEscape(label)}</title>
  <style>
    :root { color-scheme: dark; --bg: #0b1110; --ink: #f6f1e8; --muted: #b9b1a4; --gold: #e9c46a; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: radial-gradient(circle at 70% 20%, rgba(233,196,106,.14), transparent 30%), var(--bg); color: var(--ink); font-family: system-ui, -apple-system, Segoe UI, sans-serif; }
    main { width: min(720px, calc(100% - 40px)); }
    a { color: var(--gold); }
    p { color: var(--muted); font-size: 18px; line-height: 1.55; }
  </style>
</head>
<body>
  <main>
    <p style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--gold);">Inquiry received</p>
    <h1>Thank you.</h1>
    <p>Your ${htmlEscape(label)} inquiry has been recorded. We will follow up using the contact details you provided.</p>
    <p><a href="/">Return to Aristotle Agentic</a></p>
  </main>
</body>
</html>`;
}

function securityTxt(req) {
  const origin = requestOrigin(req);
  return [
    "Contact: mailto:security@aristotleagentic.com",
    "Preferred-Languages: en",
    `Canonical: ${origin}/.well-known/security.txt`,
    `Policy: ${origin}/privacy/`,
    ""
  ].join("\n");
}

function adminLoginPage(error = "") {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Admin - Aristotle Agentic</title>
  <style>
    :root { color-scheme: dark; --bg: #0b1110; --panel: #121c19; --ink: #f6f1e8; --muted: #b9b1a4; --gold: #e9c46a; --line: rgba(246,241,232,.16); }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: radial-gradient(circle at 78% 18%, rgba(233,196,106,.12), transparent 32%), var(--bg); color: var(--ink); font-family: system-ui, -apple-system, Segoe UI, sans-serif; }
    main { width: min(460px, calc(100% - 40px)); border: 1px solid var(--line); border-radius: 10px; background: var(--panel); padding: 28px; }
    h1 { margin: 0 0 10px; font-size: 28px; }
    p { color: var(--muted); line-height: 1.55; }
    label { display: block; margin: 20px 0 8px; color: var(--muted); font-size: 13px; }
    input { width: 100%; min-height: 44px; border: 1px solid var(--line); border-radius: 8px; background: #08100e; color: var(--ink); padding: 0 12px; }
    button { margin-top: 16px; min-height: 44px; border: 0; border-radius: 8px; background: var(--gold); color: #15130d; font-weight: 800; padding: 0 16px; }
    .error { color: #ffb3a7; }
  </style>
</head>
<body>
  <main>
    <h1>Admin console</h1>
    <p>Use the Aristotle website admin token to view inquiries and exports.</p>
    ${error ? `<p class="error">${htmlEscape(error)}</p>` : ""}
    <form action="/admin/login" method="post">
      <label for="token">Admin token</label>
      <input id="token" name="token" type="password" autocomplete="current-password" required />
      <button type="submit">Enter</button>
    </form>
  </main>
</body>
</html>`;
}

function readInquiries(limit = 1000) {
  if (!existsSync(inquiryLog)) return [];
  const lines = readFileSync(inquiryLog, "utf8").trim().split("\n").filter(Boolean);
  return lines.slice(-limit).map((line) => JSON.parse(line));
}

function inquirySummary(inquiries) {
  const byType = {};
  const byTopic = {};
  for (const inquiry of inquiries) {
    byType[inquiry.type || "general"] = (byType[inquiry.type || "general"] ?? 0) + 1;
    const topic = inquiry.topic || "unspecified";
    byTopic[topic] = (byTopic[topic] ?? 0) + 1;
  }
  return {
    total: inquiries.length,
    newsletter: inquiries.filter((item) => item.newsletter).length,
    lastReceivedAt: inquiries.at(-1)?.receivedAt ?? null,
    byType,
    byTopic
  };
}

function adminDashboardPage(inquiries) {
  const summary = inquirySummary(inquiries);
  const recentRows = inquiries.slice(-50).reverse().map((item) => `<tr>
    <td>${htmlEscape(item.receivedAt)}</td>
    <td>${htmlEscape(item.type)}</td>
    <td>${htmlEscape(item.name)}</td>
    <td><a href="mailto:${htmlEscape(item.email)}">${htmlEscape(item.email)}</a></td>
    <td>${htmlEscape(item.organization)}</td>
    <td>${htmlEscape(item.topic)}</td>
    <td>${htmlEscape(item.message)}</td>
  </tr>`).join("");
  const typeRows = Object.entries(summary.byType).map(([type, count]) => `<span><b>${htmlEscape(count)}</b>${htmlEscape(type)}</span>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Admin - Aristotle Agentic</title>
  <style>
    :root { color-scheme: dark; --bg: #0b1110; --panel: #111b18; --ink: #f6f1e8; --muted: #b9b1a4; --gold: #e9c46a; --line: rgba(246,241,232,.14); }
    body { margin: 0; background: var(--bg); color: var(--ink); font-family: system-ui, -apple-system, Segoe UI, sans-serif; }
    header, main { width: min(1180px, calc(100% - 40px)); margin: 0 auto; }
    header { display: flex; justify-content: space-between; align-items: center; min-height: 76px; border-bottom: 1px solid var(--line); }
    a { color: var(--gold); }
    h1 { margin: 0; font-size: 28px; }
    main { padding: 28px 0 60px; }
    .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
    .summary span, .panel { border: 1px solid var(--line); border-radius: 10px; background: var(--panel); padding: 16px; }
    .summary b { display: block; font-size: 28px; color: var(--gold); }
    .actions { display: flex; gap: 12px; flex-wrap: wrap; margin: 20px 0; }
    button, .button { display: inline-flex; align-items: center; min-height: 38px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: var(--ink); font-weight: 700; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { vertical-align: top; text-align: left; padding: 12px; border-top: 1px solid var(--line); }
    th { color: var(--muted); font-size: 11px; text-transform: uppercase; }
    td:last-child { max-width: 340px; color: var(--muted); }
    @media (max-width: 900px) { .summary { grid-template-columns: 1fr 1fr; } table { display: block; overflow-x: auto; } }
  </style>
</head>
<body>
  <header>
    <h1>Aristotle website admin</h1>
    <form action="/admin/logout" method="post"><button type="submit">Log out</button></form>
  </header>
  <main>
    <div class="summary">
      <span><b>${summary.total}</b>Total inquiries</span>
      <span><b>${summary.newsletter}</b>Newsletter opt-ins</span>
      <span><b>${htmlEscape(summary.lastReceivedAt ?? "none")}</b>Last received</span>
      <span><b>${Object.keys(summary.byTopic).length}</b>Topics</span>
    </div>
    <div class="summary">${typeRows || "<span><b>0</b>No inquiries yet</span>"}</div>
    <div class="actions">
      <a class="button" href="/api/inquiries.csv">Download CSV</a>
      <a class="button" href="/api/inquiries/summary">Summary JSON</a>
      <a class="button" href="/api/inquiries?limit=100">Recent JSON</a>
    </div>
    <section class="panel">
      <h2>Recent inquiries</h2>
      <table>
        <thead><tr><th>Received</th><th>Site</th><th>Name</th><th>Email</th><th>Organization</th><th>Topic</th><th>Message</th></tr></thead>
        <tbody>${recentRows || "<tr><td colspan=\"7\">No inquiries yet.</td></tr>"}</tbody>
      </table>
    </section>
  </main>
</body>
</html>`;
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (trustProxy && typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}

function hashIp(ip) {
  return createHash("sha256").update(`aristotle-website:${ip}`).digest("hex");
}

function rateLimitOk(ip) {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + rateWindowMs });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= maxSubmissionsPerWindow;
}

function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        rejectBody(new Error("body_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", rejectBody);
  });
}

function parseBody(req, raw) {
  const contentType = String(req.headers["content-type"] ?? "");
  if (contentType.includes("application/json")) return JSON.parse(raw || "{}");
  if (!contentType.includes("application/x-www-form-urlencoded")) {
    throw new Error("unsupported_content_type");
  }
  const params = new URLSearchParams(raw);
  return Object.fromEntries(params.entries());
}

function clean(value, max = 2000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function validateInquiry(input) {
  const allowedTypes = new Set(["aristotle-agentic", "training-hub", "aristotleos", "montana-ai-x", "general"]);
  const inquiry = {
    type: clean(input.type, 80) || "general",
    name: clean(input.name, 160),
    email: clean(input.email, 220),
    organization: clean(input.organization, 220),
    role: clean(input.role, 160),
    topic: clean(input.topic, 220),
    message: clean(input.message, 5000),
    sourcePath: clean(input.sourcePath, 240),
    newsletter: clean(input.newsletter, 20) === "yes",
    website: clean(input.website, 500)
  };
  const errors = [];
  if (inquiry.website) errors.push("spam_detected");
  if (!allowedTypes.has(inquiry.type)) errors.push("invalid_inquiry_type");
  if (!inquiry.name) errors.push("name_required");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inquiry.email)) errors.push("valid_email_required");
  if (!inquiry.message || inquiry.message.length < 12) errors.push("message_required");
  return { inquiry, errors };
}

function persistInquiry(req, inquiry) {
  mkdirSync(dataDir, { recursive: true });
  const ip = clientIp(req);
  const record = {
    id: randomUUID(),
    receivedAt: new Date().toISOString(),
    ipHash: hashIp(ip),
    ...(storeRawIp ? { ip } : {}),
    userAgent: String(req.headers["user-agent"] ?? "").slice(0, 500),
    ...inquiry
  };
  appendFileSync(inquiryLog, `${JSON.stringify(record)}\n`, { encoding: "utf8" });
  return record;
}

function emailConfigured() {
  return Boolean(smtpHost && smtpPort && smtpUser && smtpPass && contactTo && contactFrom);
}

function smtpLine(socket) {
  return new Promise((resolveLine, rejectLine) => {
    let buffer = "";
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
    };
    const onError = (error) => {
      cleanup();
      rejectLine(error);
    };
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      if (lines.length === 0) return;
      const last = lines.at(-1) ?? "";
      if (/^\d{3} /.test(last)) {
        cleanup();
        resolveLine(lines.join("\n"));
      }
    };
    socket.on("data", onData);
    socket.on("error", onError);
  });
}

async function smtpCommand(socket, command, expected = [250]) {
  socket.write(`${command}\r\n`);
  const response = await smtpLine(socket);
  const code = Number(response.slice(0, 3));
  if (!expected.includes(code)) throw new Error(`smtp_${command.split(" ")[0].toLowerCase()}_${code}`);
  return response;
}

function smtpEscape(value) {
  return String(value).replace(/^\./gm, "..");
}

function headerText(value) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim();
}

function plainMessage(record) {
  return [
    `New Aristotle Agentic inquiry`,
    ``,
    `Type: ${record.type}`,
    `Name: ${record.name}`,
    `Email: ${record.email}`,
    `Organization: ${record.organization || "n/a"}`,
    `Role: ${record.role || "n/a"}`,
    `Topic: ${record.topic || "n/a"}`,
    `Newsletter: ${record.newsletter ? "yes" : "no"}`,
    `Source: ${record.sourcePath || "n/a"}`,
    `Received: ${record.receivedAt}`,
    `ID: ${record.id}`,
    ``,
    `Message:`,
    record.message,
    ``,
    `Admin: ${configuredOrigin() || "https://www.aristotleagentic.com"}/admin/`
  ].join("\n");
}

async function sendInquiryEmail(record) {
  if (!emailConfigured()) return false;
  const subject = `[Aristotle Agentic] ${record.type || "general"} inquiry from ${record.name || "website"}`;
  const body = plainMessage(record);
  const from = headerText(contactFrom);
  const to = headerText(contactTo);
  const replyTo = headerText(record.email);
  const message = [
    `From: Aristotle Agentic Website <${from}>`,
    `To: ${to}`,
    `Reply-To: ${replyTo}`,
    `Subject: ${headerText(subject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    body
  ].join("\r\n");

  let socket = smtpSecure
    ? tlsConnect({ host: smtpHost, port: smtpPort, servername: smtpHost, timeout: 12_000 })
    : netConnect({ host: smtpHost, port: smtpPort, timeout: 12_000 });

  try {
    socket.setEncoding("utf8");
    await smtpLine(socket);
    await smtpCommand(socket, `EHLO aristotleagentic.com`);
    if (!smtpSecure && smtpStartTls) {
      await smtpCommand(socket, "STARTTLS", [220]);
      const upgraded = tlsConnect({ socket, servername: smtpHost, timeout: 12_000 });
      socket = upgraded;
      socket.setEncoding("utf8");
      await smtpCommand(socket, `EHLO aristotleagentic.com`);
    }
    await smtpCommand(socket, "AUTH LOGIN", [334]);
    await smtpCommand(socket, Buffer.from(smtpUser).toString("base64"), [334]);
    await smtpCommand(socket, Buffer.from(smtpPass).toString("base64"), [235]);
    await smtpCommand(socket, `MAIL FROM:<${from}>`);
    await smtpCommand(socket, `RCPT TO:<${to}>`, [250, 251]);
    await smtpCommand(socket, "DATA", [354]);
    socket.write(`${smtpEscape(message)}\r\n.\r\n`);
    const response = await smtpLine(socket);
    const code = Number(response.slice(0, 3));
    if (code !== 250) throw new Error(`smtp_data_${code}`);
    await smtpCommand(socket, "QUIT", [221, 250]).catch(() => {});
    return true;
  } finally {
    socket.destroy();
  }
}

function sameOriginPost(req) {
  const expected = requestOrigin(req);
  const origin = String(req.headers.origin ?? "");
  const referer = String(req.headers.referer ?? "");
  if (origin && origin !== expected) return false;
  if (referer) {
    try {
      return new URL(referer).origin === expected;
    } catch {
      return false;
    }
  }
  return Boolean(origin || referer);
}

function withinDir(target, parent) {
  const rel = relative(normalize(parent), normalize(target));
  return rel === "" || (!!rel && !rel.startsWith("..") && !isAbsolute(rel));
}

function publicStaticAllowed(rel) {
  const normalizedRel = rel.replaceAll("\\", "/");
  const parts = normalizedRel.split("/").filter(Boolean);
  const root = parts.length > 1 ? parts[0] : "";
  const extension = extname(normalizedRel).toLowerCase();
  if (!allowedStaticRoots.has(root)) return false;
  if (blockedStaticExtensions.has(extension)) return false;
  if (!publicStaticExtensions.has(extension)) return false;
  if (root === "scripts") return false;
  if (root === "papers" && parts[1] !== "files") return extension === ".html";
  return true;
}

async function handleInquiry(req, res) {
  if (!sameOriginPost(req)) {
    json(res, 403, { ok: false, errors: ["bad_origin"] });
    return;
  }
  const ip = clientIp(req);
  if (!rateLimitOk(ip)) {
    json(res, 429, { ok: false, errors: ["rate_limited"] });
    return;
  }
  try {
    const raw = await readBody(req);
    const input = parseBody(req, raw);
    const { inquiry, errors } = validateInquiry(input);
    if (errors.length > 0) {
      const acceptsHtml = String(req.headers.accept ?? "").includes("text/html");
      if (acceptsHtml) {
        send(res, 400, thankYouPage("general"), { "content-type": "text/html; charset=utf-8" });
      } else {
        json(res, 400, { ok: false, errors });
      }
      return;
    }
    const record = persistInquiry(req, inquiry);
    if (emailConfigured()) {
      sendInquiryEmail(record).catch((error) => {
        console.error("inquiry email notification failed:", error instanceof Error ? error.message : error);
      });
    }
    const acceptsHtml = String(req.headers.accept ?? "").includes("text/html");
    if (acceptsHtml) {
      send(res, 303, "", { location: `/thank-you/?type=${encodeURIComponent(inquiry.type)}` });
    } else {
      json(res, 201, { ok: true, id: record.id });
    }
  } catch (error) {
    const code = error instanceof Error && error.message === "body_too_large" ? 413 : 400;
    json(res, code, { ok: false, errors: [error instanceof Error ? error.message : "bad_request"] });
  }
}

function authorized(req) {
  if (!adminToken) return false;
  const auth = String(req.headers.authorization ?? "");
  const headerToken = String(req.headers["x-admin-token"] ?? "");
  return auth === `Bearer ${adminToken}` || headerToken === adminToken || validAdminSession(req);
}

function exportInquiries(req, res, url) {
  if (!authorized(req)) {
    json(res, 404, { ok: false, errors: ["not_found"] });
    return;
  }
  if (!existsSync(inquiryLog)) {
    json(res, 200, { ok: true, inquiries: [] });
    return;
  }
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 1000);
  const lines = readFileSync(inquiryLog, "utf8").trim().split("\n").filter(Boolean);
  const inquiries = lines.slice(-limit).map((line) => JSON.parse(line));
  json(res, 200, { ok: true, count: inquiries.length, inquiries });
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function exportInquiriesCsv(req, res) {
  if (!authorized(req)) {
    json(res, 404, { ok: false, errors: ["not_found"] });
    return;
  }
  const fields = ["id", "receivedAt", "type", "name", "email", "organization", "role", "topic", "newsletter", "sourcePath", "message", "ipHash", "userAgent"];
  const rows = readInquiries(10000);
  const csv = [
    fields.join(","),
    ...rows.map((record) => fields.map((field) => csvEscape(record[field])).join(","))
  ].join("\n");
  send(res, 200, `${csv}\n`, {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="aristotle-inquiries-${new Date().toISOString().slice(0, 10)}.csv"`,
    "cache-control": "no-store"
  });
}

function exportSummary(req, res) {
  if (!authorized(req)) {
    json(res, 404, { ok: false, errors: ["not_found"] });
    return;
  }
  const inquiries = readInquiries(10000);
  json(res, 200, { ok: true, summary: inquirySummary(inquiries) });
}

async function handleAdminLogin(req, res) {
  if (!adminToken) {
    json(res, 404, { ok: false, errors: ["not_found"] });
    return;
  }
  if (!sameOriginPost(req)) {
    send(res, 403, adminLoginPage("Bad origin."), { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return;
  }
  try {
    const input = parseBody(req, await readBody(req));
    const token = clean(input.token, 10000);
    if (!safeEqual(token, adminToken)) {
      send(res, 401, adminLoginPage("Invalid token."), { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return;
    }
    send(res, 303, "", {
      location: "/admin/",
      "set-cookie": adminCookie(createAdminSession()),
      "cache-control": "no-store"
    });
  } catch {
    send(res, 400, adminLoginPage("Could not read login."), { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  }
}

function handleAdmin(req, res) {
  if (!adminToken) {
    json(res, 404, { ok: false, errors: ["not_found"] });
    return;
  }
  if (!authorized(req)) {
    send(res, 401, adminLoginPage(), { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return;
  }
  send(res, 200, adminDashboardPage(readInquiries(10000)), { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
}

function handleAdminLogout(_req, res) {
  send(res, 303, "", {
    location: "/admin/",
    "set-cookie": `aristotle_admin=; HttpOnly; SameSite=Lax; Path=/admin/; Max-Age=0${requestIsHttps() ? "; Secure" : ""}`,
    "cache-control": "no-store"
  });
}

function staticTarget(urlPath) {
  let decodedPath = "/";
  try {
    decodedPath = decodeURIComponent(urlPath);
  } catch {
    return { error: 400, rel: urlPath, target: "" };
  }
  if (decodedPath.includes("\0") || decodedPath.split("/").some((part) => part.startsWith("."))) {
    return { error: 403, rel: decodedPath, target: "" };
  }
  const rel = decodedPath === "/" ? "/index.html" : decodedPath.endsWith("/") ? `${decodedPath}index.html` : decodedPath;
  if (!publicStaticAllowed(rel)) return { error: 403, rel, target: "" };
  const target = normalize(resolve(here, "." + rel));
  if (!withinDir(target, here)) return { error: 403, rel, target };
  if (withinDir(target, dataDir)) return { error: 403, rel, target };
  if (!existsSync(target) || !statSync(target).isFile()) return { error: 404, rel, target };
  return { rel, target };
}

const server = createServer(async (req, res) => {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;

  if ((method === "GET" || method === "HEAD") && maybeRedirectAlias(req, res, url)) {
    return;
  }

  if (method === "GET" && path === "/healthz") {
    json(res, 200, {
      ok: true,
      service: "aristotle-website",
      time: new Date().toISOString(),
      storage: existsSync(dataDir) ? "ready" : "missing"
    });
    return;
  }

  if (method === "GET" && path === "/readyz") {
    const ready = dataStoreReady();
    json(res, ready ? 200 : 503, {
      ok: ready,
      service: "aristotle-website",
      storage: ready ? "writable" : "unavailable",
      time: new Date().toISOString()
    });
    return;
  }

  if (method === "GET" && path === "/robots.txt") {
    send(res, 200, "User-agent: *\nAllow: /\nSitemap: /sitemap.xml\n", { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" });
    return;
  }

  if (method === "GET" && (path === "/security.txt" || path === "/.well-known/security.txt")) {
    send(res, 200, securityTxt(req), { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" });
    return;
  }

  if (method === "GET" && path === "/sitemap.xml") {
    const origin = requestOrigin(req);
    send(res, 200, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${origin}/</loc></url>\n  <url><loc>${origin}/about/</loc></url>\n  <url><loc>${origin}/research/</loc></url>\n  <url><loc>${origin}/papers/gplane/</loc></url>\n  <url><loc>${origin}/support/</loc></url>\n  <url><loc>${origin}/governance-thesis/</loc></url>\n  <url><loc>${origin}/training-hub/</loc></url>\n  <url><loc>${origin}/montana-ai-x/</loc></url>\n  <url><loc>${origin}/aristotleos/</loc></url>\n  <url><loc>${origin}/privacy/</loc></url>\n</urlset>\n`, { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" });
    return;
  }

  if (method === "GET" && path === "/github") {
    send(res, 302, "", {
      location: "https://github.com/AristotleAgentic/AristotleOS",
      "cache-control": "public, max-age=3600"
    });
    return;
  }

  if (method === "GET" && path === "/ui-prototype/") {
    send(res, 302, "", {
      location: uiPrototypeUrl,
      "cache-control": uiPrototypeUrl.startsWith("http://127.0.0.1") || uiPrototypeUrl.startsWith("http://localhost") ? "no-store" : "public, max-age=3600"
    });
    return;
  }

  if (method === "GET" && path === "/thank-you/") {
    send(res, 200, thankYouPage(url.searchParams.get("type") ?? "general"), { "content-type": "text/html; charset=utf-8" });
    return;
  }

  if (method === "GET" && path === "/admin/") {
    handleAdmin(req, res);
    return;
  }

  if (method === "POST" && path === "/admin/login") {
    await handleAdminLogin(req, res);
    return;
  }

  if (method === "POST" && path === "/admin/logout") {
    if (!sameOriginPost(req)) {
      send(res, 403, "forbidden", { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      return;
    }
    handleAdminLogout(req, res);
    return;
  }

  if (method === "POST" && path === "/api/inquiries") {
    await handleInquiry(req, res);
    return;
  }

  if (method === "GET" && path === "/api/inquiries/summary") {
    exportSummary(req, res);
    return;
  }

  if (method === "GET" && path === "/api/inquiries.csv") {
    exportInquiriesCsv(req, res);
    return;
  }

  if (method === "GET" && path === "/api/inquiries") {
    exportInquiries(req, res, url);
    return;
  }

  if (method !== "GET" && method !== "HEAD") {
    send(res, 405, "method not allowed", { allow: "GET, HEAD, POST", "content-type": "text/plain; charset=utf-8" });
    return;
  }

  const result = staticTarget(path);
  if (result.error === 400) {
    send(res, 400, "bad request", { "content-type": "text/plain; charset=utf-8" });
    return;
  }
  if (result.error === 403) {
    send(res, 403, "forbidden", { "content-type": "text/plain; charset=utf-8" });
    return;
  }
  if (result.error === 404) {
    send(res, 404, `not found: ${result.rel}`, { "content-type": "text/plain; charset=utf-8" });
    return;
  }
  sendStatic(req, res, method, result.target);
});

server.requestTimeout = 30_000;
server.headersTimeout = 35_000;
server.keepAliveTimeout = 5_000;

server.listen(port, host, () => {
  mkdirSync(dataDir, { recursive: true });
  console.log(`aristotleagentic.com server: http://${host}:${port}/`);
  console.log(`inquiry log: ${inquiryLog}`);
  for (const warning of runtimeWarnings()) console.warn(`warning: ${warning}`);
});

function shutdown(signal) {
  console.log(`${signal} received; closing aristotle website server`);
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exit(1);
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
