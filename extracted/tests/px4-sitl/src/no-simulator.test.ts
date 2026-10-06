import test from 'node:test';
import assert from 'node:assert/strict';
import { createSocket } from 'node:dgram';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('opted-in SITL check fails on a silent UDP listener instead of reporting success', async () => {
  const silent = createSocket('udp4');
  await new Promise<void>(resolve => silent.bind(0, '127.0.0.1', resolve));
  try {
    const childEnv = { ...process.env, ARISTOTLE_PX4_SITL_OPT_IN: '1', ARISTOTLE_PX4_SITL_HOST: '127.0.0.1', ARISTOTLE_PX4_SITL_PORT: String(silent.address().port) };
    delete childEnv.NODE_TEST_CONTEXT;
    const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', '--test', fileURLToPath(new URL('./integration.test.ts', import.meta.url))], {
        windowsHide: true, timeout: 10000,
        env: childEnv
      });
      let output = '';
      child.stdout.on('data', d => { output += d; });
      child.stderr.on('data', d => { output += d; });
      child.on('error', reject);
      child.on('close', code => resolve({ code, output }));
    });
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /No MAVLink traffic/);
  } finally { await new Promise<void>(resolve => silent.close(resolve)); }
});
