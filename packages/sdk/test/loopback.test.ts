import { describe, test } from 'node:test';
import assert from 'node:assert';
import { isLoopbackHostname } from '../src/client/loopback.js';
import { ProxyServer } from '../src/client/ProxyServer.js';

function configWithCatchAll() {
  return {
    rawProxy: {
      protocol: 'http' as const,
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
}

function decide(hostname: string, extra: Record<string, unknown> = {}) {
  const mgr = { getConfig: () => configWithCatchAll() } as any;
  const proxy = new ProxyServer(mgr, { logLevel: 'silent' });
  return (proxy as any).handleRequest({
    hostname,
    request: { url: `https://${hostname}/` },
    ...extra,
  });
}

describe('isLoopbackHostname', () => {
  test('matches the four names in the spec, case-insensitive', () => {
    for (const host of [
      'localhost',
      'LOCALHOST',
      '127.0.0.1',
      '::1',
      '::ffff:127.0.0.1',
      '::FFFF:127.0.0.1',
    ]) {
      assert.strictEqual(isLoopbackHostname(host), true, host);
    }
  });

  test('does not match public hosts or suffix wildcards', () => {
    assert.strictEqual(isLoopbackHostname('example.com'), false);
    assert.strictEqual(isLoopbackHostname('127.0.0.2'), false);
    assert.strictEqual(isLoopbackHostname('::2'), false);
  });
});

describe('ProxyServer loopback bypass', () => {
  test('never sets upstreamProxyUrl for loopback even with a * rule', () => {
    for (const host of ['localhost', '127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      assert.strictEqual(decide(host), undefined, host);
    }
  });

  test('still proxies a matching public host when rules include *', () => {
    assert.deepStrictEqual(decide('example.com'), {
      upstreamProxyUrl: 'http://user:pass@gateway.aluvia.io:8080',
    });
  });
});
