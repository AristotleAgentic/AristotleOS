#!/usr/bin/env node
// Fail fast with a clear message when someone installs with the wrong package
// manager. AristotleOS is a pnpm workspace and uses the `workspace:` protocol in
// its package dependencies, which npm/yarn-classic do not understand (npm errors
// with a cryptic EUNSUPPORTEDPROTOCOL). pnpm-lock.yaml is the single source of
// truth for reproducible, deterministic installs.
//
// Run directly (`node scripts/enforce-pnpm.mjs`) it is a no-op — it only blocks
// when invoked as a package-manager lifecycle script under a non-pnpm manager.

const userAgent = process.env.npm_config_user_agent ?? "";

// No agent => invoked directly (not via a package manager): allow.
if (userAgent && !userAgent.startsWith("pnpm")) {
  const manager = userAgent.split("/")[0] || "this package manager";
  process.stderr.write(
    `\n[31mAristotleOS is a pnpm workspace and cannot be installed with ${manager}.[0m\n` +
      `It uses the \`workspace:\` dependency protocol; pnpm-lock.yaml is the source of truth.\n\n` +
      `Install with pnpm instead:\n\n` +
      `  corepack enable\n` +
      `  corepack pnpm install --frozen-lockfile\n\n`
  );
  process.exit(1);
}
