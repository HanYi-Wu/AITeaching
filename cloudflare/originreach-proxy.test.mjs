import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import worker from './originreach-proxy.mjs';

const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });

test('fingerprinted public assets may be cached without sending credentials', async () => {
  let observed;
  globalThis.fetch = async (request, options) => {
    observed = { request, options };
    return new Response('asset', { status: 200 });
  };
  const response = await worker.fetch(new Request('https://or.whenry.cc.cd/assets/index-abcdefgh.js', {
    headers: { cookie: 'session=secret', authorization: 'Bearer secret' },
  }));
  assert.equal(observed.request.url, 'https://awa.nat100.top/assets/index-abcdefgh.js');
  assert.equal(observed.request.headers.has('cookie'), false);
  assert.equal(observed.request.headers.has('authorization'), false);
  assert.equal(observed.options.cf.cacheEverything, true);
  assert.match(response.headers.get('cache-control'), /immutable/);
  assert.equal(response.headers.get('x-originreach-edge'), '1');
});

test('authenticated API responses are never cached', async () => {
  let observed;
  globalThis.fetch = async (request, options) => {
    observed = { request, options };
    return new Response('private', { status: 200 });
  };
  const response = await worker.fetch(new Request('https://or.whenry.cc.cd/api/student/attempts', {
    headers: { authorization: 'Bearer secret' },
  }));
  assert.equal(observed.request.headers.get('authorization'), 'Bearer secret');
  assert.equal(observed.options.cf.cacheTtl, 0);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('x-originreach-edge'), '1');
});
