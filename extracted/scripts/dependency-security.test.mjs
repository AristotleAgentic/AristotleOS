import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Resolve the active dependency graph, never a stale pnpm-store directory.
const require = createRequire(import.meta.url);
const mastra = createRequire(require.resolve('../packages/mastra/node_modules/@mastra/core/package.json'));
const ui = createRequire(mastra.resolve('@ai-sdk/ui-utils-v5'));
const providerPath = ui.resolve('@ai-sdk/provider-utils');
const matter = createRequire(mastra.resolve('gray-matter'));
const yaml = createRequire(matter.resolve('js-yaml'));
const argparse = createRequire(yaml.resolve('argparse'));
const sprintfPath = argparse.resolve('sprintf-js');

for (const entry of [sprintfPath, path.resolve(path.dirname(sprintfPath), '../dist/sprintf.min.js')]) {
  test(`sprintf precision attack is bounded: ${path.basename(entry)}`, () => {
    const { sprintf } = require(entry);
    for (const precision of ['101', '999999999', '9'.repeat(400)]) {
      for (const format of ['e', 'f', 'g']) assert.ok(sprintf(`%.${precision}${format}`, 1.25).length < 110);
    }
    assert.equal(sprintf('%.0g', 1.25), '1');
    assert.equal(sprintf('%.2f %04d %s', 1.25, 7, 'ok'), '1.25 0007 ok');
  });
}
for (const entry of [providerPath, providerPath.replace(/index\.js$/, 'index.mjs')]) {
  const provider = await import(pathToFileURL(entry).href);
  for (const [name, handler] of [
    ['status', provider.createStatusCodeErrorResponseHandler()],
    ['json', provider.createJsonResponseHandler({})],
    ['error', provider.createJsonErrorResponseHandler({ errorSchema: {}, errorToMessage: () => 'error' })]
  ]) {
    test(`${path.extname(entry)} ${name} cancels oversized chunked body`, async () => {
      let cancelled = false;
      let chunks = 0;
      const body = new ReadableStream({ pull(c) { if (chunks++ < 18) c.enqueue(new Uint8Array(1024 * 1024)); else c.close(); }, cancel() { cancelled = true; } });
      await assert.rejects(handler({ response: new Response(body), url: 'https://fixture.invalid', requestBodyValues: {} }), /16 MiB/);
      assert.equal(cancelled, true);
    });
    test(`${path.extname(entry)} ${name} rejects declared oversize before reading`, async () => {
      const response = new Response('small', { headers: { 'content-length': '999999999' } });
      await assert.rejects(handler({ response, url: 'https://fixture.invalid', requestBodyValues: {} }), /16 MiB/);
    });
  }
  test(`${path.extname(entry)} bounded reader preserves UTF-8 across chunks`, async () => {
    const response = new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([0xe2])); c.enqueue(new Uint8Array([0x82, 0xac])); c.close(); } }));
    const result = await provider.createStatusCodeErrorResponseHandler()({ response, url: 'https://fixture.invalid', requestBodyValues: {} });
    assert.equal(result.value.responseBody, '€');
  });
}
test('LangChain UUID supports v4 and refuses undersized v3/v5 buffers', () => {
  const lc = createRequire(require.resolve('../packages/langchain/node_modules/@langchain/core/package.json'));
  const uuid = lc('uuid');
  assert.equal(uuid.validate(uuid.v4()), true);
  for (const fn of [uuid.v3, uuid.v5]) assert.throws(() => fn('fixture', uuid.v4(), new Uint8Array(1)), RangeError);
});
