#!/usr/bin/env node
/**
 * Tiny local static server for previewing apps/website/index.html
 * before deploying. Zero dependencies; uses node:http.
 *
 * Usage:
 *   node apps/website/serve.mjs [port]
 * Default port: 5173 (Vite-compat) but you can pass any.
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, dirname, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] ?? process.env.PORT ?? 5173);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico":  "image/x-icon",
  ".webp": "image/webp",
  ".txt":  "text/plain; charset=utf-8"
};

const server = createServer((req, res) => {
  const url = req.url?.split("?")[0] ?? "/";
  const rel = url === "/" ? "/index.html" : url;
  const target = normalize(resolve(here, "." + rel));
  if (!target.startsWith(here)) {
    res.writeHead(403); res.end("forbidden"); return;
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end(`not found: ${rel}`);
    return;
  }
  res.writeHead(200, { "content-type": mime[extname(target)] ?? "application/octet-stream" });
  res.end(readFileSync(target));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`aristotleagentic.com preview: http://127.0.0.1:${port}/`);
});
