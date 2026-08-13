import crypto from 'node:crypto';
import { handleOpen } from './open.js';
import type { OpenOptions } from './open.js';
import { handleClose } from './close.js';
import { listSessions } from '@aluvia/sdk';
import { requireApi, resolveSession, requireConnectionId, outputIfPaymentRequired } from './api-helpers.js';
import { output } from './cli.js';

export type ParsedSessionArgs = {
  url?: string;
  connectionId?: number;
  headed: boolean;
  sessionName?: string;
  autoUnblock: boolean;
  disableBlockDetection: boolean;
  run?: string;
};

export function parseSessionArgs(args: string[]): ParsedSessionArgs {
  let url: string | undefined;
  let connectionId: number | undefined;
  let headed = false;
  let sessionName: string | undefined;
  let autoUnblock = false;
  let disableBlockDetection = false;
  let run: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--connection-id' && args[i + 1]) {
      const parsed = Number(args[i + 1]);
      if (!Number.isInteger(parsed) || parsed < 1) {
        output(
          {
            error: `Invalid --connection-id: '${args[i + 1]}' must be a positive integer.`,
          },
          1,
        );
      }
      connectionId = parsed;
      i++;
    } else if (args[i] === '--browser-session' && args[i + 1]) {
      sessionName = args[i + 1];
      i++;
    } else if (args[i] === '--run' && args[i + 1]) {
      run = args[i + 1];
      i++;
    } else if (args[i] === '--headful') {
      headed = true;
    } else if (args[i] === '--auto-unblock') {
      autoUnblock = true;
    } else if (args[i] === '--disable-block-detection') {
      disableBlockDetection = true;
    } else if (!url && !args[i].startsWith('--')) {
      url = args[i];
    }
  }

  return {
    url,
    connectionId,
    headed,
    sessionName,
    autoUnblock,
    disableBlockDetection,
    run,
  };
}

export async function handleSession(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (!subcommand) {
    return output({ error: 'Missing session subcommand. Run "aluvia help" for usage.' }, 1);
  }

  switch (subcommand) {
    case 'start':
      return handleSessionStart(args.slice(1));
    case 'close':
      return handleSessionClose(args.slice(1));
    case 'list':
      return handleSessionList();
    case 'get':
      return handleSessionGet(args.slice(1));
    case 'rotate-ip':
      return handleSessionRotateIp(args.slice(1));
    case 'set-geo':
      return handleSessionSetGeo(args.slice(1));
    case 'set-rules':
      return handleSessionSetRules(args.slice(1));
    default:
      return output(
        {
          error: `Unknown session subcommand: '${subcommand}'. Run "aluvia help" for usage.`,
        },
        1,
      );
  }
}

async function handleSessionStart(args: string[]): Promise<void> {
  const parsed = parseSessionArgs(args);

  if (!parsed.url) {
    return output({ error: 'URL is required. Usage: aluvia session start <url> [options]' }, 1);
  }

  const opts: OpenOptions = {
    url: parsed.url,
    connectionId: parsed.connectionId,
    headless: !parsed.headed,
    sessionName: parsed.sessionName,
    autoUnblock: parsed.autoUnblock,
    disableBlockDetection: parsed.disableBlockDetection,
    run: parsed.run,
  };

  // Delegates to the existing open handler (spawns daemon, waits for ready)
  await handleOpen(opts);
}

async function handleSessionClose(args: string[]): Promise<void> {
  let sessionName: string | undefined;
  let all = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--browser-session' && args[i + 1]) {
      sessionName = args[i + 1];
      i++;
    } else if (args[i] === '--all') {
      all = true;
    }
  }

  await handleClose(sessionName, all);
}

function handleSessionList(): never {
  const sessions = listSessions();
  return output({
    sessions: sessions.map((s) => ({
      browserSession: s.session,
      pid: s.pid,
      startUrl: s.url ?? null,
      cdpUrl: s.cdpUrl ?? null,
      connectionId: s.connectionId ?? null,
      blockDetection: s.blockDetection ?? false,
      autoUnblock: s.autoUnblock ?? false,
    })),
    count: sessions.length,
  });
}

async function handleSessionGet(args: string[]): Promise<void> {
  let sessionName: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--browser-session' && args[i + 1]) {
      sessionName = args[i + 1];
      i++;
    }
  }

  const { session, lock } = resolveSession(sessionName);
  const connId = lock.connectionId;

  const base: Record<string, unknown> = {
    browserSession: session,
    pid: lock.pid,
    startUrl: lock.url ?? null,
    cdpUrl: lock.cdpUrl ?? null,
    connectionId: connId ?? null,
    blockDetection: lock.blockDetection ?? false,
    autoUnblock: lock.autoUnblock ?? false,
    lastDetection: lock.lastDetection ?? null,
  };

  // If we have a connection ID, enrich with full connection object from API
  if (connId != null) {
    try {
      const api = requireApi();
      const conn = await api.account.connections.get(connId);
      if (conn) {
        base.connection = conn;
      }
    } catch {
      // API enrichment is best-effort; base lock data is still returned
    }
  }

  return output(base);
}

async function handleSessionRotateIp(args: string[]): Promise<void> {
  let sessionName: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--browser-session' && args[i + 1]) {
      sessionName = args[i + 1];
      i++;
    }
  }

  const { session, lock } = resolveSession(sessionName);
  const connId = requireConnectionId(lock, session);
  const api = requireApi();

  const newSessionId = crypto.randomUUID().replace(/-/g, '');
  try {
    await api.account.connections.patch(connId, { session_id: newSessionId });
  } catch (err) {
    outputIfPaymentRequired(err);
    throw err;
  }

  return output({
    browserSession: session,
    connectionId: connId,
    sessionId: newSessionId,
  });
}

async function handleSessionSetGeo(args: string[]): Promise<void> {
  let sessionName: string | undefined;
  let geo: string | undefined;
  let clear = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--browser-session' && args[i + 1]) {
      sessionName = args[i + 1];
      i++;
    } else if (args[i] === '--clear') {
      clear = true;
    } else if (!geo && !args[i].startsWith('--')) {
      geo = args[i];
    }
  }

  if (!geo && !clear) {
    return output(
      {
        error: 'Geo code is required. Usage: aluvia session set-geo <geo> [--browser-session <name>]',
      },
      1,
    );
  }

  if (geo && !geo.trim()) {
    return output(
      {
        error: 'Geo code cannot be empty. Provide a valid geo code or use --clear.',
      },
      1,
    );
  }

  const { session, lock } = resolveSession(sessionName);
  const connId = requireConnectionId(lock, session);
  const api = requireApi();

  const targetGeo = clear ? null : geo!.trim();
  try {
    await api.account.connections.patch(connId, { target_geo: targetGeo });
  } catch (err) {
    outputIfPaymentRequired(err);
    throw err;
  }

  return output({
    browserSession: session,
    connectionId: connId,
    targetGeo,
  });
}

async function handleSessionSetRules(args: string[]): Promise<void> {
  let sessionName: string | undefined;
  let removeRules: string | undefined;
  let appendRules: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--browser-session' && args[i + 1]) {
      sessionName = args[i + 1];
      i++;
    } else if (args[i] === '--remove' && args[i + 1]) {
      removeRules = args[i + 1];
      i++;
    } else if (!appendRules && !args[i].startsWith('--')) {
      appendRules = args[i];
    }
  }

  if (!appendRules && !removeRules) {
    return output(
      {
        error: 'Rules are required. Usage: aluvia session set-rules <rules> [--browser-session <name>]',
      },
      1,
    );
  }

  if (appendRules && removeRules) {
    return output(
      {
        error: 'Cannot both append and remove rules. Use either <rules> or --remove <rules>, not both.',
      },
      1,
    );
  }

  const { session, lock } = resolveSession(sessionName);
  const connId = requireConnectionId(lock, session);
  const api = requireApi();

  // Fetch current rules
  let conn;
  try {
    conn = await api.account.connections.get(connId);
  } catch (err) {
    outputIfPaymentRequired(err);
    throw err;
  }
  const currentRules: string[] = conn?.rules ?? [];

  let newRules: string[];

  if (removeRules) {
    // Remove mode: filter out specified rules
    const toRemove = new Set(
      removeRules
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean),
    );
    newRules = currentRules.filter((r) => !toRemove.has(r));
  } else {
    // Append mode: add new rules to existing (deduplicate)
    const toAdd = appendRules!
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);
    const existing = new Set(currentRules);
    newRules = [...currentRules, ...toAdd.filter((r) => !existing.has(r))];
  }

  await api.account.connections.patch(connId, { rules: newRules });

  return output({
    browserSession: session,
    connectionId: connId,
    rules: newRules,
    count: newRules.length,
  });
}
