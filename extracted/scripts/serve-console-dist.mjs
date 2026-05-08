import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "apps", "console-ui", "dist");
const port = Number(process.env.PORT_CONSOLE_UI ?? 4173);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "content-type": contentTypes[ext] ?? "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  const requested = req.url && req.url !== "/" ? decodeURIComponent(req.url.split("?")[0]) : "/index.html";
  const candidate = path.join(root, requested.replace(/^\/+/, ""));
  const safePath = path.normalize(candidate);
  const target = safePath.startsWith(root) && fs.existsSync(safePath) && fs.statSync(safePath).isFile()
    ? safePath
    : path.join(root, "index.html");

  if (!fs.existsSync(target)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("console build not found");
    return;
  }

  sendFile(res, target);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`[console-dist] serving ${root} on http://0.0.0.0:${port}`);
});
