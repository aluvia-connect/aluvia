import { describe, test } from 'node:test';
import assert from 'node:assert';
import { ProxyServer } from '../src/net/proxy-server.js';

describe('ProxyServer hostname extraction', () => {
  test('extracts hostname from host/path without scheme', () => {
    const config = {
      rawProxy: {
        protocol: 'http',
        host: 'gateway.aluvia.io' as const,
        port: 8080,
        username: 'user',
        password: 'pass',
      },
      rules: ['example.com'],
      sessionId: null,
      targetGeo: null,
      etag: null,
    };

    const mgr = { getConfig: () => config } as any;
    const proxy = new ProxyServer(mgr, { logLevel: 'silent' });

    const res = (proxy as any).handleRequest({
      request: { url: 'example.com/some-path' },
    });

    assert.deepStrictEqual(res, {
      upstreamProxyUrl: 'http://user:pass@gateway.aluvia.io:8080',
    });
  });

  test('falls back to Host header for origin-form URLs', () => {
    const config = {
      rawProxy: {
        protocol: 'http',
        host: 'gateway.aluvia.io' as const,
        port: 8080,
        username: 'user',
        password: 'pass',
      },
      rules: ['example.com'],
      sessionId: null,
      targetGeo: null,
      etag: null,
    };

    const mgr = { getConfig: () => config } as any;
    const proxy = new ProxyServer(mgr, { logLevel: 'silent' });

    const res = (proxy as any).handleRequest({
      request: { url: '/some-path', headers: { host: 'example.com:1234' } },
    });

    assert.deepStrictEqual(res, {
      upstreamProxyUrl: 'http://user:pass@gateway.aluvia.io:8080',
    });
  });
});
