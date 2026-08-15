import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { captureOutput } from '../src/mcp-helpers.js';
import { pickAttachMethod, policyWriteCommand } from '../src/proxy-attach.js';
import { handleProxy } from '../src/proxy.js';
import { readProxyJson, writeProxyJson } from '../src/proxy-state.js';
import { createMockAluviaApi } from './helpers/mock-aluvia-api.js';
import { createMockGateway } from './helpers/mock-gateway.js';
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
  'ALUVIA_CHROME_POLICY_DIR',
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

function attachArgs(dataPort: number, controlPort: number): string[] {
  return ['attach', '--port', String(dataPort), '--control-port', String(controlPort)];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('proxy attach helpers', () => {
  test('policyWriteCommand is a sudo tee heredoc with ProxySettings', () => {
    const cmd = policyWriteCommand(18787);
    assert.ok(cmd.startsWith('sudo -n mkdir -p /etc/opt/chrome/policies/managed'));
    assert.ok(cmd.includes("sudo -n tee /etc/opt/chrome/policies/managed/aluvia-proxy.json <<'EOF'"));
    assert.ok(cmd.includes('"ProxyMode": "fixed_servers"'));
    assert.ok(cmd.includes('127.0.0.1:18787'));
    assert.ok(cmd.includes('"QuicAllowed": false'));
    assert.ok(cmd.trimEnd().endsWith('EOF'));
  });

  test('pickAttachMethod prefers policy when a policy file exists', () => {
    assert.strictEqual(
      pickAttachMethod({
        policyPath: '/etc/opt/chrome/policies/managed/aluvia-proxy.json',
        gsettings: true,
        hasExtension: true,
      }),
      'policy',
    );
    assert.strictEqual(
      pickAttachMethod({ policyPath: null, gsettings: true, hasExtension: true }),
      'gsettings',
    );
    assert.strictEqual(
      pickAttachMethod({ policyPath: null, gsettings: false, hasExtension: true }),
      'extension',
    );
    assert.strictEqual(
      pickAttachMethod({ policyPath: null, gsettings: false, hasExtension: false }),
      'policy',
    );
  });
});

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
    process.env.ALUVIA_CHROME_POLICY_DIR = path.join(home, 'chrome-policy');
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

  test('attach does not write an extension when policy can be written', async () => {
    await startDaemon();
    process.env.ALUVIA_ATTACH_WAIT_MS = '50';
    const result = await captureOutput(() => handleProxy(['attach']));
    assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
    assert.strictEqual(fs.existsSync(path.join(home, 'ext', 'manifest.json')), false);
    assert.strictEqual(result.data.extensionPath, undefined);
    assert.strictEqual(result.data.instructions, undefined);
    assert.ok(typeof result.data.policyPath === 'string');
    assert.strictEqual(result.data.policyCommand, undefined);
    assert.strictEqual(result.data.aim, 'policy');
    assert.ok(String(result.data.chromeCommand).includes('--proxy-server='));
    assert.ok(String(result.data.chromeCommand).includes('--disable-quic'));
  });

  test('attach uses flags and does not write an extension when policy cannot be written', async () => {
    const notADir = path.join(home, 'not-a-policy-dir');
    fs.writeFileSync(notADir, 'x');
    process.env.ALUVIA_CHROME_POLICY_DIR = notADir;
    await startDaemon();
    process.env.ALUVIA_ATTACH_WAIT_MS = '50';
    const result = await captureOutput(() => handleProxy(['attach']));
    assert.strictEqual(result.isError, false, String(result.data.error ?? ''));

    assert.strictEqual(fs.existsSync(path.join(home, 'ext', 'manifest.json')), false);
    assert.strictEqual(result.data.aim, 'flags');
    assert.ok(typeof result.data.persistLimit === 'string');
    assert.ok(String(result.data.chromeCommand).includes(`--proxy-server=http://127.0.0.1:${dataPort}`));
    assert.ok(String(result.data.chromeCommand).includes('--disable-quic'));
    assert.strictEqual(result.data.policyCommand, undefined);
    assert.strictEqual(result.data.extensionPath, undefined);
    assert.strictEqual(result.data.instructions, undefined);
  });

  test('CONNECT flips to verified', async () => {
    await startDaemon();
    process.env.ALUVIA_ATTACH_WAIT_MS = '2000';
    const pending = captureOutput(() => handleProxy(['attach']));
    await delay(50);
    await connectViaProxy(dataPort, 'verify.example').catch(() => undefined);
    const result = await pending;
    assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
    assert.strictEqual(result.data.status, 'verified');
    assert.strictEqual(result.data.method, 'policy');
    assert.strictEqual(result.data.proxyUrl, `http://127.0.0.1:${dataPort}`);
    assert.strictEqual(result.data.extensionPath, undefined);
    assert.strictEqual(result.data.policyCommand, undefined);

    const attach = readProxyJson()?.attach;
    assert.ok(attach);
    assert.strictEqual(attach.status, 'verified');
    assert.ok(typeof attach.verifiedAt === 'string');
    assert.ok(!Number.isNaN(Date.parse(attach.verifiedAt)));
  });

  test('No CONNECT → needs_ui exit 0', async () => {
    await startDaemon();
    process.env.ALUVIA_ATTACH_WAIT_MS = '80';
    const result = await captureOutput(() => handleProxy(['attach']));
    assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
    assert.strictEqual(result.data.status, 'needs_ui');
    assert.strictEqual(result.data.extensionPath, undefined);
    assert.strictEqual(result.data.instructions, undefined);
    assert.ok(typeof result.data.policyPath === 'string');
    assert.strictEqual(result.data.policyCommand, undefined);
  });

  test('Attach starts proxyd when down', async () => {
    process.env.ALUVIA_ATTACH_WAIT_MS = '50';
    const result = await captureOutput(() => handleProxy(attachArgs(dataPort, controlPort)));
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
    const result = await captureOutput(() => handleProxy(['attach']));
    assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
    assert.strictEqual(result.data.status, 'needs_ui');
  });

  test('second attach accepts a CONNECT recorded after the first write', async () => {
    await startDaemon();
    process.env.ALUVIA_ATTACH_WAIT_MS = '50';
    const first = await captureOutput(() => handleProxy(['attach']));
    assert.strictEqual(first.isError, false, String(first.data.error ?? ''));
    assert.strictEqual(first.data.status, 'needs_ui');

    await connectViaProxy(dataPort, 'verify.example').catch(() => undefined);

    process.env.ALUVIA_ATTACH_WAIT_MS = '80';
    const second = await captureOutput(() => handleProxy(['attach']));
    assert.strictEqual(second.isError, false, String(second.data.error ?? ''));
    assert.strictEqual(second.data.status, 'verified');
  });

  test('CONNECT after wait start verifies; loopback does not wipe lastConnect', async () => {
    await startDaemon();
    process.env.ALUVIA_ATTACH_WAIT_MS = '2000';
    const pending = captureOutput(() => handleProxy(['attach']));
    await delay(50);
    await connectViaProxy(dataPort, 'verify.example').catch(() => undefined);
    await connectViaProxy(dataPort, 'localhost').catch(() => undefined);
    const result = await pending;
    assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
    assert.strictEqual(result.data.status, 'verified');

    const last = await fetch(`http://127.0.0.1:${controlPort}/last-connect`);
    assert.strictEqual(last.status, 200);
    const body = (await last.json()) as { hostname: string; at: number };
    assert.strictEqual(body.hostname, 'verify.example');
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

  test('attach writes a chrome policy file when ALUVIA_CHROME_POLICY_DIR is set', async () => {
    const policyDir = path.join(home, 'chrome-policy');
    process.env.ALUVIA_CHROME_POLICY_DIR = policyDir;
    process.env.ALUVIA_ATTACH_WAIT_MS = '50';
    await startDaemon();
    const result = await captureOutput(() => handleProxy(['attach']));
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
    const pending = captureOutput(() => handleProxy(['setup']));
    await delay(50);
    await connectViaProxy(dataPort, 'verify.example').catch(() => undefined);
    const result = await pending;
    assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
    assert.strictEqual(result.data.ready, true);
    assert.strictEqual(result.data.status, 'verified');
    assert.strictEqual(result.data.healthy, true);
    assert.strictEqual(result.data.egress, 'aluvia');
    assert.strictEqual(result.data.needsChromeRestart, false);
    assert.ok(Array.isArray(result.data.skillPaths));
    assert.ok(typeof result.data.next === 'string');
    assert.match(String(result.data.next), /proxy-on/);
    assert.ok(!String(result.data.next).includes('Run: npx aluvia-cli setup'));
    assert.ok(typeof result.data.skillPath === 'string');
    assert.ok(String(result.data.skill).includes('aluvia proxy-on'));
    assert.ok(String(result.data.chromeCommand).includes('--disable-quic'));
    assert.strictEqual(result.data.extensionPath, undefined);
    assert.strictEqual(result.data.policyCommand, undefined);
    assert.strictEqual(result.data.instructions, undefined);
    assert.ok(typeof result.data.policyPath === 'string');
  });

  test('setup without policy prints chromeCommand and persistLimit', async () => {
    const notADir = path.join(home, 'not-a-policy-dir');
    fs.writeFileSync(notADir, 'x');
    process.env.ALUVIA_CHROME_POLICY_DIR = notADir;
    await startDaemon();
    process.env.ALUVIA_ATTACH_WAIT_MS = '50';
    const result = await captureOutput(() => handleProxy(['setup']));
    assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
    assert.strictEqual(result.data.ready, false);
    assert.strictEqual(result.data.status, 'needs_ui');
    assert.strictEqual(result.data.aim, 'flags');
    assert.strictEqual(result.data.needsChromeRestart, true);
    assert.strictEqual(result.data.egress, 'aluvia');
    assert.match(String(result.data.next), /Quit this Chrome/);
    assert.match(String(result.data.next), /Do not run setup again/);
    assert.ok(String(result.data.chromeCommand).includes(`--proxy-server=http://127.0.0.1:${dataPort}`));
    assert.ok(typeof result.data.persistLimit === 'string');
    assert.strictEqual(result.data.policyCommand, undefined);
    assert.strictEqual(result.data.extensionPath, undefined);
    assert.strictEqual(result.data.instructions, undefined);
  });

  test('CONNECT after setup verifies without a second setup', async () => {
    await startDaemon();
    process.env.ALUVIA_ATTACH_WAIT_MS = '50';
    const first = await captureOutput(() => handleProxy(['setup']));
    assert.strictEqual(first.isError, false, String(first.data.error ?? ''));
    assert.strictEqual(first.data.ready, false);
    assert.match(String(first.data.next), /Do not run setup again/);

    await connectViaProxy(dataPort, 'verify.example').catch(() => undefined);
    await delay(50);
    assert.strictEqual(readProxyJson()?.attach.status, 'verified');

    const status = await captureOutput(() => handleProxy(['status']));
    assert.strictEqual(status.isError, false, String(status.data.error ?? ''));
    assert.strictEqual(status.data.aimed, true);
  });

  test('setup --url is included in chromeCommand', async () => {
    await startDaemon();
    process.env.ALUVIA_ATTACH_WAIT_MS = '50';
    const result = await captureOutput(() =>
      handleProxy(['setup', '--url', 'https://www.example.com/checkout']),
    );
    assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
    assert.strictEqual(result.data.restoreUrl, 'https://www.example.com/checkout');
    assert.ok(String(result.data.chromeCommand).includes('https://www.example.com/checkout'));
  });

  test('Restart preserves attach unless data port changed', async () => {
    await startDaemon();
    process.env.ALUVIA_ATTACH_WAIT_MS = '2000';
    const pending = captureOutput(() => handleProxy(['attach']));
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
    assert.strictEqual(readProxyJson()?.attach.status, 'unverified');
  });
});
