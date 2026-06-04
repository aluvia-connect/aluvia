import { AluviaApi, readLock, listSessions, isProcessAlive, removeLock, toLockData } from '@aluvia/sdk';
import type { LockData } from '@aluvia/sdk';
import { output } from './cli.js';
import { getStoredApiKey } from './config.js';

/**
 * Resolve the API key from the ALUVIA_API_KEY env var, falling back to the key
 * stored by `aluvia auth` (~/.aluvia/config.json). The env var always wins.
 */
export function resolveApiKey(): string | undefined {
  const envKey = (process.env.ALUVIA_API_KEY ?? '').trim();
  if (envKey) return envKey;
  return getStoredApiKey();
}

/**
 * Create an AluviaApi instance from the resolved API key.
 * Calls output() and exits if no key is available.
 */
export function requireApi(): AluviaApi {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    return output({ error: 'No API key found. Run `aluvia auth` to log in, or set ALUVIA_API_KEY.' }, 1);
  }
  return new AluviaApi({ apiKey });
}

/**
 * Resolve a session by name or auto-select when only one is running.
 * Calls output() and exits on error (no sessions, ambiguous sessions, stale lock).
 */
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

/**
 * Require a connection ID from lock data.
 * Calls output() and exits if connectionId is missing.
 */
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
