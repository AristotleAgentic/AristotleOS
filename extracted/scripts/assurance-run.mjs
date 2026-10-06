import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.dirname(workspace);
const label = process.argv[2] ?? 'baseline';
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('invalid run label');
const profile = process.argv[3] ?? 'full';
if (!['full', 'dependency', 'production'].includes(profile)) throw new Error('invalid run profile');
const output = path.join(repo, 'docs', 'assurance', label);
mkdirSync(output, { recursive: true });
const manifestPath = path.join(output, label === 'baseline' ? 'BASELINE_ASSURANCE_MANIFEST.json' : 'RESULTS.json');
if (existsSync(manifestPath)) throw new Error('Run already exists; use a fresh label to preserve evidence');
const git = (...args) => execFileSync('git', ['-c', `safe.directory=${repo.replaceAll('\\', '/')}`, '-C', repo, ...args], { encoding: 'utf8' }).trim();
const hash = data => createHash('sha256').update(data).digest('hex');
const tracked = git('ls-files').split('\n');
const pkg = JSON.parse(readFileSync(path.join(workspace, 'package.json'), 'utf8'));
const manifest = {
  schema_version: 1, label, profile, started_at: new Date().toISOString(), source_commit: git('rev-parse', 'HEAD'),
  branch: git('branch', '--show-current'), initial_status: git('status', '--porcelain'),
  environment: { node: process.version, platform: process.platform, architecture: process.arch, package_manager: pkg.packageManager },
  lock_sha256: hash(readFileSync(path.join(workspace, 'pnpm-lock.yaml'))),
  packages: tracked.filter(p => p.endsWith('/package.json')).map(p => {
    const item = JSON.parse(readFileSync(path.join(repo, p), 'utf8'));
    return { path: p, name: item.name, version: item.version, scripts: item.scripts ?? {} };
  }),
  artifacts: tracked.filter(p => /schema|openapi|specs\/|PROOF_STATUS|LIMITATIONS|VALIDATION_MATRIX|REVIEWER|replay.*json|apps\/aristotle-cli\/src\/index.ts/i.test(p)).map(p => ({ path: p, sha256: hash(readFileSync(path.join(repo, p))) })),
  source_hashes: git('ls-files', '--cached', '--others', '--exclude-standard').split('\n')
    .filter(p => /\.(?:ts|mts|mjs|json|yaml|yml|tla|cfg|patch)$/.test(p) && !p.startsWith('docs/assurance/') && existsSync(path.join(repo, p)))
    .map(p => ({ path: p, sha256: hash(readFileSync(path.join(repo, p))) })),
  test_inventory: tracked.filter(p => /(?:\.test\.|\.spec\.|benchmark|\/bench\/|\.tla$)/.test(p)),
  command_inventory: pkg.scripts,
  inventory_scope: 'Tracked package scripts and hashed schema/API/CLI/proof sources; not a claim of semantic API completeness.',
  results: [], status: 'RUNNING'
};
const save = () => writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
save();
const commands = profile === 'production' ? [
  ['frozen-install', 'corepack pnpm@10.32.1 install --frozen-lockfile --offline --ignore-scripts'],
  ['affected-builds', 'corepack pnpm@10.32.1 -r --workspace-concurrency=1 --filter @aristotle/adapter-sdk --filter @aristotle/execution-control-runtime --filter @aristotle/mavlink-px4 --filter @aristotle/modbus-adapter --filter @aristotle/bacnet-adapter --filter @aristotle/dnp3-adapter --filter @aristotle/opcua-adapter --filter @aristotle/ros2-bridge --filter @aristotle/http-gateway build'],
  ['typecheck', 'corepack pnpm@10.32.1 typecheck'],
  ['dependency-exploits', 'node --test scripts/dependency-security.test.mjs'],
  ['adapter-tests', 'corepack pnpm@10.32.1 --filter @aristotle/adapter-sdk test'],
  ['effect-tests', 'corepack pnpm@10.32.1 test:proxy-effects'],
  ['protocol-tests', 'corepack pnpm@10.32.1 test:protocol-adapters'],
  ['single-drone-loopback', 'corepack pnpm@10.32.1 test:single-drone'],
  ['production-preflight', 'corepack pnpm@10.32.1 test:production-preflight'],
  ['simulator-negative-control', 'corepack pnpm@10.32.1 test:px4-sitl'],
  ['audit-gate-tests', 'corepack pnpm@10.32.1 test:audit'],
  ['dependency-audit', 'node scripts/audit-deps.mjs']
] : profile === 'dependency' ? [
  ['frozen-install', 'corepack pnpm@10.32.1 install --frozen-lockfile --offline --ignore-scripts'],
  ['affected-builds', 'corepack pnpm@10.32.1 -r --workspace-concurrency=1 --filter @aristotle/mastra --filter @aristotle/mcp-server-stdio --filter @aristotle/os-cli build'],
  ['typecheck', 'corepack pnpm@10.32.1 typecheck'],
  ['affected-package-tests', 'corepack pnpm@10.32.1 -r --workspace-concurrency=1 --filter @aristotle/http-gateway --filter @aristotle/agent-os --filter @aristotle/authority-router --filter @aristotle/evidence-ledger --filter @aristotle/execution-gate --filter @aristotle/governance-kernel --filter @aristotle/meta-authority-registry --filter @aristotle/policy-compiler --filter @aristotle/simulation-engine --filter @aristotle/witness-service --filter @aristotle/mcp-server-stdio --filter @aristotle/mastra test'],
  ['effect-tests', 'corepack pnpm@10.32.1 test:proxy-effects'],
  ['cli-tests', 'corepack pnpm@10.32.1 test:cli'],
  ['audit-gate-tests', 'node --test scripts/audit-deps.test.mjs'],
  ['dependency-audit', 'node scripts/audit-deps.mjs'],
  ['sbom', 'node scripts/generate-sbom.mjs'],
  ['boundary-pilot', 'node apps/aristotle-cli/dist/index.js pilot']
] : [
  ['build-prerequisites', 'corepack pnpm@10.32.1 -r --filter @aristotle/shared-types --filter @aristotle/shared-schemas --filter @aristotle/governance-core --filter @aristotle/trial-engine --filter @aristotle/execution-control-runtime --filter @aristotle/mesh-runtime --filter @aristotle/os-sdk --workspace-concurrency=1 build'],
  ['typecheck', 'corepack pnpm@10.32.1 typecheck'],
  ...Object.keys(pkg.scripts).filter(s => s.startsWith('test:') && !['test:all'].includes(s)).map(s => [s.replaceAll(':', '-'), `corepack pnpm@10.32.1 run ${s}`]),
  ['workspace-tests', label === 'baseline' ? 'corepack pnpm@10.32.1 run test:all' : 'corepack pnpm@10.32.1 -r --workspace-concurrency=1 --filter "!@aristotle/os-cli" --filter "!aristotle-autonomous-governance-os" test'],
  ['reviewer-verify', 'corepack pnpm@10.32.1 reviewer:verify'],
  ['mesh-40-asset', 'node --import tsx --test examples/mesh/swarm-partition-40-asset.test.ts examples/mesh/published.replay.test.ts'],
  ['uav-constructed-demo', 'node scripts/verify-uav-swarm-proof.mjs'],
  ['build-all', 'corepack pnpm@10.32.1 -r --workspace-concurrency=1 build'],
  ['benchmark-runtime', 'corepack pnpm@10.32.1 benchmark:runtime'],
  ['boundary-pilot', 'node apps/aristotle-cli/dist/index.js pilot'],
  ['clean-room', 'node scripts/clean-room-scan.mjs'],
  ['sbom', 'node scripts/generate-sbom.mjs'],
  ['dependency-audit', 'node scripts/audit-deps.mjs'],
  ['helm-validate', 'node scripts/validate-helm.mjs']
];
for (const [name, command] of commands) {
  const started = Date.now();
  manifest.current_command = { name, command, started_at: new Date(started).toISOString() };
  save();
  const file = `${name}.txt`;
  const logPath = path.join(output, file);
  writeFileSync(logPath, '');
  let log = '';
  const capture = value => { const chunk = String(value); log += chunk; appendFileSync(logPath, chunk); };
  const result = await new Promise(resolve => {
    const child = spawn(command, { cwd: workspace, shell: true, windowsHide: true, env: { ...process.env, FORCE_COLOR: '0' } });
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.on('error', e => { capture(e); resolve({ status: 'ENVIRONMENT_BLOCKED', exit_code: null }); });
    child.on('close', code => resolve({ status: code === 0 ? 'PASS' : 'FAIL', exit_code: code }));
  });
  const totals = [...log.matchAll(/(?:#|ℹ) (tests|pass|fail|skipped) (\d+)/g)].map(m => ({ kind: m[1], count: Number(m[2]) }));
  manifest.results.push({ name, command, ...result, duration_ms: Date.now() - started, log: file, log_sha256: hash(log), reported_counts: totals });
  delete manifest.current_command;
  save();
  console.log(`${result.status} ${name} (${Date.now() - started}ms)`);
}
manifest.results.push({ name: 'physical-validation', status: 'UNAVAILABLE', reason: 'No explicitly provisioned hardware or production test target.' });
manifest.results.push({ name: 'live-stack-checks', status: 'SKIPPED', reason: 'Do not exercise the user running stack; requires isolated service configuration.' });
manifest.status = manifest.results.some(r => r.status === 'FAIL') ? 'CHECKS_HAVE_FAILURES' : 'CHECKS_COMPLETED_WITH_LIMITATIONS';
manifest.finished_at = new Date().toISOString();
save();
console.log(manifestPath);
