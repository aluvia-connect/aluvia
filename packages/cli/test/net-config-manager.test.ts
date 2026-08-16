import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert';
import { ConfigManager } from '../src/net/config-manager.js';
import { ApiError, InvalidApiKeyError } from '../src/net/errors.js';

describe('ConfigManager', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('init() throws in strict mode when create connection fails (prevents silent direct routing)', async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: 'server_error', message: 'boom' },
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }) as any;

    const mgr = new ConfigManager({
      apiKey: 'test-api-key',
      apiBaseUrl: 'https://api.aluvia.io/v1',
      pollIntervalMs: 5000,
      gatewayProtocol: 'http',
      gatewayPort: 8080,
      logLevel: 'silent',
      strict: true,
    });

    await assert.rejects(
      () => mgr.init(),
      (err: any) => err instanceof ApiError && err.statusCode === 500,
    );
  });

  test('setConfig() throws on non-2xx (no silent failure)', async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: 'server_error', message: 'nope' },
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }) as any;

    const mgr = new ConfigManager({
      apiKey: 'test-api-key',
      apiBaseUrl: 'https://api.aluvia.io/v1',
      pollIntervalMs: 5000,
      gatewayProtocol: 'http',
      gatewayPort: 8080,
      logLevel: 'silent',
      connectionId: 123,
      strict: true,
    });

    (mgr as any).accountConnectionId = 123;

    await assert.rejects(
      () => mgr.setConfig({ rules: ['*'] }),
      (err: any) => err instanceof ApiError && err.statusCode === 500,
    );
  });

  test('setConfig() throws InvalidApiKeyError on 403', async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: 'forbidden', message: 'Forbidden' },
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }) as any;

    const mgr = new ConfigManager({
      apiKey: 'test-api-key',
      apiBaseUrl: 'https://api.aluvia.io/v1',
      pollIntervalMs: 5000,
      gatewayProtocol: 'http',
      gatewayPort: 8080,
      logLevel: 'silent',
      connectionId: 123,
      strict: true,
    });

    (mgr as any).accountConnectionId = 123;

    await assert.rejects(() => mgr.setConfig({ rules: ['*'] }), InvalidApiKeyError);
  });

  test('pollOnce sends If-None-Match and treats 304 as no update', async () => {
    let capturedInit: any = null;

    globalThis.fetch = (async (_url: any, init: any) => {
      capturedInit = init;
      return new Response('', {
        status: 304,
        headers: { ETag: '"etag-next"' },
      });
    }) as any;

    const mgr = new ConfigManager({
      apiKey: 'test-api-key',
      apiBaseUrl: 'https://api.aluvia.io/v1',
      pollIntervalMs: 5000,
      gatewayProtocol: 'http',
      gatewayPort: 8080,
      logLevel: 'silent',
      connectionId: 123,
    });

    const existingConfig = {
      rawProxy: {
        protocol: 'http',
        host: 'gateway.aluvia.io' as const,
        port: 8080,
        username: 'u',
        password: 'p',
      },
      rules: ['*'],
      sessionId: null,
      targetGeo: null,
      etag: '"etag-prev"',
    };

    (mgr as any).config = existingConfig;
    (mgr as any).accountConnectionId = 123;

    await (mgr as any).pollOnce();

    assert.strictEqual(capturedInit.headers['If-None-Match'], '"etag-prev"');
    assert.strictEqual(mgr.getConfig(), existingConfig);
  });

  test('pollOnce supports 200 → 304 → 200 sequence', async () => {
    let callCount = 0;
    const seenIfNoneMatch: Array<string | undefined> = [];

    globalThis.fetch = (async (_url: any, init: any) => {
      callCount += 1;
      seenIfNoneMatch.push(init?.headers?.['If-None-Match']);

      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              proxy_username: 'u1',
              proxy_password: 'p1',
              rules: ['*'],
              session_id: null,
              target_geo: null,
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json', ETag: '"e1"' },
          },
        );
      }

      if (callCount === 2) {
        return {
          status: 304,
          headers: new Headers({ ETag: '"e1"' }),
          text: async () => '',
        } as any;
      }

      return new Response(
        JSON.stringify({
          success: true,
          data: {
            proxy_username: 'u2',
            proxy_password: 'p2',
            rules: ['example.com'],
            session_id: 's2',
            target_geo: 'US',
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json', ETag: '"e2"' },
        },
      );
    }) as any;

    const mgr = new ConfigManager({
      apiKey: 'test-api-key',
      apiBaseUrl: 'https://api.aluvia.io/v1',
      pollIntervalMs: 5000,
      gatewayProtocol: 'http',
      gatewayPort: 8080,
      logLevel: 'silent',
      connectionId: 123,
    });

    await mgr.init();
    const cfg1 = mgr.getConfig();
    assert.ok(cfg1);
    assert.strictEqual(cfg1?.etag, '"e1"');
    assert.strictEqual(cfg1?.rawProxy.username, 'u1');

    await (mgr as any).pollOnce();
    const cfgAfter304 = mgr.getConfig();
    assert.strictEqual(cfgAfter304?.etag, '"e1"');
    assert.strictEqual(cfgAfter304?.rawProxy.username, 'u1');

    await (mgr as any).pollOnce();
    const cfg2 = mgr.getConfig();
    assert.ok(cfg2);
    assert.strictEqual(cfg2?.etag, '"e2"');
    assert.strictEqual(cfg2?.rawProxy.username, 'u2');
    assert.strictEqual(cfg2?.sessionId, 's2');

    assert.deepStrictEqual(seenIfNoneMatch, [undefined, '"e1"', '"e1"']);
  });

  test('startPolling is a no-op when pollIntervalMs is 0', () => {
    let setIntervalCalls = 0;
    const originalSetInterval = globalThis.setInterval;
    globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
      setIntervalCalls += 1;
      return originalSetInterval(...args);
    }) as typeof setInterval;

    try {
      const mgr = new ConfigManager({
        apiKey: 'test-api-key',
        apiBaseUrl: 'https://api.aluvia.io/v1',
        pollIntervalMs: 0,
        gatewayProtocol: 'http',
        gatewayPort: 8080,
        logLevel: 'silent',
      });
      let polls = 0;
      (mgr as any).pollOnce = async () => {
        polls += 1;
      };
      mgr.startPolling();
      assert.strictEqual(setIntervalCalls, 0);
      assert.strictEqual((mgr as any).timer, null);
      assert.strictEqual(polls, 0);
    } finally {
      globalThis.setInterval = originalSetInterval;
    }
  });
});
