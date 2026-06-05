import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// 127.0.0.1 (not "localhost") to avoid Node 20+ dual-stack IPv6-first resolution.
// The gateway binds IPv4 (HOST_HTTP_GATEWAY=127.0.0.1 in local-control-plane.mjs)
// so localhost → ::1 → ECONNREFUSED. Explicit IPv4 keeps the proxy hop stable.
const gatewayTarget = process.env.VITE_GATEWAY_PROXY_TARGET ?? "http://127.0.0.1:8080";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@aristotle/trial-engine": fileURLToPath(new URL("../../shared/trial-engine/src/index.ts", import.meta.url))
    }
  },
  server: {
    host: "0.0.0.0",
    port: 4173,
    proxy: {
      "/health": gatewayTarget,
      "/v1": gatewayTarget,
      "/operator": gatewayTarget
    }
  },
  preview: {
    host: "0.0.0.0",
    port: 4173
  }
});
