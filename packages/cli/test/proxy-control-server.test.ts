import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert';
import type { Server } from 'node:http';
import { createControlServer, ControlError } from '../src/proxy-control-server.js';
import { defaultAttach } from '../src/proxy-state.js';

async function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : 0);
    });
    server.on('error', reject);
  });
}

describe('control server', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  });

  test('POST /route of * is 400 and POST of a host is 200 after the handler resolves', async () => {
    let routed: string | null = null;
    server = createControlServer({
      getStatus: () => ({
        pid: 1,
        proxyUrl: 'http://127.0.0.1:18787',
        controlUrl: 'http://127.0.0.1:18788',
        connectionId: 1,
        sessionId: 'x',
        targetGeo: null,
        rules: routed ? [routed] : [],
        count: routed ? 1 : 0,
        attach: defaultAttach('/tmp'),
      }),
      route: async (host) => {
        if (host === '*') throw new ControlError(400, 'catch-all * is not allowed');
        routed = host;
        return { rules: [host] };
      },
      unroute: async () => ({ rules: [] }),
      rotateIp: async () => ({ sessionId: 'n', connectionId: 1 }),
      setGeo: async () => ({ targetGeo: null, connectionId: 1 }),
      stop: () => {},
    });
    const port = await listen(server);

    const bad = await fetch(`http://127.0.0.1:${port}/route`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ host: '*' }),
    });
    assert.strictEqual(bad.status, 400);
    assert.deepStrictEqual(await bad.json(), { error: 'catch-all * is not allowed' });

    const ok = await fetch(`http://127.0.0.1:${port}/route`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ host: 'example.com' }),
    });
    assert.strictEqual(ok.status, 200);
    assert.deepStrictEqual(await ok.json(), { rules: ['example.com'] });
    assert.strictEqual(routed, 'example.com');
  });

  test('unknown path is 404 and set-geo with neither field is 400', async () => {
    server = createControlServer({
      getStatus: () => {
        throw new Error('unused');
      },
      route: async () => ({ rules: [] }),
      unroute: async () => ({ rules: [] }),
      rotateIp: async () => ({ sessionId: 'n', connectionId: 1 }),
      setGeo: async () => ({ targetGeo: null, connectionId: 1 }),
      stop: () => {},
    });
    const port = await listen(server);
    const missing = await fetch(`http://127.0.0.1:${port}/nope`);
    assert.strictEqual(missing.status, 404);

    const geo = await fetch(`http://127.0.0.1:${port}/set-geo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(geo.status, 400);
  });

  test('GET /last-connect returns the handler value and POST /attach-state rejects invalid status', async () => {
    let stored = defaultAttach('/tmp');
    server = createControlServer({
      getStatus: () => {
        throw new Error('unused');
      },
      route: async () => ({ rules: [] }),
      unroute: async () => ({ rules: [] }),
      rotateIp: async () => ({ sessionId: 'n', connectionId: 1 }),
      setGeo: async () => ({ targetGeo: null, connectionId: 1 }),
      stop: () => {},
      getLastConnect: () => 'verify.example',
      setAttach: (next) => {
        stored = next;
      },
    });
    const port = await listen(server);

    const last = await fetch(`http://127.0.0.1:${port}/last-connect`);
    assert.strictEqual(last.status, 200);
    assert.deepStrictEqual(await last.json(), { hostname: 'verify.example' });

    const bad = await fetch(`http://127.0.0.1:${port}/attach-state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'nope' }),
    });
    assert.strictEqual(bad.status, 400);

    const missing = await fetch(`http://127.0.0.1:${port}/nope`);
    assert.strictEqual(missing.status, 404);
    assert.strictEqual(stored.status, 'unverified');
  });

  test('POST /last-connect clears lastConnect and returns hostname null', async () => {
    let lastConnect: string | null = 'verify.example';
    server = createControlServer({
      getStatus: () => {
        throw new Error('unused');
      },
      route: async () => ({ rules: [] }),
      unroute: async () => ({ rules: [] }),
      rotateIp: async () => ({ sessionId: 'n', connectionId: 1 }),
      setGeo: async () => ({ targetGeo: null, connectionId: 1 }),
      stop: () => {},
      getLastConnect: () => lastConnect,
      setLastConnect: (hostname) => {
        lastConnect = hostname;
      },
    });
    const port = await listen(server);

    const cleared = await fetch(`http://127.0.0.1:${port}/last-connect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(cleared.status, 200);
    assert.deepStrictEqual(await cleared.json(), { hostname: null });
    assert.strictEqual(lastConnect, null);

    const last = await fetch(`http://127.0.0.1:${port}/last-connect`);
    assert.strictEqual(last.status, 200);
    assert.deepStrictEqual(await last.json(), { hostname: null });
  });
});
