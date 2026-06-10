#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const websiteDir = resolve(here, "..");
const consoleDir = resolve(websiteDir, "..", "console-ui");
const command = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "npm";
const args = process.platform === "win32"
  ? [
    "/d",
    "/s",
    "/c",
    "npm.cmd run build -- --base=/ui-prototype/ --outDir=../website/ui-prototype --emptyOutDir"
  ]
  : [
    "run",
    "build",
    "--",
    "--base=/ui-prototype/",
    "--outDir=../website/ui-prototype",
    "--emptyOutDir"
  ];

const result = spawnSync(
  command,
  args,
  {
    cwd: consoleDir,
    env: {
      ...process.env,
      VITE_ARISTOTLE_AGENTIC_HOME: "/aristotleos/",
      VITE_PRODUCTION_CONSOLE_URL: "https://aristotle-console.onrender.com/public"
    },
    stdio: "inherit"
  }
);

if (result.status !== 0) {
  if (result.error) {
    console.error(`failed to start console-ui build: ${result.error.message}`);
  } else if (result.signal) {
    console.error(`console-ui build stopped by signal: ${result.signal}`);
  } else {
    console.error(`console-ui build exited with status ${result.status}`);
  }
  process.exit(result.status ?? 1);
}
