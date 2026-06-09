#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const tempDataDir = mkdtempSync(resolve(tmpdir(), "aristotle-website-smoke-"));
const spawnedPort = String(43_000 + Math.floor(Math.random() * 1_000));
const baseUrl = process.env.WEBSITE_BASE_URL ?? `http://127.0.0.1:${spawnedPort}`;
const smokeAdminToken = "smoke-test-admin-token";
let child;

const checks = [];

async function check(name, fn) {
  try {
    await fn();
    checks.push({ name, ok: true });
  } catch (error) {
    checks.push({ name, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function get(path) {
  return fetch(`${baseUrl}${path}`, { redirect: "manual" });
}

async function waitForServer() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 8_000) {
    try {
      const res = await fetch(`${baseUrl}/healthz`);
      if (res.ok) return;
    } catch {
      // Keep waiting until timeout.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error(`server did not become ready at ${baseUrl}`);
}

if (!process.env.WEBSITE_BASE_URL) {
  child = spawn(process.execPath, ["serve.mjs", spawnedPort], {
    cwd: appDir,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      ARISTOTLE_WEBSITE_DATA_DIR: tempDataDir,
      ARISTOTLE_ADMIN_TOKEN: smokeAdminToken
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  await waitForServer();
}

await check("home route", async () => {
  const res = await get("/");
  assert(res.status === 200, `expected 200, got ${res.status}`);
  assert((await res.text()).includes("Seeking human good in agentic AI"), "missing homepage marker");
});

await check("montana route", async () => {
  const res = await get("/montana-ai-x/");
  assert(res.status === 200, `expected 200, got ${res.status}`);
  assert((await res.text()).includes("Montana needs its own operating doctrine"), "missing Montana marker");
});

await check("training hub route", async () => {
  const res = await get("/training-hub/");
  assert(res.status === 200, `expected 200, got ${res.status}`);
  assert((await res.text()).includes("Future-proofing work"), "missing Training Hub marker");
});

await check("aristotleos route", async () => {
  const res = await get("/aristotleos/");
  assert(res.status === 200, `expected 200, got ${res.status}`);
  assert((await res.text()).includes("Autonomous action. Human authority."), "missing AristotleOS marker");
});

await check("about route", async () => {
  const res = await get("/about/");
  assert(res.status === 200, `expected 200, got ${res.status}`);
  assert((await res.text()).includes("A thought lab for the human side of autonomous power"), "missing About marker");
});

await check("research route", async () => {
  const res = await get("/research/");
  assert(res.status === 200, `expected 200, got ${res.status}`);
  const text = await res.text();
  assert(text.includes("The written architecture for human authority over autonomous systems"), "missing Research marker");
  assert(text.includes("PDF library"), "missing research PDF library");
  assert(text.includes("Working papers"), "missing working papers section");
  assert(text.includes("A New Precedent Born of AI"), "missing civic AI paper");
  assert(text.includes("Montana AI-X commentary"), "missing Montana commentary section");
  assert(text.includes("5 LIBRARY LANES"), "missing library taxonomy");
  assert(text.includes("Research stack"), "missing research stack");
});

await check("gplane publication route", async () => {
  const res = await get("/papers/gplane/");
  assert(res.status === 200, `expected 200, got ${res.status}`);
  const text = await res.text();
  assert(text.includes("The G-Plane Architecture"), "missing G-Plane publication title");
  assert(text.includes("Download PDF"), "missing G-Plane download action");
});

await check("support route", async () => {
  const res = await get("/support/");
  assert(res.status === 200, `expected 200, got ${res.status}`);
  const text = await res.text();
  assert(text.includes("Help build the civic layer"), "missing support hero");
  assert(text.includes("Support does not buy conclusions"), "missing independence standard");
});

await check("research pdf assets served", async () => {
  const pdfs = [
    "/papers/files/governance-plane-ai-native-6g.pdf",
    "/papers/files/deterministic-governance-enforcement.pdf",
    "/papers/files/the-gplane-architecture.pdf",
    "/papers/files/insurability-autonomous-systems.pdf",
    "/papers/files/authority-routing-autonomous-systems.pdf",
    "/papers/files/governance-kernel.pdf",
    "/papers/files/cryptographic-governance-evidence-ledgers.pdf",
    "/papers/files/new-precedent-born-of-ai.pdf",
    "/papers/files/from-copper-to-code-montanas-ai-moment.pdf",
    "/papers/files/montana-wrong-part-of-ai.pdf"
  ];
  for (const pdf of pdfs) {
    const res = await get(pdf);
    assert(res.status === 200, `${pdf} expected 200, got ${res.status}`);
    assert(res.headers.get("content-type")?.startsWith("application/pdf"), `${pdf} missing pdf content type`);
  }
});

await check("large pdf supports byte ranges", async () => {
  const res = await fetch(`${baseUrl}/papers/files/the-gplane-architecture.pdf?v=wards-warrants-2026-06-07`, {
    headers: { range: "bytes=0-1023" }
  });
  assert(res.status === 206, `expected 206, got ${res.status}`);
  assert(res.headers.get("accept-ranges") === "bytes", "missing byte range support");
  assert(res.headers.get("content-range")?.startsWith("bytes 0-1023/"), "bad content range");
  assert(Number(res.headers.get("content-length")) === 1024, "bad chunk length");
});

await check("large pdf can be forced to download", async () => {
  const res = await fetch(`${baseUrl}/papers/files/the-gplane-architecture.pdf?download=1&v=wards-warrants-2026-06-07`, {
    method: "HEAD"
  });
  assert(res.status === 200, `expected 200, got ${res.status}`);
  assert(res.headers.get("content-disposition")?.startsWith("attachment;"), "missing attachment disposition");
});

await check("governance thesis route", async () => {
  const res = await get("/governance-thesis/");
  assert(res.status === 200, `expected 200, got ${res.status}`);
  assert((await res.text()).includes("authority must become architecture"), "missing Governance Thesis marker");
});

await check("privacy route", async () => {
  const res = await get("/privacy/");
  assert(res.status === 200, `expected 200, got ${res.status}`);
  assert((await res.text()).includes("Public-interest AI work needs public-interest data practices"), "missing privacy marker");
});

await check("github redirect", async () => {
  const res = await get("/github");
  assert(res.status === 302, `expected 302, got ${res.status}`);
  assert(res.headers.get("location") === "https://github.com/AristotleAgentic/AristotleOS", "bad GitHub redirect target");
});

await check("ui prototype redirect", async () => {
  const res = await get("/ui-prototype/");
  assert(res.status === 302, `expected 302, got ${res.status}`);
  assert(res.headers.get("location")?.includes("apps/console-ui") || res.headers.get("location")?.includes("127.0.0.1:4173"), "bad UI prototype redirect target");
});

await check("security headers", async () => {
  const res = await get("/");
  assert(res.headers.get("x-frame-options") === "DENY", "missing frame denial");
  assert(res.headers.get("x-content-type-options") === "nosniff", "missing nosniff");
  assert(res.headers.get("content-security-policy")?.includes("script-src 'none'"), "missing strict CSP");
  assert(res.headers.get("cross-origin-opener-policy") === "same-origin", "missing COOP");
  assert(res.headers.get("cross-origin-resource-policy") === "same-origin", "missing CORP");
  assert(res.headers.get("x-permitted-cross-domain-policies") === "none", "missing cross-domain policy denial");
});

await check("health route", async () => {
  const res = await get("/healthz");
  const body = await res.json();
  assert(res.status === 200, `expected 200, got ${res.status}`);
  assert(body.ok === true && body.service === "aristotle-website", "bad health body");
});

await check("readiness route", async () => {
  const res = await get("/readyz");
  const body = await res.json();
  assert(res.status === 200, `expected 200, got ${res.status}`);
  assert(body.ok === true && body.storage === "writable", "bad readiness body");
});

await check("robots and sitemap", async () => {
  const robots = await get("/robots.txt");
  const sitemap = await get("/sitemap.xml");
  const security = await get("/.well-known/security.txt");
  assert(robots.status === 200, `robots expected 200, got ${robots.status}`);
  assert(sitemap.status === 200, `sitemap expected 200, got ${sitemap.status}`);
  assert(security.status === 200, `security.txt expected 200, got ${security.status}`);
  assert((await security.text()).includes("Policy:"), "security.txt missing policy");
  const sitemapText = await sitemap.text();
  assert(sitemapText.includes("/training-hub/"), "sitemap missing Training Hub");
  assert(sitemapText.includes("/about/"), "sitemap missing About");
  assert(sitemapText.includes("/research/"), "sitemap missing Research");
  assert(sitemapText.includes("/papers/gplane/"), "sitemap missing G-Plane publication");
  assert(sitemapText.includes("/support/"), "sitemap missing support page");
  assert(sitemapText.includes("/governance-thesis/"), "sitemap missing Governance Thesis");
  assert(sitemapText.includes("/privacy/"), "sitemap missing privacy page");
});

await check("local visual assets served", async () => {
  const assets = [
    "/assets/aristotle-bust-hero.png",
    "/assets/training-hub-hero-bg.png",
    "/assets/montana-ai-x-hero-bg.png",
    "/assets/aristotleos-hero-bg.png",
    "/assets/aristotleos-swarm-hero-bg.png",
    "/assets/paper-governance-plane.svg",
    "/assets/paper-deterministic-enforcement.svg",
    "/assets/paper-gplane-book-map.svg",
    "/assets/pepper-petersen-cowboy-hat.jpg",
    "/assets/founder-arc.svg",
    "/assets/regulated-systems-map.svg"
  ];
  for (const asset of assets) {
    const res = await get(asset);
    const expectedContentType = asset.endsWith(".svg") ? "image/svg+xml" : asset.endsWith(".jpg") || asset.endsWith(".jpeg") ? "image/jpeg" : "image/png";
    assert(res.status === 200, `${asset} expected 200, got ${res.status}`);
    assert(res.headers.get("content-type")?.startsWith(expectedContentType), `${asset} missing image content type`);
  }
});

await check("dotfile blocked", async () => {
  const res = await get("/.gitignore");
  assert(res.status === 403, `expected 403, got ${res.status}`);
});

await check("server source and private files blocked", async () => {
  const blockedPaths = [
    "/serve.mjs",
    "/package.json",
    "/scripts/smoke-test.mjs",
    "/DEPLOY.md",
    "/BACKEND.md",
    "/static-server.out.log",
    "/assets/founder-arc.svg.map"
  ];
  for (const path of blockedPaths) {
    const res = await get(path);
    assert(res.status === 403 || res.status === 404, `${path} expected blocked, got ${res.status}`);
  }
});

await check("head route omits body", async () => {
  const res = await fetch(`${baseUrl}/research/`, { method: "HEAD" });
  assert(res.status === 200, `expected 200, got ${res.status}`);
  assert(res.headers.get("content-type")?.startsWith("text/html"), "HEAD missing html content type");
  assert((await res.text()) === "", "HEAD response should not include body");
});

await check("bad inquiry content type rejected", async () => {
  const res = await fetch(`${baseUrl}/api/inquiries`, {
    method: "POST",
    headers: {
      "content-type": "text/plain",
      origin: baseUrl
    },
    body: "nope"
  });
  assert(res.status === 400, `expected 400, got ${res.status}`);
});

await check("missing-origin inquiry rejected", async () => {
  const res = await fetch(`${baseUrl}/api/inquiries`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "training-hub",
      name: "Smoke Test",
      email: "smoke@example.com",
      message: "This should be rejected because same-origin evidence is missing."
    })
  });
  assert(res.status === 403, `expected 403, got ${res.status}`);
});

await check("cross-origin inquiry rejected", async () => {
  const res = await fetch(`${baseUrl}/api/inquiries`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: "https://example.invalid"
    },
    body: new URLSearchParams({
      type: "montana-ai-x",
      name: "Smoke Test",
      email: "smoke@example.com",
      message: "This should be rejected before validation."
    })
  });
  assert(res.status === 403, `expected 403, got ${res.status}`);
});

await check("valid inquiry accepted", async () => {
  const res = await fetch(`${baseUrl}/api/inquiries`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: baseUrl
    },
    body: JSON.stringify({
      type: "training-hub",
      name: "Smoke Test",
      email: "smoke@example.com",
      organization: "Aristotle QA",
      topic: "Smoke",
      message: "This is a smoke test inquiry for the hardened website backend."
    })
  });
  const body = await res.json();
  assert(res.status === 201, `expected 201, got ${res.status}`);
  assert(body.ok === true && body.id, "missing accepted inquiry id");
});

await check("admin export protected and functional", async () => {
  const blocked = await fetch(`${baseUrl}/api/inquiries`);
  assert(blocked.status === 404, `unauthorized export expected 404, got ${blocked.status}`);
  if (process.env.WEBSITE_BASE_URL && !process.env.ARISTOTLE_ADMIN_TOKEN) return;
  const allowed = await fetch(`${baseUrl}/api/inquiries`, {
    headers: { authorization: `Bearer ${process.env.ARISTOTLE_ADMIN_TOKEN ?? smokeAdminToken}` }
  });
  const body = await allowed.json();
  assert(allowed.status === 200, `authorized export expected 200, got ${allowed.status}`);
  assert(body.ok === true && body.count >= 1, "missing exported inquiry");
  assert(body.inquiries.some((item) => item.email === "smoke@example.com" && item.ipHash), "missing smoke inquiry or ip hash");
});

await check("admin console login dashboard summary csv logout", async () => {
  if (process.env.WEBSITE_BASE_URL && !process.env.ARISTOTLE_ADMIN_TOKEN) return;
  const token = process.env.ARISTOTLE_ADMIN_TOKEN ?? smokeAdminToken;
  const loginPage = await fetch(`${baseUrl}/admin/`, { redirect: "manual" });
  assert(loginPage.status === 401, `login page expected 401, got ${loginPage.status}`);

  const login = await fetch(`${baseUrl}/admin/login`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: baseUrl
    },
    body: new URLSearchParams({ token })
  });
  assert(login.status === 303, `login expected 303, got ${login.status}`);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert(cookie?.startsWith("aristotle_admin="), "missing admin session cookie");

  const dashboard = await fetch(`${baseUrl}/admin/`, { headers: { cookie } });
  assert(dashboard.status === 200, `dashboard expected 200, got ${dashboard.status}`);
  assert((await dashboard.text()).includes("Recent inquiries"), "dashboard missing table marker");

  const summary = await fetch(`${baseUrl}/api/inquiries/summary`, { headers: { cookie } });
  const summaryBody = await summary.json();
  assert(summary.status === 200 && summaryBody.summary.total >= 1, "bad summary response");

  const csv = await fetch(`${baseUrl}/api/inquiries.csv`, { headers: { cookie } });
  const csvText = await csv.text();
  assert(csv.status === 200 && csvText.includes("smoke@example.com"), "bad csv export");

  const logout = await fetch(`${baseUrl}/admin/logout`, {
    method: "POST",
    redirect: "manual",
    headers: {
      cookie,
      origin: baseUrl
    }
  });
  assert(logout.status === 303, `logout expected 303, got ${logout.status}`);
});

const failed = checks.filter((item) => !item.ok);
for (const item of checks) {
  console.log(`${item.ok ? "ok" : "not ok"} - ${item.name}${item.error ? `: ${item.error}` : ""}`);
}

if (failed.length > 0) {
  process.exitCode = 1;
}

if (child) {
  child.kill();
  rmSync(tempDataDir, { recursive: true, force: true });
}
