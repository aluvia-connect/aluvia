import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getStoredConnectionId } from '../src/config.js';
import { captureOutput } from '../src/output-capture.js';
import { handleProxy } from '../src/proxy.js';
import { attachWaitMs, DEFAULT_ATTACH_WAIT_MS } from '../src/proxy-attach.js';
import { readProxyJson, writeProxyJson } from '../src/proxy-state.js';
import { createMockAluviaApi } from './helpers/mock-aluvia-api.js';
import { createMockGateway, MOCK_EGRESS_IP } from './helpers/mock-gateway.js';
import { connectViaProxy } from './helpers/connect-via-proxy.js';
import { findFreePort } from './helpers/ports.js';

const ENV_KEYS = [
  'ALUVIA_HOME',
  'ALUVIA_API_KEY',
  'ALUVIA_API_BASE_URL',
  'ALUVIA_PROXY_PORT',
  'ALUVIA_PROXY_CONTROL_PORT',
  'ALUVIA_GATEWAY_HOST',
  'ALUVIA_GATEWAY_PORT',
  'ALUVIA_ATTACH_WAIT_MS',
  'ALUVIA_SKIP_CHROME_RESTART',
  'ALUVIA_CHROME_POLICY_DIR',
  'ALUVIA_DATACENTER_IP',
  'ALUVIA_PROBE_URL',
  'ALUVIA_PROBE_RETRY_DELAY_MS',
  'ALUVIA_PROBE_RETRY_ATTEMPTS',
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

function setupArgs(
  dataPort: number,
  controlPort: number,
  url = 'https://www.example.com/checkout',
): string[] {
  return ['setup', '--url', url, '--port', String(dataPort), '--control-port', String(controlPort)];
}

function setupArgsNoUrl(dataPort: number, controlPort: number): string[] {
  return ['setup', '--port', String(dataPort), '--control-port', String(controlPort)];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('proxy attach file', { concurrency: 1 }, () => {
  describe('proxy attach', { concurrency: 1 }, () => {
    let home: string;
    let api: Awaited<ReturnType<typeof createMockAluviaApi>>;
    let gateway: Awaited<ReturnType<typeof createMockGateway>>;
    let dataPort: number;
    let controlPort: number;
    const originalEnv = snapshotEnv();

    beforeEach(async () => {
      home = fs.mkdtempSync(path.join(os.tmpdir(), 'aluvia-home-'));
      api = await createMockAluviaApi();
      gateway = await createMockGateway();
      dataPort = await findFreePort();
      controlPort = await findFreePort();
      process.env.ALUVIA_HOME = home;
      process.env.ALUVIA_API_KEY = 'test-key';
      process.env.ALUVIA_API_BASE_URL = api.url;
      process.env.ALUVIA_GATEWAY_HOST = '127.0.0.1';
      process.env.ALUVIA_GATEWAY_PORT = String(gateway.port);
      delete process.env.ALUVIA_PROXY_PORT;
      delete process.env.ALUVIA_PROXY_CONTROL_PORT;
      delete process.env.ALUVIA_ATTACH_WAIT_MS;
      process.env.ALUVIA_SKIP_CHROME_RESTART = '1';
      process.env.ALUVIA_CHROME_POLICY_DIR = path.join(home, 'chrome-policy');
      process.env.ALUVIA_PROBE_URL = `https://${MOCK_EGRESS_IP}/`;
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
      await gateway.close();
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

    async function startDaemon(): Promise<void> {
      const started = await captureOutput(() => handleProxy(startArgs(dataPort, controlPort)));
      assert.strictEqual(started.isError, false, String(started.data.error ?? ''));
    }

    test('setup with policy does not write an extension', async () => {
      await startDaemon();
      process.env.ALUVIA_ATTACH_WAIT_MS = '50';
      const result = await captureOutput(() => handleProxy(setupArgs(dataPort, controlPort)));
      assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
      assert.strictEqual(fs.existsSync(path.join(home, 'ext', 'manifest.json')), false);
      assert.ok(typeof result.data.policyPath === 'string');
      assert.strictEqual(result.data.aim, 'policy');
      // chromeCommand is platform-specific (issue #24). On Linux the quit
      // step is `pkill`; on Windows it's `taskkill /F /IM chrome.exe`.
      // The --proxy-server and --disable-quic flags are cross-platform.
      if (process.platform === 'win32') {
        assert.ok(String(result.data.chromeCommand).startsWith('taskkill /F /IM chrome.exe'));
      } else {
        assert.ok(String(result.data.chromeCommand).includes('pkill -x google-chrome'));
      }
      assert.ok(String(result.data.chromeCommand).includes('--proxy-server='));
      assert.ok(String(result.data.chromeCommand).includes('--disable-quic'));
    });

    test('setup uses flags when policy cannot be written', async () => {
      const notADir = path.join(home, 'not-a-policy-dir');
      fs.writeFileSync(notADir, 'x');
      process.env.ALUVIA_CHROME_POLICY_DIR = notADir;
      await startDaemon();
      process.env.ALUVIA_ATTACH_WAIT_MS = '50';
      const result = await captureOutput(() => handleProxy(setupArgs(dataPort, controlPort)));
      assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
      assert.strictEqual(fs.existsSync(path.join(home, 'ext', 'manifest.json')), false);
      assert.strictEqual(result.data.aim, 'flags');
      assert.ok(typeof result.data.persistLimit === 'string');
      if (process.platform === 'win32') {
        assert.ok(String(result.data.chromeCommand).includes('taskkill /F /IM chrome.exe'));
      } else {
        assert.ok(String(result.data.chromeCommand).includes('pkill -x'));
      }
      assert.ok(String(result.data.chromeCommand).includes(`--proxy-server=http://127.0.0.1:${dataPort}`));
      assert.ok(String(result.data.chromeCommand).includes('--disable-quic'));
    });

    test('CONNECT flips to verified', async () => {
      await startDaemon();
      process.env.ALUVIA_ATTACH_WAIT_MS = '2000';
      const pending = captureOutput(() => handleProxy(setupArgs(dataPort, controlPort)));
      await delay(50);
      await connectViaProxy(dataPort, 'verify.example').catch(() => undefined);
      const result = await pending;
      assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
      assert.strictEqual(result.data.status, 'verified');
      assert.strictEqual(result.data.method, 'policy');
      assert.strictEqual(result.data.proxyUrl, `http://127.0.0.1:${dataPort}`);

      const attach = readProxyJson()?.attach;
      assert.ok(attach);
      assert.strictEqual(attach.status, 'verified');
      assert.strictEqual(attach.method, 'policy');
    });

    test('No CONNECT → needs_ui exit 0', async () => {
      await startDaemon();
      process.env.ALUVIA_ATTACH_WAIT_MS = '80';
      const result = await captureOutput(() => handleProxy(setupArgs(dataPort, controlPort)));
      assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
      assert.strictEqual(result.data.status, 'needs_ui');
      assert.ok(typeof result.data.policyPath === 'string');
    });

    test('setup fail-fast when Chrome cannot aim does not burn the default attach wait', async () => {
      await startDaemon();
      delete process.env.ALUVIA_ATTACH_WAIT_MS;
      assert.strictEqual(attachWaitMs(), DEFAULT_ATTACH_WAIT_MS);
      assert.ok(DEFAULT_ATTACH_WAIT_MS >= 15_000);
      const started = Date.now();
      const result = await captureOutput(() => handleProxy(setupArgs(dataPort, controlPort)));
      const elapsed = Date.now() - started;
      assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
      assert.strictEqual(result.data.status, 'needs_ui');
      assert.strictEqual(result.data.aimed, false);
      assert.strictEqual(result.data.ready, false);
      assert.strictEqual(result.data.healthy, true);
      assert.strictEqual(result.data.needsChromeRestart, true);
      assert.ok(typeof result.data.chromeCommand === 'string');
      if (process.platform === 'win32') {
        assert.ok(String(result.data.chromeCommand).startsWith('taskkill /F /IM chrome.exe'));
      } else {
        assert.ok(String(result.data.chromeCommand).includes('pkill -x google-chrome'));
      }
      assert.ok(String(result.data.chromeCommand).includes(`--proxy-server=http://127.0.0.1:${dataPort}`));
      assert.ok(String(result.data.chromeCommand).includes('--disable-quic'));
      assert.match(String(result.data.next), /chromeCommand/);
      assert.ok(
        elapsed < 5_000,
        `setup took ${elapsed}ms; must not wait DEFAULT_ATTACH_WAIT_MS=${DEFAULT_ATTACH_WAIT_MS}`,
      );
      assert.ok(
        elapsed < DEFAULT_ATTACH_WAIT_MS / 4,
        `setup took ${elapsed}ms; production default wait is ${DEFAULT_ATTACH_WAIT_MS}ms`,
      );
    });

    test('already needs_ui setup does not wait the production attach timeout', async () => {
      await startDaemon();
      process.env.ALUVIA_ATTACH_WAIT_MS = '50';
      const first = await captureOutput(() => handleProxy(setupArgs(dataPort, controlPort)));
      assert.strictEqual(first.isError, false, String(first.data.error ?? ''));
      assert.strictEqual(first.data.status, 'needs_ui');
      assert.strictEqual(readProxyJson()?.attach.status, 'needs_ui');
      assert.ok(readProxyJson()?.attach.expectConnectAfter != null);

      delete process.env.ALUVIA_ATTACH_WAIT_MS;
      assert.strictEqual(attachWaitMs(), DEFAULT_ATTACH_WAIT_MS);
      const started = Date.now();
      const second = await captureOutput(() => handleProxy(setupArgs(dataPort, controlPort)));
      const elapsed = Date.now() - started;
      assert.strictEqual(second.isError, false, String(second.data.error ?? ''));
      assert.strictEqual(second.data.status, 'needs_ui');
      assert.strictEqual(second.data.aimed, false);
      assert.strictEqual(second.data.needsChromeRestart, true);
      assert.ok(typeof second.data.chromeCommand === 'string');
      assert.ok(String(second.data.chromeCommand).includes('--proxy-server='));
      assert.ok(
        elapsed < 5_000,
        `second setup took ${elapsed}ms; must not wait DEFAULT_ATTACH_WAIT_MS=${DEFAULT_ATTACH_WAIT_MS}`,
      );
    });

    test('setup starts proxyd when down', async () => {
      process.env.ALUVIA_ATTACH_WAIT_MS = '50';
      const result = await captureOutput(() => handleProxy(setupArgs(dataPort, controlPort)));
      assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
      const state = readProxyJson();
      assert.ok(state);
      assert.strictEqual(state.ready, true);
      assert.strictEqual(fs.existsSync(path.join(home, 'chrome-policy', 'aluvia-proxy.json')), true);
      assert.strictEqual(fs.existsSync(path.join(home, 'ext', 'manifest.json')), false);
    });

    test('pre-existing CONNECT is not treated as attach proof', async () => {
      await startDaemon();
      await connectViaProxy(dataPort, 'verify.example').catch(() => undefined);
      process.env.ALUVIA_ATTACH_WAIT_MS = '80';
      const result = await captureOutput(() => handleProxy(setupArgs(dataPort, controlPort)));
      assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
      assert.strictEqual(result.data.status, 'needs_ui');
    });

    test('idle 90s with a prior CONNECT stays aimed and setup no-ops', async () => {
      await startDaemon();
      process.env.ALUVIA_ATTACH_WAIT_MS = '2000';
      const pending = captureOutput(() => handleProxy(setupArgs(dataPort, controlPort)));
      await delay(50);
      await connectViaProxy(dataPort, 'verify.example').catch(() => undefined);
      const first = await pending;
      assert.strictEqual(first.isError, false, String(first.data.error ?? ''));
      assert.strictEqual(first.data.ready, true);

      const agedAt = Date.now() - 90_000;
      const set = await fetch(`http://127.0.0.1:${controlPort}/last-connect`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hostname: 'verify.example', at: agedAt }),
      });
      assert.strictEqual(set.status, 200);
      const attach = readProxyJson()?.attach;
      assert.ok(attach);
      const cleared = await fetch(`http://127.0.0.1:${controlPort}/attach-state`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          status: 'verified',
          method: attach.method,
          expectConnectAfter: attach.expectConnectAfter,
          reloadAskedAt: null,
        }),
      });
      assert.strictEqual(cleared.status, 200);

      process.env.ALUVIA_ATTACH_WAIT_MS = '50';
      const second = await captureOutput(() => handleProxy(setupArgs(dataPort, controlPort)));
      assert.strictEqual(second.isError, false, String(second.data.error ?? ''));
      assert.strictEqual(second.data.status, 'verified');
      assert.strictEqual(second.data.ready, true);
      assert.strictEqual(second.data.aimed, true);
      assert.strictEqual(second.data.needsChromeRestart, false);
      assert.strictEqual(second.data.chromeCommand, undefined);
    });

    test('after a reload ask, status without a new CONNECT is not aimed', async () => {
      await startDaemon();
      process.env.ALUVIA_ATTACH_WAIT_MS = '2000';
      const pending = captureOutput(() => handleProxy(setupArgs(dataPort, controlPort)));
      await delay(50);
      await connectViaProxy(dataPort, 'verify.example').catch(() => undefined);
      const first = await pending;
      assert.strictEqual(first.isError, false, String(first.data.error ?? ''));
      assert.strictEqual(first.data.aimed, true);
      assert.match(String(first.data.next), /Reload the tab/);

      process.env.ALUVIA_ATTACH_WAIT_MS = '50';
      const probed = await captureOutput(() => handleProxy(['status']));
      assert.strictEqual(probed.isError, false, String(probed.data.error ?? ''));
      assert.strictEqual(probed.data.aimed, false);
      assert.strictEqual(probed.data.needsChromeRestart, true);
      assert.ok(typeof probed.data.chromeCommand === 'string');
    });

    test('after a reload ask, a CONNECT after the stamp reports aimed', async () => {
      await startDaemon();
      process.env.ALUVIA_ATTACH_WAIT_MS = '2000';
      const pending = captureOutput(() => handleProxy(setupArgs(dataPort, controlPort)));
      await delay(50);
      await connectViaProxy(dataPort, 'verify.example').catch(() => undefined);
      const first = await pending;
      assert.strictEqual(first.isError, false, String(first.data.error ?? ''));
      assert.match(String(first.data.next), /Reload the tab/);

      await connectViaProxy(dataPort, 'verify.example').catch(() => undefined);
      const status = await captureOutput(() => handleProxy(['status']));
      assert.strictEqual(status.isError, false, String(status.data.error ?? ''));
      assert.strictEqual(status.data.aimed, true);
      assert.strictEqual(status.data.needsChromeRestart, false);
      assert.strictEqual(status.data.chromeCommand, undefined);
    });

    test('setup with a stale verified flag returns chromeCommand', async () => {
      await startDaemon();
      process.env.ALUVIA_ATTACH_WAIT_MS = '2000';
      const pending = captureOutput(() => handleProxy(setupArgs(dataPort, controlPort)));
      await delay(50);
      await connectViaProxy(dataPort, 'verify.example').catch(() => undefined);
      const first = await pending;
      assert.strictEqual(first.isError, false, String(first.data.error ?? ''));
      assert.strictEqual(first.data.status, 'verified');

      const cleared = await fetch(`http://127.0.0.1:${controlPort}/last-connect`, { method: 'POST' });
      assert.strictEqual(cleared.status, 200);

      process.env.ALUVIA_ATTACH_WAIT_MS = '50';
      const second = await captureOutput(() => handleProxy(setupArgs(dataPort, controlPort)));
      assert.strictEqual(second.isError, false, String(second.data.error ?? ''));
      assert.strictEqual(second.data.status, 'needs_ui');
      assert.strictEqual(second.data.aimed, false);
      assert.strictEqual(second.data.ready, false);
      assert.strictEqual(second.data.needsChromeRestart, true);
      assert.ok(String(second.data.chromeCommand).includes('--proxy-server='));
    });

    test('status is not aimed after last CONNECT is cleared', async () => {
      await startDaemon();
      process.env.ALUVIA_ATTACH_WAIT_MS = '2000';
      const pending = captureOutput(() => handleProxy(setupArgs(dataPort, controlPort)));
      await delay(50);
      await connectViaProxy(dataPort, 'verify.example').catch(() => undefined);
      const first = await pending;
      assert.strictEqual(first.isError, false, String(first.data.error ?? ''));
      await connectViaProxy(dataPort, 'verify.example').catch(() => undefined);

      const live = await captureOutput(() => handleProxy(['status']));
      assert.strictEqual(live.data.aimed, true);

      const cleared = await fetch(`http://127.0.0.1:${controlPort}/last-connect`, { method: 'POST' });
      assert.strictEqual(cleared.status, 200);

      const status = await captureOutput(() => handleProxy(['status']));
      assert.strictEqual(status.isError, false, String(status.data.error ?? ''));
      assert.strictEqual(status.data.aimed, false);
      assert.strictEqual(status.data.needsChromeRestart, true);
      assert.ok(typeof status.data.chromeCommand === 'string');
    });

    test('CONNECT during a second setup verifies', async () => {
      await startDaemon();
      process.env.ALUVIA_ATTACH_WAIT_MS = '50';
      const first = await captureOutput(() => handleProxy(setupArgs(dataPort, controlPort)));
      assert.strictEqual(first.isError, false, String(first.data.error ?? ''));
      assert.strictEqual(first.data.status, 'needs_ui');

      process.env.ALUVIA_ATTACH_WAIT_MS = '2000';
      const pending = captureOutput(() => handleProxy(setupArgs(dataPort, controlPort)));
      await delay(50);
      await connectViaProxy(dataPort, 'verify.example').catch(() => undefined);
      const second = await pending;
      assert.strictEqual(second.isError, false, String(second.data.error ?? ''));
      assert.strictEqual(second.data.status, 'verified');
    });

    test('CONNECT after wait start verifies; loopback does not wipe lastConnect', async () => {
      await startDaemon();
      process.env.ALUVIA_ATTACH_WAIT_MS = '2000';
      const pending = captureOutput(() => handleProxy(setupArgs(dataPort, controlPort)));
      await delay(50);
      await connectViaProxy(dataPort, 'verify.example').catch(() => undefined);
      await connectViaProxy(dataPort, 'localhost').catch(() => undefined);
      const result = await pending;
      assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
      assert.strictEqual(result.data.status, 'verified');

      const last = await fetch(`http://127.0.0.1:${controlPort}/last-connect`);
      assert.strictEqual(last.status, 200);
      const body = (await last.json()) as { hostname: string; at: number };
      assert.ok(typeof body.hostname === 'string');
      assert.ok(!['localhost', '127.0.0.1', '::1'].includes(body.hostname));
      assert.ok(typeof body.at === 'number');
    });

    test('observer ignores loopback and keeps last public host', async () => {
      await startDaemon();
      await connectViaProxy(dataPort, 'verify.example').catch(() => undefined);
      await connectViaProxy(dataPort, '127.0.0.1').catch(() => undefined);
      const last = await fetch(`http://127.0.0.1:${controlPort}/last-connect`);
      assert.strictEqual(last.status, 200);
      const body = (await last.json()) as { hostname: string; at: number };
      assert.strictEqual(body.hostname, 'verify.example');
      assert.ok(typeof body.at === 'number');
    });

    test('setup writes a chrome policy file when ALUVIA_CHROME_POLICY_DIR is set', async () => {
      const policyDir = path.join(home, 'chrome-policy');
      process.env.ALUVIA_CHROME_POLICY_DIR = policyDir;
      process.env.ALUVIA_ATTACH_WAIT_MS = '50';
      await startDaemon();
      const result = await captureOutput(() => handleProxy(setupArgs(dataPort, controlPort)));
      assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
      const policyPath = path.join(policyDir, 'aluvia-proxy.json');
      assert.strictEqual(fs.existsSync(policyPath), true);
      const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8')) as {
        ProxySettings: { ProxyMode: string; ProxyServer: string; ProxyBypassList: string };
        QuicAllowed: boolean;
      };
      assert.strictEqual(policy.ProxySettings.ProxyMode, 'fixed_servers');
      assert.strictEqual(policy.ProxySettings.ProxyServer, `127.0.0.1:${dataPort}`);
      assert.ok(policy.ProxySettings.ProxyBypassList.includes('localhost'));
      assert.strictEqual(policy.QuicAllowed, false);
      assert.ok(typeof result.data.policyPath === 'string');
    });

    test('setup reports ready after a CONNECT', async () => {
      await startDaemon();
      process.env.ALUVIA_ATTACH_WAIT_MS = '2000';
      const pending = captureOutput(() => handleProxy(setupArgs(dataPort, controlPort)));
      await delay(50);
      await connectViaProxy(dataPort, 'verify.example').catch(() => undefined);
      const result = await pending;
      assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
      assert.strictEqual(result.data.ready, true);
      assert.strictEqual(result.data.status, 'verified');
      assert.strictEqual(result.data.healthy, true);
      assert.strictEqual(result.data.egress, 'aluvia');
      assert.strictEqual(result.data.needsChromeRestart, false);
      assert.strictEqual(result.data.chromeCommand, undefined);
      assert.ok(Array.isArray(result.data.skillPaths));
      assert.ok(typeof result.data.next === 'string');
      assert.match(String(result.data.next), /proxy-on/);
      assert.ok(!String(result.data.next).includes('Run: npx aluvia-cli setup'));
      assert.ok(typeof result.data.skillPath === 'string');
      assert.strictEqual(result.data.skill, undefined);
      assert.ok(typeof result.data.policyPath === 'string');
    });

    test('setup without policy prints chromeCommand and persistLimit', async () => {
      const notADir = path.join(home, 'not-a-policy-dir');
      fs.writeFileSync(notADir, 'x');
      process.env.ALUVIA_CHROME_POLICY_DIR = notADir;
      await startDaemon();
      process.env.ALUVIA_ATTACH_WAIT_MS = '50';
      const result = await captureOutput(() => handleProxy(setupArgs(dataPort, controlPort)));
      assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
      assert.strictEqual(result.data.ready, false);
      assert.strictEqual(result.data.status, 'needs_ui');
      assert.strictEqual(result.data.aim, 'flags');
      assert.strictEqual(result.data.needsChromeRestart, true);
      assert.strictEqual(result.data.egress, 'aluvia');
      assert.match(String(result.data.next), /chromeCommand/);
      assert.match(String(result.data.next), /quits Chrome first/);
      assert.match(String(result.data.next), /aluvia setup/);
      assert.ok(!String(result.data.next).includes('Do not run setup again'));
      assert.ok(String(result.data.chromeCommand).includes(`--proxy-server=http://127.0.0.1:${dataPort}`));
      assert.ok(typeof result.data.persistLimit === 'string');
    });

    test('CONNECT after setup verifies without a second setup', async () => {
      await startDaemon();
      process.env.ALUVIA_ATTACH_WAIT_MS = '50';
      const first = await captureOutput(() => handleProxy(setupArgs(dataPort, controlPort)));
      assert.strictEqual(first.isError, false, String(first.data.error ?? ''));
      assert.strictEqual(first.data.ready, false);
      assert.match(String(first.data.next), /chromeCommand/);

      await connectViaProxy(dataPort, 'verify.example').catch(() => undefined);
      await delay(50);
      assert.strictEqual(readProxyJson()?.attach.status, 'verified');

      const status = await captureOutput(() => handleProxy(['status']));
      assert.strictEqual(status.isError, false, String(status.data.error ?? ''));
      assert.strictEqual(status.data.aimed, true);
    });

    test('setup without --url starts and does not put a page URL in chromeCommand', async () => {
      await startDaemon();
      process.env.ALUVIA_ATTACH_WAIT_MS = '50';
      const result = await captureOutput(() => handleProxy(setupArgsNoUrl(dataPort, controlPort)));
      assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
      assert.strictEqual(result.data.restoreUrl, null);
      assert.ok(String(result.data.chromeCommand).includes('--restore-last-session'));
      assert.ok(!String(result.data.chromeCommand).includes('https://'));
    });

    test('setup with empty or invalid --url is a usage error', async () => {
      const empty = await captureOutput(() => handleProxy(['setup', '--url']));
      assert.strictEqual(empty.isError, true);
      assert.match(String(empty.data.error), /Invalid --url/);

      const invalid = await captureOutput(() => handleProxy(['setup', '--url', 'ftp://example.com']));
      assert.strictEqual(invalid.isError, true);
      assert.match(String(invalid.data.error), /Invalid --url/);
      assert.match(String(invalid.data.error), /ftp:\/\/example.com/);
    });

    test('setup --url is included in chromeCommand', async () => {
      await startDaemon();
      process.env.ALUVIA_ATTACH_WAIT_MS = '50';
      const result = await captureOutput(() => handleProxy(setupArgs(dataPort, controlPort)));
      assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
      assert.strictEqual(result.data.restoreUrl, 'https://www.example.com/checkout');
      assert.ok(String(result.data.chromeCommand).includes('https://www.example.com/checkout'));
    });

    test('Restart preserves attach unless data port changed', async () => {
      await startDaemon();
      process.env.ALUVIA_ATTACH_WAIT_MS = '2000';
      const pending = captureOutput(() => handleProxy(setupArgs(dataPort, controlPort)));
      await delay(50);
      await connectViaProxy(dataPort, 'verify.example').catch(() => undefined);
      const verified = await pending;
      assert.strictEqual(verified.isError, false, String(verified.data.error ?? ''));
      assert.strictEqual(verified.data.status, 'verified');

      const stopped = await captureOutput(() => handleProxy(['stop']));
      assert.strictEqual(stopped.isError, false, String(stopped.data.error ?? ''));

      const samePorts = await captureOutput(() => handleProxy(startArgs(dataPort, controlPort)));
      assert.strictEqual(samePorts.isError, false, String(samePorts.data.error ?? ''));
      assert.strictEqual(readProxyJson()?.attach.status, 'verified');

      const stoppedAgain = await captureOutput(() => handleProxy(['stop']));
      assert.strictEqual(stoppedAgain.isError, false, String(stoppedAgain.data.error ?? ''));

      const newDataPort = await findFreePort();
      const differentPort = await captureOutput(() => handleProxy(startArgs(newDataPort, controlPort)));
      assert.strictEqual(differentPort.isError, false, String(differentPort.data.error ?? ''));
      assert.strictEqual(readProxyJson()?.attach.status, 'needs_ui');
    });

    test('setup keeps the existing session_id and sets rules to star', async () => {
      await startDaemon();
      const before = readProxyJson()?.sessionId;
      const connectionId = readProxyJson()?.connectionId;
      assert.match(before ?? '', /^[0-9a-f]{32}$/);
      process.env.ALUVIA_ATTACH_WAIT_MS = '2000';
      const pending = captureOutput(() => handleProxy(setupArgs(dataPort, controlPort)));
      await delay(50);
      await connectViaProxy(dataPort, 'verify.example').catch(() => undefined);
      const result = await pending;
      assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
      const after = readProxyJson()?.sessionId;
      assert.strictEqual(after, before);
      assert.strictEqual(readProxyJson()?.connectionId, connectionId);
      assert.deepStrictEqual(readProxyJson()?.rules, ['*']);
    });

    test('second setup with a live session keeps the same sessionId and does not rotate', async () => {
      process.env.ALUVIA_ATTACH_WAIT_MS = '2000';
      const pending = captureOutput(() => handleProxy(setupArgs(dataPort, controlPort)));
      await delay(50);
      await connectViaProxy(dataPort, 'verify.example').catch(() => undefined);
      const first = await pending;
      assert.strictEqual(first.isError, false, String(first.data.error ?? ''));
      const sessionId = readProxyJson()?.sessionId;
      const connectionId = readProxyJson()?.connectionId;
      assert.match(sessionId ?? '', /^[0-9a-f]{32}$/);
      assert.ok(connectionId != null);
      const postsAfterFirst = api.requests.filter(
        (req) => req.method === 'POST' && req.url === '/account/connections',
      ).length;
      const patchesAfterFirst = api.requests.filter(
        (req) => req.method === 'PATCH' && req.url.startsWith('/account/connections/'),
      ).length;

      process.env.ALUVIA_ATTACH_WAIT_MS = '50';
      const second = await captureOutput(() => handleProxy(setupArgs(dataPort, controlPort)));
      assert.strictEqual(second.isError, false, String(second.data.error ?? ''));
      assert.strictEqual(readProxyJson()?.sessionId, sessionId);
      assert.strictEqual(readProxyJson()?.connectionId, connectionId);
      assert.strictEqual(second.data.sessionId, sessionId);
      assert.strictEqual(second.data.connectionId, connectionId);
      const postsAfterSecond = api.requests.filter(
        (req) => req.method === 'POST' && req.url === '/account/connections',
      ).length;
      const patchesAfterSecond = api.requests.filter(
        (req) => req.method === 'PATCH' && req.url.startsWith('/account/connections/'),
      ).length;
      assert.strictEqual(postsAfterSecond, postsAfterFirst);
      // proxy-on PATCHes rules. Live probe must not PATCH a new session_id.
      assert.strictEqual(patchesAfterSecond, patchesAfterFirst + 1);
    });

    test('first setup with no session mints exactly one', async () => {
      process.env.ALUVIA_ATTACH_WAIT_MS = '50';
      const result = await captureOutput(() => handleProxy(setupArgs(dataPort, controlPort)));
      assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
      const sessionId = readProxyJson()?.sessionId;
      assert.match(sessionId ?? '', /^[0-9a-f]{32}$/);
      assert.strictEqual(api.state.session_id, sessionId);
      const posts = api.requests.filter((req) => req.method === 'POST' && req.url === '/account/connections');
      assert.strictEqual(posts.length, 1);
      const patches = api.requests.filter(
        (req) => req.method === 'PATCH' && req.url.startsWith('/account/connections/'),
      );
      // daemon mints session_id once; setup proxy-on PATCHes rules. No rotate, no second mint.
      assert.strictEqual(patches.length, 2);
      assert.strictEqual(getStoredConnectionId(), readProxyJson()?.connectionId ?? undefined);
    });

    test('aimed stays true when the tunnel probe sees the datacenter IP; ready is false', async () => {
      process.env.ALUVIA_DATACENTER_IP = '172.59.0.1';
      await startDaemon();
      process.env.ALUVIA_ATTACH_WAIT_MS = '2000';
      const pending = captureOutput(() => handleProxy(setupArgs(dataPort, controlPort)));
      await delay(50);
      await connectViaProxy(dataPort, 'verify.example').catch(() => undefined);
      const result = await pending;
      assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
      assert.strictEqual(result.data.status, 'verified');
      assert.strictEqual(result.data.aimed, true);
      assert.strictEqual(result.data.ready, false);
    });

    test('attach is an unknown command', async () => {
      const result = await captureOutput(() => handleProxy(['attach']));
      assert.strictEqual(result.isError, true);
      assert.match(String(result.data.error), /Unknown command/);
    });
  });

  describe('upstream 590 UPSTREAM503', { concurrency: 1 }, () => {
    let home: string;
    let api: Awaited<ReturnType<typeof createMockAluviaApi>>;
    let gateway: Awaited<ReturnType<typeof createMockGateway>>;
    let dataPort: number;
    let controlPort: number;
    const originalEnv = snapshotEnv();

    beforeEach(async () => {
      home = fs.mkdtempSync(path.join(os.tmpdir(), 'aluvia-home-'));
      api = await createMockAluviaApi();
      gateway = await createMockGateway({
        failConnectHosts: [MOCK_EGRESS_IP],
        connectFailStatus: 590,
      });
      dataPort = await findFreePort();
      controlPort = await findFreePort();
      process.env.ALUVIA_HOME = home;
      process.env.ALUVIA_API_KEY = 'test-key';
      process.env.ALUVIA_API_BASE_URL = api.url;
      process.env.ALUVIA_GATEWAY_HOST = '127.0.0.1';
      process.env.ALUVIA_GATEWAY_PORT = String(gateway.port);
      process.env.ALUVIA_SKIP_CHROME_RESTART = '1';
      process.env.ALUVIA_CHROME_POLICY_DIR = path.join(home, 'chrome-policy');
      process.env.ALUVIA_PROBE_URL = `https://${MOCK_EGRESS_IP}/`;
      process.env.ALUVIA_PROBE_RETRY_DELAY_MS = '20';
      process.env.ALUVIA_PROBE_RETRY_ATTEMPTS = '3';
      delete process.env.ALUVIA_PROXY_PORT;
      delete process.env.ALUVIA_PROXY_CONTROL_PORT;
      delete process.env.ALUVIA_ATTACH_WAIT_MS;
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
      await gateway.close();
      await api.close();
      restoreEnv(originalEnv);
      try {
        fs.rmSync(home, { recursive: true, force: true });
      } catch {
        // ignore leftover tmp files
      }
    });

    test('setup with a dead session (590) rotates once after retries keep failing', async () => {
      const started = await captureOutput(() =>
        handleProxy(['start', '--port', String(dataPort), '--control-port', String(controlPort)]),
      );
      assert.strictEqual(started.isError, false, String(started.data.error ?? ''));
      const before = readProxyJson()?.sessionId;
      const connectionId = readProxyJson()?.connectionId;
      assert.match(before ?? '', /^[0-9a-f]{32}$/);
      const patchesBefore = api.requests.filter(
        (req) => req.method === 'PATCH' && req.url.startsWith('/account/connections/'),
      ).length;
      process.env.ALUVIA_ATTACH_WAIT_MS = '2000';
      const pending = captureOutput(() =>
        handleProxy([
          'setup',
          '--url',
          'https://www.example.com/checkout',
          '--port',
          String(dataPort),
          '--control-port',
          String(controlPort),
        ]),
      );
      await delay(50);
      await connectViaProxy(dataPort, 'verify.example').catch(() => undefined);
      const result = await pending;
      const after = readProxyJson()?.sessionId;
      assert.match(after ?? '', /^[0-9a-f]{32}$/);
      assert.notStrictEqual(after, before);
      assert.strictEqual(result.data.sessionId, after);
      assert.strictEqual(result.data.connectionId, connectionId);
      assert.strictEqual(readProxyJson()?.connectionId, connectionId);
      const posts = api.requests.filter((req) => req.method === 'POST' && req.url === '/account/connections');
      assert.strictEqual(posts.length, 1);
      const patchesAfter = api.requests.filter(
        (req) => req.method === 'PATCH' && req.url.startsWith('/account/connections/'),
      ).length;
      // proxy-on PATCHes rules; exhausted same-session retries PATCH one new session_id.
      assert.strictEqual(patchesAfter, patchesBefore + 2);
      assert.strictEqual(result.data.ready, false);
      assert.strictEqual(result.data.aimed, true);
      assert.strictEqual(result.data.code, 'upstream_unavailable');
      assert.match(String(result.data.error), /590 UPSTREAM503/);
      assert.match(String(result.data.next), /aluvia rotate-ip/);
      assert.notStrictEqual(result.data.aimed, result.data.ready);
    });
  });

  describe('setup retries 590 on the same session before rotating', { concurrency: 1 }, () => {
    let home: string;
    let api: Awaited<ReturnType<typeof createMockAluviaApi>>;
    let gateway: Awaited<ReturnType<typeof createMockGateway>>;
    let dataPort: number;
    let controlPort: number;
    const originalEnv = snapshotEnv();

    beforeEach(async () => {
      home = fs.mkdtempSync(path.join(os.tmpdir(), 'aluvia-home-'));
      api = await createMockAluviaApi();
      gateway = await createMockGateway({
        failConnectHosts: [MOCK_EGRESS_IP],
        connectFailStatus: 590,
        failFirstConnects: 1,
      });
      dataPort = await findFreePort();
      controlPort = await findFreePort();
      process.env.ALUVIA_HOME = home;
      process.env.ALUVIA_API_KEY = 'test-key';
      process.env.ALUVIA_API_BASE_URL = api.url;
      process.env.ALUVIA_GATEWAY_HOST = '127.0.0.1';
      process.env.ALUVIA_GATEWAY_PORT = String(gateway.port);
      process.env.ALUVIA_SKIP_CHROME_RESTART = '1';
      process.env.ALUVIA_CHROME_POLICY_DIR = path.join(home, 'chrome-policy');
      process.env.ALUVIA_PROBE_URL = `https://${MOCK_EGRESS_IP}/`;
      process.env.ALUVIA_PROBE_RETRY_DELAY_MS = '20';
      process.env.ALUVIA_PROBE_RETRY_ATTEMPTS = '3';
      delete process.env.ALUVIA_PROXY_PORT;
      delete process.env.ALUVIA_PROXY_CONTROL_PORT;
      delete process.env.ALUVIA_ATTACH_WAIT_MS;
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
      await gateway.close();
      await api.close();
      restoreEnv(originalEnv);
      try {
        fs.rmSync(home, { recursive: true, force: true });
      } catch {
        // ignore leftover tmp files
      }
    });

    test('590 then success on retry keeps the same sessionId and does not rotate', async () => {
      const started = await captureOutput(() =>
        handleProxy(['start', '--port', String(dataPort), '--control-port', String(controlPort)]),
      );
      assert.strictEqual(started.isError, false, String(started.data.error ?? ''));
      const before = readProxyJson()?.sessionId;
      const connectionId = readProxyJson()?.connectionId;
      assert.match(before ?? '', /^[0-9a-f]{32}$/);
      const patchesBefore = api.requests.filter(
        (req) => req.method === 'PATCH' && req.url.startsWith('/account/connections/'),
      ).length;
      process.env.ALUVIA_ATTACH_WAIT_MS = '2000';
      const pending = captureOutput(() => handleProxy(setupArgs(dataPort, controlPort)));
      await delay(50);
      await connectViaProxy(dataPort, 'verify.example').catch(() => undefined);
      const result = await pending;
      const after = readProxyJson()?.sessionId;
      assert.match(after ?? '', /^[0-9a-f]{32}$/);
      assert.strictEqual(after, before);
      assert.strictEqual(result.data.sessionId, after);
      assert.strictEqual(result.data.connectionId, connectionId);
      assert.strictEqual(result.data.ready, true);
      assert.strictEqual(result.data.aimed, true);
      assert.strictEqual(result.data.code, undefined);
      const posts = api.requests.filter((req) => req.method === 'POST' && req.url === '/account/connections');
      assert.strictEqual(posts.length, 1);
      const patchesAfter = api.requests.filter(
        (req) => req.method === 'PATCH' && req.url.startsWith('/account/connections/'),
      ).length;
      // proxy-on PATCHes rules. Retry success must not PATCH a new session_id.
      assert.strictEqual(patchesAfter, patchesBefore + 1);
    });
  });

  describe('status is not poisoned by one background 590', { concurrency: 1 }, () => {
    let home: string;
    let api: Awaited<ReturnType<typeof createMockAluviaApi>>;
    let gateway: Awaited<ReturnType<typeof createMockGateway>>;
    let dataPort: number;
    let controlPort: number;
    const originalEnv = snapshotEnv();

    beforeEach(async () => {
      home = fs.mkdtempSync(path.join(os.tmpdir(), 'aluvia-home-'));
      api = await createMockAluviaApi();
      gateway = await createMockGateway({
        failConnectHosts: ['mtalk.google.com'],
        connectFailStatus: 590,
      });
      dataPort = await findFreePort();
      controlPort = await findFreePort();
      process.env.ALUVIA_HOME = home;
      process.env.ALUVIA_API_KEY = 'test-key';
      process.env.ALUVIA_API_BASE_URL = api.url;
      process.env.ALUVIA_GATEWAY_HOST = '127.0.0.1';
      process.env.ALUVIA_GATEWAY_PORT = String(gateway.port);
      process.env.ALUVIA_SKIP_CHROME_RESTART = '1';
      process.env.ALUVIA_CHROME_POLICY_DIR = path.join(home, 'chrome-policy');
      process.env.ALUVIA_PROBE_URL = `https://${MOCK_EGRESS_IP}/`;
      process.env.ALUVIA_PROBE_RETRY_DELAY_MS = '20';
      process.env.ALUVIA_PROBE_RETRY_ATTEMPTS = '3';
      delete process.env.ALUVIA_PROXY_PORT;
      delete process.env.ALUVIA_PROXY_CONTROL_PORT;
      delete process.env.ALUVIA_ATTACH_WAIT_MS;
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
      await gateway.close();
      await api.close();
      restoreEnv(originalEnv);
      try {
        fs.rmSync(home, { recursive: true, force: true });
      } catch {
        // ignore leftover tmp files
      }
    });

    test('a background CONNECT 590 after a good page load does not mark the tunnel dead', async () => {
      const started = await captureOutput(() =>
        handleProxy(['start', '--port', String(dataPort), '--control-port', String(controlPort)]),
      );
      assert.strictEqual(started.isError, false, String(started.data.error ?? ''));
      process.env.ALUVIA_ATTACH_WAIT_MS = '2000';
      const pending = captureOutput(() => handleProxy(setupArgs(dataPort, controlPort)));
      await delay(50);
      await connectViaProxy(dataPort, 'verify.example').catch(() => undefined);
      const first = await pending;
      assert.strictEqual(first.isError, false, String(first.data.error ?? ''));
      assert.strictEqual(first.data.ready, true);
      const sessionId = readProxyJson()?.sessionId;
      assert.match(sessionId ?? '', /^[0-9a-f]{32}$/);

      await connectViaProxy(dataPort, 'mtalk.google.com').catch(() => undefined);
      const state = readProxyJson();
      assert.strictEqual(state?.ready, true);
      assert.notStrictEqual(state?.code, 'upstream_unavailable');
      assert.strictEqual(state?.sessionId, sessionId);

      const status = await captureOutput(() => handleProxy(['status']));
      assert.strictEqual(status.isError, false, String(status.data.error ?? ''));
      assert.strictEqual(status.data.ready, true);
      assert.strictEqual(status.data.aimed, true);
      assert.strictEqual(status.data.code, undefined);
      assert.strictEqual(status.data.sessionId, sessionId);
    });
  });
});
