import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { captureOutput } from '../src/mcp-helpers.js';
import { handleProxy } from '../src/proxy.js';
import { defaultAttach, readProxyJson, writeProxyJson, type ProxyJson } from '../src/proxy-state.js';
import { createMockAluviaApi } from './helpers/mock-aluvia-api.js';
import { findFreePort, occupyPort } from './helpers/ports.js';

const ENV_KEYS = [
  'ALUVIA_HOME',
  'ALUVIA_API_KEY',
  'ALUVIA_API_BASE_URL',
  'ALUVIA_UPSTREAM',
  'ALUVIA_INSTALL_ID',
  'ALUVIA_PROXY_PORT',
  'ALUVIA_PROXY_CONTROL_PORT',
] as const;

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

describe('proxy lifecycle', { concurrency: 1 }, () => {
  let home: string;
  let api: Awaited<ReturnType<typeof createMockAluviaApi>>;
  let dataPort: number;
  let controlPort: number;
  const originalEnv = snapshotEnv();

  beforeEach(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'aluvia-home-'));
    api = await createMockAluviaApi();
    dataPort = await findFreePort();
    controlPort = await findFreePort();
    process.env.ALUVIA_HOME = home;
    process.env.ALUVIA_API_KEY = 'test-key';
    process.env.ALUVIA_API_BASE_URL = api.url;
    delete process.env.ALUVIA_UPSTREAM;
    delete process.env.ALUVIA_INSTALL_ID;
    delete process.env.ALUVIA_PROXY_PORT;
    delete process.env.ALUVIA_PROXY_CONTROL_PORT;
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

  test('start without an API key uses install id', async () => {
    delete process.env.ALUVIA_API_KEY;
    const result = await captureOutput(() => handleProxy(startArgs(dataPort, controlPort)));
    assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
    const id = fs.readFileSync(path.join(home, 'install_id'), 'utf8').trim();
    assert.match(id, /^[a-f0-9]{64}$/);
    assert.ok(
      api.requests.some(
        (req) =>
          req.method === 'POST' &&
          req.url === '/account/connections' &&
          req.headers['x-aluvia-install-id'] === id,
      ),
      `expected install-id header, got ${JSON.stringify(api.requests)}`,
    );
  });

  test('start with BYO upstream does not call the Aluvia API', async () => {
    delete process.env.ALUVIA_API_KEY;
    process.env.ALUVIA_UPSTREAM = 'http://user:pass@127.0.0.1:9';
    const result = await captureOutput(() => handleProxy(startArgs(dataPort, controlPort)));
    assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
    assert.deepStrictEqual(api.requests, []);
  });

  test('start maps 402 to payment_required', async () => {
    delete process.env.ALUVIA_API_KEY;
    api.setPaymentRequired(true);
    const result = await captureOutput(() => handleProxy(startArgs(dataPort, controlPort)));
    assert.strictEqual(result.isError, true);
    assert.strictEqual(result.data.code, 'payment_required');
    assert.strictEqual(result.data.claim_url, 'https://dashboard.aluvia.io/cli-auth');
  });

  test('start writes proxy.json + proxy.log under ALUVIA_HOME', async () => {
    const result = await captureOutput(() => handleProxy(startArgs(dataPort, controlPort)));
    assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
    assert.strictEqual(fs.existsSync(path.join(home, 'proxy.json')), true);
    assert.strictEqual(fs.existsSync(path.join(home, 'proxy.log')), true);
    const state = readProxyJson();
    assert.ok(state);
    assert.strictEqual(state.ready, true);
    assert.match(state.sessionId ?? '', /^[0-9a-f]{32}$/);
    assert.strictEqual(state.connectionId, 3449);
    assert.deepStrictEqual(state.rules, []);
    assert.match(api.state.session_id ?? '', /^[0-9a-f]{32}$/);
    assert.strictEqual(api.state.session_id, state.sessionId);
  });

  test('--connection-id reuses the seeded connection without POST', async () => {
    const result = await captureOutput(() =>
      handleProxy([...startArgs(dataPort, controlPort), '--connection-id', '3449']),
    );
    assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
    assert.strictEqual(result.data.connectionId, 3449);
    assert.strictEqual(readProxyJson()?.connectionId, 3449);
    assert.ok(
      !api.requests.some((req) => req.method === 'POST' && req.url === '/account/connections'),
      `unexpected create: ${JSON.stringify(api.requests)}`,
    );
    assert.ok(
      api.requests.some((req) => req.method === 'GET' && req.url.startsWith('/account/connections/3449')),
    );
  });

  test('sticky id reused', async () => {
    const first = await captureOutput(() => handleProxy(startArgs(dataPort, controlPort)));
    assert.strictEqual(first.isError, false, String(first.data.error ?? ''));
    const firstId = api.state.session_id;
    assert.match(firstId ?? '', /^[0-9a-f]{32}$/);

    const stopped = await captureOutput(() => handleProxy(['stop']));
    assert.strictEqual(stopped.isError, false, String(stopped.data.error ?? ''));
    assert.strictEqual(stopped.data.status, 'stopped');

    const second = await captureOutput(() => handleProxy(startArgs(dataPort, controlPort)));
    assert.strictEqual(second.isError, false, String(second.data.error ?? ''));
    assert.strictEqual(api.state.session_id, firstId);
    assert.strictEqual(readProxyJson()?.sessionId, firstId);
  });

  test('singleton', async () => {
    const first = await captureOutput(() => handleProxy(startArgs(dataPort, controlPort)));
    assert.strictEqual(first.isError, false, String(first.data.error ?? ''));
    const second = await captureOutput(() => handleProxy(startArgs(dataPort, controlPort)));
    assert.strictEqual(second.isError, true);
    assert.strictEqual(second.data.error, 'proxyd already running');
    assert.ok(typeof second.data.proxyUrl === 'string');
  });

  test('stale pid', async () => {
    const stale: ProxyJson = {
      pid: 999999991,
      ready: false,
      dataPort,
      controlPort,
      proxyUrl: `http://127.0.0.1:${dataPort}`,
      controlUrl: `http://127.0.0.1:${controlPort}`,
      connectionId: 3449,
      sessionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      targetGeo: null,
      rules: [],
      attach: defaultAttach(home),
    };
    writeProxyJson(stale);
    const result = await captureOutput(() => handleProxy(startArgs(dataPort, controlPort)));
    assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
    assert.strictEqual(readProxyJson()?.ready, true);
  });

  test('fixed ports', async () => {
    const occupier = await occupyPort(dataPort);
    try {
      const result = await captureOutput(() => handleProxy(startArgs(dataPort, controlPort)));
      assert.strictEqual(result.isError, true);
      assert.strictEqual(result.data.error, `port ${dataPort} in use`);
    } finally {
      await new Promise<void>((resolve) => occupier.close(() => resolve()));
    }
  });

  test('status healthy', async () => {
    const started = await captureOutput(() => handleProxy(startArgs(dataPort, controlPort)));
    assert.strictEqual(started.isError, false, String(started.data.error ?? ''));
    const status = await captureOutput(() => handleProxy(['status']));
    assert.strictEqual(status.isError, false, String(status.data.error ?? ''));
    assert.strictEqual(status.data.healthy, true);
    assert.ok(typeof status.data.proxyUrl === 'string');
    assert.ok(typeof status.data.controlUrl === 'string');
  });

  test('stop then status', async () => {
    const started = await captureOutput(() => handleProxy(startArgs(dataPort, controlPort)));
    assert.strictEqual(started.isError, false, String(started.data.error ?? ''));
    const before = readProxyJson();
    assert.ok(before);
    const sessionId = before.sessionId;
    const rules = before.rules;

    const stopped = await captureOutput(() => handleProxy(['stop']));
    assert.strictEqual(stopped.isError, false);
    assert.deepStrictEqual(stopped.data, { status: 'stopped' });

    const after = readProxyJson();
    assert.ok(after);
    assert.strictEqual(after.pid, null);
    assert.strictEqual(after.ready, false);
    assert.strictEqual(after.sessionId, sessionId);
    assert.deepStrictEqual(after.rules, rules);

    const status = await captureOutput(() => handleProxy(['status']));
    assert.strictEqual(status.isError, true);
    assert.strictEqual(status.data.error, 'proxyd is not running. Run `aluvia start`.');
  });

  test('stop when already dead', async () => {
    const started = await captureOutput(() => handleProxy(startArgs(dataPort, controlPort)));
    assert.strictEqual(started.isError, false, String(started.data.error ?? ''));
    const pid = readProxyJson()?.pid;
    assert.ok(typeof pid === 'number');
    process.kill(pid, 'SIGKILL');
    await new Promise((resolve) => setTimeout(resolve, 100));

    const stopped = await captureOutput(() => handleProxy(['stop']));
    assert.strictEqual(stopped.isError, false);
    assert.deepStrictEqual(stopped.data, { status: 'stopped' });
    const after = readProxyJson();
    assert.ok(after);
    assert.strictEqual(after.pid, null);
    assert.strictEqual(after.ready, false);
  });

  test('start strips *', async () => {
    await api.close();
    api = await createMockAluviaApi({ rules: ['*', 'example.com'] });
    process.env.ALUVIA_API_BASE_URL = api.url;
    const result = await captureOutput(() => handleProxy(startArgs(dataPort, controlPort)));
    assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
    assert.deepStrictEqual(api.state.rules, ['example.com']);
  });

  test('control timeout', async () => {
    const hangPort = await findFreePort();
    const hangSockets = new Set<net.Socket>();
    const hang = net.createServer((socket) => {
      hangSockets.add(socket);
      socket.on('close', () => hangSockets.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
      hang.listen(hangPort, '127.0.0.1', () => resolve());
      hang.on('error', reject);
    });
    try {
      writeProxyJson({
        pid: process.pid,
        ready: true,
        dataPort,
        controlPort: hangPort,
        proxyUrl: `http://127.0.0.1:${dataPort}`,
        controlUrl: `http://127.0.0.1:${hangPort}`,
        connectionId: 3449,
        sessionId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        targetGeo: null,
        rules: [],
        attach: defaultAttach(home),
      });
      const started = Date.now();
      const result = await captureOutput(() => handleProxy(['status']));
      const elapsed = Date.now() - started;
      assert.ok(elapsed <= 3000, `status took ${elapsed}ms`);
      assert.strictEqual(result.isError, true);
      assert.strictEqual(result.data.error, 'proxyd did not respond. Run `aluvia status`.');
    } finally {
      const state = readProxyJson();
      if (state) writeProxyJson({ ...state, pid: null, ready: false });
      for (const socket of hangSockets) socket.destroy();
      await new Promise<void>((resolve) => hang.close(() => resolve()));
    }
  });
});
