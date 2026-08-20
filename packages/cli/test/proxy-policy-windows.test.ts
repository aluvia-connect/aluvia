import { describe, test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isWindows } from '../src/chrome-launch.js';
import { chromeProxyPolicyBody, writeChromeProxyPolicy } from '../src/proxy-attach.js';

describe('chrome policy write', () => {
  test('builds the expected policy body', () => {
    const body = chromeProxyPolicyBody(18787);
    assert.deepStrictEqual(body, {
      ProxySettings: {
        ProxyMode: 'fixed_servers',
        ProxyServer: '127.0.0.1:18787',
        ProxyBypassList: 'localhost,127.0.0.1,::1,<local>',
      },
      QuicAllowed: false,
    });
  });

  test('writes to ALUVIA_CHROME_POLICY_DIR override on any platform', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aluvia-policy-'));
    const prev = process.env.ALUVIA_CHROME_POLICY_DIR;
    process.env.ALUVIA_CHROME_POLICY_DIR = dir;
    try {
      const result = writeChromeProxyPolicy(18787);
      assert.strictEqual(result.wrote, true, `wrote should be true; got ${JSON.stringify(result)}`);
      assert.ok(
        result.path && result.path.startsWith(dir),
        `path should start with the override dir ${dir}, got ${result.path}`,
      );
      const written = JSON.parse(fs.readFileSync(result.path!, 'utf8'));
      assert.strictEqual(written.ProxySettings.ProxyServer, '127.0.0.1:18787');
      assert.strictEqual(written.ProxySettings.ProxyMode, 'fixed_servers');
      assert.strictEqual(written.QuicAllowed, false);
    } finally {
      if (prev === undefined) delete process.env.ALUVIA_CHROME_POLICY_DIR;
      else process.env.ALUVIA_CHROME_POLICY_DIR = prev;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('Windows: does NOT silently write to any /etc/... Linux path', { skip: !isWindows() }, async () => {
    // Regression for issue #24. Without a valid override the policy write
    // must fail on Windows rather than "succeed" writing to C:\etc\... —
    // which Chrome for Windows never reads.
    const prev = process.env.ALUVIA_CHROME_POLICY_DIR;
    delete process.env.ALUVIA_CHROME_POLICY_DIR;
    try {
      const result = writeChromeProxyPolicy(18787);
      if (result.path) {
        assert.ok(
          !result.path.includes('etc\\opt\\chrome') && !result.path.includes('/etc/opt/chrome'),
          `policy path must not be a Linux path; got ${result.path}`,
        );
        assert.ok(
          !result.path.includes('etc\\chromium') && !result.path.includes('/etc/chromium'),
          `policy path must not be a Linux path; got ${result.path}`,
        );
      }
    } finally {
      if (prev !== undefined) process.env.ALUVIA_CHROME_POLICY_DIR = prev;
    }
  });
});
