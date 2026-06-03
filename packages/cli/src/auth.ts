import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { AluviaApi } from '@aluvia/sdk';
import { output } from './cli.js';
import { getStoredApiKey, saveApiKey, clearApiKey, configPath } from './config.js';

const DEFAULT_DASHBOARD_URL = 'https://dashboard.aluvia.io';
const DEFAULT_API_URL = 'https://api.aluvia.io';
const CALLBACK_TIMEOUT_MS = 180_000;
const DEVICE_FLOW_TIMEOUT_MS = 600_000;

function dashboardBaseUrl(): string {
  const raw = (process.env.ALUVIA_DASHBOARD_URL ?? DEFAULT_DASHBOARD_URL).trim();
  return raw.replace(/\/+$/, '');
}

function apiBaseUrl(): string {
  const raw = (process.env.ALUVIA_API_URL ?? DEFAULT_API_URL).trim();
  return raw.replace(/\/+$/, '');
}

/**
 * Verify the received key works, persist it, and emit the success/error result.
 * Shared by the loopback and device flows. Never returns.
 */
async function finishWithKey(apiKey: string): Promise<never> {
  try {
    const api = new AluviaApi({ apiKey });
    const account = await api.account.get();
    saveApiKey(apiKey);
    return output({ status: 'authenticated', configPath: configPath(), account });
  } catch (err) {
    return output({ error: `Received an API key but it failed verification: ${(err as Error).message}` }, 1);
  }
}

/**
 * Best-effort cross-platform browser open. Never throws — the printed link is
 * the fallback when no browser can be launched (e.g. headless environments).
 */
function openBrowser(url: string): void {
  try {
    let command: string;
    let args: string[];
    if (process.platform === 'darwin') {
      command = 'open';
      args = [url];
    } else if (process.platform === 'win32') {
      command = 'cmd';
      args = ['/c', 'start', '', url];
    } else {
      command = 'xdg-open';
      args = [url];
    }
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {
      /* opener not available — link is printed as fallback */
    });
    child.unref();
  } catch {
    /* ignore */
  }
}

interface CallbackResult {
  apiKey: string;
}

/**
 * Start a loopback HTTP server on 127.0.0.1 and resolve with the API key once
 * the dashboard delivers it (and the state nonce matches).
 */
function waitForCallback(
  state: string,
  allowedOrigin: string,
): Promise<{ port: number; result: Promise<CallbackResult>; close: () => void }> {
  return new Promise((resolveServer, rejectServer) => {
    let settle: (r: CallbackResult) => void;
    let fail: (e: Error) => void;
    const result = new Promise<CallbackResult>((res, rej) => {
      settle = res;
      fail = rej;
    });

    const corsHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      // Required for Chrome Private Network Access (HTTPS page -> localhost).
      'Access-Control-Allow-Private-Network': 'true',
    };

    const successHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Aluvia CLI</title></head><body style="font-family:system-ui,sans-serif;text-align:center;padding:48px"><h2>&#10003; Authentication complete</h2><p>You can close this tab and return to your terminal.</p></body></html>`;

    const finish = (apiKey: string, res: http.ServerResponse, asHtml: boolean) => {
      if (asHtml) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders });
        res.end(successHtml);
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ ok: true }));
      }
      settle({ apiKey });
    };

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');

      if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders);
        res.end();
        return;
      }

      if (url.pathname !== '/callback') {
        res.writeHead(404, corsHeaders);
        res.end();
        return;
      }

      // Fallback: redirect-based delivery via query params.
      if (req.method === 'GET') {
        const apiKey = url.searchParams.get('api_key');
        const gotState = url.searchParams.get('state');
        if (!apiKey || gotState !== state) {
          res.writeHead(400, corsHeaders);
          res.end('Invalid request');
          return;
        }
        finish(apiKey, res, true);
        return;
      }

      if (req.method === 'POST') {
        let body = '';
        let tooLarge = false;
        req.on('data', (chunk) => {
          body += chunk;
          if (body.length > 1_000_000) {
            tooLarge = true;
            req.destroy();
          }
        });
        req.on('end', () => {
          if (tooLarge) return;
          try {
            const parsed = JSON.parse(body) as { api_key?: string; state?: string };
            if (!parsed.api_key || parsed.state !== state) {
              res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders });
              res.end(JSON.stringify({ ok: false, error: 'invalid_request' }));
              return;
            }
            finish(parsed.api_key, res, false);
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders });
            res.end(JSON.stringify({ ok: false, error: 'invalid_json' }));
          }
        });
        return;
      }

      res.writeHead(405, corsHeaders);
      res.end();
    });

    server.on('error', (err) => rejectServer(err));

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      if (!port) {
        server.close();
        fail(new Error('Failed to bind local callback server.'));
        return;
      }
      resolveServer({
        port,
        result,
        close: () => {
          try {
            server.close();
          } catch {
            /* ignore */
          }
        },
      });
    });
  });
}

async function runLogin(noBrowser: boolean): Promise<never> {
  const dashboard = dashboardBaseUrl();
  const allowedOrigin = new URL(dashboard).origin;
  const state = crypto.randomBytes(16).toString('hex');

  let port: number;
  let result: Promise<CallbackResult>;
  let close: () => void;
  try {
    ({ port, result, close } = await waitForCallback(state, allowedOrigin));
  } catch (err) {
    return output({ error: `Could not start local authentication server: ${(err as Error).message}` }, 1);
  }

  // NOTE: use `cli_state` (not `state`) — `state` is a reserved OAuth param that
  // the dashboard's auth tooling strips from the URL on load.
  const authUrl = `${dashboard}/cli-auth?port=${port}&cli_state=${state}`;

  console.error('Authenticate with Aluvia by opening this link in your browser:\n');
  console.error(`  ${authUrl}\n`);
  console.error('Waiting for you to finish signing in...');

  if (!noBrowser) {
    openBrowser(authUrl);
  }

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('timeout'));
    }, CALLBACK_TIMEOUT_MS);
  });

  let apiKey: string;
  try {
    const res = await Promise.race([result, timeout]);
    apiKey = res.apiKey;
  } catch (err) {
    close();
    if ((err as Error).message === 'timeout') {
      return output(
        {
          error: `Timed out waiting for browser authentication. Open the link manually: ${authUrl} — or, on a headless machine, run \`aluvia auth --device\`.`,
        },
        1,
      );
    }
    return output({ error: `Authentication failed: ${(err as Error).message}` }, 1);
  } finally {
    if (timer) clearTimeout(timer);
  }

  // Verify the key works before persisting it.
  close();
  return finishWithKey(apiKey);
}

interface DeviceInit {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  interval: number;
  expires_in: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * Backend-brokered device flow — works without a same-machine browser
 * (headless / SSH / containers). The CLI polls the backend; the user approves
 * in any browser.
 */
async function runDeviceLogin(noBrowser: boolean): Promise<never> {
  const api = apiBaseUrl();

  let init: DeviceInit;
  try {
    const res = await fetch(`${api}/auth/cli/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: `aluvia-cli@${process.platform}` }),
    });
    if (!res.ok) throw new Error(`init failed (HTTP ${res.status})`);
    init = (await res.json()) as DeviceInit;
  } catch (err) {
    return output({ error: `Could not start device authentication: ${(err as Error).message}` }, 1);
  }

  console.error('Authenticate with Aluvia:\n');
  console.error(`  1. Open: ${init.verification_uri_complete}`);
  console.error(`  2. Confirm this code matches: ${init.user_code}\n`);
  console.error('Waiting for approval...');

  if (!noBrowser) {
    openBrowser(init.verification_uri_complete);
  }

  const intervalMs = Math.max(1, init.interval || 5) * 1000;
  const deadline =
    Date.now() + Math.min(init.expires_in * 1000 || DEVICE_FLOW_TIMEOUT_MS, DEVICE_FLOW_TIMEOUT_MS);
  let waitMs = intervalMs;

  while (Date.now() < deadline) {
    await delay(waitMs);
    let status: string;
    let apiKey: string | undefined;
    try {
      const res = await fetch(`${api}/auth/cli/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_code: init.device_code }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        status?: string;
        api_key?: string;
      };
      status = data.status ?? 'error';
      apiKey = data.api_key;
    } catch {
      // Transient network error — keep polling until the deadline.
      continue;
    }

    if (status === 'approved' && apiKey) {
      return finishWithKey(apiKey);
    }
    if (status === 'denied') {
      return output({ error: 'Authentication was denied in the browser.' }, 1);
    }
    if (status === 'expired' || status === 'invalid') {
      return output({ error: 'Authentication session expired. Run `aluvia auth --device` again.' }, 1);
    }
    if (status === 'slow_down') {
      waitMs += 5000;
    }
    // 'pending' (or transient 'error') → keep polling.
  }

  return output({ error: 'Timed out waiting for approval. Run `aluvia auth --device` again.' }, 1);
}

function runStatus(): never {
  const envKey = (process.env.ALUVIA_API_KEY ?? '').trim();
  if (envKey) {
    return output({ authenticated: true, source: 'env' });
  }
  if (getStoredApiKey()) {
    return output({ authenticated: true, source: 'config', configPath: configPath() });
  }
  return output({ authenticated: false });
}

function runLogout(): never {
  const removed = clearApiKey();
  return output({ status: removed ? 'logged_out' : 'not_logged_in', configPath: configPath() });
}

export async function handleAuth(args: string[]): Promise<void> {
  // The first non-flag argument (if any) is the subcommand.
  const subcommand = args.find((a) => !a.startsWith('-'));

  if (subcommand === 'status') {
    runStatus();
  }
  if (subcommand === 'logout') {
    runLogout();
  }
  if (subcommand && subcommand !== 'login') {
    output({ error: `Unknown auth subcommand: '${subcommand}'.` }, 1);
  }

  const noBrowser = args.includes('--no-browser');
  if (args.includes('--device')) {
    await runDeviceLogin(noBrowser);
  } else {
    await runLogin(noBrowser);
  }
}
