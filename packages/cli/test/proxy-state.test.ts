import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  defaultAttach,
  isLiveAim,
  resolveAimProbe,
  readProxyJson,
  writeProxyJson,
  type ProxyJson,
} from '../src/proxy-state.js';

describe('proxy.json', () => {
  let home: string;
  const original = process.env.ALUVIA_HOME;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'aluvia-home-'));
    process.env.ALUVIA_HOME = home;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.ALUVIA_HOME;
    else process.env.ALUVIA_HOME = original;
    fs.rmSync(home, { recursive: true, force: true });
  });

  test('write then read round-trips and leaves no .tmp file', () => {
    const data: ProxyJson = {
      pid: 123,
      ready: true,
      dataPort: 18787,
      controlPort: 18788,
      proxyUrl: 'http://127.0.0.1:18787',
      controlUrl: 'http://127.0.0.1:18788',
      connectionId: 3449,
      sessionId: 'abc',
      targetGeo: null,
      rules: ['example.com'],
      attach: defaultAttach(),
    };
    writeProxyJson(data);
    assert.deepStrictEqual(readProxyJson(), {
      ...data,
      lastConnect: { hostname: null, at: null },
    });
    assert.strictEqual(fs.existsSync(path.join(home, 'proxy.json.tmp')), false);
    assert.strictEqual(fs.existsSync(path.join(home, 'proxy.json')), true);
  });

  test('readProxyJson returns null when the file is missing', () => {
    assert.strictEqual(readProxyJson(), null);
  });

  test('isLiveAim stays true for an idle CONNECT; probe fails only after a reload ask', () => {
    const attach = {
      status: 'verified' as const,
      method: 'flags' as const,
      expectConnectAfter: 1,
      reloadAskedAt: null,
    };
    const now = 1_000_000;
    assert.strictEqual(isLiveAim(attach, { hostname: 'example.com', at: now }), true);
    assert.strictEqual(isLiveAim(attach, { hostname: 'example.com', at: now - 90_000 }), true);
    assert.strictEqual(isLiveAim(attach, { hostname: null, at: now }), false);
    assert.strictEqual(isLiveAim(attach, { hostname: 'example.com', at: null }), false);
    assert.strictEqual(
      isLiveAim(
        { status: 'needs_ui', method: null, expectConnectAfter: 1, reloadAskedAt: null },
        { hostname: 'example.com', at: now },
      ),
      true,
    );
    assert.strictEqual(
      isLiveAim(
        { status: 'needs_ui', method: null, expectConnectAfter: now + 1, reloadAskedAt: null },
        { hostname: 'example.com', at: now },
      ),
      false,
    );
    assert.strictEqual(
      isLiveAim(
        { status: 'needs_ui', method: null, expectConnectAfter: null, reloadAskedAt: null },
        { hostname: 'example.com', at: now },
      ),
      false,
    );

    const pending = { ...attach, reloadAskedAt: now };
    const idle = resolveAimProbe(pending, { hostname: 'example.com', at: now - 1 });
    assert.strictEqual(idle.aimed, false);
    assert.strictEqual(idle.failed, true);
    const after = resolveAimProbe(pending, { hostname: 'example.com', at: now + 1 });
    assert.strictEqual(after.aimed, true);
    assert.strictEqual(after.failed, false);
    assert.strictEqual(after.attach.reloadAskedAt, null);

    const landed = resolveAimProbe(
      { status: 'needs_ui', method: null, expectConnectAfter: 1, reloadAskedAt: null },
      { hostname: 'accounts.google.com', at: now },
    );
    assert.strictEqual(landed.aimed, true);
    assert.strictEqual(landed.failed, false);
    assert.strictEqual(landed.attach.status, 'verified');
    assert.strictEqual(landed.attach.expectConnectAfter, 1);
    const tooOld = resolveAimProbe(
      { status: 'needs_ui', method: null, expectConnectAfter: now + 1, reloadAskedAt: null },
      { hostname: 'accounts.google.com', at: now },
    );
    assert.strictEqual(tooOld.aimed, false);
    assert.strictEqual(tooOld.attach.status, 'needs_ui');
  });
});
