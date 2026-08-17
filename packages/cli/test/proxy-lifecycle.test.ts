import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { getStoredConnectionId } from '../src/config.js';
import { captureOutput } from '../src/output-capture.js';
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
  'ALUVIA_CONTROL_TIMEOUT_MS',
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

  test('proxy-provider recycles a running daemon so the new URL applies', async () => {
    const started = await captureOutput(() => handleProxy(startArgs(dataPort, controlPort)));
    assert.strictEqual(started.isError, false, String(started.data.error ?? ''));
    const before = readProxyJson();
    assert.ok(before?.pid);

    const result = await captureOutput(() => handleProxy(['proxy-provider', 'http://user:pass@127.0.0.1:9']));
    assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
    assert.strictEqual(result.data.provider, 'custom');
    assert.strictEqual(result.data.upstreamHost, '127.0.0.1');
    assert.strictEqual(result.data.recycled, true);
    assert.match(String(result.data.next), /Reload the tab/);

    const after = readProxyJson();
    assert.ok(after?.ready);
    assert.ok(after.pid);
    assert.notStrictEqual(after.pid, before.pid);

    const back = await captureOutput(() => handleProxy(['proxy-provider', 'aluvia']));
    assert.strictEqual(back.isError, false, String(back.data.error ?? ''));
    assert.strictEqual(back.data.provider, 'aluvia');
    assert.strictEqual(back.data.recycled, true);
  });

  test('start maps 402 on the first session mint to payment_required', async () => {
    delete process.env.ALUVIA_API_KEY;
    api.setPaymentRequired(true, { exceptPost: true });
    const result = await captureOutput(() => handleProxy(startArgs(dataPort, controlPort)));
    assert.strictEqual(result.isError, true);
    assert.strictEqual(result.data.code, 'payment_required');
    assert.strictEqual(result.data.claim_url, 'https://dashboard.aluvia.io/cli-auth?cli_code=user-code-1');
    assert.match(String(result.data.next), /aluvia auth login/);
  });

  test('start maps 402 to payment_required', async () => {
    delete process.env.ALUVIA_API_KEY;
    api.setPaymentRequired(true);
    const result = await captureOutput(() => handleProxy(startArgs(dataPort, controlPort)));
    assert.strictEqual(result.isError, true);
    assert.strictEqual(result.data.code, 'payment_required');
    assert.strictEqual(result.data.claim_url, 'https://dashboard.aluvia.io/cli-auth?cli_code=user-code-1');
    assert.match(String(result.data.next), /aluvia auth login/);
  });

  test('start writes proxy.json + proxy.log under ALUVIA_HOME', async () => {
    const result = await captureOutput(() => handleProxy(startArgs(dataPort, controlPort)));
    assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
    assert.ok(typeof result.data.next === 'string');
    assert.ok(result.data.what);
    assert.strictEqual(fs.existsSync(path.join(home, 'proxy.json')), true);
    assert.strictEqual(fs.existsSync(path.join(home, 'proxy.log')), true);
    const state = readProxyJson();
    assert.ok(state);
    assert.strictEqual(state.ready, true);
    assert.match(state.sessionId ?? '', /^[0-9a-f]{32}$/);
    assert.strictEqual(state.connectionId, 3449);
    assert.strictEqual(getStoredConnectionId(), 3449);
    assert.deepStrictEqual(state.rules, []);
    assert.match(api.state.session_id ?? '', /^[0-9a-f]{32}$/);
    assert.strictEqual(api.state.session_id, state.sessionId);
  });

  test('wiping proxy.json but keeping config.json reuses connectionId', async () => {
    const first = await captureOutput(() => handleProxy(startArgs(dataPort, controlPort)));
    assert.strictEqual(first.isError, false, String(first.data.error ?? ''));
    assert.strictEqual(getStoredConnectionId(), 3449);
    const postsAfterFirst = api.requests.filter(
      (req) => req.method === 'POST' && req.url === '/account/connections',
    ).length;
    assert.strictEqual(postsAfterFirst, 1);

    const stopped = await captureOutput(() => handleProxy(['stop']));
    assert.strictEqual(stopped.isError, false, String(stopped.data.error ?? ''));
    fs.rmSync(path.join(home, 'proxy.json'), { force: true });
    assert.strictEqual(getStoredConnectionId(), 3449);

    const second = await captureOutput(() => handleProxy(startArgs(dataPort, controlPort)));
    assert.strictEqual(second.isError, false, String(second.data.error ?? ''));
    assert.strictEqual(second.data.connectionId, 3449);
    assert.strictEqual(readProxyJson()?.connectionId, 3449);
    const postsAfterSecond = api.requests.filter(
      (req) => req.method === 'POST' && req.url === '/account/connections',
    ).length;
    assert.strictEqual(postsAfterSecond, 1);
    assert.ok(
      api.requests.some((req) => req.method === 'GET' && req.url.startsWith('/account/connections/3449')),
    );
  });

  test('stale --connection-id creates a new connection after GET 404', async () => {
    const result = await captureOutput(() =>
      handleProxy([...startArgs(dataPort, controlPort), '--connection-id', '9999']),
    );
    assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
    assert.strictEqual(result.data.connectionId, 3449);
    assert.ok(
      api.requests.some((req) => req.method === 'GET' && req.url.startsWith('/account/connections/9999')),
    );
    assert.ok(api.requests.some((req) => req.method === 'POST' && req.url === '/account/connections'));
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
    assert.strictEqual(second.isError, false, String(second.data.error ?? ''));
    assert.strictEqual(second.data.error, undefined);
    assert.ok(typeof second.data.proxyUrl === 'string');
    assert.match(String(second.data.next), /already running/);
  });

  test('stale ready:true is not treated as a live daemon', async () => {
    const stale: ProxyJson = {
      pid: 999999994,
      ready: true,
      dataPort,
      controlPort,
      proxyUrl: `http://127.0.0.1:${dataPort}`,
      controlUrl: `http://127.0.0.1:${controlPort}`,
      connectionId: 3449,
      sessionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      targetGeo: null,
      rules: [],
      attach: defaultAttach(),
    };
    writeProxyJson(stale);
    const result = await captureOutput(() => handleProxy(startArgs(dataPort, controlPort)));
    assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
    const after = readProxyJson();
    assert.ok(after);
    assert.notStrictEqual(after.pid, 999999994);
    assert.ok(after.pid != null && after.pid > 0);
    assert.strictEqual(after.ready, true);
    assert.strictEqual(result.data.healthy, true);
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
      attach: defaultAttach(),
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
    assert.ok(typeof status.data.next === 'string');
    assert.ok(status.data.next.length > 0);
    const what = status.data.what as {
      next?: string;
      aimed?: string;
      egress?: string;
      ready?: string;
      healthy?: string;
      needsChromeRestart?: string;
      rules?: string;
      targetGeo?: string;
    };
    assert.ok(typeof what.next === 'string');
    assert.ok(typeof what.aimed === 'string');
    assert.ok(typeof what.egress === 'string');
    assert.ok(typeof what.ready === 'string');
    assert.ok(typeof what.healthy === 'string');
    assert.ok(typeof what.needsChromeRestart === 'string');
    assert.ok(typeof what.rules === 'string');
    assert.ok(typeof what.targetGeo === 'string');
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
    assert.strictEqual(stopped.data.status, 'stopped');
    assert.ok(typeof stopped.data.warning === 'string');

    const after = readProxyJson();
    assert.ok(after);
    assert.strictEqual(after.pid, null);
    assert.strictEqual(after.ready, false);
    assert.strictEqual(after.sessionId, sessionId);
    assert.strictEqual(after.connectionId, before.connectionId);
    assert.strictEqual(getStoredConnectionId(), before.connectionId ?? undefined);
    assert.deepStrictEqual(after.rules, rules);

    const status = await captureOutput(() => handleProxy(['status']));
    assert.strictEqual(status.isError, false, String(status.data.error ?? ''));
    assert.strictEqual(status.data.healthy, false);
    assert.ok(typeof status.data.next === 'string');
    assert.match(String(status.data.next), /aluvia setup/);
    assert.ok(status.data.what);
  });

  test('status when aimed and daemon is dead tells the agent to start without quitting Chrome', async () => {
    writeProxyJson({
      pid: 999999992,
      ready: false,
      dataPort,
      controlPort,
      proxyUrl: `http://127.0.0.1:${dataPort}`,
      controlUrl: `http://127.0.0.1:${controlPort}`,
      connectionId: 3449,
      sessionId: 'dddddddddddddddddddddddddddddddd',
      targetGeo: null,
      rules: ['*'],
      attach: {
        status: 'verified',
        method: 'flags',
        expectConnectAfter: Date.now(),
      },
      lastConnect: { hostname: 'verify.example', at: Date.now() },
    });
    const status = await captureOutput(() => handleProxy(['status']));
    assert.strictEqual(status.isError, false, String(status.data.error ?? ''));
    assert.strictEqual(status.data.aimed, true);
    assert.strictEqual(status.data.egress, 'aluvia');
    assert.match(String(status.data.next), /aluvia start/);
    assert.match(String(status.data.next), /Do not quit Chrome/);
  });

  test('status stays aimed when the last CONNECT is 90s old and no probe is pending', async () => {
    writeProxyJson({
      pid: 999999993,
      ready: false,
      dataPort,
      controlPort,
      proxyUrl: `http://127.0.0.1:${dataPort}`,
      controlUrl: `http://127.0.0.1:${controlPort}`,
      connectionId: 3449,
      sessionId: 'dddddddddddddddddddddddddddddddd',
      targetGeo: null,
      rules: ['*'],
      attach: {
        status: 'verified',
        method: 'flags',
        expectConnectAfter: Date.now() - 120_000,
        reloadAskedAt: null,
      },
      lastConnect: { hostname: 'verify.example', at: Date.now() - 90_000 },
    });
    const status = await captureOutput(() => handleProxy(['status']));
    assert.strictEqual(status.isError, false, String(status.data.error ?? ''));
    assert.strictEqual(status.data.aimed, true);
    assert.strictEqual(status.data.needsChromeRestart, false);
    assert.match(String(status.data.next), /aluvia start/);
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
    assert.strictEqual(stopped.data.status, 'stopped');
    assert.ok(typeof stopped.data.next === 'string');
    const after = readProxyJson();
    assert.ok(after);
    assert.strictEqual(after.pid, null);
    assert.strictEqual(after.ready, false);
  });

  test('start keeps catch-all * from the connection', async () => {
    await api.close();
    api = await createMockAluviaApi({ rules: ['*', 'example.com'] });
    process.env.ALUVIA_API_BASE_URL = api.url;
    const result = await captureOutput(() => handleProxy(startArgs(dataPort, controlPort)));
    assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
    assert.deepStrictEqual(api.state.rules, ['*', 'example.com']);
    assert.strictEqual(result.data.egress, 'aluvia');
  });

  test('status succeeds when control responds after 3s', async () => {
    process.env.ALUVIA_CONTROL_TIMEOUT_MS = '10000';
    const delayed = http.createServer((req, res) => {
      if (req.method === 'GET' && (req.url ?? '') === '/status') {
        setTimeout(() => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              pid: process.pid,
              proxyUrl: `http://127.0.0.1:${dataPort}`,
              controlUrl: `http://127.0.0.1:1`,
              connectionId: 3449,
              sessionId: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
              targetGeo: null,
              rules: [],
              count: 0,
              attach: defaultAttach(),
              egress: 'direct',
            }),
          );
        }, 3000);
        return;
      }
      res.writeHead(404);
      res.end();
    });
    const delayedPort: number = await new Promise((resolve, reject) => {
      delayed.listen(0, '127.0.0.1', () => {
        const addr = delayed.address();
        resolve(typeof addr === 'object' && addr ? addr.port : 0);
      });
      delayed.on('error', reject);
    });
    try {
      writeProxyJson({
        pid: process.pid,
        ready: true,
        dataPort,
        controlPort: delayedPort,
        proxyUrl: `http://127.0.0.1:${dataPort}`,
        controlUrl: `http://127.0.0.1:${delayedPort}`,
        connectionId: 3449,
        sessionId: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        targetGeo: null,
        rules: [],
        attach: defaultAttach(),
      });
      const started = Date.now();
      const result = await captureOutput(() => handleProxy(['status']));
      const elapsed = Date.now() - started;
      assert.ok(elapsed >= 2500, `status returned too fast (${elapsed}ms)`);
      assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
      assert.strictEqual(result.data.sessionId, 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
    } finally {
      const state = readProxyJson();
      if (state) writeProxyJson({ ...state, pid: null, ready: false });
      await new Promise<void>((resolve) => delayed.close(() => resolve()));
    }
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
      process.env.ALUVIA_CONTROL_TIMEOUT_MS = '400';
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
        attach: defaultAttach(),
      });
      const started = Date.now();
      const result = await captureOutput(() => handleProxy(['status']));
      const elapsed = Date.now() - started;
      assert.ok(elapsed <= 2000, `status took ${elapsed}ms`);
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
