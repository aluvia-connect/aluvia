import { AluviaApi } from './net/aluvia-api.js';
import { PaymentRequiredError } from './net/errors.js';
import {
  getStoredApiKey,
  getStoredInstallId,
  getStoredUpstream,
  saveApiKey,
  clearUpstream,
  getPendingCliAuth,
  savePendingCliAuth,
  clearPendingCliAuth,
  configPath,
  type PendingCliAuth,
} from './config.js';
import { credentialNext } from './api-helpers.js';
import { output } from './cli.js';
import { OutputCapture } from './output-capture.js';

const DEFAULT_API_URL = 'https://api.aluvia.io';
const DEFAULT_CLAIM_URL = 'https://dashboard.aluvia.io/cli-auth';
const DEVICE_FLOW_TIMEOUT_MS = 600_000;

export const PAYMENT_REQUIRED_NEXT =
  'Show claim_url to the human. Then run `aluvia auth login` to wait until they finish. When that succeeds, retry.';

/** Used only when the API sent no 402 message (offline, proxy, truncated body). */
const PAYMENT_REQUIRED_FALLBACK =
  'Trial data is used up. Show the human claim_url. They open it on their machine, create an account or sign in, Authorize, then Buy data if asked.';

function apiBaseUrl(): string {
  const fromEnv = (process.env.ALUVIA_API_BASE_URL ?? '').trim();
  return (fromEnv || DEFAULT_API_URL).replace(/\/$/, '');
}

const AUTH_USAGE = 'Usage: aluvia auth <key> | aluvia auth login | aluvia auth status';

async function recycleAfterCredentialChange(): Promise<boolean> {
  const { recycleDaemonIfRunning } = await import('./proxy.js');
  const result = await recycleDaemonIfRunning();
  return result.recycled;
}

function aluviaApiOptions(apiKey: string): { apiKey: string; apiBaseUrl?: string } {
  const fromEnv = (process.env.ALUVIA_API_BASE_URL ?? '').trim();
  return fromEnv ? { apiKey, apiBaseUrl: fromEnv } : { apiKey };
}

async function finishWithKey(apiKey: string): Promise<never> {
  try {
    const api = new AluviaApi(aluviaApiOptions(apiKey));
    await api.account.get();
  } catch (err) {
    if (err instanceof OutputCapture) throw err;
    if (err instanceof PaymentRequiredError) {
      return output(await paymentRequiredPayload(err), 1);
    }
    return output({ error: `Received an API key but it failed verification: ${(err as Error).message}` }, 1);
  }

  saveApiKey(apiKey);
  clearUpstream();
  try {
    const recycled = await recycleAfterCredentialChange();
    return output({
      status: 'authenticated',
      recycled,
      next: credentialNext(recycled),
    });
  } catch (err) {
    if (err instanceof OutputCapture) throw err;
    return output(
      {
        status: 'authenticated',
        recycled: false,
        error: `API key saved but the daemon failed to restart: ${(err as Error).message}`,
        next: 'Key is saved. Run `aluvia start` or `aluvia setup`.',
      },
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
  // Prefer the server's wording. It distinguishes an exhausted trial from a
  // paid account with an empty balance, and telling a paying customer their
  // "trial" is used up sends them down the wrong path. `next` carries the
  // agent instruction either way.
  return {
    error: err.message.trim() || PAYMENT_REQUIRED_FALLBACK,
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
    return output(
      {
        error: `Could not start authentication: ${(err as Error).message}`,
        next: 'Run `aluvia auth login` again.',
      },
      1,
    );
  }

  if (!alreadyShown) {
    console.error('Authenticate with Aluvia:\n');
    console.error(`  Open: ${session.claimUrl}\n`);
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
    if (status === 'approved') {
      clearPendingCliAuth();
      return output(
        {
          error: 'Authentication succeeded but no API key was returned. Run `aluvia auth login` again.',
          next: 'Run `aluvia auth login` again.',
        },
        1,
      );
    }
    if (status === 'denied') {
      clearPendingCliAuth();
      return output(
        {
          error: 'Authentication was denied in the browser.',
          next: 'Ask the human to try again. Then run `aluvia auth login`.',
        },
        1,
      );
    }
    if (status === 'expired' || status === 'invalid') {
      clearPendingCliAuth();
      return output(
        {
          error: 'Authentication session expired. Run `aluvia auth login` again.',
          next: 'Run `aluvia auth login` again.',
        },
        1,
      );
    }
    if (status === 'slow_down') {
      waitMs += 5000;
    }
  }

  return output(
    {
      error: 'Timed out waiting for approval. Run `aluvia auth login` again.',
      next: 'Run `aluvia auth login` again.',
    },
    1,
  );
}

function runStatus(): never {
  if (getStoredUpstream()) {
    return output({
      authenticated: false,
      provider: 'custom',
      next: 'Using a pasted proxy URL. Run `aluvia proxy-provider aluvia` to use Aluvia again.',
    });
  }
  const envKey = (process.env.ALUVIA_API_KEY ?? '').trim();
  if (envKey) {
    return output({
      authenticated: true,
      source: 'env',
      provider: 'aluvia',
      next: 'Authenticated. Run `aluvia status`.',
    });
  }
  if (getStoredApiKey()) {
    return output({
      authenticated: true,
      source: 'config',
      provider: 'aluvia',
      configFile: configPath(),
      next: 'Authenticated. Run `aluvia status`.',
    });
  }
  if (getStoredInstallId()) {
    return output({
      authenticated: false,
      provider: 'aluvia',
      trial: true,
      next: 'On a free trial. Run `aluvia setup` if Chrome is not aimed. If you see payment_required, show claim_url then `aluvia auth login`.',
    });
  }
  return output({
    authenticated: false,
    provider: 'none',
    next: 'No credentials yet. Run `aluvia setup` to start a trial.',
  });
}

export async function handleAuth(args: string[]): Promise<void> {
  if (args.includes('--key')) {
    return output({ error: AUTH_USAGE, next: AUTH_USAGE }, 1);
  }

  const subcommand = args.find((argument) => !argument.startsWith('-'));
  if (!subcommand) {
    return output({ error: AUTH_USAGE, next: AUTH_USAGE }, 1);
  }
  if (subcommand === 'status') {
    return runStatus();
  }
  if (subcommand === 'login') {
    return runAuth();
  }
  if (subcommand === 'logout') {
    return output({ error: AUTH_USAGE, next: AUTH_USAGE }, 1);
  }

  return finishWithKey(subcommand);
}
