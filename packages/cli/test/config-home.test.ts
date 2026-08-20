import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configDir, resolveConfigDir } from '../src/config.js';

describe('configDir ALUVIA_HOME', () => {
  const original = process.env.ALUVIA_HOME;

  afterEach(() => {
    if (original === undefined) delete process.env.ALUVIA_HOME;
    else process.env.ALUVIA_HOME = original;
  });

  test('resolveConfigDir defaults to ~/.aluvia when /workspace is absent', () => {
    assert.strictEqual(
      resolveConfigDir({ workspaceExists: false, homedir: '/Users/dev' }),
      path.join('/Users/dev', '.aluvia'),
    );
  });

  test('resolveConfigDir defaults to /workspace/.aluvia when /workspace exists', () => {
    assert.strictEqual(
      resolveConfigDir({ workspaceExists: true, homedir: '/Users/dev' }),
      path.resolve('/workspace/.aluvia'),
    );
  });

  test('ALUVIA_HOME wins over the /workspace default', () => {
    assert.strictEqual(
      resolveConfigDir({
        aluviaHome: 'relative-aluvia-home',
        workspaceExists: true,
        homedir: '/Users/dev',
      }),
      path.resolve('relative-aluvia-home'),
    );
  });

  test('whitespace-only ALUVIA_HOME is unset and still prefers /workspace', () => {
    assert.strictEqual(
      resolveConfigDir({ aluviaHome: '   ', workspaceExists: true, homedir: '/Users/dev' }),
      path.resolve('/workspace/.aluvia'),
    );
    assert.strictEqual(
      resolveConfigDir({ aluviaHome: '   ', workspaceExists: false, homedir: '/Users/dev' }),
      path.join('/Users/dev', '.aluvia'),
    );
  });

  test('configDir matches resolveConfigDir for the live machine', () => {
    delete process.env.ALUVIA_HOME;
    assert.strictEqual(
      configDir(),
      resolveConfigDir({
        workspaceExists: fs.existsSync('/workspace'),
        homedir: os.homedir(),
      }),
    );
  });

  test('uses ALUVIA_HOME when set, resolved to an absolute path', () => {
    process.env.ALUVIA_HOME = 'relative-aluvia-home';
    assert.strictEqual(configDir(), path.resolve('relative-aluvia-home'));
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

  test('ensureInstallId is sticky and clearing a key keeps it', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aluvia-home-'));
    process.env.ALUVIA_HOME = home;
    const { ensureInstallId, getStoredInstallId, saveApiKey, clearApiKey } = await import('../src/config.js');
    const first = ensureInstallId();
    assert.match(first, /^[a-f0-9]{64}$/);
    assert.strictEqual(ensureInstallId(), first);
    assert.strictEqual(getStoredInstallId(), first);
    saveApiKey('tok');
    assert.strictEqual(clearApiKey(), true);
    assert.strictEqual(getStoredInstallId(), first);
    fs.rmSync(home, { recursive: true, force: true });
  });

  test('upstream persist and parse', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aluvia-home-'));
    process.env.ALUVIA_HOME = home;
    delete process.env.ALUVIA_UPSTREAM;
    const { saveUpstream, getStoredUpstream, clearUpstream, parseUpstreamUrl } =
      await import('../src/config.js');
    const parsed = saveUpstream('http://user:pass@proxy.example:8080');
    assert.strictEqual(parsed.host, 'proxy.example');
    assert.strictEqual(getStoredUpstream()?.includes('proxy.example'), true);
    assert.strictEqual(clearUpstream(), true);
    assert.strictEqual(getStoredUpstream(), undefined);
    assert.throws(() => parseUpstreamUrl('ftp://x'), /Invalid upstream/);
    process.env.ALUVIA_UPSTREAM = 'http://env-proxy.example:9000';
    assert.strictEqual(getStoredUpstream(), undefined);
    delete process.env.ALUVIA_UPSTREAM;
    fs.rmSync(path.join(home, 'config.json'), { force: true });
    process.env.ALUVIA_UPSTREAM = 'http://env-proxy.example:9000';
    assert.match(getStoredUpstream() ?? '', /env-proxy\.example/);
    delete process.env.ALUVIA_UPSTREAM;
    fs.rmSync(home, { recursive: true, force: true });
  });

  test('connectionId persist helpers write config.json', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aluvia-home-'));
    process.env.ALUVIA_HOME = home;
    const { getStoredConnectionId, saveConnectionId, clearConnectionId, saveApiKey, getStoredApiKey } =
      await import('../src/config.js');
    assert.strictEqual(getStoredConnectionId(), undefined);
    saveApiKey('test-key');
    saveConnectionId(3449);
    assert.strictEqual(getStoredConnectionId(), 3449);
    assert.strictEqual(getStoredApiKey(), 'test-key');
    const parsed = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')) as {
      connectionId?: number;
    };
    assert.strictEqual(parsed.connectionId, 3449);
    assert.strictEqual(clearConnectionId(), true);
    assert.strictEqual(getStoredConnectionId(), undefined);
    assert.strictEqual(getStoredApiKey(), 'test-key');
    fs.rmSync(home, { recursive: true, force: true });
  });
});
