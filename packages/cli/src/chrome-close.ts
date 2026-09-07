import http from 'node:http';
import WebSocket from 'ws';
import { chromeDebugPort, type RunningChrome } from './chrome-process.js';

/** Ask an agent-controlled Chrome to save its profile before exiting. No new debugging port is opened. */
export async function closeChromeGracefully(browser: RunningChrome): Promise<boolean> {
  const port = chromeDebugPort(browser);
  if (port == null) return false;
  const endpoint = await new Promise<string | null>((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
        if (body.length > 65536) req.destroy();
      });
      res.on('error', () => resolve(null));
      res.on('end', () => {
        try {
          const raw = JSON.parse(body).webSocketDebuggerUrl;
          const url = new URL(raw);
          // Connect only to the discovered local browser, never a URL returned by a remote service.
          if (
            url.protocol !== 'ws:' ||
            !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
            Number(url.port) !== port
          ) {
            resolve(null);
            return;
          }
          url.hostname = '127.0.0.1';
          resolve(url.href);
        } catch {
          resolve(null);
        }
      });
    });
    req.setTimeout(1000, () => req.destroy());
    req.on('error', () => resolve(null));
  });
  if (!endpoint) return false;
  return await new Promise<boolean>((resolve) => {
    const socket = new WebSocket(endpoint, { handshakeTimeout: 1000, maxPayload: 65536 });
    let acknowledged = false;
    let settled = false;
    const finish = (closed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.terminate();
      resolve(closed);
    };
    const timer = setTimeout(() => finish(acknowledged), 3000);
    socket.on('open', () => socket.send(JSON.stringify({ id: 1, method: 'Browser.close' })));
    socket.on('message', (data) => {
      try {
        const response = JSON.parse(data.toString());
        if (response.id === 1 && !response.error) acknowledged = true;
      } catch {
        /* Ignore unrelated protocol events. */
      }
    });
    socket.on('close', () => finish(acknowledged));
    socket.on('error', () => finish(false));
  });
}
