#!/usr/bin/env node
import { accessSync, constants as fsConstants, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const failures = [];
const warnings = [];

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) fail(`${name} is required for production.`);
  return value ?? "";
}

function checkUrl(name, value, { httpsRequired = true } = {}) {
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) fail(`${name} must be http or https.`);
    if (httpsRequired && parsed.protocol !== "https:") fail(`${name} must use https in production.`);
    return parsed;
  } catch {
    fail(`${name} must be a valid absolute URL.`);
    return null;
  }
}

const origin = requireEnv("PUBLIC_ORIGIN");
if (origin) checkUrl("PUBLIC_ORIGIN", origin);

const adminToken = requireEnv("ARISTOTLE_ADMIN_TOKEN");
if (adminToken && adminToken.length < 32) fail("ARISTOTLE_ADMIN_TOKEN must be at least 32 characters.");
if (/changeme|replace|password|secret|token/i.test(adminToken)) fail("ARISTOTLE_ADMIN_TOKEN looks like a placeholder.");

const dataDir = requireEnv("ARISTOTLE_WEBSITE_DATA_DIR");
if (dataDir) {
  try {
    accessSync(dataDir, fsConstants.R_OK | fsConstants.W_OK);
  } catch {
    fail(`ARISTOTLE_WEBSITE_DATA_DIR must exist and be readable/writable: ${dataDir}`);
  }
  const resolvedData = resolve(dataDir);
  if (resolvedData.startsWith(appDir)) warn("ARISTOTLE_WEBSITE_DATA_DIR is inside the app directory; use durable external storage for production.");
}

if (process.env.TRUST_PROXY !== "1") warn("TRUST_PROXY is not enabled. Set TRUST_PROXY=1 when deployed behind a trusted reverse proxy.");
if (process.env.STORE_RAW_IP === "1") warn("STORE_RAW_IP=1 stores raw IP addresses; confirm this is required by policy.");

const requiredFiles = [
  "index.html",
  "about/index.html",
  "research/index.html",
  "papers/gplane/index.html",
  "support/index.html",
  "training-hub/index.html",
  "montana-ai-x/index.html",
  "aristotleos/index.html",
  "governance-thesis/index.html",
  "privacy/index.html",
  "ui-prototype/index.html",
  "BACKEND.md",
  "DEPLOY.md",
  "ASSETS.md",
  "serve.mjs",
  "papers/files/governance-plane-ai-native-6g.pdf",
  "papers/files/deterministic-governance-enforcement.pdf",
  "papers/files/the-gplane-architecture.pdf",
  "papers/files/insurability-autonomous-systems.pdf",
  "papers/files/authority-routing-autonomous-systems.pdf",
  "papers/files/governance-kernel.pdf",
  "papers/files/cryptographic-governance-evidence-ledgers.pdf",
  "papers/files/new-precedent-born-of-ai.pdf",
  "papers/files/from-copper-to-code-montanas-ai-moment.pdf",
  "papers/files/montana-wrong-part-of-ai.pdf"
];

for (const file of requiredFiles) {
  const target = resolve(appDir, file);
  if (!existsSync(target) || !statSync(target).isFile()) fail(`required file missing: ${file}`);
}

const assetDir = resolve(appDir, "assets");
const imageAssets = existsSync(assetDir)
  ? readdirSync(assetDir).filter((name) => [".png", ".svg", ".webp", ".jpg", ".jpeg"].includes(extname(name).toLowerCase()))
  : [];
if (imageAssets.length < 8) warn("fewer than 8 local visual assets found; verify the deployed site has all intended imagery.");

for (const message of warnings) console.warn(`warning: ${message}`);
if (failures.length > 0) {
  for (const message of failures) console.error(`error: ${message}`);
  process.exit(1);
}

console.log("production preflight passed");
