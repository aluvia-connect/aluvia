import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultAttach, readProxyJson, writeProxyJson, type ProxyJson } from '../src/proxy-state.js';

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
      attach: defaultAttach(home),
    };
    writeProxyJson(data);
    assert.deepStrictEqual(readProxyJson(), data);
    assert.strictEqual(fs.existsSync(path.join(home, 'proxy.json.tmp')), false);
    assert.strictEqual(fs.existsSync(path.join(home, 'proxy.json')), true);
  });

  test('readProxyJson returns null when the file is missing', () => {
    assert.strictEqual(readProxyJson(), null);
  });
});
