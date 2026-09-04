import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureInstallId } from '../src/config.js';
import { captureOutput } from '../src/output-capture.js';
import {
  DEFAULT_ALUVIA_META_PIXEL_ID,
  FIRST_PROXY_REQUEST_EVENT,
  META_FIRST_PROXY_REQUEST_DEDUPE_FILE,
  isFirstProxyRequestTrigger,
  maybeFireFirstProxyRequestBeacon,
} from '../src/meta-first-proxy-request.js';
import { DEFAULT_PROBE_URLS } from '../src/session-probe-hosts.js';

const ENV_KEYS = [
  'ALUVIA_HOME',
  'ALUVIA_META_PIXEL_ID',
  'ALUVIA_META_FBC',
  'ALUVIA_META_FBP',
  'ALUVIA_META_FBCLID',
  'ALUVIA_PROBE_URL',
] as const;

describe('maybeFireFirstProxyRequestBeacon', { concurrency: 1 }, () => {
  const original: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) original[key] = process.env[key];
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let home: string | undefined;
  let fetchCalls = 0;
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
    fetchCalls = 0;
    capturedUrl = undefined;
    capturedInit = undefined;
    if (home) {
      fs.rmSync(home, { recursive: true, force: true });
      home = undefined;
    }
  });

  function tempHome(): string {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'aluvia-meta-first-proxy-'));
    process.env.ALUVIA_HOME = home;
    delete process.env.ALUVIA_META_PIXEL_ID;
    delete process.env.ALUVIA_META_FBC;
    delete process.env.ALUVIA_META_FBP;
    delete process.env.ALUVIA_META_FBCLID;
    delete process.env.ALUVIA_PROBE_URL;
    return home;
  }

  function mockFetch(impl?: typeof fetch): void {
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      fetchCalls += 1;
      capturedUrl = String(url);
      capturedInit = init;
      if (impl) return impl(url as Parameters<typeof fetch>[0], init);
      return new Response(null, { status: 200 });
    }) as typeof fetch;
  }

  function parsedUrl(): URL {
    assert.ok(capturedUrl, 'expected a Pixel GET URL');
    return new URL(capturedUrl);
  }

  test('GET tr with default pixel, event first_proxy_request, noscript, and cd[install_id]', async () => {
    tempHome();
    const installId = ensureInstallId();
    mockFetch();

    await maybeFireFirstProxyRequestBeacon();

    assert.strictEqual(fetchCalls, 1);
    const url = parsedUrl();
    assert.strictEqual(url.origin + url.pathname, 'https://www.facebook.com/tr');
    assert.strictEqual(url.searchParams.get('id'), DEFAULT_ALUVIA_META_PIXEL_ID);
    assert.strictEqual(url.searchParams.get('ev'), FIRST_PROXY_REQUEST_EVENT);
    assert.strictEqual(url.searchParams.get('ev'), 'first_proxy_request');
    assert.strictEqual(url.searchParams.get('noscript'), '1');
    assert.strictEqual(url.searchParams.get('cd[install_id]'), installId);
    assert.strictEqual(url.searchParams.get('fbc'), null);
    assert.strictEqual(url.searchParams.get('fbp'), null);
    assert.strictEqual(url.searchParams.get('cd[fbclid]'), null);
    assert.strictEqual(capturedInit?.method, 'GET');
    assert.strictEqual(capturedInit?.redirect, 'manual');
    assert.ok(capturedInit?.signal instanceof AbortSignal);
    const fired = fs.readFileSync(path.join(home!, META_FIRST_PROXY_REQUEST_DEDUPE_FILE), 'utf8').trim();
    assert.strictEqual(fired, installId);
  });

  test('passes fbc and fbp from env and does not invent ids', async () => {
    tempHome();
    ensureInstallId();
    process.env.ALUVIA_META_FBC = 'fb.1.1700000000000.ExistingClick';
    process.env.ALUVIA_META_FBP = 'fb.1.1700000000000.BrowserId';
    mockFetch();

    await maybeFireFirstProxyRequestBeacon();

    const url = parsedUrl();
    assert.strictEqual(url.searchParams.get('fbc'), 'fb.1.1700000000000.ExistingClick');
    assert.strictEqual(url.searchParams.get('fbp'), 'fb.1.1700000000000.BrowserId');
    assert.strictEqual(url.searchParams.get('cd[fbclid]'), null);
  });

  test('builds fbc from fbclid when fbc is absent', async () => {
    tempHome();
    ensureInstallId();
    const fbclid = 'IwAR0TestClickId';
    process.env.ALUVIA_META_FBCLID = fbclid;
    const now = 1_711_111_111_111;
    Date.now = () => now;
    mockFetch();

    await maybeFireFirstProxyRequestBeacon();

    const url = parsedUrl();
    assert.strictEqual(url.searchParams.get('fbc'), `fb.1.${now}.${fbclid}`);
    assert.strictEqual(url.searchParams.get('cd[fbclid]'), fbclid);
    assert.strictEqual(url.searchParams.get('fbp'), null);
  });

  test('prefers env fbc when fbclid is also present', async () => {
    tempHome();
    ensureInstallId();
    process.env.ALUVIA_META_FBC = 'fb.1.1.FromEnv';
    process.env.ALUVIA_META_FBCLID = 'ClickFromEnv';
    mockFetch();

    await maybeFireFirstProxyRequestBeacon();

    const url = parsedUrl();
    assert.strictEqual(url.searchParams.get('fbc'), 'fb.1.1.FromEnv');
    assert.strictEqual(url.searchParams.get('cd[fbclid]'), 'ClickFromEnv');
  });

  test('dedupes once per install id', async () => {
    tempHome();
    ensureInstallId();
    mockFetch();

    await maybeFireFirstProxyRequestBeacon();
    await maybeFireFirstProxyRequestBeacon();
    await maybeFireFirstProxyRequestBeacon();

    assert.strictEqual(fetchCalls, 1);
  });

  test('a new install id is allowed to fire again', async () => {
    tempHome();
    const first = ensureInstallId();
    mockFetch();
    await maybeFireFirstProxyRequestBeacon();
    assert.strictEqual(fetchCalls, 1);

    const second = 'b'.repeat(64);
    fs.writeFileSync(path.join(home!, 'install_id'), second + '\n', { mode: 0o600 });
    const configPath = path.join(home!, 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { installId?: string };
    config.installId = second;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

    await maybeFireFirstProxyRequestBeacon();
    assert.strictEqual(fetchCalls, 2);
    assert.notStrictEqual(first, second);
    assert.strictEqual(parsedUrl().searchParams.get('cd[install_id]'), second);
  });

  test('without an install id, omits cd[install_id] and dedupes as no-install-id', async () => {
    tempHome();
    mockFetch();

    await maybeFireFirstProxyRequestBeacon();
    await maybeFireFirstProxyRequestBeacon();

    assert.strictEqual(fetchCalls, 1);
    const url = parsedUrl();
    assert.strictEqual(url.searchParams.get('cd[install_id]'), null);
    assert.ok(!fs.existsSync(path.join(home!, 'install_id')));
    const fired = fs.readFileSync(path.join(home!, META_FIRST_PROXY_REQUEST_DEDUPE_FILE), 'utf8').trim();
    assert.strictEqual(fired, 'no-install-id');
  });

  test('swallows fetch failure and still claims the install id', async () => {
    tempHome();
    const installId = ensureInstallId();
    mockFetch(async () => {
      throw new Error('network down');
    });

    await assert.doesNotReject(() => maybeFireFirstProxyRequestBeacon());
    assert.strictEqual(fetchCalls, 1);
    const fired = fs.readFileSync(path.join(home!, META_FIRST_PROXY_REQUEST_DEDUPE_FILE), 'utf8').trim();
    assert.strictEqual(fired, installId);

    fetchCalls = 0;
    await maybeFireFirstProxyRequestBeacon();
    assert.strictEqual(fetchCalls, 0);
  });

  test('capturing skips fire and does not claim', async () => {
    tempHome();
    ensureInstallId();
    mockFetch();

    await captureOutput(async () => {
      await maybeFireFirstProxyRequestBeacon();
    });

    assert.strictEqual(fetchCalls, 0);
    assert.ok(!fs.existsSync(path.join(home!, META_FIRST_PROXY_REQUEST_DEDUPE_FILE)));
  });

  test('concurrent callers issue a single GET', async () => {
    tempHome();
    ensureInstallId();
    mockFetch();

    await Promise.all([maybeFireFirstProxyRequestBeacon(), maybeFireFirstProxyRequestBeacon()]);
    assert.strictEqual(fetchCalls, 1);
  });
});

describe('isFirstProxyRequestTrigger', { concurrency: 1 }, () => {
  const originalProbe = process.env.ALUVIA_PROBE_URL;

  afterEach(() => {
    if (originalProbe === undefined) delete process.env.ALUVIA_PROBE_URL;
    else process.env.ALUVIA_PROBE_URL = originalProbe;
  });

  test('HTTP via upstream counts; direct HTTP does not', () => {
    assert.strictEqual(
      isFirstProxyRequestTrigger({ hostname: 'example.com', viaUpstream: true, isHttp: true }),
      true,
    );
    assert.strictEqual(
      isFirstProxyRequestTrigger({ hostname: 'example.com', viaUpstream: false, isHttp: true }),
      false,
    );
  });

  test('successful CONNECT via upstream counts; failed or prepare-only CONNECT does not', () => {
    assert.strictEqual(
      isFirstProxyRequestTrigger({
        hostname: 'example.com',
        viaUpstream: true,
        isHttp: false,
        connectOk: true,
      }),
      true,
    );
    assert.strictEqual(
      isFirstProxyRequestTrigger({
        hostname: 'example.com',
        viaUpstream: true,
        isHttp: false,
        connectOk: false,
      }),
      false,
    );
    assert.strictEqual(
      isFirstProxyRequestTrigger({ hostname: 'example.com', viaUpstream: true, isHttp: false }),
      false,
    );
  });

  test('does not fire on proxy-on / setup / rotate-ip alone (no client request)', () => {
    assert.strictEqual(
      isFirstProxyRequestTrigger({ hostname: '', viaUpstream: false, isHttp: false }),
      false,
    );
  });

  test('skips loopback and empty hostname', () => {
    assert.strictEqual(
      isFirstProxyRequestTrigger({ hostname: '127.0.0.1', viaUpstream: true, isHttp: true }),
      false,
    );
    assert.strictEqual(
      isFirstProxyRequestTrigger({
        hostname: 'localhost',
        viaUpstream: true,
        isHttp: false,
        connectOk: true,
      }),
      false,
    );
  });

  test('skips session probe echo hosts so setup/status/rotate-ip probes do not count', () => {
    delete process.env.ALUVIA_PROBE_URL;
    for (const raw of DEFAULT_PROBE_URLS) {
      const host = new URL(raw).hostname;
      assert.strictEqual(
        isFirstProxyRequestTrigger({ hostname: host, viaUpstream: true, isHttp: false, connectOk: true }),
        false,
        host,
      );
    }
  });

  test('skips ALUVIA_PROBE_URL hostname', () => {
    process.env.ALUVIA_PROBE_URL = 'https://172.59.0.1/';
    assert.strictEqual(
      isFirstProxyRequestTrigger({
        hostname: '172.59.0.1',
        viaUpstream: true,
        isHttp: false,
        connectOk: true,
      }),
      false,
    );
    assert.strictEqual(
      isFirstProxyRequestTrigger({
        hostname: 'example.com',
        viaUpstream: true,
        isHttp: false,
        connectOk: true,
      }),
      true,
    );
  });
});
