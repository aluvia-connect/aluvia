import { AluviaApi, PaymentRequiredError } from '@aluvia/sdk';
import {
  getStoredApiKey,
  getStoredInstallId,
  getStoredUpstream,
  saveApiKey,
  clearUpstream,
  getPendingCliAuth,
  savePendingCliAuth,
  clearPendingCliAuth,
  type PendingCliAuth,
} from './config.js';
import { isCapturing, MCPOutputCapture } from './mcp-helpers.js';

const DEFAULT_API_URL = 'https://api.aluvia.io';
const DEFAULT_CLAIM_URL = 'https://dashboard.aluvia.io/cli-auth';
const DEVICE_FLOW_TIMEOUT_MS = 600_000;
const STORED_KEY_LOCATION = '~/.aluvia/config.json';

export const PAYMENT_REQUIRED_NEXT =
  'Show claim_url to the human. Then run `aluvia auth login` to wait until they finish. When that succeeds, retry.';

function apiBaseUrl(): string {
  const fromEnv = (process.env.ALUVIA_API_BASE_URL ?? '').trim();
  return (fromEnv || DEFAULT_API_URL).replace(/\/$/, '');
}

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

const AUTH_USAGE = 'Usage: aluvia auth <key> | aluvia auth login | aluvia auth status';

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

export async function ensureDeviceAuthSession(): Promise<PendingCliAuth> {
  const existing = getPendingCliAuth();
  if (existing) return existing;

  const installId = getStoredInstallId();
  const response = await fetch(`${apiBaseUrl()}/auth/cli/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      label: `aluvia-cli@${process.platform}`,
      ...(installId ? { install_id: installId } : {}),
    }),
  });
  if (!response.ok) throw new Error(`init failed (HTTP ${response.status})`);
  const init = (await response.json()) as DeviceInit;
  const claimUrl =
    typeof init.verification_uri_complete === 'string' && init.verification_uri_complete
      ? init.verification_uri_complete
      : `${DEFAULT_CLAIM_URL}?cli_code=${init.user_code}`;
  const expiresInMs = Math.min((init.expires_in || 600) * 1000, DEVICE_FLOW_TIMEOUT_MS);
  const session: PendingCliAuth = {
    deviceCode: init.device_code,
    userCode: init.user_code,
    claimUrl,
    interval: Math.max(1, init.interval || 5),
    expiresAt: Date.now() + expiresInMs,
  };
  savePendingCliAuth(session);
  return session;
}

export async function paymentRequiredPayload(err: PaymentRequiredError): Promise<Record<string, unknown>> {
  let claimUrl = err.claimUrl || DEFAULT_CLAIM_URL;
  try {
    claimUrl = (await ensureDeviceAuthSession()).claimUrl;
  } catch {
    // Keep the API claim_url if device-flow init is down.
  }
  return {
    error:
      'Trial data is used up. Show the human claim_url. They open it on their machine, create an account or sign in, Authorize, then Buy data if asked.',
    code: 'payment_required',
    claim_url: claimUrl,
    next: PAYMENT_REQUIRED_NEXT,
  };
}

async function runAuth(): Promise<never> {
  const alreadyShown = getPendingCliAuth() != null;
  let session: PendingCliAuth;
  try {
    session = await ensureDeviceAuthSession();
  } catch (err) {
    return authOutput({ error: `Could not start authentication: ${(err as Error).message}` }, 1);
  }

  if (!alreadyShown) {
    console.error('Authenticate with Aluvia:\n');
    console.error(`  1. Open: ${session.claimUrl}`);
    console.error(`  2. Confirm this code matches: ${session.userCode}\n`);
  }

  const intervalMs = session.interval * 1000;
  const deadline = Math.min(session.expiresAt, Date.now() + DEVICE_FLOW_TIMEOUT_MS);
  let waitMs = intervalMs;

  while (Date.now() < deadline) {
    await delay(waitMs);
    let status: string;
    let apiKey: string | undefined;
    try {
      const response = await fetch(`${apiBaseUrl()}/auth/cli/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_code: session.deviceCode }),
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
      clearPendingCliAuth();
      return finishWithKey(apiKey);
    }
    if (status === 'denied') {
      clearPendingCliAuth();
      return authOutput({ error: 'Authentication was denied in the browser.' }, 1);
    }
    if (status === 'expired' || status === 'invalid') {
      clearPendingCliAuth();
      return authOutput({ error: 'Authentication session expired. Run `aluvia auth login` again.' }, 1);
    }
    if (status === 'slow_down') {
      waitMs += 5000;
    }
  }

  return authOutput({ error: 'Timed out waiting for approval. Run `aluvia auth login` again.' }, 1);
}

function runStatus(): never {
  if (getStoredUpstream()) {
    return authOutput({ authenticated: false, provider: 'custom' });
  }
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
  if (getStoredInstallId()) {
    return authOutput({ authenticated: false, provider: 'aluvia', trial: true });
  }
  return authOutput({ authenticated: false, provider: 'none' });
}

export async function handleAuth(args: string[]): Promise<void> {
  if (args.includes('--key')) {
    return authOutput({ error: AUTH_USAGE }, 1);
  }

  const subcommand = args.find((argument) => !argument.startsWith('-'));
  if (!subcommand) {
    return authOutput({ error: AUTH_USAGE }, 1);
  }
  if (subcommand === 'status') {
    return runStatus();
  }
  if (subcommand === 'login') {
    return runAuth();
  }

  return finishWithKey(subcommand);
}
