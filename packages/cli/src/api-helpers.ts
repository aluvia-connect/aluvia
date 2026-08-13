import { AluviaApi, PaymentRequiredError, readLock, listSessions, isProcessAlive, removeLock, toLockData } from '@aluvia/sdk';
import type { LockData } from '@aluvia/sdk';
import { output } from './cli.js';
import {
  ensureInstallId,
  getStoredApiKey,
  getStoredUpstream,
  parseUpstreamUrl,
  type ParsedUpstream,
} from './config.js';

export type Credential =
  | { kind: 'byo'; upstream: ParsedUpstream }
  | { kind: 'token'; apiKey: string }
  | { kind: 'install'; installId: string };

/**
 * BYO upstream wins, then ALUVIA_API_KEY / stored key, then a sticky install id.
 */
export function resolveCredential(): Credential {
  const upstreamRaw = getStoredUpstream();
  if (upstreamRaw) {
    return { kind: 'byo', upstream: parseUpstreamUrl(upstreamRaw) };
  }
  const envKey = (process.env.ALUVIA_API_KEY ?? '').trim();
  if (envKey) return { kind: 'token', apiKey: envKey };
  const stored = getStoredApiKey();
  if (stored) return { kind: 'token', apiKey: stored };
  return { kind: 'install', installId: ensureInstallId() };
}

/** @deprecated Use resolveCredential(). Kept for call sites that only need a token. */
export function resolveApiKey(): string | undefined {
  const envKey = (process.env.ALUVIA_API_KEY ?? '').trim();
  if (envKey) return envKey;
  return getStoredApiKey();
}

export function requireApi(): AluviaApi {
  const cred = resolveCredential();
  if (cred.kind === 'byo') {
    return output(
      {
        error:
          'This command needs the Aluvia network. Run `aluvia upstream --clear`, then `aluvia auth`.',
      },
      1,
    );
  }
  if (cred.kind === 'token') {
    return new AluviaApi({ apiKey: cred.apiKey });
  }
  return new AluviaApi({ installId: cred.installId });
}

export function paymentRequiredOutput(err: unknown): Record<string, unknown> | null {
  if (err instanceof PaymentRequiredError) {
    return {
      error: err.message,
      code: 'payment_required',
      claim_url: err.claimUrl,
    };
  }
  return null;
}

export function outputIfPaymentRequired(err: unknown): void {
  const payload = paymentRequiredOutput(err);
  if (payload) output(payload, 1);
}

export function resolveSession(sessionName?: string): {
  session: string;
  lock: LockData;
} {
  if (sessionName) {
    const lock = readLock(sessionName);
    if (!lock) {
      return output({ error: `No session found with name '${sessionName}'.` }, 1);
    }
    if (!isProcessAlive(lock.pid)) {
      removeLock(sessionName);
      return output(
        {
          error: `Session '${sessionName}' is no longer running (stale lock cleaned up).`,
        },
        1,
      );
    }
    return { session: sessionName, lock };
  }

  const sessions = listSessions();
  if (sessions.length === 0) {
    return output({ error: 'No running browser sessions found.' }, 1);
  }
  if (sessions.length > 1) {
    return output(
      {
        error: 'Multiple sessions running. Specify --browser-session <name>.',
        browserSessions: sessions.map((s) => s.session),
      },
      1,
    );
  }

  const s = sessions[0];
  return { session: s.session, lock: toLockData(s) };
}

export function requireConnectionId(lock: LockData, session: string): number {
  if (lock.connectionId == null) {
    return output(
      {
        error: `Session '${session}' has no connection ID. It may have been started without API access.`,
      },
      1,
    );
  }
  return lock.connectionId;
}
