import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { captureOutput } from '../src/output-capture.js';
import { handleProxy } from '../src/proxy.js';
import { defaultAttach, readProxyJson, writeProxyJson } from '../src/proxy-state.js';
import { createMockAluviaApi } from './helpers/mock-aluvia-api.js';
import { createMockGateway, MOCK_EGRESS_IP } from './helpers/mock-gateway.js';
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
  'ALUVIA_PROBE_URL',
] as const;

const NOT_RUNNING = 'proxyd is not running. Run `aluvia start`.';
const DATA_PORT_UNHEALTHY = 'proxyd data port is not healthy. Run `aluvia status`.';

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

describe('proxy-on / proxy-off / rotate-ip', { concurrency: 1 }, () => {
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
    process.env.ALUVIA_PROBE_URL = `https://${MOCK_EGRESS_IP}/`;
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

  test('proxy-on sends every host through the gateway', async () => {
    const routed = await captureOutput(() => handleProxy(['proxy-on']));
    assert.strictEqual(routed.isError, false, String(routed.data.error ?? ''));
    assert.strictEqual(routed.data.egress, 'aluvia');
    assert.deepStrictEqual(routed.data.rules, ['*']);
    await connectViaProxy(dataPort, 'example.com');
    assert.ok(gateway.connects.includes('example.com:443'));
  });

  test('proxy-on closes a live CONNECT so the next one can flip to Aluvia', async () => {
    const target = await new Promise<import('net').Server>((resolve, reject) => {
      const server = http.createServer();
      server.listen(0, '127.0.0.1', () => resolve(server));
      server.on('error', reject);
    });
    const targetPort = (target.address() as import('net').AddressInfo).port;
    try {
      const held = await new Promise<{ socket: import('net').Socket }>((resolve, reject) => {
        const req = http.request({
          host: '127.0.0.1',
          port: dataPort,
          method: 'CONNECT',
          path: `127.0.0.1:${targetPort}`,
        });
        req.on('connect', (_res, socket) => resolve({ socket }));
        req.on('error', reject);
        req.setTimeout(2000, () => req.destroy(new Error('CONNECT timeout')));
        req.end();
      });
      const closed = new Promise<void>((resolve) => {
        held.socket.once('close', () => resolve());
      });
      const routed = await captureOutput(() => handleProxy(['proxy-on']));
      assert.strictEqual(routed.isError, false, String(routed.data.error ?? ''));
      await Promise.race([
        closed,
        new Promise((_, reject) => setTimeout(() => reject(new Error('live CONNECT was not dropped')), 2000)),
      ]);
    } finally {
      await new Promise<void>((resolve) => target.close(() => resolve()));
    }
  });

  test('proxy-off goes direct and does not hit the mock gateway', async () => {
    const routed = await captureOutput(() => handleProxy(['proxy-on']));
    assert.strictEqual(routed.isError, false, String(routed.data.error ?? ''));
    await connectViaProxy(dataPort, 'example.com');
    const before = gateway.connects.length;

    const off = await captureOutput(() => handleProxy(['proxy-off']));
    assert.strictEqual(off.isError, false, String(off.data.error ?? ''));
    assert.strictEqual(off.data.egress, 'direct');
    assert.deepStrictEqual(off.data.rules, []);

    await connectViaProxy(dataPort, 'example.com');
    assert.strictEqual(gateway.connects.length, before);
    assert.strictEqual(readProxyJson()?.pid != null, true);
  });

  test('direct host never hits the gateway', async () => {
    await connectViaProxy(dataPort, 'other.com');
    assert.deepStrictEqual(gateway.connects, []);
  });

  test('rotate-ip closes a live CONNECT so the next request uses the new session', async () => {
    const on = await captureOutput(() => handleProxy(['proxy-on']));
    assert.strictEqual(on.isError, false, String(on.data.error ?? ''));
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
    const rotated = await captureOutput(() => handleProxy(['rotate-ip']));
    assert.strictEqual(rotated.isError, false, String(rotated.data.error ?? ''));
    await Promise.race([
      closed,
      new Promise((_, reject) => setTimeout(() => reject(new Error('live CONNECT was not dropped')), 2000)),
    ]);
  });

  test('proxy-on after trial is used up is payment_required with a cli_code URL', async () => {
    api.setPaymentRequired(true);
    const result = await captureOutput(() => handleProxy(['proxy-on']));
    assert.strictEqual(result.isError, true);
    assert.strictEqual(result.data.code, 'payment_required');
    assert.strictEqual(result.data.claim_url, 'https://dashboard.aluvia.io/cli-auth?cli_code=user-code-1');
    assert.match(String(result.data.next), /aluvia auth login/);
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
    assert.strictEqual(rotated.data.rotated, true);
    assert.strictEqual(rotated.data.ready, true);
    assert.strictEqual(api.state.session_id, sessionId);
    assert.strictEqual(api.state.session_id, readProxyJson()?.sessionId);
  });

  test('proxy-on and rotate-ip reject --geo all / any / *', async () => {
    const before = await captureOutput(() => handleProxy(['status']));
    assert.strictEqual(before.isError, false, String(before.data.error ?? ''));
    const targetBefore = before.data.targetGeo ?? null;

    for (const value of ['all', 'ANY', '*']) {
      const result = await captureOutput(() => handleProxy(['proxy-on', '--geo', value]));
      assert.strictEqual(result.isError, true, value);
      assert.match(String(result.data.error), /Omit --geo/);
      assert.match(String(result.data.next), /without --geo/);
    }

    const rotate = await captureOutput(() => handleProxy(['rotate-ip', '--geo', 'any']));
    assert.strictEqual(rotate.isError, true);
    assert.match(String(rotate.data.error), /Omit --geo/);

    const after = await captureOutput(() => handleProxy(['status']));
    assert.strictEqual(after.isError, false, String(after.data.error ?? ''));
    assert.strictEqual(after.data.targetGeo ?? null, targetBefore);
  });

  test('proxy-on --geo pins, no-ops in that geo, omit --geo selects any geo', async () => {
    const first = await captureOutput(() => handleProxy(['proxy-on', '--geo', 'us_ca']));
    assert.strictEqual(first.isError, false, String(first.data.error ?? ''));
    assert.strictEqual(first.data.egress, 'aluvia');
    assert.strictEqual(first.data.targetGeo, 'us_ca');
    assert.strictEqual(first.data.rotated, true);

    const again = await captureOutput(() => handleProxy(['proxy-on', '--geo', 'us_ca']));
    assert.strictEqual(again.isError, false, String(again.data.error ?? ''));
    assert.strictEqual(again.data.rotated, false);
    assert.strictEqual(again.data.targetGeo, 'us_ca');

    const unpinned = await captureOutput(() => handleProxy(['proxy-on']));
    assert.strictEqual(unpinned.isError, false, String(unpinned.data.error ?? ''));
    assert.strictEqual(unpinned.data.targetGeo, null);
    assert.strictEqual(unpinned.data.rotated, true);

    const alreadyAny = await captureOutput(() => handleProxy(['proxy-on']));
    assert.strictEqual(alreadyAny.isError, false, String(alreadyAny.data.error ?? ''));
    assert.strictEqual(alreadyAny.data.rotated, false);
    assert.strictEqual(alreadyAny.data.targetGeo, null);

    const pinnedAgain = await captureOutput(() => handleProxy(['rotate-ip', '--geo', 'us_ca']));
    assert.strictEqual(pinnedAgain.isError, false, String(pinnedAgain.data.error ?? ''));
    assert.strictEqual(pinnedAgain.data.targetGeo, 'us_ca');

    const rotated = await captureOutput(() => handleProxy(['rotate-ip']));
    assert.strictEqual(rotated.isError, false, String(rotated.data.error ?? ''));
    assert.strictEqual(rotated.data.targetGeo, null);
    assert.strictEqual(rotated.data.egress, 'aluvia');
    assert.strictEqual(rotated.data.rotated, true);

    const gone = await captureOutput(() => handleProxy(['set-geo', 'us_ca']));
    assert.strictEqual(gone.isError, true);
    assert.match(String(gone.data.error), /Unknown command/);
  });

  test('rotate-ip turns proxy on when egress is direct', async () => {
    const off = await captureOutput(() => handleProxy(['proxy-off']));
    assert.strictEqual(off.isError, false, String(off.data.error ?? ''));
    assert.strictEqual(off.data.egress, 'direct');

    const rotated = await captureOutput(() => handleProxy(['rotate-ip']));
    assert.strictEqual(rotated.isError, false, String(rotated.data.error ?? ''));
    assert.strictEqual(rotated.data.egress, 'aluvia');
    assert.strictEqual(rotated.data.rotated, true);
  });

  test('proxy-on after stop is not-running', async () => {
    const stopped = await captureOutput(() => handleProxy(['stop']));
    assert.strictEqual(stopped.isError, false);
    const result = await captureOutput(() => handleProxy(['proxy-on']));
    assert.strictEqual(result.isError, true);
    assert.strictEqual(result.data.error, NOT_RUNNING);
  });

  test('PATCH failure leaves memory unchanged', async () => {
    await api.close();
    const routed = await captureOutput(() => handleProxy(['proxy-on']));
    assert.strictEqual(routed.isError, true);
    const status = await captureOutput(() => handleProxy(['status']));
    assert.strictEqual(status.isError, false, String(status.data.error ?? ''));
    assert.deepStrictEqual(status.data.rules, []);
    assert.strictEqual(status.data.egress, 'direct');
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
        attach: defaultAttach(),
      });
      const result = await captureOutput(() => handleProxy(['proxy-on']));
      assert.strictEqual(result.isError, true);
      assert.strictEqual(result.data.error, DATA_PORT_UNHEALTHY);
    } finally {
      const state = readProxyJson();
      if (state) writeProxyJson({ ...state, pid: null, ready: false });
      await new Promise<void>((resolve) => fake.close(() => resolve()));
    }
  });
});

describe('rotate-ip waits for a successful tunnel probe', { concurrency: 1 }, () => {
  let home: string;
  let api: Awaited<ReturnType<typeof createMockAluviaApi>>;
  let gateway: Awaited<ReturnType<typeof createMockGateway>>;
  let dataPort: number;
  let controlPort: number;
  const originalEnv = snapshotEnv();

  beforeEach(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'aluvia-home-'));
    api = await createMockAluviaApi();
    gateway = await createMockGateway({
      failConnectHosts: [MOCK_EGRESS_IP],
      connectFailStatus: 502,
    });
    dataPort = await findFreePort();
    controlPort = await findFreePort();
    process.env.ALUVIA_HOME = home;
    process.env.ALUVIA_API_KEY = 'test-key';
    process.env.ALUVIA_API_BASE_URL = api.url;
    process.env.ALUVIA_GATEWAY_HOST = '127.0.0.1';
    process.env.ALUVIA_GATEWAY_PORT = String(gateway.port);
    process.env.ALUVIA_PROBE_URL = `https://${MOCK_EGRESS_IP}/`;
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

  test('rotate-ip does not return success without a successful probe', async () => {
    const before = String(readProxyJson()?.sessionId ?? '');
    assert.match(before, /^[0-9a-f]{32}$/);
    const rotated = await captureOutput(() => handleProxy(['rotate-ip']));
    assert.strictEqual(rotated.isError, false, String(rotated.data.error ?? ''));
    assert.strictEqual(rotated.data.rotated, false);
    assert.strictEqual(rotated.data.ready, false);
    const sessionId = String(rotated.data.sessionId);
    assert.match(sessionId, /^[0-9a-f]{32}$/);
    assert.notStrictEqual(sessionId, before);
    assert.strictEqual(api.state.session_id, sessionId);
    assert.strictEqual(readProxyJson()?.sessionId, sessionId);
    assert.match(String(rotated.data.error), /Upstream gateway returned \d+\./);
    assert.ok(!String(rotated.data.error).includes('590 UPSTREAM503'));
  });
});
