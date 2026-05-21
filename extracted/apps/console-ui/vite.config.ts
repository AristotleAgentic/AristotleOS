import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const gatewayTarget = process.env.VITE_GATEWAY_PROXY_TARGET ?? "http://localhost:8080";

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
