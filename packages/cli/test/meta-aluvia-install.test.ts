import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureInstallId } from '../src/config.js';
import {
  ALUVIA_INSTALL_EVENT,
  DEFAULT_ALUVIA_META_PIXEL_ID,
  META_ALUVIA_INSTALL_DEDUPE_FILE,
  maybeFireAluviaInstallBeacon,
} from '../src/meta-aluvia-install.js';

const ENV_KEYS = [
  'ALUVIA_HOME',
  'ALUVIA_META_PIXEL_ID',
  'ALUVIA_META_FBC',
  'ALUVIA_META_FBP',
  'ALUVIA_META_FBCLID',
] as const;

describe('maybeFireAluviaInstallBeacon', { concurrency: 1 }, () => {
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
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'aluvia-meta-'));
    process.env.ALUVIA_HOME = home;
    delete process.env.ALUVIA_META_PIXEL_ID;
    delete process.env.ALUVIA_META_FBC;
    delete process.env.ALUVIA_META_FBP;
    delete process.env.ALUVIA_META_FBCLID;
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

  test('GET tr with default pixel, event, noscript, and cd[install_id]', async () => {
    tempHome();
    const installId = ensureInstallId();
    mockFetch();

    await maybeFireAluviaInstallBeacon();

    assert.strictEqual(fetchCalls, 1);
    const url = parsedUrl();
    assert.strictEqual(url.origin + url.pathname, 'https://www.facebook.com/tr');
    assert.strictEqual(url.searchParams.get('id'), DEFAULT_ALUVIA_META_PIXEL_ID);
    assert.strictEqual(url.searchParams.get('ev'), ALUVIA_INSTALL_EVENT);
    assert.strictEqual(url.searchParams.get('noscript'), '1');
    assert.strictEqual(url.searchParams.get('cd[install_id]'), installId);
    assert.strictEqual(url.searchParams.get('fbc'), null);
    assert.strictEqual(url.searchParams.get('fbp'), null);
    assert.strictEqual(url.searchParams.get('cd[fbclid]'), null);
    assert.strictEqual(capturedInit?.method, 'GET');
    assert.strictEqual(capturedInit?.redirect, 'manual');
    assert.ok(capturedInit?.signal instanceof AbortSignal);
    const fired = fs.readFileSync(path.join(home!, META_ALUVIA_INSTALL_DEDUPE_FILE), 'utf8').trim();
    assert.strictEqual(fired, installId);
  });

  test('passes fbc and fbp from env and does not invent ids', async () => {
    tempHome();
    ensureInstallId();
    process.env.ALUVIA_META_FBC = 'fb.1.1700000000000.ExistingClick';
    process.env.ALUVIA_META_FBP = 'fb.1.1700000000000.BrowserId';
    mockFetch();

    await maybeFireAluviaInstallBeacon();

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

    await maybeFireAluviaInstallBeacon();

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

    await maybeFireAluviaInstallBeacon();

    const url = parsedUrl();
    assert.strictEqual(url.searchParams.get('fbc'), 'fb.1.1.FromEnv');
    assert.strictEqual(url.searchParams.get('cd[fbclid]'), 'ClickFromEnv');
  });

  test('ALUVIA_META_PIXEL_ID override wins; whitespace falls back to default', async () => {
    tempHome();
    ensureInstallId();
    process.env.ALUVIA_META_PIXEL_ID = '  999888777666555  ';
    mockFetch();

    await maybeFireAluviaInstallBeacon();
    assert.strictEqual(parsedUrl().searchParams.get('id'), '999888777666555');

    fs.rmSync(path.join(home!, META_ALUVIA_INSTALL_DEDUPE_FILE), { force: true });
    process.env.ALUVIA_META_PIXEL_ID = '   ';
    fetchCalls = 0;
    capturedUrl = undefined;
    await maybeFireAluviaInstallBeacon();
    assert.strictEqual(parsedUrl().searchParams.get('id'), DEFAULT_ALUVIA_META_PIXEL_ID);
  });

  test('dedupes once per install id', async () => {
    tempHome();
    ensureInstallId();
    mockFetch();

    await maybeFireAluviaInstallBeacon();
    await maybeFireAluviaInstallBeacon();
    await maybeFireAluviaInstallBeacon();

    assert.strictEqual(fetchCalls, 1);
  });

  test('a new install id is allowed to fire again', async () => {
    tempHome();
    const first = ensureInstallId();
    mockFetch();
    await maybeFireAluviaInstallBeacon();
    assert.strictEqual(fetchCalls, 1);

    const second = 'b'.repeat(64);
    fs.writeFileSync(path.join(home!, 'install_id'), second + '\n', { mode: 0o600 });
    const configPath = path.join(home!, 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { installId?: string };
    config.installId = second;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

    await maybeFireAluviaInstallBeacon();
    assert.strictEqual(fetchCalls, 2);
    assert.notStrictEqual(first, second);
    assert.strictEqual(parsedUrl().searchParams.get('cd[install_id]'), second);
  });

  test('without an install id, omits cd[install_id] and dedupes as no-install-id', async () => {
    tempHome();
    mockFetch();

    await maybeFireAluviaInstallBeacon();
    await maybeFireAluviaInstallBeacon();

    assert.strictEqual(fetchCalls, 1);
    const url = parsedUrl();
    assert.strictEqual(url.searchParams.get('cd[install_id]'), null);
    assert.ok(!fs.existsSync(path.join(home!, 'install_id')));
    const fired = fs.readFileSync(path.join(home!, META_ALUVIA_INSTALL_DEDUPE_FILE), 'utf8').trim();
    assert.strictEqual(fired, 'no-install-id');
  });

  test('swallows fetch failure and still claims the install id', async () => {
    tempHome();
    const installId = ensureInstallId();
    mockFetch(async () => {
      throw new Error('network down');
    });

    await assert.doesNotReject(() => maybeFireAluviaInstallBeacon());
    assert.strictEqual(fetchCalls, 1);
    const fired = fs.readFileSync(path.join(home!, META_ALUVIA_INSTALL_DEDUPE_FILE), 'utf8').trim();
    assert.strictEqual(fired, installId);

    fetchCalls = 0;
    await maybeFireAluviaInstallBeacon();
    assert.strictEqual(fetchCalls, 0);
  });

  test('concurrent callers issue a single GET', async () => {
    tempHome();
    ensureInstallId();
    mockFetch();

    await Promise.all([maybeFireAluviaInstallBeacon(), maybeFireAluviaInstallBeacon()]);
    assert.strictEqual(fetchCalls, 1);
  });
});
