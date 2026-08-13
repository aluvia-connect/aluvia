import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import { configDir } from '../src/config.js';

describe('configDir ALUVIA_HOME', () => {
  const original = process.env.ALUVIA_HOME;

  afterEach(() => {
    if (original === undefined) delete process.env.ALUVIA_HOME;
    else process.env.ALUVIA_HOME = original;
  });

  test('defaults to ~/.aluvia when ALUVIA_HOME is unset', () => {
    delete process.env.ALUVIA_HOME;
    assert.strictEqual(configDir(), path.join(os.homedir(), '.aluvia'));
  });

  test('uses ALUVIA_HOME when set, resolved to an absolute path', () => {
    process.env.ALUVIA_HOME = 'relative-aluvia-home';
    assert.strictEqual(configDir(), path.resolve('relative-aluvia-home'));
  });

  test('treats whitespace-only ALUVIA_HOME as unset', () => {
    process.env.ALUVIA_HOME = '   ';
    assert.strictEqual(configDir(), path.join(os.homedir(), '.aluvia'));
  });

  test('saveApiKey writes config.json under ALUVIA_HOME', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aluvia-home-'));
    process.env.ALUVIA_HOME = home;
    const { saveApiKey, getStoredApiKey } = await import('../src/config.js');
    saveApiKey('test-key');
    assert.strictEqual(getStoredApiKey(), 'test-key');
    assert.strictEqual(fs.existsSync(path.join(home, 'config.json')), true);
    fs.rmSync(home, { recursive: true, force: true });
  });
});
