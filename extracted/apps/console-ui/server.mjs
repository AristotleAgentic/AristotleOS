import express from "express";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const port = Number(process.env.PORT_CONSOLE ?? process.env.PORT ?? 4173);
const gatewayBaseUrl = (process.env.CONSOLE_GATEWAY_BASE_URL ?? "http://http-gateway:8080").replace(/\/$/, "");
const root = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(root, "dist");
const indexPath = path.join(distDir, "index.html");

const proxyPaths = ["/operator", "/v1", "/health", "/ready", "/metrics"];

const readRawBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return chunks.length ? Buffer.concat(chunks) : undefined;
};

const proxyToGateway = async (req, res) => {
  const target = `${gatewayBaseUrl}${req.originalUrl}`;
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (!value || key.toLowerCase() === "host" || key.toLowerCase() === "content-length") continue;
      headers.set(key, Array.isArray(value) ? value.join(",") : value);
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
    publicRoutes: ["/public", "/try", "/"]
  });
});

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
