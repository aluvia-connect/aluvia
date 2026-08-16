import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PaymentRequiredError } from './net/errors.js';
import {
  normalizeAttach,
  type LastConnectSnapshot,
  type ProxyAttachState,
  type ProxyEgress,
} from './proxy-state.js';

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
  egress?: ProxyEgress;
};

export type ControlHandlers = {
  getStatus: () => ControlStatusBody;
  rotateIp: () => Promise<{ sessionId: string; connectionId: number }>;
  setGeo: (body: { geo?: string; clear?: boolean }) => Promise<{
    targetGeo: string | null;
    connectionId: number;
  }>;
  proxyOn?: () => Promise<{ egress: ProxyEgress; rules: string[] }>;
  proxyOff?: () => Promise<{ egress: ProxyEgress; rules: string[] }>;
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

    if (method === 'POST' && pathname === '/rotate-ip') {
      await readJsonBody(req);
      const result = await handlers.rotateIp();
      sendJson(res, 200, result);
      return;
    }

    if (method === 'POST' && pathname === '/proxy-on') {
      await readJsonBody(req);
      if (!handlers.proxyOn) {
        sendJson(res, 404, { error: 'not found' });
        return;
      }
      const result = await handlers.proxyOn();
      sendJson(res, 200, result);
      return;
    }

    if (method === 'POST' && pathname === '/proxy-off') {
      await readJsonBody(req);
      if (!handlers.proxyOff) {
        sendJson(res, 404, { error: 'not found' });
        return;
      }
      const result = await handlers.proxyOff();
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
      if (body.status !== 'verified' && body.status !== 'needs_ui' && body.status !== 'unverified') {
        sendJson(res, 400, { error: 'invalid attach status' });
        return;
      }
      const attach = normalizeAttach(body);
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
    if (err instanceof PaymentRequiredError) {
      sendJson(res, 402, {
        error: err.message,
        code: 'payment_required',
        claim_url: err.claimUrl,
      });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 500, { error: message });
  }
}
