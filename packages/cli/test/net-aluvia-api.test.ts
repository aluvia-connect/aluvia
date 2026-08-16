import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert';
import { AluviaApi } from '../src/net/aluvia-api.js';
import { ApiError, InvalidApiKeyError } from '../src/net/errors.js';

describe('AluviaApi', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('account.get uses GET /account and unwraps success envelope', async () => {
    let capturedUrl: any = null;
    let capturedInit: any = null;

    globalThis.fetch = (async (url: any, init: any) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(JSON.stringify({ success: true, data: { id: 'acct-1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const api = new AluviaApi({
      apiKey: 'test-api-key',
      apiBaseUrl: 'https://api.aluvia.io/v1/',
    });
    const data = await api.account.get();

    assert.ok(String(capturedUrl).endsWith('/account'));
    assert.strictEqual(capturedInit.method, 'GET');
    assert.strictEqual(capturedInit.headers.Authorization, 'Bearer test-api-key');
    assert.ok((data as any).id);
  });

  test('account.usage.get sends optional query params', async () => {
    let capturedUrl: any = null;

    globalThis.fetch = (async (url: any) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ success: true, data: { ok: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const api = new AluviaApi({
      apiKey: 'test-api-key',
      apiBaseUrl: 'https://api.aluvia.io/v1',
    });
    await api.account.usage.get({ start: '2025-01-01', end: '2025-01-31' });

    assert.ok(String(capturedUrl).includes('/account/usage?'));
    assert.ok(String(capturedUrl).includes('start=2025-01-01'));
    assert.ok(String(capturedUrl).includes('end=2025-01-31'));
  });

  test('geos.list uses GET /geos', async () => {
    let capturedUrl: any = null;
    globalThis.fetch = (async (url: any) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ success: true, data: [{ code: 'US' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const api = new AluviaApi({
      apiKey: 'test-api-key',
      apiBaseUrl: 'https://api.aluvia.io/v1/',
    });
    const res = await api.geos.list();
    assert.ok(String(capturedUrl).endsWith('/geos'));
    assert.ok(Array.isArray(res));
  });

  test('throws InvalidApiKeyError on 401', async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: 'unauthorized', message: 'Unauthorized' },
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }) as any;

    const api = new AluviaApi({
      apiKey: 'bad',
      apiBaseUrl: 'https://api.aluvia.io/v1',
    });
    await assert.rejects(() => api.account.get(), InvalidApiKeyError);
  });

  test('throws ApiError with details on 422-style error envelope', async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: 'validation_error',
            message: 'Validation failed',
            details: { field: 'x' },
          },
        }),
        { status: 422, headers: { 'Content-Type': 'application/json' } },
      );
    }) as any;

    const api = new AluviaApi({
      apiKey: 'test-api-key',
      apiBaseUrl: 'https://api.aluvia.io/v1',
    });
    await assert.rejects(() => api.account.get(), ApiError);
  });
});
