import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert';
import { requestCore } from '../src/net/request.js';
import { ApiError } from '../src/net/errors.js';

describe('requestCore', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('requestCore sends If-None-Match when provided', async () => {
    let capturedInit: any = null;
    let capturedUrl: any = null;

    globalThis.fetch = (async (url: any, init: any) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(JSON.stringify({ data: { id: 123 } }), {
        status: 200,
        headers: { ETag: '"etag-a"' },
      });
    }) as any;

    const res = await requestCore({
      apiBaseUrl: 'https://api.aluvia.io/v1/',
      apiKey: 'test-api-key',
      method: 'GET',
      path: '/account/connections/123',
      ifNoneMatch: '"etag-prev"',
    });

    assert.ok(String(capturedUrl).endsWith('/account/connections/123'));
    assert.strictEqual(capturedInit.method, 'GET');
    assert.strictEqual(capturedInit.headers['If-None-Match'], '"etag-prev"');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.etag, '"etag-a"');
  });

  test('requestCore POSTs JSON body with Content-Type when body is provided', async () => {
    let capturedInit: any = null;

    globalThis.fetch = (async (_url: any, init: any) => {
      capturedInit = init;
      return new Response(JSON.stringify({ data: { id: 999 } }), {
        status: 201,
        headers: { ETag: '"etag-c"', 'Content-Type': 'application/json' },
      });
    }) as any;

    const res = await requestCore({
      apiBaseUrl: 'https://api.aluvia.io/v1',
      apiKey: 'test-api-key',
      method: 'POST',
      path: '/account/connections',
      body: {},
    });

    assert.strictEqual(capturedInit.method, 'POST');
    assert.strictEqual(capturedInit.headers['Content-Type'], 'application/json');
    assert.strictEqual(res.status, 201);
    assert.ok(res.body);
  });

  test('requestCore times out and rejects', async () => {
    globalThis.fetch = ((_: any, init: any) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
      });
    }) as any;

    await assert.rejects(
      async () => {
        await requestCore({
          apiBaseUrl: 'https://api.aluvia.io/v1',
          apiKey: 'test-api-key',
          method: 'GET',
          path: '/account',
          timeoutMs: 10,
        });
      },
      (err: any) => {
        assert.ok(err instanceof ApiError);
        assert.strictEqual(err.statusCode, 408);
        assert.ok(String(err.message).includes('Request timed out after 10ms'));
        return true;
      },
    );
  });
});
