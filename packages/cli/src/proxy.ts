import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import tls from 'node:tls';
import { PaymentRequiredError } from './net/errors.js';
import { isProcessAlive } from './net/process.js';
import { credentialNext, resolveCredential } from './api-helpers.js';
import {
  clearUpstream,
  configDir,
  getStoredConnectionId,
  getStoredUpstream,
  parseUpstreamUrl,
  saveConnectionId,
  saveUpstream,
} from './config.js';
import { output } from './cli.js';
import { getCliLaunch, writePathBin } from './cli-path.js';
import { chromeRestartCommand, skipChromeRestart, tryRestartChrome } from './chrome-launch.js';
import { isCapturing } from './output-capture.js';
import {
  attachWaitMs,
  attachWaitOverrideMs,
  waitForExternalConnect,
  writeChromeProxyPolicy,
} from './proxy-attach.js';
import { bothPortsAccept, controlRequest, isControlClientError } from './proxy-control-client.js';
import { maybeFireAluviaInstallBeacon } from './meta-aluvia-install.js';
import { DEFAULT_PROBE_URLS, probeTargetUrls } from './session-probe-hosts.js';
import { installProxySkill } from './proxy-skill.js';
import {
  DEFAULT_CONTROL_PORT,
  DEFAULT_DATA_PORT,
  defaultAttach,
  egressFromRules,
  isLiveAim,
  nextAsksReload,
  normalizeAttach,
  normalizeLastConnect,
  readProxyJson,
  resolveAimProbe,
  writeProxyJson,
  type LastConnectSnapshot,
  type ProxyAttachState,
  type ProxyEgress,
  type ProxyJson,
} from './proxy-state.js';

export { DEFAULT_PROBE_URLS };

const NOT_RUNNING = 'proxyd is not running. Run `aluvia start`.';
const CONTROL_TIMEOUT = 'proxyd did not respond. Run `aluvia status`.';
const BYO_NETWORK = 'This command needs the Aluvia network. Run `aluvia proxy-provider aluvia`.';

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

function parseUrlFlag(
  args: string[],
): { specified: false } | { specified: true; raw: string | null; url: string | null } {
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--url') continue;
    const next = args[i + 1];
    if (next == null || next.startsWith('-')) {
      return { specified: true, raw: null, url: null };
    }
    const raw = next.trim();
    if (!raw) return { specified: true, raw: next, url: null };
    try {
      const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) ? raw : `https://${raw}`;
      const parsed = new URL(withScheme);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { specified: true, raw, url: null };
      }
      return { specified: true, raw, url: parsed.href };
    } catch {
      return { specified: true, raw, url: null };
    }
  }
  return { specified: false };
}

function parseRestoreUrl(args: string[]): string | null {
  const parsed = parseUrlFlag(args);
  if (!parsed.specified) return null;
  if (!parsed.url) {
    output(
      {
        error: `Invalid --url: '${parsed.raw ?? ''}'. Use an http(s) page URL.`,
        next: 'Pass --url <https-page> (an http(s) page URL).',
      },
      1,
    );
  }
  return parsed.url;
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

/** `--connection-id` flag, then config.json, then proxy.json. Never POST a second connection if an id is saved. */
function resolveConnectionId(flagConnectionId?: number, existing?: ProxyJson | null): number | undefined {
  return flagConnectionId ?? getStoredConnectionId() ?? existing?.connectionId ?? undefined;
}

/** Live pid check only. A not-live ProxyJson is still a ProxyJson. */
function isLive(state: ProxyJson | null): boolean {
  return state != null && state.pid != null && isProcessAlive(state.pid);
}

/** Restart args from saved proxy.json, overlaying explicit CLI flags. */
function savedDaemonArgs(existing: ProxyJson, args: string[] = []): string[] {
  const parsed = parseStartArgs(args);
  const dataPort = args.includes('--port') ? parsed.dataPort : existing.dataPort;
  const controlPort = args.includes('--control-port') ? parsed.controlPort : existing.controlPort;
  const connectionId = resolveConnectionId(parsed.connectionId, existing);
  return [
    '--port',
    String(dataPort),
    '--control-port',
    String(controlPort),
    ...(connectionId != null ? ['--connection-id', String(connectionId)] : []),
  ];
}

const DATACENTER_IP = '104.30.175.37';
const UPSTREAM_UNAVAILABLE_ERROR = 'Upstream gateway returned 503 (590 UPSTREAM503).';
const UPSTREAM_UNAVAILABLE_CODE = 'upstream_unavailable';
const UPSTREAM_UNAVAILABLE_NEXT = 'Run `aluvia rotate-ip` then reload the tab.';

export type TunnelProbe = {
  ok: boolean;
  status: number | null;
  ip: string | null;
  upstreamUnavailable: boolean;
};

function datacenterIp(): string {
  const raw = (process.env.ALUVIA_DATACENTER_IP ?? '').trim();
  return raw || DATACENTER_IP;
}

function probeTargetUrl(): string {
  return probeTargetUrls()[0] ?? DEFAULT_PROBE_URLS[0];
}

function probeRetryDelayMs(): number {
  return parsePositiveInt(process.env.ALUVIA_PROBE_RETRY_DELAY_MS) ?? 2_000;
}

function probeRetryAttempts(): number {
  return parsePositiveInt(process.env.ALUVIA_PROBE_RETRY_ATTEMPTS) ?? 3;
}

function extractIp(body: string): string | null {
  const trimmed = body.trim();
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(trimmed)) return trimmed;
  try {
    const parsed = JSON.parse(trimmed) as { ip?: unknown };
    if (typeof parsed.ip === 'string' && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(parsed.ip)) return parsed.ip;
  } catch {
    // not JSON
  }
  return null;
}

function requestPath(parsed: URL): string {
  return `${parsed.pathname || '/'}${parsed.search}`;
}

const PROBE_TIMEOUT_MS = 5_000;

/** HTTPS CONNECT through the local proxy. ready requires CONNECT 200 and a non-datacenter egress IP. */
export async function probeAluviaTunnel(dataPort: number, targetUrl?: string): Promise<TunnelProbe> {
  const target = (targetUrl ?? probeTargetUrl()).trim();
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return { ok: false, status: null, ip: null, upstreamUnavailable: false };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, status: null, ip: null, upstreamUnavailable: false };
  }

  const destPort = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;
  const connectTarget = `${parsed.hostname}:${destPort}`;
  const timedOut: TunnelProbe = { ok: false, status: null, ip: null, upstreamUnavailable: false };

  return new Promise((resolve) => {
    let settled = false;
    let connectSocket: net.Socket | undefined;
    let tlsSocket: tls.TLSSocket | undefined;
    let connectTimer: ReturnType<typeof setTimeout> | undefined;
    let tlsTimer: ReturnType<typeof setTimeout> | undefined;
    let getTimer: ReturnType<typeof setTimeout> | undefined;

    const req = http.request({
      host: '127.0.0.1',
      port: dataPort,
      method: 'CONNECT',
      path: connectTarget,
    });

    const finish = (result: TunnelProbe) => {
      if (settled) return;
      settled = true;
      if (connectTimer) clearTimeout(connectTimer);
      if (tlsTimer) clearTimeout(tlsTimer);
      if (getTimer) clearTimeout(getTimer);
      // Destroying an in-flight socket/request can emit an async 'error' event.
      // Swallow it instead of stripping listeners first, which would leave the
      // emission unhandled and crash the process (Node throws on unhandled 'error').
      tlsSocket?.removeAllListeners();
      tlsSocket?.on('error', () => {});
      connectSocket?.removeAllListeners();
      connectSocket?.on('error', () => {});
      req.removeAllListeners();
      req.on('error', () => {});
      tlsSocket?.destroy();
      connectSocket?.destroy();
      req.destroy();
      resolve(result);
    };

    connectTimer = setTimeout(() => finish(timedOut), PROBE_TIMEOUT_MS);
    req.setTimeout(PROBE_TIMEOUT_MS, () => finish(timedOut));
    req.on('error', () => finish(timedOut));
    req.on('connect', (res, socket) => {
      connectSocket = socket;
      socket.setTimeout(PROBE_TIMEOUT_MS, () => finish(timedOut));
      socket.on('error', () =>
        finish({ ok: false, status: res.statusCode ?? 0, ip: null, upstreamUnavailable: false }),
      );
      const status = res.statusCode ?? 0;
      if (status === 590 || status === 503) {
        finish({ ok: false, status, ip: null, upstreamUnavailable: true });
        return;
      }
      if (status !== 200) {
        finish({ ok: false, status, ip: null, upstreamUnavailable: false });
        return;
      }

      const request = `GET ${requestPath(parsed)} HTTP/1.1\r\nHost: ${parsed.host}\r\nConnection: close\r\n\r\n`;
      const handleGet = (stream: net.Socket) => {
        getTimer = setTimeout(() => finish(timedOut), PROBE_TIMEOUT_MS);
        stream.setTimeout(PROBE_TIMEOUT_MS, () => finish(timedOut));
        const chunks: Buffer[] = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          const sep = raw.indexOf('\r\n\r\n');
          const header = sep === -1 ? raw : raw.slice(0, sep);
          const body = sep === -1 ? '' : raw.slice(sep + 4);
          const match = header.match(/^HTTP\/\d\.\d\s+(\d+)/);
          const getStatus = match ? Number(match[1]) : 0;
          if (getStatus === 590 || getStatus === 503) {
            finish({ ok: false, status: getStatus, ip: null, upstreamUnavailable: true });
            return;
          }
          const ip = extractIp(body);
          const ok = getStatus === 200 && ip != null && ip !== datacenterIp();
          finish({ ok, status, ip, upstreamUnavailable: false });
        });
        stream.on('error', () => {
          finish({ ok: false, status, ip: null, upstreamUnavailable: false });
        });
        stream.write(request);
      };

      if (parsed.protocol !== 'https:') {
        handleGet(socket);
        return;
      }

      tlsTimer = setTimeout(() => finish(timedOut), PROBE_TIMEOUT_MS);
      tlsSocket = tls.connect({
        socket,
        servername: net.isIP(parsed.hostname) ? undefined : parsed.hostname,
        rejectUnauthorized: false,
      });
      tlsSocket.setTimeout(PROBE_TIMEOUT_MS, () => finish(timedOut));
      tlsSocket.once('secureConnect', () => handleGet(tlsSocket!));
      tlsSocket.once('error', () => {
        finish({ ok: false, status, ip: null, upstreamUnavailable: false });
      });
    });
    req.on('response', (res) => {
      const status = res.statusCode ?? 0;
      res.resume();
      if (status === 590 || status === 503) {
        finish({ ok: false, status, ip: null, upstreamUnavailable: true });
        return;
      }
      finish({ ok: false, status, ip: null, upstreamUnavailable: false });
    });
    req.end();
  });
}

function upstreamUnavailablePayload(): {
  error: string;
  code: string;
  next: string;
} {
  return {
    error: UPSTREAM_UNAVAILABLE_ERROR,
    code: UPSTREAM_UNAVAILABLE_CODE,
    next: UPSTREAM_UNAVAILABLE_NEXT,
  };
}

/** One pass across probe hosts. A 590 on ipify is not dead if another echo host is live. */
export async function probeSessionOnce(dataPort: number): Promise<TunnelProbe> {
  let last: TunnelProbe = { ok: false, status: null, ip: null, upstreamUnavailable: false };
  for (const url of probeTargetUrls()) {
    last = await probeAluviaTunnel(dataPort, url);
    if (last.ok || last.ip != null) return last;
  }
  return last;
}

/**
 * Retry the same session on 503/590 (1–3s gaps). Do not rotate here.
 * A datacenter IP is a live session, not a flake — stop retrying.
 */
export async function probeUntilReady(dataPort: number): Promise<TunnelProbe> {
  const attempts = probeRetryAttempts();
  const delayMs = probeRetryDelayMs();
  let last: TunnelProbe = { ok: false, status: null, ip: null, upstreamUnavailable: false };
  for (let attempt = 0; attempt < attempts; attempt++) {
    last = await probeSessionOnce(dataPort);
    if (last.ok || last.ip != null) return last;
    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return last;
}

/** Dead exit: 590/503/upstream_unavailable, or no IP. A datacenter IP is live but not ready. */
function isDeadSessionProbe(probe: TunnelProbe): boolean {
  if (probe.ok) return false;
  return probe.upstreamUnavailable || probe.ip == null;
}

/**
 * Setup session order: reuse the one connection; mint only if there is no session_id;
 * retry a saved session on 503/590; rotate only after those retries stay dead.
 */
async function ensureSetupSession(opts: {
  dataPort: number;
  sessionId: string | null;
  hadPriorSession: boolean;
  byo: boolean;
}): Promise<TunnelProbe> {
  if (!opts.sessionId) {
    if (!opts.byo) {
      await postRotate();
    }
    return probeUntilReady(opts.dataPort);
  }

  const probe = await probeUntilReady(opts.dataPort);
  if (!isDeadSessionProbe(probe) || opts.byo || !opts.hadPriorSession) return probe;
  await postRotate();
  return probeUntilReady(opts.dataPort);
}

/** Report the raw CONNECT/GET status. Do not rewrite 502/404/590 as 503. */
function rotateProbeFailure(probe: TunnelProbe): { error: string; code: string; next: string } {
  if (probe.status != null) {
    return {
      error: `Upstream gateway returned ${probe.status}.`,
      code: UPSTREAM_UNAVAILABLE_CODE,
      next: UPSTREAM_UNAVAILABLE_NEXT,
    };
  }
  if (probe.ip != null) {
    return {
      error: `Upstream gateway returned datacenter IP ${probe.ip}.`,
      code: UPSTREAM_UNAVAILABLE_CODE,
      next: UPSTREAM_UNAVAILABLE_NEXT,
    };
  }
  return {
    error: 'Upstream gateway did not return a non-datacenter IP.',
    code: UPSTREAM_UNAVAILABLE_CODE,
    next: UPSTREAM_UNAVAILABLE_NEXT,
  };
}

function aimedFrom(state: ProxyJson | null): boolean {
  return isLiveAim(state?.attach, state?.lastConnect);
}

async function attachAlreadyAimed(state: ProxyJson | null): Promise<boolean> {
  if (!state) return false;
  const last = isLive(state) ? await readLastConnect() : state.lastConnect;
  const probe = resolveAimProbe(state.attach ?? defaultAttach(), last);
  return probe.aimed && !probe.failed;
}

function failMissingSetupUrl(extra?: Record<string, unknown>): never {
  output(
    {
      error: 'setup requires --url <https-page> so Chrome opens a real page after the restart.',
      next: 'Pass --url <https-page> (the blocked address-bar URL) and run `aluvia setup` again.',
      aimed: false,
      ready: false,
      needsChromeRestart: true,
      restoreUrl: null,
      status: 'needs_ui',
      ...extra,
    },
    1,
  );
}

async function readLastConnect(): Promise<LastConnectSnapshot> {
  try {
    const res = await controlRequest('GET', '/last-connect');
    return normalizeLastConnect(res.json);
  } catch {
    return normalizeLastConnect(readProxyJson()?.lastConnect);
  }
}

const STATUS_WHAT = {
  next: 'The next action. Follow it.',
  aimed:
    'Has Chrome CONNECTed to the local proxy? Idle tabs stay aimed. After next asks you to reload, the following status/setup checks for a CONNECT since that ask.',
  egress: 'aluvia = mobile/residential IP. direct = this VM datacenter IP.',
  ready:
    'Aluvia tunnel CONNECT returned 200 and the egress IP is not this VM datacenter IP. Distinct from aimed.',
  healthy: 'The local proxy process is accepting connections.',
  needsChromeRestart: 'true means run chromeCommand (quit then launch). Then run aluvia setup again.',
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
    if (opts.aimed) {
      return {
        next: 'Chrome is aimed at the proxy but the daemon is down. Run `aluvia start` or `aluvia setup`. Do not quit Chrome.',
      };
    }
    return { next: 'Daemon is not running. Run `aluvia setup`.' };
  }
  if (!opts.healthy) {
    if (opts.aimed) {
      return {
        next: 'Chrome is aimed at the proxy but the daemon is down. Run `aluvia start` or `aluvia setup`. Do not quit Chrome.',
      };
    }
    return { next: 'Daemon is not healthy. Run `aluvia setup`.' };
  }
  if (!opts.aimed) {
    return {
      next: 'Chrome is not aimed. Run chromeCommand (it quits Chrome first; launching without quitting ignores flags). Then run `aluvia setup` again.',
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

function statusFields(
  state: ProxyJson,
  healthy: boolean,
  extra?: Record<string, unknown> & { probe?: TunnelProbe },
) {
  const egress = egressFromRules(state.rules);
  const aimed = aimedFrom(state);
  const live = isLive(state);
  const probe = extra?.probe;
  const probeOk = probe?.ok === true;
  const guide = statusNext({
    live,
    healthy,
    aimed,
    egress,
    dataPort: state.dataPort,
  });
  const { probe: _probe, ...rest } = extra ?? {};
  return {
    next: probe?.upstreamUnavailable ? UPSTREAM_UNAVAILABLE_NEXT : guide.next,
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
    ready: aimed && healthy && live && probeOk,
    needsChromeRestart: !aimed,
    what: STATUS_WHAT,
    ...(guide.chromeCommand ? { chromeCommand: guide.chromeCommand } : {}),
    ...(probe?.upstreamUnavailable ? upstreamUnavailablePayload() : {}),
    ...rest,
  };
}

async function failIfDaemonDied(logFile: string): Promise<never> {
  const dead = readProxyJson();
  if (dead?.code === 'payment_required') {
    const { paymentRequiredPayload } = await import('./auth.js');
    const err = new PaymentRequiredError(dead.error ?? 'Trial data is used up.', dead.claimUrl);
    output({ ...(await paymentRequiredPayload(err)), logFile }, 1);
  }
  if (dead?.error) {
    output(
      {
        error: dead.error,
        ...(dead.code ? { code: dead.code } : {}),
        ...(dead.claimUrl ? { claim_url: dead.claimUrl } : {}),
        logFile,
        next: 'Run `aluvia status`. If you see payment_required, show claim_url then `aluvia auth login`.',
      },
      1,
    );
  }
  output(
    {
      error: 'proxyd process exited unexpectedly.',
      logFile,
      next: 'Run `aluvia status` or `aluvia setup`.',
    },
    1,
  );
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
    output(
      {
        error: NOT_RUNNING,
        next: 'Run `aluvia start` if Chrome is already aimed, or `aluvia setup`.',
      },
      1,
    );
  }
  if (isControlClientError(err, 'timeout')) {
    output({ error: CONTROL_TIMEOUT, next: 'Run `aluvia status`.' }, 1);
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
    output(
      {
        error: `port ${dataPort} in use`,
        next: 'Run `aluvia status`. If the daemon is dead, stop whatever is bound to that port and retry.',
      },
      1,
    );
  }
  if (await portBusy(controlPort)) {
    output(
      {
        error: `port ${controlPort} in use`,
        next: 'Run `aluvia status`. If the daemon is dead, stop whatever is bound to that port and retry.',
      },
      1,
    );
  }

  const connectionId = resolveConnectionId(flagConnectionId, existing);
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
          const spawnedPid = child.pid;
          if (!spawnedPid || !isProcessAlive(spawnedPid)) {
            clearInterval(poll);
            await failIfDaemonDied(logFile);
          }

          const state = readProxyJson();
          const pidLive =
            state != null && state.pid != null && state.pid === spawnedPid && isProcessAlive(spawnedPid);
          const healthy = pidLive && state != null ? await bothPortsAccept(state) : false;
          if (pidLive && healthy && state) {
            clearInterval(poll);
            if (state.connectionId != null) saveConnectionId(state.connectionId);
            try {
              const { json } = await controlRequest('GET', '/status');
              resolve({ json: { ...statusFields(state, healthy), ...json, healthy }, healthy });
            } catch {
              resolve({ json: statusFields(state, healthy), healthy });
            }
            return;
          }

          if (attempts >= maxAttempts) {
            clearInterval(poll);
            const alive = child.pid ? isProcessAlive(child.pid) : false;
            if (!alive) await failIfDaemonDied(logFile);
            output(
              { error: 'proxyd is still initializing (timeout).', logFile, next: 'Run `aluvia status`.' },
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

/**
 * If proxy.json exists and the daemon is dead (dead pid or both ports down
 * with nothing bound), start it with the saved ports and connectionId.
 * Does not kill Chrome. Does not SIGTERM a live pid that still holds a port.
 */
async function ensureRunningDaemon(args: string[] = []): Promise<boolean> {
  const existing = readProxyJson();
  if (!existing) return false;
  if (isLive(existing) && (await bothPortsAccept(existing))) return true;

  if (isLive(existing)) {
    const dataTaken = await portBusy(existing.dataPort);
    const controlTaken = await portBusy(existing.controlPort);
    if (dataTaken || controlTaken) return false;
  }

  const started = await startDaemon(savedDaemonArgs(existing, args));
  return started.healthy === true;
}

async function handleStart(args: string[]): Promise<void> {
  const existing = readProxyJson();
  if (existing && isLive(existing)) {
    const keepGoing = 'Daemon is already running. Run `aluvia status` or keep going.';
    const notHealthy = 'Daemon is up but not healthy. Run `aluvia status`.';
    try {
      const { json } = await controlRequest('GET', '/status');
      const lastConnect = await readLastConnect();
      const healthy = await bothPortsAccept(existing);
      const fields = statusFields({ ...existing, lastConnect }, healthy);
      if (healthy) {
        output({ ...fields, ...json, healthy: true, next: keepGoing });
      }
      output({ ...fields, ...json, healthy: false, error: 'proxyd already running', next: notHealthy }, 1);
    } catch {
      const healthy = await bothPortsAccept(existing).catch(() => false);
      const fields = statusFields(existing, healthy);
      if (healthy) {
        return outputMaybeStamp({ ...fields, next: keepGoing });
      }
      output({ ...fields, error: 'proxyd already running', next: notHealthy }, 1);
    }
  }

  const started = await startDaemon(args);
  return outputMaybeStamp({ ...started.json, healthy: started.healthy });
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
  const next = normalizeAttach(attach);
  const state = readProxyJson();
  if (!state || !isLive(state)) {
    if (state) writeProxyJson({ ...state, attach: next });
    return;
  }
  try {
    const res = await controlRequest('POST', '/attach-state', next);
    if (res.status !== 200) {
      output(
        {
          error: String(res.json.error ?? 'attach-state failed'),
          next: 'Run `aluvia status`. If the daemon is down, run `aluvia start` or `aluvia setup`.',
        },
        1,
      );
    }
  } catch (err) {
    failControl(err);
  }
}

async function stampReloadAsk(): Promise<void> {
  const state = readProxyJson();
  if (!state || state.attach.status !== 'verified' || state.attach.reloadAskedAt != null) return;
  const last = isLive(state) ? await readLastConnect() : state.lastConnect;
  if (!isLiveAim(state.attach, last)) return;
  await persistAttach({ ...normalizeAttach(state.attach), reloadAskedAt: Date.now() });
}

async function outputMaybeStamp(data: Record<string, unknown>, exitCode = 0): Promise<never> {
  const next = typeof data.next === 'string' ? data.next : '';
  if (exitCode === 0 && nextAsksReload(next) && data.aimed !== false) {
    await stampReloadAsk();
  }
  return output(data, exitCode);
}

/** Progress that is not the final JSON. Agents parse stdout; keep this off stdout. */
function attachProgress(message: string): void {
  if (isCapturing()) return;
  process.stderr.write(`aluvia: ${message}\n`);
}

async function runAttach(args: string[]): Promise<AttachOutcome> {
  const existing = readProxyJson();
  if (existing) {
    await ensureRunningDaemon(args);
  }
  if (!isLive(readProxyJson())) {
    await startDaemon(args);
  }

  const state = readProxyJson();
  if (!state || !isLive(state)) {
    output(
      {
        error: NOT_RUNNING,
        next: 'Run `aluvia start` if Chrome is already aimed, or `aluvia setup`.',
      },
      1,
    );
  }

  const dataPort = state.dataPort;
  const policy = writeChromeProxyPolicy(dataPort);
  const aim: 'policy' | 'flags' = policy.path ? 'policy' : 'flags';
  const persistLimit =
    aim === 'flags'
      ? 'If the platform replaces this Chrome without flags, aim is gone. Run `aluvia status`; if aimed is false, run `aluvia setup` and chromeCommand again.'
      : undefined;

  const restoreUrl = parseRestoreUrl(args);
  const chromeCommand = chromeRestartCommand(dataPort, restoreUrl);
  const lastConnect = await readLastConnect();
  const probe = resolveAimProbe(state.attach, lastConnect);
  if (
    probe.attach.status !== state.attach.status ||
    probe.attach.reloadAskedAt !== state.attach.reloadAskedAt
  ) {
    await persistAttach(probe.attach);
  }

  if (probe.aimed && !probe.failed) {
    const method = probe.attach.method ?? aim;
    await persistAttach({
      ...probe.attach,
      status: 'verified',
      method,
    });
    return {
      status: 'verified',
      method,
      aim,
      proxyUrl: state.proxyUrl,
      policyPath: policy.path,
      chromeCommand,
      restoreUrl,
      ...(persistLimit ? { persistLimit } : {}),
    };
  }

  if (!restoreUrl) {
    failMissingSetupUrl();
  }

  const expectConnectAfter = Date.now();
  await persistAttach({
    status: 'needs_ui',
    method: null,
    expectConnectAfter,
    reloadAskedAt: null,
  });

  if (!skipChromeRestart()) {
    attachProgress(`restarting Chrome with proxy flags (quit, then launch on 127.0.0.1:${dataPort})`);
  }
  const { launched } = await tryRestartChrome(dataPort, restoreUrl);
  // Restart skipped/failed: a CONNECT cannot appear unless a test set a short explicit wait.
  const timeoutMs = launched ? attachWaitMs() : attachWaitOverrideMs();
  if (timeoutMs == null) {
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

  attachProgress(`waiting up to ${timeoutMs}ms for Chrome to CONNECT to http://127.0.0.1:${dataPort}`);
  await waitForExternalConnect({ timeoutMs, sinceMs: expectConnectAfter });
  const lastAfter = await readLastConnect();
  const latest = readProxyJson();
  const after = latest ? resolveAimProbe(latest.attach, lastAfter) : null;

  if (after?.aimed && !after.failed) {
    await persistAttach({
      status: 'verified',
      method: aim,
      expectConnectAfter,
      reloadAskedAt: null,
    });
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
  const needsChromeRestart = result.status !== 'verified';
  return {
    status: result.status,
    method: result.method,
    aim: result.aim,
    restoreUrl: result.restoreUrl,
    needsChromeRestart,
    ...(needsChromeRestart ? { chromeCommand: result.chromeCommand } : {}),
    ...(result.policyPath ? { policyPath: result.policyPath } : {}),
    ...(result.persistLimit ? { persistLimit: result.persistLimit } : {}),
  };
}

function setupNext(ready: boolean): string {
  if (ready) {
    return 'Chrome is aimed. Reload the tab. Use `aluvia proxy-off` to go direct and `aluvia proxy-on` to use Aluvia again. If still blocked, run `aluvia status`. If aimed is false, run `aluvia setup` again.';
  }
  return 'Run chromeCommand (it quits Chrome first, then launches with proxy flags). If you launch without quitting, flags are ignored. Then run `aluvia setup` again.';
}

async function failIfPaymentRequired(res: { status: number; json: Record<string, unknown> }): Promise<void> {
  if (res.status !== 402 && res.json.code !== 'payment_required') return;
  const { paymentRequiredPayload } = await import('./auth.js');
  const claimUrl = typeof res.json.claim_url === 'string' ? res.json.claim_url : null;
  const err = new PaymentRequiredError(String(res.json.error ?? 'Trial data is used up.'), claimUrl);
  output(await paymentRequiredPayload(err), 1);
}

async function postEgress(on: boolean): Promise<{ egress: ProxyEgress; rules: string[] }> {
  try {
    const res = await controlRequest('POST', on ? '/proxy-on' : '/proxy-off', {});
    await failIfPaymentRequired(res);
    if (res.status !== 200) {
      output(
        {
          error: String(res.json.error ?? (on ? 'proxy-on failed' : 'proxy-off failed')),
          next: 'Run `aluvia status`.',
        },
        1,
      );
    }
    return {
      egress: res.json.egress === 'aluvia' ? 'aluvia' : 'direct',
      rules: Array.isArray(res.json.rules) ? (res.json.rules as string[]) : [],
    };
  } catch (err) {
    failControl(err);
  }
}

async function handleSetup(args: string[]): Promise<void> {
  const restoreUrl = parseRestoreUrl(args);
  const skill = installProxySkill();
  const binPath = writePathBin();
  if (!restoreUrl && !(await attachAlreadyAimed(readProxyJson()))) {
    failMissingSetupUrl({
      skillPath: skill.skillPaths[0] ?? null,
      skillPaths: skill.skillPaths,
      ...(binPath ? { binPath } : {}),
      ...(skill.error ? { skillError: skill.error } : {}),
    });
  }
  const priorSessionId = (readProxyJson()?.sessionId ?? '').trim() || null;
  // 1. Reuse the one saved connection (never POST a second).
  const result = await runAttach(args);
  // 2. proxy-on / rules ['*'].
  await postEgress(true);
  const state = readProxyJson();
  if (state?.connectionId != null) saveConnectionId(state.connectionId);
  let statusJson: Record<string, unknown> = {};
  let healthy = false;
  try {
    const { json } = await controlRequest('GET', '/status');
    statusJson = json;
    healthy = state ? await bothPortsAccept(state) : false;
  } catch (err) {
    failControl(err);
  }
  const aimed = result.status === 'verified';
  const sessionId =
    typeof statusJson.sessionId === 'string' && statusJson.sessionId
      ? statusJson.sessionId
      : (state?.sessionId ?? null);
  // 3. No session_id → mint once, wait for a live probe.
  // 4. Saved session_id → retry the same session on 503/590; rotate only if retries stay dead.
  // 5. rotate-ip remains the explicit new-exit command. Do not rotate to heal first setup.
  // Skip the session probe until Chrome is aimed. ready requires aimed, and a long
  // probe would sit silent after setup already knows the next action is chromeCommand.
  const probe =
    aimed && state && healthy
      ? await ensureSetupSession({
          dataPort: state.dataPort,
          sessionId,
          hadPriorSession: Boolean(priorSessionId),
          byo: resolveCredential().kind === 'byo',
        })
      : {
          ok: false,
          status: null,
          ip: null,
          upstreamUnavailable: false,
        };
  if (state && healthy) {
    try {
      const { json } = await controlRequest('GET', '/status');
      statusJson = json;
    } catch (err) {
      failControl(err);
    }
  }
  const ready = aimed && healthy && probe.ok;
  if (ready) {
    void maybeFireAluviaInstallBeacon();
  }
  const skillPath = skill.skillPaths[0] ?? null;
  // A skipped probe (Chrome not aimed) is not a dead session — next is chromeCommand.
  const unavailable = aimed && isDeadSessionProbe(probe);
  return outputMaybeStamp({
    next: unavailable ? UPSTREAM_UNAVAILABLE_NEXT : setupNext(ready),
    skillPath,
    ...statusJson,
    healthy,
    ready,
    egress: 'aluvia',
    aimed,
    needsChromeRestart: !aimed,
    skillPaths: skill.skillPaths,
    ...(skill.error ? { skillError: skill.error } : {}),
    ...(binPath ? { binPath } : {}),
    ...attachPublicFields(result),
    ...(unavailable ? upstreamUnavailablePayload() : {}),
  });
}

async function stopDaemonProcess(): Promise<ProxyJson | null> {
  const existing = readProxyJson();
  if (!existing || !isLive(existing)) {
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
    output({
      status: 'stopped',
      next: 'Daemon is stopped. Run `aluvia setup` to start it.',
    });
  }
  output({
    status: 'stopped',
    warning: `Chrome is still aimed at ${existing.proxyUrl}. Browsing will fail until you run \`aluvia start\` or \`aluvia setup\`. Prefer \`aluvia proxy-off\` to stay on the datacenter IP without killing the daemon.`,
    next: 'Daemon is stopped. Chrome aimed at 18787 will fail. Run `aluvia start` or `aluvia setup`. Prefer `aluvia proxy-off` next time.',
  });
}

/** Restart proxyd so a newly saved API key or BYO URL takes effect. Chrome stays aimed. */
export async function recycleDaemonIfRunning(): Promise<{ recycled: boolean }> {
  const existing = readProxyJson();
  if (!existing || !isLive(existing)) return { recycled: false };
  const connectionId = resolveConnectionId(undefined, existing);
  const args = [
    '--port',
    String(existing.dataPort),
    '--control-port',
    String(existing.controlPort),
    ...(connectionId != null ? ['--connection-id', String(connectionId)] : []),
  ];
  await stopDaemonProcess();
  await startDaemon(args);
  return { recycled: true };
}

async function handleStatus(): Promise<void> {
  await ensureRunningDaemon();
  const state = readProxyJson();
  try {
    const { json } = await controlRequest('GET', '/status');
    const healthy = state ? await bothPortsAccept(state) : false;
    const lastConnect = await readLastConnect();
    const base = state ? { ...state, lastConnect } : null;
    const probe = base ? resolveAimProbe(base.attach, lastConnect) : null;
    if (
      base &&
      probe &&
      (probe.attach.reloadAskedAt !== base.attach.reloadAskedAt || probe.attach.status !== base.attach.status)
    ) {
      await persistAttach(probe.attach);
    }
    const aimedState = base && probe ? { ...base, attach: probe.attach, lastConnect } : base;
    const aimedNow = aimedState ? aimedFrom(aimedState) : false;
    const tunnelProbe =
      aimedNow &&
      healthy &&
      egressFromRules(aimedState?.rules ?? state?.rules ?? []) === 'aluvia' &&
      aimedState
        ? await probeUntilReady(aimedState.dataPort)
        : undefined;
    return outputMaybeStamp(
      aimedState
        ? { ...statusFields(aimedState, healthy, { probe: tunnelProbe }), ...json, healthy }
        : { ...json, healthy },
    );
  } catch (err) {
    if (isControlClientError(err, 'not_running')) {
      if (state) {
        const probe = resolveAimProbe(state.attach, state.lastConnect);
        if (probe.attach.reloadAskedAt !== state.attach.reloadAskedAt || probe.failed) {
          writeProxyJson({ ...state, attach: probe.attach });
        }
        return outputMaybeStamp(statusFields({ ...state, attach: probe.attach }, false));
      }
      output(
        {
          error: NOT_RUNNING,
          next: 'Run `aluvia setup`.',
        },
        1,
      );
    }
    failControl(err);
  }
}

async function requireHealthyDaemon(): Promise<void> {
  await ensureRunningDaemon();
  const state = readProxyJson();
  if (!state || state.pid == null || !isProcessAlive(state.pid)) {
    output(
      {
        error: NOT_RUNNING,
        next: 'Run `aluvia setup`.',
      },
      1,
    );
  }
  const healthy = await bothPortsAccept(state);
  if (!healthy) {
    output(
      {
        error: 'proxyd data port is not healthy. Run `aluvia status`.',
        next: 'Run `aluvia status`.',
      },
      1,
    );
  }
}

const RESERVED_GEO = new Set(['all', 'any', '*']);

function parseGeoFlag(args: string[]): { specified: boolean; geo: string | null } {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--geo') {
      const value = args[i + 1];
      if (value == null || value.startsWith('-')) {
        output({ error: 'Usage: --geo <geo> (e.g. --geo US)' }, 1);
      }
      if (RESERVED_GEO.has(value.trim().toLowerCase())) {
        output(
          {
            error: 'Omit --geo to use every geo. --geo takes a country code (e.g. US).',
            next: 'Retry without --geo, or pass --geo US.',
          },
          1,
        );
      }
      return { specified: true, geo: value };
    }
  }
  return { specified: false, geo: null };
}

function desiredGeo(
  flag: { specified: boolean; geo: string | null },
  current: string | null,
  byo: boolean,
): string | null {
  if (flag.specified) return flag.geo;
  if (byo) return current;
  return null;
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
    await failIfPaymentRequired(res);
    if (res.status !== 200) {
      output({ error: String(res.json.error ?? 'set-geo failed'), next: 'Run `aluvia status`.' }, 1);
    }
    return typeof res.json.targetGeo === 'string' ? res.json.targetGeo : null;
  } catch (err) {
    failControl(err);
  }
}

async function postRotate(): Promise<{ sessionId: string; connectionId: unknown }> {
  try {
    const res = await controlRequest('POST', '/rotate-ip', {});
    await failIfPaymentRequired(res);
    if (res.status !== 200) {
      output({ error: String(res.json.error ?? 'rotate-ip failed'), next: 'Run `aluvia status`.' }, 1);
    }
    return { sessionId: String(res.json.sessionId ?? ''), connectionId: res.json.connectionId };
  } catch (err) {
    failControl(err);
  }
}

async function handleProxySwitch(on: boolean): Promise<void> {
  await requireHealthyDaemon();
  const result = await postEgress(on);
  return outputMaybeStamp({
    egress: result.egress,
    rules: result.rules,
    count: result.rules.length,
    next: 'Reload the tab. Do not restart Chrome.',
  });
}

async function handleProxyOn(args: string[]): Promise<void> {
  const geoFlag = parseGeoFlag(args);
  await requireHealthyDaemon();
  const byo = resolveCredential().kind === 'byo';
  if (geoFlag.specified && byo) {
    output({ error: BYO_NETWORK, next: 'Run `aluvia proxy-provider aluvia`, then retry.' }, 1);
  }
  const before = await readControlStatus();
  const geo = desiredGeo(geoFlag, before.targetGeo, byo);
  const geoSame = before.targetGeo === geo;
  if (before.egress === 'aluvia' && geoSame) {
    return outputMaybeStamp({
      egress: 'aluvia',
      rules: before.rules,
      count: before.rules.length,
      targetGeo: before.targetGeo,
      rotated: false,
      next: 'Already on. Reload the tab if the page is still blocked.',
    });
  }

  if (!geoSame) {
    await postSetGeo(geo);
  }
  if (before.egress !== 'aluvia') {
    await postEgress(true);
  }

  let rotated = false;
  let sessionId: string | undefined;
  let connectionId: unknown;
  if (!geoSame) {
    const result = await postRotate();
    rotated = true;
    sessionId = result.sessionId;
    connectionId = result.connectionId;
  }

  const after = await readControlStatus();
  return outputMaybeStamp({
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
  const geoFlag = parseGeoFlag(args);
  if (resolveCredential().kind === 'byo') {
    output({ error: BYO_NETWORK, next: 'Run `aluvia proxy-provider aluvia`, then retry.' }, 1);
  }
  await requireHealthyDaemon();
  const before = await readControlStatus();
  const geo = desiredGeo(geoFlag, before.targetGeo, false);
  if (before.targetGeo !== geo) {
    await postSetGeo(geo);
  }
  if (before.egress !== 'aluvia') {
    await postEgress(true);
  }
  const rotated = await postRotate();
  const after = await readControlStatus();
  const state = readProxyJson();
  const probe = state
    ? await probeUntilReady(state.dataPort)
    : {
        ok: false,
        status: null,
        ip: null,
        upstreamUnavailable: false,
      };
  if (!probe.ok) {
    return outputMaybeStamp({
      sessionId: rotated.sessionId,
      connectionId: rotated.connectionId,
      targetGeo: after.targetGeo,
      egress: 'aluvia',
      rotated: false,
      ready: false,
      ...rotateProbeFailure(probe),
    });
  }
  return outputMaybeStamp({
    sessionId: rotated.sessionId,
    connectionId: rotated.connectionId,
    targetGeo: after.targetGeo,
    egress: 'aluvia',
    rotated: true,
    ready: true,
    next: 'Reload the tab. Do not restart Chrome.',
  });
}

async function handleProxyProvider(args: string[]): Promise<void> {
  const raw = args.find((arg) => !arg.startsWith('-'));
  if (!raw) {
    const stored = getStoredUpstream();
    if (stored) {
      output({
        provider: 'custom',
        upstreamHost: parseUpstreamUrl(stored).host,
        next: 'Using a pasted proxy URL. Run `aluvia proxy-provider aluvia` to use Aluvia again.',
      });
    }
    output({
      provider: 'aluvia',
      next: 'Using the Aluvia network. Run `aluvia proxy-on` then reload.',
    });
  }
  if (raw.toLowerCase() === 'aluvia') {
    const changed = clearUpstream();
    const recycled = changed ? (await recycleDaemonIfRunning()).recycled : false;
    output({
      provider: 'aluvia',
      recycled,
      next: credentialNext(recycled),
    });
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
  if (subcommand === 'setup') {
    return handleSetup(args.slice(1));
  }
  if (subcommand === 'proxy-provider') {
    return handleProxyProvider(args.slice(1));
  }
  output(
    {
      error: `Unknown command: '${subcommand}'. Run "aluvia help" for usage.`,
      next: 'Run `aluvia help`.',
    },
    1,
  );
}
