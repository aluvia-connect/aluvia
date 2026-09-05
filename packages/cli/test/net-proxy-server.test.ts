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
      customTag: { hostname: 'example.com', credentialKind: 'byo', connectionId: undefined },
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
      customTag: { hostname: 'example.com', credentialKind: 'byo', connectionId: undefined },
    });
  });

  test('request observer receives viaUpstream and isHttp', () => {
    const config = {
      rawProxy: {
        protocol: 'http',
        host: 'gateway.aluvia.io' as const,
        port: 8080,
        username: 'user',
        password: 'pass',
      },
      rules: ['*'],
      sessionId: null,
      targetGeo: null,
      etag: null,
    };

    const mgr = { getConfig: () => config } as any;
    const proxy = new ProxyServer(mgr, { logLevel: 'silent' });
    const seen: Array<{ hostname: string; viaUpstream: boolean; isHttp: boolean }> = [];
    proxy.setRequestObserver((hostname, viaUpstream, isHttp) => {
      seen.push({ hostname, viaUpstream, isHttp });
    });

    (proxy as any).handleRequest({
      hostname: 'example.com',
      isHttp: true,
      request: { url: 'http://example.com/' },
    });
    (proxy as any).handleRequest({
      hostname: 'example.com',
      isHttp: false,
      request: { url: 'example.com:443' },
    });

    assert.deepStrictEqual(seen, [
      { hostname: 'example.com', viaUpstream: true, isHttp: true },
      { hostname: 'example.com', viaUpstream: true, isHttp: false },
    ]);
  });
});

describe('CONNECT attribution evidence', () => {
  test('captures actual credential source and connection before a provider switch; rejects failed CONNECT', async () => {
    const mgr = {
      credentialKind: 'aluvia',
      connectionId: 23,
      getConfig: () => ({
        rawProxy: {
          protocol: 'http',
          host: 'localhost',
          port: 9999,
          username: 'fixture',
          password: 'fixture',
        },
        rules: ['*'],
      }),
    } as any;
    const proxy = new ProxyServer(mgr, { logLevel: 'silent' });
    const events: any[] = [];
    proxy.setConnectObserver((event) => events.push(event));
    const prepared = (proxy as any).handleRequest({
      hostname: 'example.com',
      isHttp: false,
      request: { url: 'example.com:443' },
    });
    assert.deepStrictEqual(prepared.customTag, {
      hostname: 'example.com',
      credentialKind: 'aluvia',
      connectionId: 23,
    });
    mgr.credentialKind = 'byo';
    mgr.connectionId = undefined;
    await proxy.start();
    try {
      (proxy as any).server.emit('tunnelConnectResponded', {
        customTag: prepared.customTag,
        response: { statusCode: 200 },
      });
      (proxy as any).server.emit('tunnelConnectResponded', {
        customTag: prepared.customTag,
        response: { statusCode: 503 },
      });
      assert.equal(events[0].credentialKind, 'aluvia');
      assert.equal(events[0].connectionId, 23);
      assert.equal(events[0].ok, true);
      assert.equal(events[1].ok, false);
    } finally {
      await proxy.stop();
    }
  });
});
