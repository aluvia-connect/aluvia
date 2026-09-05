import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { configDir, getStoredInstallId } from './config.js';
import { isCapturing } from './output-capture.js';
import { isLoopbackHostname } from './net/loopback.js';
import { DEFAULT_PROBE_URLS, isSessionProbeHostname } from './session-probe-hosts.js';

// Attribution cannot inherit user-controlled API/proxy destinations: the install ID is a credential.
const ORIGIN = 'https://api.aluvia.io/v1/growth';
const REQUEST_TIMEOUT_MS = 750;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_NAMES = ['setup_ready', 'first_proxy_request'] as const;
type EventName = (typeof EVENT_NAMES)[number];
type Event = {
  schema_version: 1;
  event_name: EventName;
  client_event_id: string;
  occurred_at: string;
  connection_id: number;
};
const pending = new Map<string, Promise<void>>();
const trafficScheduled = new Set<string>();

function root(): string {
  return path.join(configDir(), 'growth-attribution');
}
function read(file: string): Record<string, unknown> | undefined {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 8192) return;
    const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value != null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return;
  }
}

/** Publish a complete immutable file exclusively; crashes and concurrent processes cannot overwrite it. */
function publish(file: string, value: object): void {
  const dir = path.dirname(file);
  for (const target of [configDir(), root(), dir]) {
    fs.mkdirSync(target, { recursive: true, mode: 0o700 });
    if (!fs.lstatSync(target).isDirectory()) throw new Error('Invalid attribution directory');
    fs.chmodSync(target, 0o700);
  }
  const temp = path.join(dir, `.pending-${crypto.randomUUID()}`);
  try {
    const fd = fs.openSync(temp, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(value));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    try {
      fs.linkSync(temp, file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

/** Capture at setup entry, including incomplete setup. First accepted token stays sticky. Never creates an install. */
export function captureAttributionToken(value = process.env.ALUVIA_ATTRIBUTION_TOKEN): void {
  if (typeof value !== 'string' || !TOKEN.test(value)) return;
  try {
    publish(path.join(root(), 'token.json'), { schema_version: 1, attribution_token: value });
  } catch {
    // Attribution must not break normal setup; never log capabilities or auth headers.
  }
}
function context(): { dir: string; installId: string; token: string } | undefined {
  const token = read(path.join(root(), 'token.json'))?.attribution_token;
  if (typeof token !== 'string' || !TOKEN.test(token)) return;
  const installId = getStoredInstallId();
  if (!installId) return;
  const key = crypto.createHash('sha256').update(installId).digest('hex');
  return { dir: path.join(root(), key), installId, token };
}
function validId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
function ack(value: Record<string, unknown> | undefined, kind: 'binding' | 'event'): boolean {
  const key = kind === 'binding' ? 'acquisition_id' : 'receipt_id';
  return (
    value?.schema_version === 1 &&
    value.status === (kind === 'binding' ? 'bound' : 'recorded') &&
    typeof value[key] === 'string' &&
    UUID.test(value[key])
  );
}

type Result =
  | { kind: 'ack'; body: Record<string, unknown> }
  | { kind: 'terminal'; status: number }
  | { kind: 'retry' };
async function post(
  endpoint: string,
  installId: string,
  body: object,
  kind: 'binding' | 'event',
): Promise<Result> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  try {
    // Deadline includes body reading, and remains bounded even if a transport ignores abort.
    return await Promise.race([
      (async (): Promise<Result> => {
        const response = await globalThis.fetch(`${ORIGIN}/${endpoint}`, {
          method: 'POST',
          redirect: 'error',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', 'X-Aluvia-Install-Id': installId },
          body: JSON.stringify(body),
        });
        if (response.redirected) return { kind: 'retry' };
        if (response.status === 200 || response.status === 201) {
          const text = await response.text();
          if (text.length > 8192) return { kind: 'retry' };
          const value = JSON.parse(text);
          if (ack(value, kind)) return { kind: 'ack', body: value };
          return { kind: 'retry' };
        }
        if ([400, 403, 409, 410, 422].includes(response.status)) {
          return { kind: 'terminal', status: response.status };
        }
        // 401 waits for the normal install flow. 404 means the bridge is disabled.
        return { kind: 'retry' };
      })(),
      new Promise<Result>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve({ kind: 'retry' });
        }, REQUEST_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return { kind: 'retry' };
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
  }
}
function validEvent(value: Record<string, unknown> | undefined, event: EventName): value is Event {
  return (
    value?.schema_version === 1 &&
    value.event_name === event &&
    typeof value.client_event_id === 'string' &&
    UUID.test(value.client_event_id) &&
    typeof value.occurred_at === 'string' &&
    Number.isFinite(Date.parse(value.occurred_at)) &&
    validId(value.connection_id) &&
    Object.keys(value).length === 5
  );
}
async function drain(ctx: NonNullable<ReturnType<typeof context>>): Promise<void> {
  const stop = path.join(ctx.dir, 'stopped.json');
  if (fs.existsSync(stop)) return;
  const bound = path.join(ctx.dir, 'bound.json');
  if (!ack(read(bound), 'binding')) {
    const result = await post(
      'install-attribution',
      ctx.installId,
      { schema_version: 1, attribution_token: ctx.token },
      'binding',
    );
    if (result.kind === 'terminal') publish(stop, { status: result.status });
    if (result.kind !== 'ack') return;
    publish(bound, result.body);
  }
  for (const event of EVENT_NAMES) {
    if (fs.existsSync(stop)) return;
    const receipt = path.join(ctx.dir, `${event}.receipt.json`);
    const rejected = path.join(ctx.dir, `${event}.rejected.json`);
    if (ack(read(receipt), 'event') || fs.existsSync(rejected)) continue;
    const body = read(path.join(ctx.dir, `${event}.pending.json`));
    if (!validEvent(body, event)) continue;
    const result = await post('install-events', ctx.installId, body, 'event');
    if (result.kind === 'ack') publish(receipt, result.body);
    if (result.kind === 'terminal') {
      // A conflict/withdrawal ends this binding; never fallback to a different install/token.
      publish([409, 410].includes(result.status) ? stop : rejected, { status: result.status });
    }
  }
}

/** One bounded attempt per endpoint. Later setup/daemon ticks retry durable work. */
export function drainAttribution(): Promise<void> {
  if (isCapturing()) return Promise.resolve();
  try {
    const ctx = context();
    if (!ctx) return Promise.resolve();
    const active = pending.get(ctx.dir);
    if (active) return active;
    const run = drain(ctx)
      .catch(() => {})
      .finally(() => {
        pending.delete(ctx.dir);
      });
    pending.set(ctx.dir, run);
    return run;
  } catch {
    return Promise.resolve();
  }
}
export function pendingAttributionDrain(): Promise<void> | undefined {
  return pending.size ? Promise.all([...pending.values()]).then(() => {}) : undefined;
}
function queue(event: EventName, connectionId: number): Promise<void> {
  if (isCapturing()) return Promise.resolve();
  try {
    const ctx = context();
    if (!ctx || fs.existsSync(path.join(ctx.dir, 'stopped.json'))) return Promise.resolve();
    const file = path.join(ctx.dir, `${event}.pending.json`);
    if (!fs.existsSync(file))
      publish(file, {
        schema_version: 1,
        event_name: event,
        client_event_id: crypto.randomUUID(),
        occurred_at: new Date().toISOString(),
        connection_id: connectionId,
      });
    return drainAttribution();
  } catch {
    return Promise.resolve();
  }
}
export function reportSetupReady(info: {
  aimed: boolean;
  healthy: boolean;
  probeOk: boolean;
  credentialKind: 'install' | 'token' | 'aluvia' | 'byo';
  connectionId?: number;
}): Promise<void> {
  if (
    !info.aimed ||
    !info.healthy ||
    !info.probeOk ||
    info.credentialKind === 'byo' ||
    !validId(info.connectionId)
  ) {
    return Promise.resolve();
  }
  return queue('setup_ready', info.connectionId);
}
export type FirstProxyRequestTrigger = {
  hostname: string;
  viaUpstream: boolean;
  isHttp: boolean;
  connectOk?: boolean;
  credentialKind: 'aluvia' | 'byo';
  connectionId?: number;
};
export function isFirstProxyRequestTrigger(info: FirstProxyRequestTrigger): boolean {
  const hostname = info.hostname.trim().toLowerCase().replace(/\.$/, '');
  return (
    Boolean(hostname) &&
    !isLoopbackHostname(hostname) &&
    !isSessionProbeHostname(hostname) &&
    !DEFAULT_PROBE_URLS.some((url) => new URL(url).hostname === hostname) &&
    info.viaUpstream &&
    !info.isHttp &&
    info.connectOk === true &&
    info.credentialKind === 'aluvia' &&
    validId(info.connectionId)
  );
}
/** Never await network delivery on the traffic path. */
export function reportFirstProxyRequest(info: FirstProxyRequestTrigger): void {
  if (!isFirstProxyRequestTrigger(info) || isCapturing()) return;
  try {
    const ctx = context();
    if (
      !ctx ||
      trafficScheduled.has(ctx.dir) ||
      fs.existsSync(path.join(ctx.dir, 'first_proxy_request.pending.json'))
    )
      return;
    trafficScheduled.add(ctx.dir);
    setImmediate(() => {
      void queue('first_proxy_request', info.connectionId!).finally(() => {
        trafficScheduled.delete(ctx.dir);
      });
    });
  } catch {
    // Disk errors cannot affect a CONNECT.
  }
}
