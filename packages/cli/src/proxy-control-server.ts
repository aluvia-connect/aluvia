import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseRouteHost } from './proxy-host.js';
import type { LastConnectSnapshot, ProxyAttachState } from './proxy-state.js';

export class ControlError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'ControlError';
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, ControlError.prototype);
  }
}

export type ControlStatusBody = {
  pid: number;
  proxyUrl: string;
  controlUrl: string;
  connectionId: number | null;
  sessionId: string | null;
  targetGeo: string | null;
  rules: string[];
  count: number;
  attach: ProxyAttachState;
};

export type ControlHandlers = {
  getStatus: () => ControlStatusBody;
  route: (host: string) => Promise<{ rules: string[] }>;
  unroute: (host: string) => Promise<{ rules: string[] }>;
  rotateIp: () => Promise<{ sessionId: string; connectionId: number }>;
  setGeo: (body: { geo?: string; clear?: boolean }) => Promise<{
    targetGeo: string | null;
    connectionId: number;
  }>;
  stop: () => void;
  getLastConnect?: () => LastConnectSnapshot;
  setLastConnect?: (snapshot: LastConnectSnapshot) => void;
  setAttach?: (attach: ProxyAttachState) => void;
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(payload);
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('error', reject);
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new ControlError(400, 'invalid json'));
          return;
        }
        resolve(parsed as Record<string, unknown>);
      } catch {
        reject(new ControlError(400, 'invalid json'));
      }
    });
  });
}

function hostFromBody(body: Record<string, unknown>): string {
  const host = body.host;
  return typeof host === 'string' ? host : '';
}

export function createControlServer(handlers: ControlHandlers): http.Server {
  return http.createServer((req, res) => {
    void handleRequest(req, res, handlers);
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  handlers: ControlHandlers,
): Promise<void> {
  try {
    const method = req.method ?? 'GET';
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;

    if (method === 'GET' && pathname === '/status') {
      sendJson(res, 200, handlers.getStatus());
      return;
    }

    if (method === 'POST' && pathname === '/route') {
      const body = await readJsonBody(req);
      const parsed = parseRouteHost(hostFromBody(body));
      if (!parsed.ok) {
        sendJson(res, 400, { error: parsed.error });
        return;
      }
      const result = await handlers.route(parsed.host);
      sendJson(res, 200, result);
      return;
    }

    if (method === 'POST' && pathname === '/unroute') {
      const body = await readJsonBody(req);
      const rawHost = hostFromBody(body);
      const parsed = parseRouteHost(rawHost);
      if (!parsed.ok && parsed.error === 'host is required') {
        sendJson(res, 400, { error: 'host is required' });
        return;
      }
      const host = parsed.ok ? parsed.host : rawHost.trim().replace(/\.+$/, '').toLowerCase();
      const result = await handlers.unroute(host);
      sendJson(res, 200, result);
      return;
    }

    if (method === 'POST' && pathname === '/rotate-ip') {
      await readJsonBody(req);
      const result = await handlers.rotateIp();
      sendJson(res, 200, result);
      return;
    }

    if (method === 'POST' && pathname === '/set-geo') {
      const body = await readJsonBody(req);
      const hasGeo = Object.prototype.hasOwnProperty.call(body, 'geo');
      const hasClear = Object.prototype.hasOwnProperty.call(body, 'clear');
      if (hasGeo === hasClear) {
        sendJson(res, 400, { error: 'set-geo requires either geo or clear, not both' });
        return;
      }
      const result = await handlers.setGeo({
        ...(hasGeo ? { geo: typeof body.geo === 'string' ? body.geo : undefined } : {}),
        ...(hasClear ? { clear: Boolean(body.clear) } : {}),
      });
      sendJson(res, 200, result);
      return;
    }

    if (method === 'POST' && pathname === '/stop') {
      await readJsonBody(req);
      sendJson(res, 200, { status: 'stopped' });
      setImmediate(() => {
        handlers.stop();
      });
      return;
    }

    if (method === 'GET' && pathname === '/last-connect') {
      sendJson(res, 200, handlers.getLastConnect?.() ?? { hostname: null, at: null });
      return;
    }

    if (method === 'POST' && pathname === '/last-connect') {
      await readJsonBody(req);
      const cleared: LastConnectSnapshot = { hostname: null, at: null };
      handlers.setLastConnect?.(cleared);
      sendJson(res, 200, cleared);
      return;
    }

    if (method === 'POST' && pathname === '/attach-state') {
      const body = await readJsonBody(req);
      const status = body.status;
      if (status !== 'unverified' && status !== 'verified' && status !== 'needs_ui') {
        sendJson(res, 400, { error: 'invalid attach status' });
        return;
      }
      const attach: ProxyAttachState = {
        status,
        method:
          body.method === 'gsettings' || body.method === 'extension' || body.method === 'policy'
            ? body.method
            : null,
        verifiedAt: typeof body.verifiedAt === 'string' ? body.verifiedAt : null,
        extensionPath: typeof body.extensionPath === 'string' ? body.extensionPath : null,
      };
      handlers.setAttach?.(attach);
      sendJson(res, 200, { attach });
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    if (err instanceof ControlError) {
      sendJson(res, err.statusCode, { error: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 500, { error: message });
  }
}
