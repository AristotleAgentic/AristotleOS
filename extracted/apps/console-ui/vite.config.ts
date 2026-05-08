import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const gatewayTarget = process.env.VITE_GATEWAY_PROXY_TARGET ?? "http://localhost:8080";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 4173,
    proxy: {
      "/health": gatewayTarget,
      "/operator": gatewayTarget
    }
  },
  preview: {
    host: "0.0.0.0",
    port: 4173
  }
});
