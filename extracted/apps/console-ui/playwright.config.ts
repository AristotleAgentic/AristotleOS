import { defineConfig, devices } from "@playwright/test";

// Layout smoke for the public site / playground. The `test:e2e` script produces a
// fresh build; this config serves THAT build via `vite preview` on a dedicated
// port (4188) so the tests always exercise the just-built dist and never reuse an
// unrelated dev/preview server that may be running on the app's default 4173.
const PORT = 4188;
const BASE = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  use: {
    baseURL: BASE,
    trace: "off"
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "mobile", use: { ...devices["Pixel 5"] } }
  ],
  webServer: {
    command: `npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: BASE,
    // Dedicated port: never reuse a foreign server; always test the fresh build.
    reuseExistingServer: false,
    timeout: 60_000
  }
});
