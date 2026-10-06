import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const java = process.env.ARISTOTLE_JAVA ?? 'java';
const jar = process.env.TLA_TOOLS_JAR;
if (!jar) throw new Error('TLA_TOOLS_JAR must point to the reviewed TLC release; see docs/specs/README.md');
const sha = data => createHash('sha256').update(data).digest('hex');
const expected = '936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88';
if (sha(readFileSync(jar)) !== expected) throw new Error('Unreviewed TLC binary: expected v1.7.4 SHA-256');
const output = path.join(root, 'reports', 'formal');
mkdirSync(output, { recursive: true });
const directory = mkdtempSync(path.join(output, 'run-'));
const spec = readFileSync(path.join(root, 'docs/specs/MeshReconciliation.tla'), 'utf8').replaceAll('\r\n', '\n');
const manifest = { tool: 'TLC v1.7.4 / TLC2 2.19', jar_sha256: expected, spec_sha256: sha(spec), started_at: new Date().toISOString(), results: [] };
const configurations = [
  ['two-edge', 'MeshReconciliation.cfg', spec, false],
  ['quota', 'MeshReconciliation.quota.cfg', spec, false],
  ['negative-quota', 'MeshReconciliation.quota.cfg', spec.replace('quota[e] < MaxDisconnectedWarrants /\\ clock', 'TRUE /\\ clock'), true],
  ['negative-revocation', 'MeshReconciliation.quota.cfg', spec.replace('  /\\ ~known[e]\n', '  /\\ TRUE\n'), true]
];
for (const [name, configName, source, negative] of configurations) {
  if (negative && source === spec) throw new Error(`Mutation ${name} did not change the model`);
  const runDir = path.join(directory, name);
  mkdirSync(runDir);
  const config = readFileSync(path.join(root, 'docs/specs', configName));
  writeFileSync(path.join(runDir, 'MeshReconciliation.tla'), source);
  writeFileSync(path.join(runDir, 'MeshReconciliation.cfg'), config);
  const args = ['-Xmx1g', '-XX:+UseParallelGC', '-cp', path.resolve(jar), 'tlc2.TLC', '-workers', '2', '-config', 'MeshReconciliation.cfg', 'MeshReconciliation.tla'];
  const result = spawnSync(java, args, { cwd: runDir, encoding: 'utf8', timeout: 180000, windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
  const log = `${result.stdout ?? ''}\n${result.stderr ?? ''}\n${result.error ?? ''}`;
  writeFileSync(path.join(runDir, 'tlc.txt'), log);
  const ok = !result.error && (negative ? result.status !== 0 && /Invariant .* is violated/.test(log) : result.status === 0 && /Model checking completed. No error has been found/.test(log));
  manifest.results.push({ name, config_sha256: sha(config), spec_sha256: sha(source), exit_code: result.status, expected_counterexample: negative, status: ok ? 'PASS' : 'FAIL', log_sha256: sha(log), log: path.relative(output, path.join(runDir, 'tlc.txt')) });
  writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${negative ? ' (expected counterexample)' : ''}`);
}
console.log(path.join(directory, 'manifest.json'));
if (manifest.results.some(r => r.status !== 'PASS')) process.exitCode = 1;
