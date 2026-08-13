import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { captureOutput } from '../src/mcp-helpers.js';
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

  test('attach writes a valid MV3 extension', async () => {
    await startDaemon();
    process.env.ALUVIA_ATTACH_WAIT_MS = '50';
    const result = await captureOutput(() => handleProxy(['attach']));
    assert.strictEqual(result.isError, false, String(result.data.error ?? ''));

    const manifestPath = path.join(home, 'ext', 'manifest.json');
    assert.strictEqual(fs.existsSync(manifestPath), true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      manifest_version: number;
      permissions: string[];
      background: { service_worker?: string };
    };
    assert.strictEqual(manifest.manifest_version, 3);
    assert.ok(manifest.permissions.includes('proxy'));
    assert.ok(manifest.background.service_worker);

    const background = fs.readFileSync(path.join(home, 'ext', 'background.js'), 'utf8');
    assert.ok(background.includes('chrome.proxy.settings.set'));
    assert.ok(background.includes(`port: ${dataPort}`));
    for (const host of ['localhost', '127.0.0.1', '::1', '<local>']) {
      assert.ok(background.includes(host), `bypassList missing ${host}`);
    }
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
    assert.ok(
      result.data.method === 'extension' ||
        result.data.method === 'gsettings' ||
        result.data.method === 'policy',
    );
    assert.strictEqual(result.data.proxyUrl, `http://127.0.0.1:${dataPort}`);

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
    assert.ok(typeof result.data.extensionPath === 'string');
    assert.ok((result.data.extensionPath as string).length > 0);
    assert.ok(typeof result.data.instructions === 'string');
    assert.ok((result.data.instructions as string).length > 0);
    assert.ok((result.data.instructions as string).includes('/etc/opt/chrome/policies/managed'));
    assert.ok((result.data.instructions as string).includes('chrome://policy'));
  });

  test('Attach starts proxyd when down', async () => {
    process.env.ALUVIA_ATTACH_WAIT_MS = '50';
    const result = await captureOutput(() => handleProxy(attachArgs(dataPort, controlPort)));
    assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
    const state = readProxyJson();
    assert.ok(state);
    assert.strictEqual(state.ready, true);
    assert.strictEqual(fs.existsSync(path.join(home, 'ext', 'manifest.json')), true);
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
      ProxyMode: string;
      ProxyServer: string;
      ProxyBypassList: string;
      QuicAllowed: boolean;
    };
    assert.strictEqual(policy.ProxyMode, 'fixed_servers');
    assert.strictEqual(policy.ProxyServer, `127.0.0.1:${dataPort}`);
    assert.ok(policy.ProxyBypassList.includes('localhost'));
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
    assert.ok(Array.isArray(result.data.skillPaths));
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
