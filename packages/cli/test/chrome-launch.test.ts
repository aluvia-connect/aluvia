import { describe, test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  chromeRestartCommand,
  isWindows,
  quoteShellArg,
  skipChromeRestart,
  tryRestartChrome,
} from '../src/chrome-launch.js';
import { attachWaitMs, DEFAULT_ATTACH_WAIT_MS } from '../src/proxy-attach.js';

describe('chrome launch command', () => {
  test('quits Chrome first, then launches with proxy flags and the page URL', { skip: isWindows() }, () => {
    const prev = process.env.ALUVIA_CHROME;
    process.env.ALUVIA_CHROME = '/opt/google/chrome/chrome';
    try {
      const cmd = chromeRestartCommand(18787, 'https://example.com');
      assert.match(cmd, /^pkill -x google-chrome;/);
      assert.ok(cmd.includes('pkill -x chromium'));
      assert.ok(cmd.includes('sleep 1'));
      assert.ok(cmd.includes('--proxy-server=http://127.0.0.1:18787'));
      assert.ok(cmd.includes('--disable-quic'));
      assert.ok(cmd.includes('--restore-last-session'));
      assert.ok(cmd.includes('https://example.com'));
      const quitAt = cmd.indexOf('pkill');
      const launchAt = cmd.indexOf('--proxy-server=');
      assert.ok(quitAt >= 0 && launchAt > quitAt);
    } finally {
      if (prev === undefined) delete process.env.ALUVIA_CHROME;
      else process.env.ALUVIA_CHROME = prev;
    }
  });

  test(
    'Windows: quits chrome.exe with taskkill and launches with proxy flags',
    { skip: !isWindows() },
    () => {
      const prev = process.env.ALUVIA_CHROME;
      process.env.ALUVIA_CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
      try {
        const cmd = chromeRestartCommand(18787, 'https://example.com');
        assert.ok(cmd.startsWith('taskkill /F /IM chrome.exe /T'), `cmd was: ${cmd}`);
        assert.ok(cmd.includes('start ""'));
        assert.ok(cmd.includes('--proxy-server=http://127.0.0.1:18787'));
        assert.ok(cmd.includes('--disable-quic'));
        assert.ok(cmd.includes('--restore-last-session'));
        assert.ok(cmd.includes('https://example.com'));
        // Path with spaces must be quoted for cmd.exe.
        assert.ok(cmd.includes('"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"'));
        // No Linux-only tokens.
        assert.ok(!cmd.includes('pkill'), `cmd should not contain pkill: ${cmd}`);
        assert.ok(!cmd.includes('sleep 1'), `cmd should not contain sleep: ${cmd}`);
        const quitAt = cmd.indexOf('taskkill');
        const launchAt = cmd.indexOf('--proxy-server=');
        assert.ok(quitAt >= 0 && launchAt > quitAt);
      } finally {
        if (prev === undefined) delete process.env.ALUVIA_CHROME;
        else process.env.ALUVIA_CHROME = prev;
      }
    },
  );

  test('quotes binaries with spaces', () => {
    assert.strictEqual(
      quoteShellArg('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
      `'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'`,
    );
  });

  test('attach wait defaults to 30s', () => {
    const prev = process.env.ALUVIA_ATTACH_WAIT_MS;
    delete process.env.ALUVIA_ATTACH_WAIT_MS;
    try {
      assert.strictEqual(attachWaitMs(), DEFAULT_ATTACH_WAIT_MS);
      assert.strictEqual(DEFAULT_ATTACH_WAIT_MS, 30_000);
    } finally {
      if (prev === undefined) delete process.env.ALUVIA_ATTACH_WAIT_MS;
      else process.env.ALUVIA_ATTACH_WAIT_MS = prev;
    }
  });

  test('tryRestartChrome respects ALUVIA_SKIP_CHROME_RESTART', async () => {
    const prev = process.env.ALUVIA_SKIP_CHROME_RESTART;
    process.env.ALUVIA_SKIP_CHROME_RESTART = '1';
    try {
      assert.strictEqual(skipChromeRestart(), true);
      const result = await tryRestartChrome(18787, 'https://example.com');
      assert.deepStrictEqual(result, { launched: false });
    } finally {
      if (prev === undefined) delete process.env.ALUVIA_SKIP_CHROME_RESTART;
      else process.env.ALUVIA_SKIP_CHROME_RESTART = prev;
    }
  });

  test('tryRestartChrome launches the configured binary after quitting', { skip: isWindows() }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aluvia-chrome-'));
    const bin = path.join(dir, 'fake-chrome');
    const marker = path.join(dir, 'launched');
    fs.writeFileSync(bin, `#!/bin/sh\necho "$@">"${marker}"\n`);
    fs.chmodSync(bin, 0o755);
    const prevSkip = process.env.ALUVIA_SKIP_CHROME_RESTART;
    const prevChrome = process.env.ALUVIA_CHROME;
    delete process.env.ALUVIA_SKIP_CHROME_RESTART;
    process.env.ALUVIA_CHROME = bin;
    try {
      const result = await tryRestartChrome(18787, 'https://example.com/checkout');
      assert.strictEqual(result.launched, true);
      const started = Date.now();
      while (!fs.existsSync(marker) && Date.now() - started < 2000) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.strictEqual(fs.existsSync(marker), true);
      const args = fs.readFileSync(marker, 'utf8');
      assert.ok(args.includes('--proxy-server=http://127.0.0.1:18787'));
      assert.ok(args.includes('--disable-quic'));
      assert.ok(args.includes('https://example.com/checkout'));
    } finally {
      if (prevSkip === undefined) delete process.env.ALUVIA_SKIP_CHROME_RESTART;
      else process.env.ALUVIA_SKIP_CHROME_RESTART = prevSkip;
      if (prevChrome === undefined) delete process.env.ALUVIA_CHROME;
      else process.env.ALUVIA_CHROME = prevChrome;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
