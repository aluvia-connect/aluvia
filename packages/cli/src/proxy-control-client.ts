import net from 'node:net';
import { isProcessAlive } from './net/process.js';
import { readProxyJson, type ProxyJson } from './proxy-state.js';

export const DEFAULT_CONTROL_REQUEST_TIMEOUT_MS = 35_000;

export function controlRequestTimeoutMs(): number {
  const raw = (process.env.ALUVIA_CONTROL_TIMEOUT_MS ?? '').trim();
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isInteger(parsed) && parsed >= 1) return parsed;
  return DEFAULT_CONTROL_REQUEST_TIMEOUT_MS;
}

export class ControlClientError extends Error {
  readonly code: 'not_running' | 'timeout';
  constructor(code: 'not_running' | 'timeout') {
    super(code);
    this.name = 'ControlClientError';
    this.code = code;
  }
}

export function isControlClientError(
  err: unknown,
  code?: 'not_running' | 'timeout',
): err is ControlClientError {
  if (!(err instanceof ControlClientError)) return false;
  return code == null || err.code === code;
}

export async function bothPortsAccept(state: { dataPort: number; controlPort: number }): Promise<boolean> {
  const check = (port: number) =>
    new Promise<boolean>((resolve) => {
      const sock = net.connect({ host: '127.0.0.1', port }, () => {
        sock.end();
        resolve(true);
      });
      sock.setTimeout(200);
      sock.on('timeout', () => {
        sock.destroy();
        resolve(false);
      });
      sock.on('error', () => resolve(false));
    });
  const [dataOk, controlOk] = await Promise.all([check(state.dataPort), check(state.controlPort)]);
  return dataOk && controlOk;
}

export async function controlRequest(
  method: 'GET' | 'POST',
  pathname: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const state: ProxyJson | null = readProxyJson();
  if (!state || state.pid == null || !isProcessAlive(state.pid)) {
    throw new ControlClientError('not_running');
  }

  const base = state.controlUrl.replace(/\/+$/, '');
  const url = `${base}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ControlClientError('timeout'));
    }, controlRequestTimeoutMs());
  });

  const run = async (): Promise<{ status: number; json: Record<string, unknown> }> => {
    try {
      const res = await fetch(url, {
        method,
        headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      let json: Record<string, unknown> = {};
      try {
        const parsed = (await res.json()) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          json = parsed as Record<string, unknown>;
        }
      } catch {
        json = {};
      }
      return { status: res.status, json };
    } catch (err) {
      if (err instanceof ControlClientError) throw err;
      const name = err instanceof Error ? err.name : '';
      if (name === 'AbortError' || name === 'TimeoutError' || controller.signal.aborted) {
        throw new ControlClientError('timeout');
      }
      throw err;
    }
  };

  try {
    return await Promise.race([run(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
