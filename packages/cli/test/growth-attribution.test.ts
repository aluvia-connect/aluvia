import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureInstallId, getStoredInstallId, saveApiKey } from '../src/config.js';
import { captureOutput } from '../src/output-capture.js';

const moduleUrl = new URL('../src/growth-attribution.ts', import.meta.url);
const token = 'A'.repeat(43);
const uuid = '781b451f-b36d-4350-8134-c09f0890851d';
let home: string;
let calls: { url: string; init: RequestInit; body: Record<string, unknown> }[];
let reply: (url: string) => Promise<Response>;
const originalHome = process.env.ALUVIA_HOME;
const originalToken = process.env.ALUVIA_ATTRIBUTION_TOKEN;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'aluvia-growth-'));
  process.env.ALUVIA_HOME = home;
  delete process.env.ALUVIA_ATTRIBUTION_TOKEN;
  calls = [];
  reply = async (url) =>
    Response.json(
      url.endsWith('install-attribution')
        ? { schema_version: 1, status: 'bound', acquisition_id: uuid }
        : { schema_version: 1, status: 'recorded', receipt_id: uuid },
      { status: 201 },
    );
  globalThis.fetch = (async (url, init) => {
    calls.push({ url: String(url), init: init!, body: JSON.parse(String(init!.body)) });
    return reply(String(url));
  }) as typeof fetch;
});
afterEach(() => {
  if (originalHome === undefined) delete process.env.ALUVIA_HOME;
  else process.env.ALUVIA_HOME = originalHome;
  if (originalToken === undefined) delete process.env.ALUVIA_ATTRIBUTION_TOKEN;
  else process.env.ALUVIA_ATTRIBUTION_TOKEN = originalToken;
  globalThis.fetch = originalFetch;
  fs.rmSync(home, { recursive: true, force: true });
});
async function bridge() {
  assert.ok(fs.existsSync(moduleUrl), 'first-party attribution bridge must replace direct Meta beacons');
  return import('../src/growth-attribution.js');
}
async function seed() {
  const g = await bridge();
  ensureInstallId();
  g.captureAttributionToken(token);
  return g;
}

test('missing or malformed consent token sends nothing and does not create an install', async () => {
  const g = await bridge();
  for (const value of [undefined, '', 'x', ' '.repeat(43), 'a'.repeat(44), 'a'.repeat(42) + '!']) {
    g.captureAttributionToken(value);
    await g.drainAttribution();
  }
  g.captureAttributionToken(token);
  await g.drainAttribution();
  assert.equal(calls.length, 0);
  assert.equal(getStoredInstallId(), undefined);
  assert.equal(fs.existsSync(path.join(home, 'config.json')), false);
});

test('persists consent separately with protected permissions and binds only the existing install', async () => {
  const g = await seed();
  saveApiKey('fixture-key');
  const configBefore = fs.readFileSync(path.join(home, 'config.json'), 'utf8');
  g.captureAttributionToken('B'.repeat(43));
  await g.drainAttribution();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.aluvia.io/v1/growth/install-attribution');
  assert.deepEqual(calls[0].body, { schema_version: 1, attribution_token: token });
  const headers = new Headers(calls[0].init.headers);
  assert.equal(headers.get('X-Aluvia-Install-Id'), getStoredInstallId());
  assert.equal(headers.has('Authorization'), false);
  assert.equal(calls[0].init.redirect, 'error');
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.equal(fs.readFileSync(path.join(home, 'config.json'), 'utf8'), configBefore);
  function modes(dir: string) {
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) modes(p);
      else assert.equal(fs.statSync(p).mode & 0o777, 0o600);
    }
  }
  modes(path.join(home, 'growth-attribution'));
});

test('lost acknowledgement retries original durable event ID and occurrence, then dedupes after receipt', async () => {
  const g = await seed();
  const success = reply;
  reply = async (url) => {
    if (url.endsWith('install-events')) throw new Error('offline / lost acknowledgement');
    return success(url);
  };
  await g.reportSetupReady({
    aimed: true,
    healthy: true,
    probeOk: true,
    credentialKind: 'install',
    connectionId: 17,
  });
  const first = calls.find((call) => call.url.endsWith('install-events'))!;
  assert.ok(first);
  assert.deepEqual(Object.keys(first.body).sort(), [
    'client_event_id',
    'connection_id',
    'event_name',
    'occurred_at',
    'schema_version',
  ]);
  assert.equal(first.body.connection_id, 17);
  assert.equal(first.body.event_name, 'setup_ready');
  assert.ok(!JSON.stringify(first.body).includes(getStoredInstallId()!));
  reply = success;
  await g.drainAttribution();
  const reports = calls.filter((call) => call.url.endsWith('install-events'));
  assert.ok(reports.length >= 2 && reports.length <= 3);
  for (const report of reports) assert.deepEqual(report.body, first.body);
  const count = calls.length;
  await g.reportSetupReady({
    aimed: true,
    healthy: true,
    probeOk: true,
    credentialKind: 'install',
    connectionId: 99,
  });
  await g.drainAttribution();
  assert.equal(calls.length, count);
});

test('malformed successful acknowledgements remain pending; redirects cannot count as receipts', async () => {
  const g = await seed();
  reply = async () => Response.json({ status: 'bound', acquisition_id: uuid }, { status: 200 });
  await g.drainAttribution();
  const count = calls.length;
  reply = async () => new Response(null, { status: 302, headers: { Location: 'https://other.invalid' } });
  await g.drainAttribution();
  assert.ok(calls.length > count);
  for (const call of calls) assert.equal(call.url, 'https://api.aluvia.io/v1/growth/install-attribution');
  assert.equal(
    calls.some((call) => call.url.endsWith('install-events')),
    false,
  );
});

for (const status of [409, 410, 422])
  test(`binding HTTP ${status} stops binding and reporting without new IDs`, async () => {
    const g = await seed();
    const id = getStoredInstallId();
    reply = async () => new Response(null, { status });
    await g.drainAttribution();
    assert.equal(calls.length, 1);
    await g.reportSetupReady({
      aimed: true,
      healthy: true,
      probeOk: true,
      credentialKind: 'install',
      connectionId: 17,
    });
    await g.drainAttribution();
    assert.equal(calls.length, 1);
    assert.equal(getStoredInstallId(), id);
  });

for (const status of [401, 404, 503])
  test(`binding HTTP ${status} waits for a later bounded retry`, async () => {
    const g = await seed();
    reply = async () => new Response(null, { status });
    await g.drainAttribution();
    assert.ok(calls.length >= 1 && calls.length <= 2);
    const count = calls.length;
    await g.drainAttribution();
    assert.ok(calls.length > count && calls.length <= count + 2);
  });

test('capture mode makes no attribution network requests', async () => {
  const g = await seed();
  await captureOutput(async () => {
    await g.drainAttribution();
  });
  assert.equal(calls.length, 0);
});

test('setup receipt requires all readiness evidence and an Aluvia connection', async () => {
  const g = await seed();
  const ready = {
    aimed: true,
    healthy: true,
    probeOk: true,
    credentialKind: 'install' as const,
    connectionId: 17,
  };
  for (const bad of [
    { aimed: false },
    { healthy: false },
    { probeOk: false },
    { credentialKind: 'byo' as const },
    { connectionId: undefined },
    { connectionId: 0 },
  ]) {
    await g.reportSetupReady({ ...ready, ...bad });
  }
  assert.equal(calls.length, 0);
});

test('only successful Aluvia CONNECT qualifies, excluding all probes, HTTP, direct, BYO and loopback', async () => {
  const g = await seed();
  const valid = {
    hostname: 'example.com',
    viaUpstream: true,
    isHttp: false,
    connectOk: true,
    credentialKind: 'aluvia' as const,
    connectionId: 17,
  };
  assert.equal(g.isFirstProxyRequestTrigger(valid), true);
  for (const bad of [
    { hostname: '' },
    { hostname: 'localhost' },
    { hostname: '127.0.0.1' },
    { hostname: '[::1]' },
    { hostname: 'api.ipify.org' },
    { hostname: 'ifconfig.me' },
    { hostname: 'icanhazip.com' },
    { viaUpstream: false },
    { isHttp: true },
    { connectOk: false },
    { connectOk: undefined },
    { credentialKind: 'byo' as const },
    { connectionId: undefined },
    { connectionId: -1 },
  ]) {
    assert.equal(g.isFirstProxyRequestTrigger({ ...valid, ...bad }), false, JSON.stringify(bad));
  }
});

test('setup saves token before invalid arguments can end an incomplete invocation', async () => {
  await bridge();
  process.env.ALUVIA_ATTRIBUTION_TOKEN = token;
  const { handleProxy } = await import('../src/proxy.js');
  await captureOutput(() => handleProxy(['setup', '--url']));
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(home, 'growth-attribution/token.json'), 'utf8')).attribution_token,
    token,
  );
  assert.equal(calls.length, 0);
  assert.equal(getStoredInstallId(), undefined);
});

test('the CLI contains no direct Meta beacon implementation', () => {
  const src = new URL('../src/', import.meta.url);
  for (const filename of fs.readdirSync(src).filter((name) => name.endsWith('.ts'))) {
    const source = fs.readFileSync(new URL(filename, src), 'utf8');
    assert.ok(!source.includes('facebook.com/tr'), filename);
    assert.ok(!source.includes('ALUVIA_META_'), filename);
  }
});

test('repeated CONNECTs do not retry or rewrite a pending report on the traffic path', async () => {
  const g = await seed();
  const success = reply;
  reply = async (url) =>
    url.endsWith('install-events') ? new Response(null, { status: 503 }) : success(url);
  const trigger = {
    hostname: 'example.com',
    viaUpstream: true,
    isHttp: false,
    connectOk: true,
    credentialKind: 'aluvia' as const,
    connectionId: 17,
  };
  for (let i = 0; i < 5; i++) {
    g.reportFirstProxyRequest(trigger);
    await new Promise((resolve) => setImmediate(resolve));
    await g.pendingAttributionDrain();
  }
  assert.equal(calls.filter((call) => call.url.endsWith('install-events')).length, 1);
  await g.drainAttribution();
  assert.equal(calls.filter((call) => call.url.endsWith('install-events')).length, 2);
});

test('slow or abort-ignoring transport has a bounded deadline and retains pending work', async () => {
  const g = await seed();
  reply = () => new Promise(() => {});
  const started = Date.now();
  await g.drainAttribution();
  assert.ok(Date.now() - started < 1500);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.signal?.aborted, true);
});

test('invalid event receipt is retried unchanged; terminal event rejection is not retried', async () => {
  const g = await seed();
  const success = reply;
  reply = async (url) =>
    url.endsWith('install-events')
      ? Response.json({ schema_version: 1, status: 'recorded', receipt_id: 'invalid' })
      : success(url);
  await g.reportSetupReady({
    aimed: true,
    healthy: true,
    probeOk: true,
    credentialKind: 'install',
    connectionId: 17,
  });
  const event = calls.find((call) => call.url.endsWith('install-events'))!.body;
  reply = async () => new Response(null, { status: 422 });
  await g.drainAttribution();
  assert.deepEqual(calls.at(-1)!.body, event);
  const count = calls.length;
  await g.drainAttribution();
  assert.equal(calls.length, count);
});

test('concurrent processes publish one original event; restart after lost ack replays it and persists the receipt', async () => {
  await seed();
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { fileURLToPath } = await import('node:url');
  const run = async (mode: string) => {
    const { stdout, stderr } = await promisify(execFile)(
      process.execPath,
      [
        '--import',
        'tsx',
        fileURLToPath(new URL('./helpers/growth-attribution-process.ts', import.meta.url)),
        mode,
      ],
      { env: { ...process.env, ALUVIA_HOME: home }, timeout: 5000 },
    );
    assert.equal(stderr, '');
    return stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  };
  const reports = (await Promise.all([run('lost'), run('lost'), run('lost')])).flat();
  assert.ok(reports.length >= 1);
  for (const report of reports) assert.deepEqual(report, reports[0]);
  assert.deepEqual(await run('recovered'), [reports[0]]);
  assert.deepEqual(await run('recovered'), []);
});
