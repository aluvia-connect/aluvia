import { AluviaApi } from '@aluvia/sdk';
import {
  getStoredApiKey,
  getStoredInstallId,
  getStoredUpstream,
  saveApiKey,
  clearApiKey,
  clearUpstream,
} from './config.js';
import { isCapturing, MCPOutputCapture } from './mcp-helpers.js';

const API_URL = 'https://api.aluvia.io';
const DEVICE_FLOW_TIMEOUT_MS = 600_000;
const STORED_KEY_LOCATION = '~/.aluvia/config.json';

function authOutput(data: Record<string, unknown>, exitCode = 0): never {
  if (isCapturing()) {
    throw new MCPOutputCapture(data, exitCode);
  }
  console.log(JSON.stringify(data));
  setTimeout(() => {
    process.exit(exitCode);
  }, 200);
  return undefined as never;
}

function parseAuthKey(args: string[]): string | null | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--key') {
      const value = args[i + 1];
      if (value == null || value.startsWith('-')) return null;
      return value;
    }
  }
  return undefined;
}

async function recycleAfterCredentialChange(): Promise<boolean> {
  const { recycleDaemonIfRunning } = await import('./proxy.js');
  const result = await recycleDaemonIfRunning();
  return result.recycled;
}

function credentialNext(recycled: boolean): string {
  return recycled
    ? 'Reload the tab. Do not restart Chrome.'
    : 'Saved. If Chrome is not aimed yet, run `aluvia setup --url <page>`.';
}

async function finishWithKey(apiKey: string): Promise<never> {
  try {
    const api = new AluviaApi({ apiKey });
    await api.account.get();
    saveApiKey(apiKey);
    clearUpstream();
    const recycled = await recycleAfterCredentialChange();
    return authOutput({
      status: 'authenticated',
      recycled,
      next: credentialNext(recycled),
    });
  } catch (err) {
    if (err instanceof MCPOutputCapture) throw err;
    return authOutput(
      { error: `Received an API key but it failed verification: ${(err as Error).message}` },
      1,
    );
  }
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
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runAuth(): Promise<never> {
  let init: DeviceInit;
  try {
    const installId = getStoredInstallId();
    const response = await fetch(`${API_URL}/auth/cli/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: `aluvia-cli@${process.platform}`,
        ...(installId ? { install_id: installId } : {}),
      }),
    });
    if (!response.ok) throw new Error(`init failed (HTTP ${response.status})`);
    init = (await response.json()) as DeviceInit;
  } catch (err) {
    return authOutput({ error: `Could not start authentication: ${(err as Error).message}` }, 1);
  }

  console.error('Authenticate with Aluvia:\n');
  console.error(`  1. Open: ${init.verification_uri_complete}`);
  console.error(`  2. Confirm this code matches: ${init.user_code}\n`);

  const intervalMs = Math.max(1, init.interval || 5) * 1000;
  const deadline =
    Date.now() + Math.min(init.expires_in * 1000 || DEVICE_FLOW_TIMEOUT_MS, DEVICE_FLOW_TIMEOUT_MS);
  let waitMs = intervalMs;

  while (Date.now() < deadline) {
    await delay(waitMs);
    let status: string;
    let apiKey: string | undefined;
    try {
      const response = await fetch(`${API_URL}/auth/cli/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_code: init.device_code }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        status?: string;
        api_key?: string;
      };
      status = data.status ?? 'error';
      apiKey = data.api_key;
    } catch {
      continue;
    }

    if (status === 'approved' && apiKey) {
      return finishWithKey(apiKey);
    }
    if (status === 'denied') {
      return authOutput({ error: 'Authentication was denied in the browser.' }, 1);
    }
    if (status === 'expired' || status === 'invalid') {
      return authOutput({ error: 'Authentication session expired. Run `aluvia auth` again.' }, 1);
    }
    if (status === 'slow_down') {
      waitMs += 5000;
    }
  }

  return authOutput({ error: 'Timed out waiting for approval. Run `aluvia auth` again.' }, 1);
}

function runStatus(): never {
  const envKey = (process.env.ALUVIA_API_KEY ?? '').trim();
  if (envKey) {
    return authOutput({ authenticated: true, source: 'env', provider: 'aluvia' });
  }
  if (getStoredApiKey()) {
    return authOutput({
      authenticated: true,
      source: 'config',
      provider: 'aluvia',
      configFile: STORED_KEY_LOCATION,
    });
  }
  if (getStoredUpstream()) {
    return authOutput({ authenticated: false, provider: 'custom' });
  }
  if (getStoredInstallId()) {
    return authOutput({ authenticated: false, provider: 'aluvia', trial: true });
  }
  return authOutput({ authenticated: false, provider: 'none' });
}

async function runLogout(): Promise<never> {
  const removed = clearApiKey();
  const recycled = removed ? await recycleAfterCredentialChange() : false;
  return authOutput({
    status: removed ? 'logged_out' : 'not_logged_in',
    configFile: STORED_KEY_LOCATION,
    recycled,
  });
}

export async function handleAuth(args: string[]): Promise<void> {
  if (args.includes('--key')) {
    const key = parseAuthKey(args);
    if (!key) {
      return authOutput({ error: 'Usage: aluvia auth --key <key>' }, 1);
    }
    return finishWithKey(key);
  }

  const subcommand = args.find((argument) => !argument.startsWith('-'));

  if (subcommand === 'status') {
    return runStatus();
  }
  if (subcommand === 'logout') {
    return runLogout();
  }
  if (subcommand) {
    return authOutput({ error: `Unknown auth subcommand: '${subcommand}'.` }, 1);
  }

  return runAuth();
}
