import { describe, test } from 'node:test';
import assert from 'node:assert';
import { chromeRestartCommand, quoteShellArg } from '../src/chrome-launch.js';

describe('chrome launch command', () => {
  test('includes proxy, disable-quic, and restore-last-session', () => {
    const prev = process.env.ALUVIA_CHROME;
    process.env.ALUVIA_CHROME = '/opt/google/chrome/chrome';
    try {
      const cmd = chromeRestartCommand(18787, 'https://example.com');
      assert.ok(cmd.includes('--proxy-server=http://127.0.0.1:18787'));
      assert.ok(cmd.includes('--disable-quic'));
      assert.ok(cmd.includes('--restore-last-session'));
      assert.ok(cmd.includes('https://example.com'));
    } finally {
      if (prev === undefined) delete process.env.ALUVIA_CHROME;
      else process.env.ALUVIA_CHROME = prev;
    }
  });

  test('quotes binaries with spaces', () => {
    assert.strictEqual(
      quoteShellArg('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
      `'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'`,
    );
  });
});
