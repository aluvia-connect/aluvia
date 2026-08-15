import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { isProcessAlive } from '@aluvia/sdk';
import { resolveCredential } from './api-helpers.js';
import { clearUpstream, saveUpstream } from './config.js';
import { output } from './cli.js';
import { getCliLaunch } from './cli-path.js';
import { configDir } from './config.js';
import { chromeRestartCommand } from './chrome-launch.js';
import { tryGsettings, waitForExternalConnect, writeChromeProxyPolicy } from './proxy-attach.js';
import { bothPortsAccept, controlRequest, isControlClientError } from './proxy-control-client.js';
import { installProxySkill } from './proxy-skill.js';
import {
  DEFAULT_CONTROL_PORT,
  DEFAULT_DATA_PORT,
  egressFromRules,
  readProxyJson,
  writeProxyJson,
  type ProxyAttachState,
  type ProxyEgress,
  type ProxyJson,
} from './proxy-state.js';

const NOT_RUNNING = 'proxyd is not running. Run `aluvia start`.';
const CONTROL_TIMEOUT = 'proxyd did not respond. Run `aluvia status`.';
const BYO_NETWORK =
  'This command needs the Aluvia network. Run `aluvia upstream --clear`, then `aluvia auth`.';

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (raw == null || raw.trim() === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return undefined;
  return n;
}

function parsePortFlag(value: string, flag: string): number {
  const parsed = parsePositiveInt(value);
  if (parsed == null) {
    output({ error: `Invalid ${flag}: '${value}' must be a positive integer.` }, 1);
  }
  return parsed;
}

function parseRestoreUrl(args: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) {
      const raw = args[i + 1].trim();
      if (!raw) return null;
      try {
        const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) ? raw : `https://${raw}`;
        const parsed = new URL(withScheme);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
        return parsed.href;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function parseStartArgs(args: string[]): {
  dataPort: number;
  controlPort: number;
  connectionId?: number;
} {
  let dataPort = parsePositiveInt(process.env.ALUVIA_PROXY_PORT) ?? DEFAULT_DATA_PORT;
  let controlPort = parsePositiveInt(process.env.ALUVIA_PROXY_CONTROL_PORT) ?? DEFAULT_CONTROL_PORT;
  let connectionId: number | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      dataPort = parsePortFlag(args[i + 1], '--port');
      i++;
    } else if (args[i] === '--control-port' && args[i + 1]) {
      controlPort = parsePortFlag(args[i + 1], '--control-port');
      i++;
    } else if (args[i] === '--connection-id' && args[i + 1]) {
      connectionId = parsePortFlag(args[i + 1], '--connection-id');
      i++;
    }
  }
  return connectionId != null ? { dataPort, controlPort, connectionId } : { dataPort, controlPort };
}

function isLive(state: ProxyJson | null): state is ProxyJson {
  return state != null && state.pid != null && isProcessAlive(state.pid);
}

function aimedFrom(state: ProxyJson | null): boolean {
  return state?.attach.status === 'verified';
}

const STATUS_WHAT = {
  aimed: 'Is Chrome sending traffic to the local proxy (http://127.0.0.1:18787)?',
  egress: 'aluvia = mobile/residential IP. direct = this VM datacenter IP.',
  ready: 'aimed and the daemon is up. Reload the tab.',
  healthy: 'The local proxy process is accepting connections.',
  needsChromeRestart: 'true means quit Chrome and run chromeCommand. After that it stays false.',
  rules: '["*"] = all hosts through Aluvia. [] = all hosts direct.',
  targetGeo: 'Pinned country code, or null for all geos.',
};

function statusNext(opts: {
  live: boolean;
  healthy: boolean;
  aimed: boolean;
  egress: ProxyEgress;
  dataPort: number;
}): { next: string; chromeCommand?: string } {
  if (!opts.live) {
    return { next: 'Daemon is not running. Run `aluvia setup --url <blocked page>`.' };
  }
  if (!opts.healthy) {
    if (opts.aimed) {
      return {
        next: 'Chrome is aimed at the proxy but the daemon is down. Run `aluvia start` or `aluvia setup --url <page>`. Do not quit Chrome.',
      };
    }
    return { next: 'Daemon is not healthy. Run `aluvia setup --url <blocked page>`.' };
  }
  if (!opts.aimed) {
    return {
      next: 'Chrome is not sending traffic to the local proxy. Quit this Chrome. Run chromeCommand. Open or reload the blocked tab. Do not run setup again.',
      chromeCommand: chromeRestartCommand(opts.dataPort),
    };
  }
  if (opts.egress === 'direct') {
    return {
      next: 'Chrome is aimed. Traffic is using the datacenter IP. Run `aluvia proxy-on` then reload the tab.',
    };
  }
  return {
    next: 'Chrome is aimed and traffic is going through Aluvia. Reload the tab. If still blocked, run `aluvia rotate-ip` then reload.',
  };
}

function statusFields(state: ProxyJson, healthy: boolean, extra?: Record<string, unknown>) {
  const egress = egressFromRules(state.rules);
  const aimed = aimedFrom(state);
  const live = isLive(state);
  const guide = statusNext({
    live,
    healthy,
    aimed,
    egress,
    dataPort: state.dataPort,
  });
  return {
    next: guide.next,
    pid: state.pid,
    proxyUrl: state.proxyUrl,
    controlUrl: state.controlUrl,
    connectionId: state.connectionId,
    sessionId: state.sessionId,
    targetGeo: state.targetGeo,
    rules: state.rules,
    count: state.rules.length,
    healthy,
    attach: state.attach,
    egress,
    aimed,
    ready: aimed && healthy && live,
    needsChromeRestart: !aimed,
    what: STATUS_WHAT,
    ...(guide.chromeCommand ? { chromeCommand: guide.chromeCommand } : {}),
    ...extra,
  };
}

function failIfDaemonDied(logFile: string): never {
  const dead = readProxyJson();
  if (dead?.code === 'payment_required') {
    output(
      {
        error: dead.error ?? 'Trial data is used up.',
        code: 'payment_required',
        claim_url: dead.claimUrl,
        logFile,
      },
      1,
    );
  }
  if (dead?.error) {
    output(
      {
        error: dead.error,
        ...(dead.code ? { code: dead.code } : {}),
        ...(dead.claimUrl ? { claim_url: dead.claimUrl } : {}),
        logFile,
      },
      1,
    );
  }
  output({ error: 'proxyd process exited unexpectedly.', logFile }, 1);
}

function portBusy(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') resolve(true);
      else reject(err);
    });
    server.listen(port, '127.0.0.1', () => {
      server.close((closeErr) => {
        if (closeErr) reject(closeErr);
        else resolve(false);
      });
    });
  });
}

async function waitForPortFree(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (!(await portBusy(port))) return true;
    if (Date.now() >= deadline) return !(await portBusy(port));
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function waitForDeath(pid: number, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (!isProcessAlive(pid)) {
        resolve(true);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        resolve(!isProcessAlive(pid));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

function clearPidReady(state: ProxyJson): void {
  writeProxyJson({ ...state, pid: null, ready: false });
}

function failControl(err: unknown): never {
  if (isControlClientError(err, 'not_running')) {
    output({ error: NOT_RUNNING }, 1);
  }
  if (isControlClientError(err, 'timeout')) {
    output({ error: CONTROL_TIMEOUT }, 1);
  }
  throw err;
}

async function startDaemon(args: string[]): Promise<{ json: Record<string, unknown>; healthy: boolean }> {
  let cred: ReturnType<typeof resolveCredential>;
  try {
    cred = resolveCredential();
  } catch (err) {
    output({ error: (err as Error).message }, 1);
  }

  const { dataPort, controlPort, connectionId: flagConnectionId } = parseStartArgs(args);
  const existing = readProxyJson();

  if (await portBusy(dataPort)) {
    output({ error: `port ${dataPort} in use` }, 1);
  }
  if (await portBusy(controlPort)) {
    output({ error: `port ${controlPort} in use` }, 1);
  }

  const connectionId = flagConnectionId ?? existing?.connectionId ?? undefined;
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const logFile = path.join(dir, 'proxy.log');
  const logFd = fs.openSync(logFile, 'a');

  const launch = getCliLaunch();
  const daemonArgs = [
    ...launch.prefixArgs,
    launch.script,
    '--proxy-daemon',
    '--port',
    String(dataPort),
    '--control-port',
    String(controlPort),
    ...(connectionId != null ? ['--connection-id', String(connectionId)] : []),
  ];

  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(launch.execPath, daemonArgs, {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: {
        ...process.env,
        ...(cred.kind === 'token' ? { ALUVIA_API_KEY: cred.apiKey } : {}),
        ...(cred.kind === 'install' ? { ALUVIA_INSTALL_ID: cred.installId } : {}),
        ...(cred.kind === 'byo' ? { ALUVIA_UPSTREAM: cred.upstream.href } : {}),
        ALUVIA_HOME: configDir(),
      },
    });
    child.unref();
  } catch (err: any) {
    fs.closeSync(logFd);
    output({ error: `Failed to spawn proxyd: ${err.message}`, logFile }, 1);
  }
  fs.closeSync(logFd);

  return new Promise((resolve, reject) => {
    let attempts = 0;
    let inFlight = false;
    const maxAttempts = 240;
    const poll = setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      attempts++;
      void (async () => {
        try {
          if (child.pid && !isProcessAlive(child.pid)) {
            clearInterval(poll);
            failIfDaemonDied(logFile);
          }

          const state = readProxyJson();
          if (state && state.ready) {
            clearInterval(poll);
            const healthy = await bothPortsAccept(state);
            try {
              const { json } = await controlRequest('GET', '/status');
              resolve({ json, healthy });
            } catch {
              resolve({ json: statusFields(state, healthy), healthy });
            }
            return;
          }

          if (attempts >= maxAttempts) {
            clearInterval(poll);
            const alive = child.pid ? isProcessAlive(child.pid) : false;
            if (!alive) failIfDaemonDied(logFile);
            output({ error: 'proxyd is still initializing (timeout).', logFile }, 1);
          }
        } catch (err) {
          clearInterval(poll);
          reject(err);
        } finally {
          inFlight = false;
        }
      })();
    }, 250);
  });
}

async function handleStart(args: string[]): Promise<void> {
  const existing = readProxyJson();
  if (isLive(existing)) {
    try {
      const { json } = await controlRequest('GET', '/status');
      const healthy = await bothPortsAccept(existing);
      output({ ...json, healthy, error: 'proxyd already running' }, 1);
    } catch {
      const healthy = await bothPortsAccept(existing).catch(() => false);
      output({ ...statusFields(existing, healthy), error: 'proxyd already running' }, 1);
    }
  }

  const started = await startDaemon(args);
  output({ ...started.json, healthy: started.healthy });
}

type AttachOutcome = {
  status: 'verified' | 'needs_ui';
  method: ProxyAttachState['method'];
  aim: 'policy' | 'flags';
  proxyUrl: string;
  policyPath: string | null;
  chromeCommand: string;
  restoreUrl: string | null;
  persistLimit?: string;
};

async function persistAttach(attach: ProxyAttachState): Promise<void> {
  try {
    const res = await controlRequest('POST', '/attach-state', attach);
    if (res.status !== 200) output({ error: String(res.json.error ?? 'attach-state failed') }, 1);
  } catch (err) {
    failControl(err);
  }
}

async function runAttach(args: string[]): Promise<AttachOutcome> {
  if (!isLive(readProxyJson())) {
    await startDaemon(args);
  }

  const state = readProxyJson();
  if (!isLive(state)) {
    output({ error: NOT_RUNNING }, 1);
  }

  const dataPort = state.dataPort;
  const policy = writeChromeProxyPolicy(dataPort);
  await tryGsettings(dataPort);
  const aim: 'policy' | 'flags' = policy.path ? 'policy' : 'flags';
  const persistLimit =
    aim === 'flags'
      ? 'If the platform replaces this Chrome without flags, aim is gone. Run `aluvia status`; if aimed is false, run setup --url <page> and chromeCommand again.'
      : undefined;

  const restoreUrl = parseRestoreUrl(args);
  const chromeCommand = chromeRestartCommand(dataPort, restoreUrl);

  const alreadyVerified = state.attach.status === 'verified' && !policy.wrote;
  if (!alreadyVerified) {
    await persistAttach({
      status: 'needs_ui',
      method: null,
      verifiedAt: null,
      extensionPath: null,
    });
  }

  let sinceMs = Date.now();
  if (!policy.wrote && policy.mtimeMs != null) {
    sinceMs = policy.mtimeMs;
  }
  const timeoutMs = Number(process.env.ALUVIA_ATTACH_WAIT_MS) || 1_000;
  const seen = alreadyVerified || (await waitForExternalConnect({ timeoutMs, sinceMs }));
  const verifiedNow = seen || readProxyJson()?.attach.status === 'verified';

  if (verifiedNow) {
    const attach: ProxyAttachState = {
      status: 'verified',
      method: aim,
      verifiedAt: new Date().toISOString(),
      extensionPath: null,
    };
    await persistAttach(attach);
    return {
      status: 'verified',
      method: aim,
      aim,
      proxyUrl: state.proxyUrl,
      policyPath: policy.path,
      chromeCommand,
      restoreUrl,
      ...(persistLimit ? { persistLimit } : {}),
    };
  }

  return {
    status: 'needs_ui',
    method: null,
    aim,
    proxyUrl: state.proxyUrl,
    policyPath: policy.path,
    chromeCommand,
    restoreUrl,
    ...(persistLimit ? { persistLimit } : {}),
  };
}

function attachPublicFields(result: AttachOutcome): Record<string, unknown> {
  return {
    status: result.status,
    method: result.method,
    aim: result.aim,
    chromeCommand: result.chromeCommand,
    restoreUrl: result.restoreUrl,
    needsChromeRestart: result.status !== 'verified',
    ...(result.policyPath ? { policyPath: result.policyPath } : {}),
    ...(result.persistLimit ? { persistLimit: result.persistLimit } : {}),
  };
}

function setupNext(ready: boolean): string {
  if (ready) {
    return 'Chrome is aimed. Reload the tab. Use `aluvia proxy-off` to go direct and `aluvia proxy-on` to use Aluvia again. Do not restart Chrome.';
  }
  return 'Quit this Chrome. Run chromeCommand. Open or reload the blocked tab. Do not run setup again. If still blocked, run `aluvia status`. If aimed is false, run setup --url <that page> and chromeCommand again.';
}

async function postEgress(on: boolean): Promise<{ egress: ProxyEgress; rules: string[] }> {
  try {
    const res = await controlRequest('POST', on ? '/proxy-on' : '/proxy-off', {});
    if (res.status !== 200) {
      output({ error: String(res.json.error ?? (on ? 'proxy-on failed' : 'proxy-off failed')) }, 1);
    }
    return {
      egress: res.json.egress === 'aluvia' ? 'aluvia' : 'direct',
      rules: Array.isArray(res.json.rules) ? (res.json.rules as string[]) : [],
    };
  } catch (err) {
    failControl(err);
  }
}

async function handleAttach(args: string[]): Promise<void> {
  const result = await runAttach(args);
  output({
    proxyUrl: result.proxyUrl,
    ...attachPublicFields(result),
  });
}

async function handleSetup(args: string[]): Promise<void> {
  const skill = installProxySkill();
  const result = await runAttach(args);
  await postEgress(true);
  const state = readProxyJson();
  let statusJson: Record<string, unknown> = {};
  let healthy = false;
  try {
    const { json } = await controlRequest('GET', '/status');
    statusJson = json;
    healthy = state ? await bothPortsAccept(state) : false;
  } catch (err) {
    failControl(err);
  }
  const ready = result.status === 'verified' && healthy;
  const skillPath = skill.skillPaths[0] ?? null;
  output({
    next: setupNext(ready),
    skillPath,
    ...(skill.skill ? { skill: skill.skill } : {}),
    ...statusJson,
    healthy,
    ready,
    egress: 'aluvia',
    aimed: ready,
    needsChromeRestart: !ready,
    skillPaths: skill.skillPaths,
    ...(skill.error ? { skillError: skill.error } : {}),
    ...attachPublicFields(result),
  });
}

async function stopDaemonProcess(): Promise<ProxyJson | null> {
  const existing = readProxyJson();
  if (!isLive(existing)) {
    if (existing) clearPidReady(existing);
    return null;
  }

  const pid = existing.pid!;
  try {
    await controlRequest('POST', '/stop', {});
  } catch (err) {
    if (!isControlClientError(err, 'not_running')) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // ignore
      }
    }
  }

  const dead = await waitForDeath(pid, 10_000);
  if (!dead) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // ignore
    }
    await waitForDeath(pid, 1000);
  }

  const latest = readProxyJson() ?? existing;
  clearPidReady(latest);
  await waitForPortFree(existing.dataPort, 3_000);
  await waitForPortFree(existing.controlPort, 3_000);
  return existing;
}

async function handleStop(): Promise<void> {
  const existing = await stopDaemonProcess();
  if (!existing) {
    output({ status: 'stopped' });
  }
  output({
    status: 'stopped',
    warning: `Chrome is still aimed at ${existing.proxyUrl}. Browsing will fail until you run \`aluvia start\` or \`aluvia setup\`. Prefer \`aluvia proxy-off\` to stay on the datacenter IP without killing the daemon.`,
  });
}

function credentialNext(recycled: boolean): string {
  return recycled
    ? 'Reload the tab. Do not restart Chrome.'
    : 'Saved. If Chrome is not aimed yet, run `aluvia setup --url <page>`.';
}

/** Restart proxyd so a newly saved API key or BYO URL takes effect. Chrome stays aimed. */
export async function recycleDaemonIfRunning(): Promise<{ recycled: boolean }> {
  const existing = readProxyJson();
  if (!isLive(existing)) return { recycled: false };
  const args = [
    '--port',
    String(existing.dataPort),
    '--control-port',
    String(existing.controlPort),
    ...(existing.connectionId != null ? ['--connection-id', String(existing.connectionId)] : []),
  ];
  await stopDaemonProcess();
  await startDaemon(args);
  return { recycled: true };
}

async function handleStatus(): Promise<void> {
  try {
    const { json } = await controlRequest('GET', '/status');
    const state = readProxyJson();
    const healthy = state ? await bothPortsAccept(state) : false;
    output(state ? { ...statusFields(state, healthy), ...json, healthy } : { ...json, healthy });
  } catch (err) {
    failControl(err);
  }
}

async function requireHealthyDaemon(): Promise<void> {
  const state = readProxyJson();
  if (!state || state.pid == null || !isProcessAlive(state.pid)) {
    output({ error: NOT_RUNNING }, 1);
  }
  const healthy = await bothPortsAccept(state);
  if (!healthy) {
    output({ error: 'proxyd data port is not healthy. Run `aluvia status`.' }, 1);
  }
}

function parseGeoFlag(args: string[]): { specified: boolean; geo: string | null } {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--geo') {
      const value = args[i + 1];
      if (value == null || value.startsWith('-')) {
        output({ error: 'Usage: --geo <geo> | --geo all' }, 1);
      }
      if (value.toLowerCase() === 'all') return { specified: true, geo: null };
      return { specified: true, geo: value };
    }
  }
  return { specified: false, geo: null };
}

async function readControlStatus(): Promise<{
  egress: ProxyEgress;
  targetGeo: string | null;
  rules: string[];
}> {
  try {
    const { json } = await controlRequest('GET', '/status');
    const rules = Array.isArray(json.rules) ? (json.rules as string[]) : [];
    return {
      egress: json.egress === 'aluvia' ? 'aluvia' : egressFromRules(rules),
      targetGeo: typeof json.targetGeo === 'string' ? json.targetGeo : null,
      rules,
    };
  } catch (err) {
    failControl(err);
  }
}

async function postSetGeo(geo: string | null): Promise<string | null> {
  try {
    const res = await controlRequest('POST', '/set-geo', geo == null ? { clear: true } : { geo });
    if (res.status !== 200) output({ error: String(res.json.error ?? 'set-geo failed') }, 1);
    return typeof res.json.targetGeo === 'string' ? res.json.targetGeo : null;
  } catch (err) {
    failControl(err);
  }
}

async function postRotate(): Promise<{ sessionId: string; connectionId: unknown }> {
  try {
    const res = await controlRequest('POST', '/rotate-ip', {});
    if (res.status !== 200) output({ error: String(res.json.error ?? 'rotate-ip failed') }, 1);
    return { sessionId: String(res.json.sessionId ?? ''), connectionId: res.json.connectionId };
  } catch (err) {
    failControl(err);
  }
}

async function handleProxySwitch(on: boolean): Promise<void> {
  await requireHealthyDaemon();
  const result = await postEgress(on);
  output({
    egress: result.egress,
    rules: result.rules,
    count: result.rules.length,
    next: 'Reload the tab. Do not restart Chrome.',
  });
}

async function handleProxyOn(args: string[]): Promise<void> {
  await requireHealthyDaemon();
  const geoFlag = parseGeoFlag(args);
  if (geoFlag.specified && resolveCredential().kind === 'byo') {
    output({ error: BYO_NETWORK }, 1);
  }
  const before = await readControlStatus();
  const geoSame = !geoFlag.specified || before.targetGeo === geoFlag.geo;
  if (before.egress === 'aluvia' && geoSame) {
    output({
      egress: 'aluvia',
      rules: before.rules,
      count: before.rules.length,
      targetGeo: before.targetGeo,
      rotated: false,
      next: 'Already on. Reload the tab if the page is still blocked.',
    });
  }

  if (geoFlag.specified && before.targetGeo !== geoFlag.geo) {
    await postSetGeo(geoFlag.geo);
  }
  if (before.egress !== 'aluvia') {
    await postEgress(true);
  }

  let rotated = false;
  let sessionId: string | undefined;
  let connectionId: unknown;
  if (geoFlag.specified && before.targetGeo !== geoFlag.geo) {
    const result = await postRotate();
    rotated = true;
    sessionId = result.sessionId;
    connectionId = result.connectionId;
  }

  const after = await readControlStatus();
  output({
    egress: 'aluvia',
    rules: after.rules,
    count: after.rules.length,
    targetGeo: after.targetGeo,
    rotated,
    ...(rotated ? { sessionId, connectionId } : {}),
    next: 'Reload the tab. Do not restart Chrome.',
  });
}

async function handleRotateIp(args: string[]): Promise<void> {
  if (resolveCredential().kind === 'byo') {
    output({ error: BYO_NETWORK }, 1);
  }
  await requireHealthyDaemon();
  const geoFlag = parseGeoFlag(args);
  const before = await readControlStatus();
  if (geoFlag.specified && before.targetGeo !== geoFlag.geo) {
    await postSetGeo(geoFlag.geo);
  }
  if (before.egress !== 'aluvia') {
    await postEgress(true);
  }
  const rotated = await postRotate();
  const after = await readControlStatus();
  output({
    sessionId: rotated.sessionId,
    connectionId: rotated.connectionId,
    targetGeo: after.targetGeo,
    egress: 'aluvia',
    rotated: true,
    next: 'Reload the tab. Do not restart Chrome.',
  });
}

function handleSetGeoRemoved(): never {
  output(
    {
      error:
        'Use `aluvia proxy-on --geo <geo>` or `aluvia rotate-ip --geo <geo>`. `--geo all` uses every geo.',
    },
    1,
  );
}

async function handleUpstream(args: string[]): Promise<void> {
  if (args.includes('--clear')) {
    clearUpstream();
    const { recycled } = await recycleDaemonIfRunning();
    output({
      provider: 'none',
      status: 'cleared',
      recycled,
      next: credentialNext(recycled),
    });
  }
  const raw = args.find((arg) => !arg.startsWith('-'));
  if (!raw) {
    output({ error: 'Usage: aluvia upstream <url> | aluvia upstream --clear' }, 1);
  }
  let parsed;
  try {
    parsed = saveUpstream(raw);
  } catch (err) {
    output({ error: (err as Error).message }, 1);
  }
  const { recycled } = await recycleDaemonIfRunning();
  output({
    provider: 'custom',
    upstreamHost: parsed.host,
    recycled,
    next: credentialNext(recycled),
  });
}

export async function handleProxy(args: string[]): Promise<void> {
  const subcommand = args[0];
  if (subcommand === 'start') {
    return handleStart(args.slice(1));
  }
  if (subcommand === 'stop') {
    return handleStop();
  }
  if (subcommand === 'status') {
    return handleStatus();
  }
  if (subcommand === 'proxy-on') {
    return handleProxyOn(args.slice(1));
  }
  if (subcommand === 'proxy-off') {
    return handleProxySwitch(false);
  }
  if (subcommand === 'rotate-ip') {
    return handleRotateIp(args.slice(1));
  }
  if (subcommand === 'set-geo') {
    return handleSetGeoRemoved();
  }
  if (subcommand === 'attach') {
    return handleAttach(args.slice(1));
  }
  if (subcommand === 'setup') {
    return handleSetup(args.slice(1));
  }
  if (subcommand === 'upstream') {
    return handleUpstream(args.slice(1));
  }
  output({ error: `Unknown command: '${subcommand}'. Run "aluvia help" for usage.` }, 1);
}
