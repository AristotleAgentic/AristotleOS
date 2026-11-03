import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

// Usage: node scripts/compare-assurance-surfaces.mjs BASELINE_CHECKOUT OUTPUT_JSON
// Both checkouts must have their runtime packages built first.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const baseline = path.resolve(process.argv[2]);
const output = path.resolve(process.argv[3]);
const git = (...args) => execFileSync('git', ['-c', `safe.directory=${baseline.replaceAll('\\', '/')}`, '-C', baseline, ...args], { encoding: 'utf8' });
const normalize = value => value.replaceAll('\r\n', '\n');
const hash = value => createHash('sha256').update(value).digest('hex');
const files = git('ls-files').trim().split('\n').filter(p => /(?:\/schemas\/|\.schema\.json$|\/openapi\.json$|\/openapi-spec\.gen\.ts$)/.test(p));
const schemas = files.map(file => {
  const before = normalize(git('show', `HEAD:${file}`));
  const after = normalize(readFileSync(path.join(repo, file), 'utf8'));
  return { file, baseline_sha256: hash(before), current_sha256: hash(after), status: before === after ? 'UNCHANGED' : 'CHANGED_REQUIRES_REVIEW' };
});
const runtimePath = 'extracted/shared/execution-control-runtime/dist/index.js';
const original = await import(pathToFileURL(path.join(baseline, runtimePath)).href);
const current = await import(pathToFileURL(path.join(repo, runtimePath)).href);
const oldExports = Object.keys(original), newExports = Object.keys(current);
const cliPath = 'extracted/apps/aristotle-cli/src/index.ts';
const helpCommands = source => source.slice(source.indexOf('Commands:\n'), source.indexOf('Examples:\n')).split('\n').filter(line => /^  \S/.test(line)).map(line => line.trim().split(/\s{2,}/)[0]);
const oldCommands = helpCommands(normalize(git('show', `HEAD:${cliPath}`)));
const newCommands = helpCommands(normalize(readFileSync(path.join(repo, cliPath), 'utf8')));
const result = {
  generated_at: new Date().toISOString(), baseline_commit: git('rev-parse', 'HEAD').trim(),
  scope: 'Normalized tracked schemas/generated OpenAPI, exported runtime names, generated execution-control OpenAPI and CLI help commands. Does not establish semantic substitutability, every TypeScript signature, behavior or binary compatibility.',
  schemas,
  runtime_exports_removed: oldExports.filter(x => !newExports.includes(x)),
  runtime_exports_added: newExports.filter(x => !oldExports.includes(x)),
  execution_control_openapi_unchanged: JSON.stringify(original.executionControlOpenApiSpec()) === JSON.stringify(current.executionControlOpenApiSpec()),
  cli_commands_removed: oldCommands.filter(x => !newCommands.includes(x)),
  cli_commands_added: newCommands.filter(x => !oldCommands.includes(x)),
  security_behavior_changes: 'See extracted/docs/effect-accounting.md; unchanged schema is not unchanged behavior.'
};
if (!oldCommands.length || !newCommands.length) throw new Error('CLI inventory extraction failed');
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(output);
if (schemas.some(x => x.status !== 'UNCHANGED') || result.runtime_exports_removed.length || result.cli_commands_removed.length || !result.execution_control_openapi_unchanged) process.exitCode = 1;
