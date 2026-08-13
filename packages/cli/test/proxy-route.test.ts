import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { captureOutput } from '../src/mcp-helpers.js';
import { handleProxy } from '../src/proxy.js';
import { defaultAttach, readProxyJson, writeProxyJson } from '../src/proxy-state.js';
import { createMockAluviaApi } from './helpers/mock-aluvia-api.js';
import { createMockGateway } from './helpers/mock-gateway.js';
import { connectViaProxy } from './helpers/connect-via-proxy.js';
import { findFreePort } from './helpers/ports.js';

const ENV_KEYS = [
  'ALUVIA_HOME',
  'ALUVIA_API_KEY',
  'ALUVIA_API_BASE_URL',
  'ALUVIA_PROXY_PORT',
  'ALUVIA_PROXY_CONTROL_PORT',
  'ALUVIA_GATEWAY_HOST',
  'ALUVIA_GATEWAY_PORT',
] as const;

const NOT_RUNNING = 'proxyd is not running. Run `aluvia proxy start`.';
const DATA_PORT_UNHEALTHY = 'proxyd data port is not healthy. Run `aluvia proxy status`.';

function snapshotEnv(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) out[key] = process.env[key];
  return out;
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
}

function startArgs(dataPort: number, controlPort: number): string[] {
  return ['start', '--port', String(dataPort), '--control-port', String(controlPort)];
}

describe('proxy route / unroute / rotate-ip / set-geo', { concurrency: 1 }, () => {
  let home: string;
  let api: Awaited<ReturnType<typeof createMockAluviaApi>>;
  let gateway: Awaited<ReturnType<typeof createMockGateway>>;
  let dataPort: number;
  let controlPort: number;
  const originalEnv = snapshotEnv();

  beforeEach(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'aluvia-home-'));
    api = await createMockAluviaApi();
    gateway = await createMockGateway();
    dataPort = await findFreePort();
    controlPort = await findFreePort();
    process.env.ALUVIA_HOME = home;
    process.env.ALUVIA_API_KEY = 'test-key';
    process.env.ALUVIA_API_BASE_URL = api.url;
    process.env.ALUVIA_GATEWAY_HOST = '127.0.0.1';
    process.env.ALUVIA_GATEWAY_PORT = String(gateway.port);
    delete process.env.ALUVIA_PROXY_PORT;
    delete process.env.ALUVIA_PROXY_CONTROL_PORT;
    const started = await captureOutput(() => handleProxy(startArgs(dataPort, controlPort)));
    assert.strictEqual(started.isError, false, String(started.data.error ?? ''));
  });

  afterEach(async () => {
    const state = readProxyJson();
    if (state?.pid === process.pid) {
      writeProxyJson({ ...state, pid: null, ready: false });
    }
    try {
      await captureOutput(() => handleProxy(['stop']));
    } catch {
      // ignore
    }
    await gateway.close();
    await api.close();
    restoreEnv(originalEnv);
    try {
      fs.rmSync(home, { recursive: true, force: true });
    } catch {
      try {
        fs.rmSync(home, { recursive: true, force: true });
      } catch {
        // ignore leftover tmp files
      }
    }
  });

  test('synchronous route takes effect before the CLI returns', async () => {
    const routed = await captureOutput(() => handleProxy(['route', 'example.com']));
    assert.strictEqual(routed.isError, false, String(routed.data.error ?? ''));
    assert.deepStrictEqual(routed.data, { rules: ['example.com'], count: 1 });
    await connectViaProxy(dataPort, 'example.com');
    assert.ok(gateway.connects.includes('example.com:443'));
  });

  test('route closes a live CONNECT so the next one can flip to Aluvia', async () => {
    const held = await new Promise<{ socket: import('net').Socket }>((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1',
        port: dataPort,
        method: 'CONNECT',
        path: 'held.example:443',
      });
      req.on('connect', (_res, socket) => resolve({ socket }));
      req.on('error', reject);
      req.setTimeout(2000, () => req.destroy(new Error('CONNECT timeout')));
      req.end();
    });
    const closed = new Promise<void>((resolve) => {
      held.socket.once('close', () => resolve());
    });
    const routed = await captureOutput(() => handleProxy(['route', 'held.example']));
    assert.strictEqual(routed.isError, false, String(routed.data.error ?? ''));
    await Promise.race([
      closed,
      new Promise((_, reject) => setTimeout(() => reject(new Error('live CONNECT was not dropped')), 2000)),
    ]);
  });

  test('unroute goes direct and does not hit the mock gateway', async () => {
    const routed = await captureOutput(() => handleProxy(['route', 'example.com']));
    assert.strictEqual(routed.isError, false, String(routed.data.error ?? ''));
    await connectViaProxy(dataPort, 'example.com');
    const before = gateway.connects.length;

    const unrouted = await captureOutput(() => handleProxy(['unroute', 'example.com']));
    assert.strictEqual(unrouted.isError, false, String(unrouted.data.error ?? ''));
    assert.deepStrictEqual(unrouted.data, { rules: [], count: 0 });

    await connectViaProxy(dataPort, 'example.com');
    assert.strictEqual(gateway.connects.length, before);
  });

  test('unrouted host never hits the gateway', async () => {
    await connectViaProxy(dataPort, 'other.com');
    assert.deepStrictEqual(gateway.connects, []);
  });

  test('CLI refuses catch-all *', async () => {
    const beforeRules = [...api.state.rules];
    const result = await captureOutput(() => handleProxy(['route', '*']));
    assert.strictEqual(result.isError, true);
    assert.strictEqual(result.data.error, 'catch-all * is not allowed');
    assert.deepStrictEqual(api.state.rules, beforeRules);
  });

  test('control refuses catch-all *', async () => {
    const res = await fetch(`http://127.0.0.1:${controlPort}/route`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ host: '*' }),
    });
    assert.strictEqual(res.status, 400);
    const body = (await res.json()) as { error?: string };
    assert.strictEqual(body.error, 'catch-all * is not allowed');
  });

  test('URL parse lowercases hostname', async () => {
    const result = await captureOutput(() => handleProxy(['route', 'https://Example.COM/path?q=1']));
    assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
    assert.deepStrictEqual(result.data, { rules: ['example.com'], count: 1 });
  });

  test('loopback refuse', async () => {
    const result = await captureOutput(() => handleProxy(['route', 'localhost']));
    assert.strictEqual(result.isError, true);
    assert.strictEqual(result.data.error, 'loopback hosts cannot be routed');
  });

  test('unroute of a missing host succeeds', async () => {
    const current = readProxyJson()?.rules ?? [];
    const result = await captureOutput(() => handleProxy(['unroute', 'nope.example']));
    assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
    assert.deepStrictEqual(result.data, { rules: current, count: current.length });
  });

  test('rotate-ip changes only the session id', async () => {
    const status = await captureOutput(() => handleProxy(['status']));
    assert.strictEqual(status.isError, false, String(status.data.error ?? ''));
    const previous = String(status.data.sessionId);
    assert.match(previous, /^[0-9a-f]{32}$/);

    const rotated = await captureOutput(() => handleProxy(['rotate-ip']));
    assert.strictEqual(rotated.isError, false, String(rotated.data.error ?? ''));
    const sessionId = String(rotated.data.sessionId);
    assert.match(sessionId, /^[0-9a-f]{32}$/);
    assert.notStrictEqual(sessionId, previous);
    assert.strictEqual(rotated.data.connectionId, status.data.connectionId);
    assert.strictEqual(api.state.session_id, sessionId);
  });

  test('set-geo sets, clears, and rejects neither/both', async () => {
    const status = await captureOutput(() => handleProxy(['status']));
    assert.strictEqual(status.isError, false, String(status.data.error ?? ''));
    const connectionId = status.data.connectionId;

    const set = await captureOutput(() => handleProxy(['set-geo', 'us_ca']));
    assert.strictEqual(set.isError, false, String(set.data.error ?? ''));
    assert.deepStrictEqual(set.data, { targetGeo: 'us_ca', connectionId });

    const cleared = await captureOutput(() => handleProxy(['set-geo', '--clear']));
    assert.strictEqual(cleared.isError, false, String(cleared.data.error ?? ''));
    assert.deepStrictEqual(cleared.data, { targetGeo: null, connectionId });

    const neither = await captureOutput(() => handleProxy(['set-geo']));
    assert.strictEqual(neither.isError, true);
    assert.strictEqual(neither.data.error, 'set-geo requires either geo or clear, not both');

    const both = await captureOutput(() => handleProxy(['set-geo', 'us_ca', '--clear']));
    assert.strictEqual(both.isError, true);
    assert.strictEqual(both.data.error, 'set-geo requires either geo or clear, not both');
  });

  test('route after stop is not-running', async () => {
    const stopped = await captureOutput(() => handleProxy(['stop']));
    assert.strictEqual(stopped.isError, false);
    const result = await captureOutput(() => handleProxy(['route', 'example.com']));
    assert.strictEqual(result.isError, true);
    assert.strictEqual(result.data.error, NOT_RUNNING);
  });

  test('PATCH failure leaves memory unchanged', async () => {
    await api.close();
    const routed = await captureOutput(() => handleProxy(['route', 'example.com']));
    assert.strictEqual(routed.isError, true);
    const status = await captureOutput(() => handleProxy(['status']));
    assert.strictEqual(status.isError, false, String(status.data.error ?? ''));
    assert.deepStrictEqual(status.data.rules, []);
  });

  test('missing host', async () => {
    const result = await captureOutput(() => handleProxy(['route']));
    assert.strictEqual(result.isError, true);
    assert.strictEqual(result.data.error, 'host is required');
  });

  test('control up, data port dead', async () => {
    const stopped = await captureOutput(() => handleProxy(['stop']));
    assert.strictEqual(stopped.isError, false);

    const deadDataPort = await findFreePort();
    const fake = http.createServer((req, res) => {
      if (req.method === 'POST' && (req.url ?? '').startsWith('/route')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ rules: ['example.com'] }));
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
    const fakeControlPort: number = await new Promise((resolve, reject) => {
      fake.listen(0, '127.0.0.1', () => {
        const addr = fake.address();
        resolve(typeof addr === 'object' && addr ? addr.port : 0);
      });
      fake.on('error', reject);
    });
    try {
      writeProxyJson({
        pid: process.pid,
        ready: true,
        dataPort: deadDataPort,
        controlPort: fakeControlPort,
        proxyUrl: `http://127.0.0.1:${deadDataPort}`,
        controlUrl: `http://127.0.0.1:${fakeControlPort}`,
        connectionId: 3449,
        sessionId: 'cccccccccccccccccccccccccccccccc',
        targetGeo: null,
        rules: [],
        attach: defaultAttach(home),
      });
      const result = await captureOutput(() => handleProxy(['route', 'example.com']));
      assert.strictEqual(result.isError, true);
      assert.strictEqual(result.data.error, DATA_PORT_UNHEALTHY);
    } finally {
      const state = readProxyJson();
      if (state) writeProxyJson({ ...state, pid: null, ready: false });
      await new Promise<void>((resolve) => fake.close(() => resolve()));
    }
  });
});
