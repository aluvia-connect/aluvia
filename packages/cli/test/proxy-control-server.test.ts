import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert';
import type { Server } from 'node:http';
import { PaymentRequiredError } from '../src/net/errors.js';
import { createControlServer, type ControlHandlers } from '../src/proxy-control-server.js';
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

function unusedHandlers(overrides: Partial<ControlHandlers> = {}): ControlHandlers {
  return {
    getStatus: () => {
      throw new Error('unused');
    },
    rotateIp: async () => ({ sessionId: 'n', connectionId: 1 }),
    setGeo: async () => ({ targetGeo: null, connectionId: 1 }),
    stop: () => {},
    ...overrides,
  };
}

describe('control server', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  });

  test('POST /proxy-on and /proxy-off call handlers', async () => {
    let egress: 'aluvia' | 'direct' = 'direct';
    server = createControlServer(
      unusedHandlers({
        proxyOn: async () => {
          egress = 'aluvia';
          return { egress, rules: ['*'] };
        },
        proxyOff: async () => {
          egress = 'direct';
          return { egress, rules: [] };
        },
      }),
    );
    const port = await listen(server);

    const on = await fetch(`http://127.0.0.1:${port}/proxy-on`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(on.status, 200);
    assert.deepStrictEqual(await on.json(), { egress: 'aluvia', rules: ['*'] });

    const off = await fetch(`http://127.0.0.1:${port}/proxy-off`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(off.status, 200);
    assert.deepStrictEqual(await off.json(), { egress: 'direct', rules: [] });
  });

  test('unknown path is 404 and set-geo with neither field is 400', async () => {
    server = createControlServer(unusedHandlers());
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
    let stored = defaultAttach();
    server = createControlServer(
      unusedHandlers({
        getLastConnect: () => ({ hostname: 'verify.example', at: 1 }),
        setAttach: (next) => {
          stored = next;
        },
      }),
    );
    const port = await listen(server);

    const last = await fetch(`http://127.0.0.1:${port}/last-connect`);
    assert.strictEqual(last.status, 200);
    assert.deepStrictEqual(await last.json(), { hostname: 'verify.example', at: 1 });

    const bad = await fetch(`http://127.0.0.1:${port}/attach-state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'nope' }),
    });
    assert.strictEqual(bad.status, 400);

    const missing = await fetch(`http://127.0.0.1:${port}/nope`);
    assert.strictEqual(missing.status, 404);
    assert.strictEqual(stored.status, 'needs_ui');
  });

  test('handler PaymentRequiredError becomes 402 with claim_url', async () => {
    server = createControlServer(
      unusedHandlers({
        rotateIp: async () => {
          throw new PaymentRequiredError('used up', 'https://dashboard.aluvia.io/cli-auth');
        },
      }),
    );
    const port = await listen(server);
    const res = await fetch(`http://127.0.0.1:${port}/rotate-ip`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(res.status, 402);
    assert.deepStrictEqual(await res.json(), {
      error: 'used up',
      code: 'payment_required',
      claim_url: 'https://dashboard.aluvia.io/cli-auth',
    });
  });

  test('POST /last-connect clears lastConnect and returns hostname null', async () => {
    let lastConnect = { hostname: 'verify.example' as string | null, at: 1 as number | null };
    server = createControlServer(
      unusedHandlers({
        getLastConnect: () => lastConnect,
        setLastConnect: (snapshot) => {
          lastConnect = snapshot;
        },
      }),
    );
    const port = await listen(server);

    const cleared = await fetch(`http://127.0.0.1:${port}/last-connect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(cleared.status, 200);
    assert.deepStrictEqual(await cleared.json(), { hostname: null, at: null });
    assert.deepStrictEqual(lastConnect, { hostname: null, at: null });

    const last = await fetch(`http://127.0.0.1:${port}/last-connect`);
    assert.strictEqual(last.status, 200);
    assert.deepStrictEqual(await last.json(), { hostname: null, at: null });
  });
});
