import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { readRequestBody, readResponseBody, createLoginLimiter } from './http-limits.mjs';

function rejectedDeclaration(url, bytes, headers = {}) {
  // Assert rejection from headers alone. Sending a large body after the server
  // closes the connection can legitimately produce ECONNRESET instead of 413.
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'POST', headers: { ...headers, 'content-length': String(bytes) } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject); req.end();
  });
}

test('body reader bounds declared and chunked input and stalled requests', async () => {
  const declared = new PassThrough(); declared.headers = { 'content-length': '8193' };
  await assert.rejects(readRequestBody(declared, 8192), e => e.status === 413);
  const chunked = new PassThrough(); chunked.headers = {};
  const pending = readRequestBody(chunked, 8);
  chunked.write('12345'); chunked.write('67890');
  await assert.rejects(pending, e => e.status === 413);
  const stalled = new PassThrough(); stalled.headers = {};
  await assert.rejects(readRequestBody(stalled, 8, 20), e => e.status === 408);
  for (const stream of [declared, chunked, stalled]) stream.destroy();
});

test('upstream reader cancels over-limit chunked bodies', async () => {
  let cancelled = false;
  const body = new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(16)); }, cancel() { cancelled = true; } });
  await assert.rejects(readResponseBody(new Response(body), 8), /too large/);
  assert.equal(cancelled, true);
});

test('login limiter has bounded state, limits bursts, and recovers', () => {
  let now = 0;
  const accept = createLoginLimiter(() => now);
  for (let i = 0; i < 60; i++) assert.equal(accept(), true);
  assert.equal(accept(), false);
  now += 1000; assert.equal(accept(), true); assert.equal(accept(), false);
});

test('production console enforces auth, limits and security headers without breaking proxy', async t => {
  let forwarded;
  const gateway = http.createServer((req, res) => {
    forwarded = req.headers;
    if (req.url === '/v1/large') { res.end(Buffer.alloc(8 * 1024 * 1024 + 1)); return; }
    res.setHeader('content-security-policy', "default-src *");
    res.setHeader('set-cookie', 'upstream=untrusted');
    res.end('gateway fixture');
  }).listen(0, '127.0.0.1');
  await once(gateway, 'listening');
  t.after(() => { gateway.closeAllConnections(); gateway.close(); });
  const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
    env: { ...process.env, NODE_ENV: 'production', PORT_CONSOLE: '0', CONSOLE_ACCESS_TOKEN: 'test-only-console-token', CONSOLE_OPERATOR_API_KEY: '', CONSOLE_GATEWAY_BASE_URL: `http://127.0.0.1:${gateway.address().port}` },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => child.kill());
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('console startup timed out')), 10_000);
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; const match = output.match(/ on (\d+);/); if (match) { clearTimeout(timer); resolve(Number(match[1])); } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`console exited ${code}`)); });
  });
  const base = `http://127.0.0.1:${port}`;
  const health = await fetch(`${base}/console-health`);
  assert.equal(health.status, 200);
  assert.match(health.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.ok(health.headers.get('strict-transport-security'));
  const denied = await fetch(`${base}/health`, { headers: { cookie: 'aristotle_console=%broken' } });
  assert.match(await denied.text(), /Enter the console access token/);
  assert.equal(await rejectedDeclaration(`${base}/console-login`, 8193), 413);
  const valid = await fetch(`${base}/console-login`, { method: 'POST', body: 'token=test-only-console-token', redirect: 'manual' });
  assert.equal(valid.status, 303);
  assert.match(valid.headers.get('set-cookie'), /; Secure/);
  assert.match(valid.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  const headers = { cookie: 'aristotle_console=test-only-console-token', 'x-operator-key': 'spoofed', authorization: 'Bearer spoofed' };
  const proxied = await fetch(`${base}/health`, { headers });
  assert.equal(await proxied.text(), 'gateway fixture');
  assert.equal(forwarded.cookie, undefined);
  assert.equal(forwarded.authorization, undefined);
  assert.equal(forwarded['x-operator-key'], undefined);
  assert.equal(proxied.headers.get('set-cookie'), null);
  assert.match(proxied.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await fetch(`${base}/v1/large`, { headers })).status, 502);
  assert.equal(await rejectedDeclaration(`${base}/v1/test`, 1024 * 1024 + 1, headers), 413);
  let limited = false;
  for (let i = 0; i < 61; i++) {
    const attempt = await fetch(`${base}/console-login`, { method: 'POST', body: 'token=wrong' });
    await attempt.text();
    if (attempt.status === 429) { limited = true; assert.equal(attempt.headers.get('retry-after'), '1'); break; }
  }
  assert.equal(limited, true);
});

test('production console refuses to start without an access token', async () => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
    env: { ...process.env, NODE_ENV: 'production', CONSOLE_ACCESS_TOKEN: '', PORT_CONSOLE: '0' },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let error = '';
  child.stderr.on('data', chunk => { error += chunk; });
  const [code] = await once(child, 'exit');
  assert.notEqual(code, 0);
  assert.match(error, /Production console requires CONSOLE_ACCESS_TOKEN/);
});
