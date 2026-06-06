/**
 * Shared test harness for AristotleOS service integration tests.
 *
 * Spawns a service as a child process on a caller-chosen port (or
 * auto-allocates one), waits until /health responds, returns a
 * client object the test can use to issue HTTP requests. Tests must
 * call stop() at the end to clean up.
 *
 * Stage 1 testing strategy: services are monolithic Express apps
 * with module-level state + a top-level app.listen() call.
 * Importing a service module would start the server on its default
 * port; instead we spawn it as a fresh child process per test so
 * state is naturally isolated and the test exercises the real
 * production code path (Express, route handlers, env-var
 * configuration) without any production code change.
 *
 * No new dependencies. Pure node:child_process + fetch + tsx (already
 * in the root's devDependencies).
 */

import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Pick a free TCP port by binding 0 on localhost. Race window is
 * small but real — for higher reliability we'd retry on EADDRINUSE,
 * but tests typically only spawn one service at a time.
 */
export async function freePort() {
  return await new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Spawn `services/<name>/src/index.ts` as a child process using tsx,
 * with the supplied env vars layered onto process.env. Returns a
 * handle with the assigned port, a get/post HTTP helper, and a stop()
 * function.
 *
 * Waits up to `readyTimeoutMs` for GET /health to return 200.
 *
 * Options:
 *  - port: pre-allocated TCP port (otherwise freePort() picks one)
 *  - env: extra env vars layered on top of process.env. The harness
 *    always sets PORT + PORT_<SERVICE_UPPER>; pass any additional
 *    port aliases (e.g. PORT_GATEWAY for http-gateway) here.
 *  - entryPath: relative-from-repo-root path to the service entry. Defaults
 *    to "services/<name>/src/index.ts". Use this to spawn services that
 *    live under adapters/ (e.g. "adapters/http-gateway/src/index.ts").
 *    Accepts a string (with "/" separators) or an array of path segments.
 *  - readyTimeoutMs: how long to wait for GET /health to return 200.
 *  - captureOutput: pipe child stderr so failures surface its logs.
 *  - get/post helpers accept an optional `headers` object on the second
 *    arg (post) or first arg (get) — handy for RBAC tests.
 */
export async function startService(serviceName, opts = {}) {
  const port = opts.port ?? (await freePort());
  const env = {
    ...process.env,
    PORT: String(port),
    [`PORT_${serviceUpper(serviceName)}`]: String(port),
    SERVICE_DISCOVERY_MODE: "local",
    ...(opts.env ?? {})
  };
  const entrySegments = opts.entryPath
    ? (Array.isArray(opts.entryPath) ? opts.entryPath : opts.entryPath.split("/"))
    : ["services", serviceName, "src", "index.ts"];
  const entry = path.join(REPO_ROOT, ...entrySegments);
  const child = spawn(process.execPath, ["--import", "tsx", entry], {
    cwd: REPO_ROOT,
    env,
    stdio: opts.captureOutput ? ["ignore", "pipe", "pipe"] : ["ignore", "ignore", "ignore"]
  });
  const stderr = [];
  if (opts.captureOutput && child.stderr) {
    child.stderr.on("data", (b) => stderr.push(b.toString()));
  }
  const base = `http://127.0.0.1:${port}`;
  const readyTimeoutMs = opts.readyTimeoutMs ?? 10_000;
  const ready = await waitForHealth(base, readyTimeoutMs).catch(async (err) => {
    child.kill("SIGKILL");
    throw new Error(
      `service '${serviceName}' did not become ready on ${base}/health within ${readyTimeoutMs}ms: ${err.message}` +
        (stderr.length ? `\n--- stderr ---\n${stderr.join("")}` : "")
    );
  });
  return {
    port,
    base,
    child,
    healthBody: ready,
    async get(p, headers) {
      const r = await fetch(`${base}${p}`, headers ? { headers } : undefined);
      return { status: r.status, body: await safeJson(r) };
    },
    async post(p, body, headers) {
      const r = await fetch(`${base}${p}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(headers ?? {}) },
        body: JSON.stringify(body ?? {})
      });
      return { status: r.status, body: await safeJson(r) };
    },
    async stop() {
      if (child.exitCode !== null) return;
      child.kill("SIGINT");
      await new Promise((resolve) => {
        const t = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* */ } resolve(); }, 1500);
        child.once("exit", () => { clearTimeout(t); resolve(); });
      });
    }
  };
}

function serviceUpper(name) {
  return name.toUpperCase().replace(/-/g, "_");
}

async function waitForHealth(base, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = new Error("never attempted");
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return await safeJson(r);
      lastError = new Error(`status ${r.status}`);
    } catch (err) {
      lastError = err;
    }
    await sleep(150);
  }
  throw lastError;
}

async function safeJson(r) {
  const ct = (r.headers.get("content-type") ?? "").toLowerCase();
  if (ct.includes("application/json")) {
    try { return await r.json(); } catch { return null; }
  }
  try { return await r.text(); } catch { return null; }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Spin up a tiny in-process HTTP mock server on an auto-allocated
 * port. Used by tests that need to stub downstream services
 * (governance-kernel, execution-gate, evidence-ledger, etc.) without
 * standing up the full control plane.
 *
 * routes is a map from "METHOD /pathname" → handler. Examples:
 *
 *   {
 *     "GET /health":           { status: 200, body: { ok: true } },
 *     "POST /events/commit":   { status: 201, body: { index: 0 } },
 *     "POST /issue-warrant":   ({ body }) => ({ status: 201, body: { id: "war-" + body.missionId } }),
 *     "POST /kill-switch":     async ({ body }) => ({ status: 200, body }),
 *   }
 *
 * Handler shapes accepted:
 *  - { status, body, headers? } — canned response, returned as-is
 *  - (req) => { status, body, headers? } | Promise<...> — dynamic
 *    handler that gets { method, path, query, body, headers } and
 *    returns or resolves to the canned shape
 *
 * Pathname-only matching (no params or globs in the route key); use
 * a function handler if you need dispatch on URL segments. Status
 * defaults to 200, body to {}; bodies are JSON-stringified unless
 * already a string.
 *
 * Returns { base, port, calls, stop }:
 *  - calls is an array of { method, path, query, body, headers }
 *    recorded in arrival order — assertion-friendly
 *  - stop() awaits server close; the test MUST call it, otherwise
 *    node:test will hang waiting for the open handle (same
 *    discipline as startService)
 *
 * Unmatched routes return 404 with body
 *   { error: "mock_route_not_configured", method, path }
 * so a mismatched URL surfaces as a deterministic test failure
 * rather than a phantom hang.
 *
 * Pure node:http — no Express dependency, no test-framework
 * coupling.
 */
export async function startMockService(routes, opts = {}) {
  const calls = [];
  const port = opts.port ?? (await freePort());

  const server = createHttpServer(async (req, res) => {
    try {
      // Buffer the body, parse as JSON if content-type says so or if it
      // looks like JSON. Otherwise pass the raw string.
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const contentType = (req.headers["content-type"] ?? "").toLowerCase();
      let parsedBody = null;
      if (raw) {
        if (contentType.includes("application/json")) {
          try { parsedBody = JSON.parse(raw); } catch { parsedBody = raw; }
        } else {
          parsedBody = raw;
        }
      }
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const callRecord = {
        method: req.method ?? "GET",
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        body: parsedBody,
        headers: req.headers
      };
      calls.push(callRecord);

      const key = `${callRecord.method} ${callRecord.path}`;
      const handler = routes[key];

      let response;
      if (handler === undefined) {
        response = {
          status: 404,
          body: {
            error: "mock_route_not_configured",
            method: callRecord.method,
            path: callRecord.path
          }
        };
      } else if (typeof handler === "function") {
        response = await handler(callRecord);
      } else {
        response = handler;
      }

      const status = response?.status ?? 200;
      const body = response?.body ?? {};
      const headers = {
        "content-type": "application/json",
        ...(response?.headers ?? {})
      };
      const payload = typeof body === "string" ? body : JSON.stringify(body);
      res.writeHead(status, headers);
      res.end(payload);
    } catch (err) {
      // Surface handler errors as 500 so the test sees the failure
      // rather than the connection hanging.
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({
        error: "mock_handler_threw",
        message: err instanceof Error ? err.message : String(err)
      }));
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });

  return {
    port,
    base: `http://127.0.0.1:${port}`,
    calls,
    async stop() {
      await new Promise((resolve) => server.close(() => resolve()));
    }
  };
}
