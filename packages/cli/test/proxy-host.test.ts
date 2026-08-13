import { describe, test } from 'node:test';
import assert from 'node:assert';
import { parseRouteHost } from '../src/proxy-host.js';

describe('parseRouteHost', () => {
  test('parses a URL to a lowercased hostname', () => {
    assert.deepStrictEqual(parseRouteHost('https://Example.COM/path?q=1'), {
      ok: true,
      host: 'example.com',
    });
  });

  test('allows a suffix wildcard and refuses a catch-all *', () => {
    assert.deepStrictEqual(parseRouteHost('*.Example.com'), { ok: true, host: '*.example.com' });
    assert.deepStrictEqual(parseRouteHost('*'), { ok: false, error: 'catch-all * is not allowed' });
    assert.deepStrictEqual(parseRouteHost('  *  '), { ok: false, error: 'catch-all * is not allowed' });
  });

  test('refuses loopback and empty input', () => {
    assert.deepStrictEqual(parseRouteHost('localhost'), {
      ok: false,
      error: 'loopback hosts cannot be routed',
    });
    assert.deepStrictEqual(parseRouteHost('https://127.0.0.1/'), {
      ok: false,
      error: 'loopback hosts cannot be routed',
    });
    assert.deepStrictEqual(parseRouteHost('[::1]'), {
      ok: false,
      error: 'loopback hosts cannot be routed',
    });
    assert.deepStrictEqual(parseRouteHost('   '), { ok: false, error: 'host is required' });
  });
});
