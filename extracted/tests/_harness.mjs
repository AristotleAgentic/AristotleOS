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
import { createServer } from "node:net";
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
    const srv = createServer();
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
  const entry = path.join(REPO_ROOT, "services", serviceName, "src", "index.ts");
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
    async get(p) {
      const r = await fetch(`${base}${p}`);
      return { status: r.status, body: await safeJson(r) };
    },
    async post(p, body) {
      const r = await fetch(`${base}${p}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
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
