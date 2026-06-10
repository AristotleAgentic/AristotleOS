import express from "express";
import { createReadStream, existsSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const port = Number(process.env.PORT_CONSOLE ?? process.env.PORT ?? 4173);
const normalizeGatewayBaseUrl = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "http://http-gateway:8080";
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  return withScheme.replace(/\/$/, "");
};
const gatewayBaseUrl = normalizeGatewayBaseUrl(process.env.CONSOLE_GATEWAY_BASE_URL ?? process.env.CONSOLE_GATEWAY_HOSTPORT);
const consoleAccessToken = process.env.CONSOLE_ACCESS_TOKEN?.trim() ?? "";
const operatorApiKey = process.env.CONSOLE_OPERATOR_API_KEY?.trim() ?? "";
const operatorActor = process.env.CONSOLE_OPERATOR_ACTOR?.trim() ?? "operator:console";
const operatorRole = process.env.CONSOLE_OPERATOR_ROLE?.trim() ?? "operator";
const root = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(root, "dist");
const indexPath = path.join(distDir, "index.html");

const proxyPaths = ["/operator", "/v1", "/health", "/ready", "/metrics"];
let operatorSessionToken = "";
let operatorSessionExpiresAt = 0;

const safeEqual = (left, right) => {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
};

const parseCookies = (header = "") =>
  Object.fromEntries(
    String(header)
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const index = item.indexOf("=");
        if (index === -1) return [item, ""];
        return [item.slice(0, index), decodeURIComponent(item.slice(index + 1))];
      })
  );

const html = (body, status = 200, extraHeaders = {}) => ({
  status,
  body: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AristotleOS Console Access</title>
  <style>
    :root { color-scheme: dark; --bg:#05070d; --panel:#0f172a; --ink:#e2e8f0; --muted:#94a3b8; --cyan:#38d4e8; --line:rgba(148,163,184,.22); }
    body { margin:0; min-height:100vh; display:grid; place-items:center; background:radial-gradient(circle at 72% 18%, rgba(56,212,232,.12), transparent 32%), var(--bg); color:var(--ink); font-family:Inter,ui-sans-serif,system-ui,sans-serif; }
    main { width:min(440px, calc(100% - 40px)); border:1px solid var(--line); border-radius:10px; background:rgba(15,23,42,.9); padding:28px; box-shadow:0 24px 80px rgba(0,0,0,.35); }
    h1 { margin:0 0 10px; font-size:26px; }
    p { color:var(--muted); line-height:1.55; }
    label { display:block; color:var(--muted); font-size:13px; margin:18px 0 8px; }
    input { width:100%; min-height:44px; border:1px solid var(--line); border-radius:8px; background:#05070d; color:var(--ink); padding:0 12px; box-sizing:border-box; }
    button { margin-top:16px; min-height:44px; border:0; border-radius:8px; background:var(--cyan); color:#031018; font-weight:800; padding:0 16px; }
    .error { color:#fca5a5; }
  </style>
</head>
<body>${body}</body>
</html>`,
  headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...extraHeaders }
});

const loginPage = (error = "") => html(`<main>
  <h1>Operator console</h1>
  <p>Enter the console access token to open the AristotleOS operator surface.</p>
  ${error ? `<p class="error">${error}</p>` : ""}
  <form method="post" action="/console-login">
    <label for="token">Access token</label>
    <input id="token" name="token" type="password" autocomplete="current-password" required />
    <button type="submit">Open console</button>
  </form>
</main>`);

const readFormBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
};

const consoleAuthorized = (req) => {
  if (!consoleAccessToken) return true;
  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = cookies.aristotle_console;
  return Boolean(cookieToken && safeEqual(cookieToken, consoleAccessToken));
};

const requireConsoleAccess = (req, res, next) => {
  if (req.path === "/console-health" || req.path === "/console-login") return next();
  if (consoleAuthorized(req)) return next();
  const page = loginPage();
  res.status(page.status).set(page.headers).send(page.body);
};

const readRawBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return chunks.length ? Buffer.concat(chunks) : undefined;
};

const ensureOperatorSession = async () => {
  if (!operatorApiKey) return "";
  if (operatorSessionToken && operatorSessionExpiresAt > Date.now() + 30_000) {
    return operatorSessionToken;
  }
  const headers = new Headers();
  headers.set("x-operator-key", operatorApiKey);
  headers.set("x-operator-actor", operatorActor);
  headers.set("x-operator-role", operatorRole);
  const response = await fetch(`${gatewayBaseUrl}/operator/auth/session`, {
    method: "POST",
    headers
  });
  if (!response.ok) {
    operatorSessionToken = "";
    operatorSessionExpiresAt = 0;
    return "";
  }
  const session = await response.json().catch(() => null);
  if (!session?.token) return "";
  operatorSessionToken = session.token;
  operatorSessionExpiresAt = Date.parse(session.expiresAt) || 0;
  return operatorSessionToken;
};

const proxyToGateway = async (req, res) => {
  const target = `${gatewayBaseUrl}${req.originalUrl}`;
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      const lower = key.toLowerCase();
      if (!value || lower === "host" || lower === "content-length" || lower === "authorization") continue;
      headers.set(key, Array.isArray(value) ? value.join(",") : value);
    }
    if (operatorApiKey) {
      const sessionToken = await ensureOperatorSession();
      if (sessionToken) {
        headers.set("authorization", `Bearer ${sessionToken}`);
      } else {
        headers.set("x-operator-key", operatorApiKey);
      }
      headers.set("x-operator-actor", operatorActor);
      headers.set("x-operator-role", operatorRole);
    }
    const body = ["GET", "HEAD"].includes(req.method) ? undefined : await readRawBody(req);
    const response = await fetch(target, { method: req.method, headers, body });
    res.status(response.status);
    response.headers.forEach((value, key) => {
      if (!["content-encoding", "content-length", "transfer-encoding"].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
  } catch (error) {
    res.status(502).json({
      error: "gateway_proxy_unavailable",
      message: error instanceof Error ? error.message : String(error),
      gatewayBaseUrl
    });
  }
};

app.get("/console-health", (_req, res) => {
  res.json({
    ok: existsSync(indexPath),
    service: "console-ui",
    gatewayBaseUrl,
    accessTokenConfigured: Boolean(consoleAccessToken),
    operatorProxyConfigured: Boolean(operatorApiKey),
    publicRoutes: ["/public", "/try", "/"]
  });
});

app.post("/console-login", async (req, res) => {
  if (!consoleAccessToken) {
    res.redirect(303, "/");
    return;
  }
  const form = await readFormBody(req);
  const token = form.get("token") ?? "";
  if (!safeEqual(token, consoleAccessToken)) {
    const page = loginPage("Invalid token.");
    res.status(401).set(page.headers).send(page.body);
    return;
  }
  res
    .status(303)
    .setHeader("set-cookie", `aristotle_console=${encodeURIComponent(consoleAccessToken)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${req.secure ? "; Secure" : ""}`)
    .setHeader("location", "/");
  res.end();
});

app.use(requireConsoleAccess);

for (const route of proxyPaths) {
  app.use(route, proxyToGateway);
}

app.use(express.static(distDir, {
  etag: true,
  fallthrough: true,
  maxAge: "1h"
}));

app.get("*", (_req, res) => {
  if (!existsSync(indexPath)) {
    res.status(503).json({ error: "console_assets_missing", distDir });
    return;
  }
  createReadStream(indexPath).pipe(res.type("html"));
});

app.listen(port, "0.0.0.0", () => {
  console.log(`console-ui serving ${distDir} on ${port}; gateway=${gatewayBaseUrl}`);
});
