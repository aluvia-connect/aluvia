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
import {
  ensureAttachExtension,
  pickAttachMethod,
  policyWriteCommand,
  tryGsettings,
  waitForExternalConnect,
  writeChromeProxyPolicy,
} from './proxy-attach.js';
import { bothPortsAccept, controlRequest, isControlClientError } from './proxy-control-client.js';
import { parseRouteHost } from './proxy-host.js';
import { installProxySkill } from './proxy-skill.js';
import {
  DEFAULT_CONTROL_PORT,
  DEFAULT_DATA_PORT,
  readProxyJson,
  writeProxyJson,
  type ProxyAttachState,
  type ProxyJson,
} from './proxy-state.js';

const NOT_RUNNING = 'proxyd is not running. Run `aluvia start`.';
const CONTROL_TIMEOUT = 'proxyd did not respond. Run `aluvia status`.';
const BYO_NETWORK = 'This command needs the Aluvia network. Run `aluvia upstream --clear`, then `aluvia auth`.';

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

function statusFields(state: ProxyJson, healthy: boolean, extra?: Record<string, unknown>) {
  return {
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
    ...extra,
  };
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
            output({ error: 'proxyd process exited unexpectedly.', logFile }, 1);
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
            output(
              {
                error: alive
                  ? 'proxyd is still initializing (timeout).'
                  : 'proxyd process exited unexpectedly.',
                logFile,
              },
              1,
            );
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
  proxyUrl: string;
  extensionPath: string | null;
  policyPath: string | null;
  policyCommand?: string;
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
  const extensionPath = path.join(configDir(), 'ext');
  // Policy is the product. Only write the unpacked extension if /etc (or the
  // override dir) could not be written — last resort, not advertised.
  const ext = policy.path ? null : ensureAttachExtension(extensionPath, dataPort);
  const gok = await tryGsettings(dataPort);
  // If we rewrote artifacts this call, only CONNECTs from now on count
  // (so a prior curl -x cannot fake attach). If artifacts already matched,
  // count CONNECTs since they were written so the next setup can verify.
  let sinceMs = Date.now();
  const wroteThisCall = policy.wrote || Boolean(ext?.wrote);
  if (!wroteThisCall) {
    const times = [policy.mtimeMs, ext?.mtimeMs].filter((t): t is number => t != null);
    if (times.length > 0) sinceMs = Math.min(...times);
  }
  const timeoutMs = Number(process.env.ALUVIA_ATTACH_WAIT_MS) || 15_000;
  const seen = await waitForExternalConnect({ timeoutMs, sinceMs });
  const method = pickAttachMethod({
    policyPath: policy.path,
    gsettings: gok,
    hasExtension: ext != null,
  });
  const policyCommand = policy.path ? undefined : policyWriteCommand(dataPort);

  if (seen) {
    const attach: ProxyAttachState = {
      status: 'verified',
      method,
      verifiedAt: new Date().toISOString(),
      extensionPath: null,
    };
    await persistAttach(attach);
    return {
      status: 'verified',
      method,
      proxyUrl: state.proxyUrl,
      extensionPath: null,
      policyPath: policy.path,
    };
  }

  const attach: ProxyAttachState = {
    status: 'needs_ui',
    method: null,
    verifiedAt: null,
    extensionPath: null,
  };
  await persistAttach(attach);
  return {
    status: 'needs_ui',
    method: null,
    proxyUrl: state.proxyUrl,
    extensionPath: ext ? extensionPath : null,
    policyPath: policy.path,
    ...(policyCommand ? { policyCommand } : {}),
  };
}

function attachPublicFields(result: AttachOutcome, ready: boolean): Record<string, unknown> {
  return {
    status: result.status,
    method: result.method,
    ...(result.policyPath ? { policyPath: result.policyPath } : {}),
    ...(!ready && result.policyCommand ? { policyCommand: result.policyCommand } : {}),
  };
}

async function handleAttach(args: string[]): Promise<void> {
  const result = await runAttach(args);
  if (result.status === 'verified') {
    output({
      status: 'verified',
      method: result.method,
      proxyUrl: result.proxyUrl,
      ...attachPublicFields(result, true),
    });
  }
  output(
    {
      proxyUrl: result.proxyUrl,
      ...attachPublicFields(result, false),
    },
    0,
  );
}

async function handleSetup(args: string[]): Promise<void> {
  const skill = installProxySkill();
  const result = await runAttach(args);
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
  const next = skillPath
    ? `Read and follow the Aluvia skill now (${skillPath}). The full text is in this JSON as "skill". Use it for attach, route, unroute, and payment_required. Do not skip it.`
    : 'Skill file was not written. On a block run `aluvia route <host>` then reload. If code is payment_required, tell a human to run `aluvia auth` or `aluvia upstream <url>`.';
  output({
    next,
    skillPath,
    ...(skill.skill ? { skill: skill.skill } : {}),
    ...statusJson,
    healthy,
    ready,
    skillPaths: skill.skillPaths,
    ...(skill.error ? { skillError: skill.error } : {}),
    ...attachPublicFields(result, ready),
  });
}

async function handleStop(): Promise<void> {
  const existing = readProxyJson();
  if (!isLive(existing)) {
    if (existing) clearPidReady(existing);
    output({ status: 'stopped' });
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
  output({ status: 'stopped' });
}

async function handleStatus(): Promise<void> {
  try {
    const { json } = await controlRequest('GET', '/status');
    const state = readProxyJson();
    const healthy = state ? await bothPortsAccept(state) : false;
    output({ ...json, healthy });
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

async function handleRouteVerb(verb: 'route' | 'unroute', hostArg: string): Promise<void> {
  const parsed = parseRouteHost(hostArg);
  if (!parsed.ok) output({ error: parsed.error }, 1);
  await requireHealthyDaemon();
  try {
    const res = await controlRequest('POST', `/${verb}`, { host: parsed.host });
    if (res.status !== 200) output({ error: String(res.json.error ?? `${verb} failed`) }, 1);
    const rules = res.json.rules as string[];
    output({ rules, count: rules.length });
  } catch (err) {
    failControl(err);
  }
}

async function handleRotateIp(): Promise<void> {
  if (resolveCredential().kind === 'byo') {
    output({ error: BYO_NETWORK }, 1);
  }
  try {
    const res = await controlRequest('POST', '/rotate-ip', {});
    if (res.status !== 200) output({ error: String(res.json.error ?? 'rotate-ip failed') }, 1);
    output({ sessionId: res.json.sessionId, connectionId: res.json.connectionId });
  } catch (err) {
    failControl(err);
  }
}

async function handleUpstream(args: string[]): Promise<void> {
  if (args.includes('--clear')) {
    clearUpstream();
    output({ provider: 'none', status: 'cleared' });
  }
  const raw = args.find((arg) => !arg.startsWith('-'));
  if (!raw) {
    output({ error: 'Usage: aluvia upstream <url> | aluvia upstream --clear' }, 1);
  }
  try {
    const parsed = saveUpstream(raw);
    output({ provider: 'custom', upstreamHost: parsed.host });
  } catch (err) {
    output({ error: (err as Error).message }, 1);
  }
}

async function handleSetGeo(args: string[]): Promise<void> {
  if (resolveCredential().kind === 'byo') {
    output({ error: BYO_NETWORK }, 1);
  }
  const clear = args.includes('--clear');
  const geo = args.find((arg) => arg !== '--clear');
  if (clear === Boolean(geo)) {
    output({ error: 'set-geo requires either geo or clear, not both' }, 1);
  }
  try {
    const res = await controlRequest('POST', '/set-geo', clear ? { clear: true } : { geo });
    if (res.status !== 200) output({ error: String(res.json.error ?? 'set-geo failed') }, 1);
    output({ targetGeo: res.json.targetGeo, connectionId: res.json.connectionId });
  } catch (err) {
    failControl(err);
  }
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
  if (subcommand === 'route') {
    return handleRouteVerb('route', args[1] ?? '');
  }
  if (subcommand === 'unroute') {
    return handleRouteVerb('unroute', args[1] ?? '');
  }
  if (subcommand === 'rotate-ip') {
    return handleRotateIp();
  }
  if (subcommand === 'set-geo') {
    return handleSetGeo(args.slice(1));
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
