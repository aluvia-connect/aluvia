import {
  AluviaClient,
  writeLock,
  readLock,
  removeLock,
  isProcessAlive,
  getLogFilePath,
  generateSessionName,
  validateSessionName,
} from '@aluvia/sdk';
import type { LockDetection, BlockDetectionResult } from '@aluvia/sdk';
import { output } from './cli.js';
import { resolveApiKey } from './api-helpers.js';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// Determine the directory of this module at load time
// @ts-ignore - import.meta.url exists at runtime in ESM
const thisModuleDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Get the path to cli.js for spawning daemon processes.
 * Looks in the same directory as this module (works for both dev and installed).
 */
function getCliScriptPath(): string {
  // cli.js should be in the same directory as open.js
  const cliPath = path.join(thisModuleDir, 'cli.js');

  if (fs.existsSync(cliPath)) {
    return cliPath;
  }

  throw new Error(`Could not find cli.js at ${cliPath}`);
}

export type OpenOptions = {
  url: string;
  connectionId?: number;
  headless?: boolean;
  sessionName?: string;
  autoUnblock?: boolean;
  disableBlockDetection?: boolean;
  run?: string;
};

/**
 * Called from cli.ts when running `session start <url>`.
 * Spawns the actual browser in a detached child and polls until ready.
 * Returns a Promise that resolves via process.exit() (never returns normally).
 */
export function handleOpen({
  url,
  connectionId,
  headless,
  sessionName,
  autoUnblock,
  disableBlockDetection,
  run,
}: OpenOptions): Promise<never> {
  // Generate session name if not provided
  const session = sessionName ?? generateSessionName();

  // Validate session name early (before spawning daemon)
  if (sessionName && !validateSessionName(sessionName)) {
    output(
      {
        error: 'Invalid session name. Use only letters, numbers, hyphens, and underscores.',
      },
      1,
    );
  }

  // Check for existing instance with this session name
  const existing = readLock(session);
  if (existing !== null && isProcessAlive(existing.pid)) {
    output(
      {
        error: `A browser session named '${session}' is already running.`,
        browserSession: session,
        startUrl: existing.url ?? null,
        cdpUrl: existing.cdpUrl ?? null,
        connectionId: existing.connectionId ?? null,
        pid: existing.pid,
      },
      1,
    );
  }

  // Clean up stale lock if process is dead
  if (existing !== null) {
    removeLock(session);
  }

  // Require API key (env var, falling back to the key stored by `aluvia auth`)
  const apiKey = resolveApiKey();
  if (!apiKey) {
    output({ error: 'No API key found. Run `aluvia auth` to log in, or set ALUVIA_API_KEY.' }, 1);
  }

  // Spawn a detached child process that runs the daemon
  const logFile = getLogFilePath(session);
  const out = fs.openSync(logFile, 'a');

  const args = ['--daemon', url, '--browser-session', session];
  if (connectionId != null) {
    args.push('--connection-id', String(connectionId));
  }
  if (!headless) {
    args.push('--headful');
  }
  if (autoUnblock) {
    args.push('--auto-unblock');
  }
  if (disableBlockDetection) {
    args.push('--disable-block-detection');
  }
  if (run) {
    args.push('--run', run);
  }

  let child: ReturnType<typeof spawn>;
  try {
    // Get the path to cli.js in the same directory as this module
    const cliPath = getCliScriptPath();
    child = spawn(process.execPath, [cliPath, ...args], {
      detached: true,
      stdio: ['ignore', out, out],
      env: { ...process.env, ALUVIA_API_KEY: apiKey },
    });
    child.unref();
  } catch (err: any) {
    fs.closeSync(out);
    return output(
      {
        browserSession: session,
        error: `Failed to spawn browser process: ${err.message}`,
      },
      1,
    );
  }
  fs.closeSync(out);

  // Wait for the daemon to be fully ready (lock file with ready: true)
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const maxAttempts = 240; // 60 seconds max
    const poll = setInterval(() => {
      attempts++;

      try {
        // Early exit if daemon process died
        if (child.pid && !isProcessAlive(child.pid)) {
          clearInterval(poll);
          removeLock(session);
          output(
            {
              browserSession: session,
              error: 'Browser process exited unexpectedly.',
              logFile,
            },
            1,
          );
        }

        const lock = readLock(session);
        if (lock && lock.ready) {
          clearInterval(poll);
          output({
            browserSession: session,
            pid: lock.pid,
            startUrl: lock.url ?? null,
            cdpUrl: lock.cdpUrl ?? null,
            connectionId: lock.connectionId ?? null,
            blockDetection: lock.blockDetection ?? false,
            autoUnblock: lock.autoUnblock ?? false,
          });
        }
        if (attempts >= maxAttempts) {
          clearInterval(poll);
          const alive = child.pid ? isProcessAlive(child.pid) : false;
          output(
            {
              browserSession: session,
              error: alive
                ? 'Browser is still initializing (timeout).'
                : 'Browser process exited unexpectedly.',
              logFile,
            },
            1,
          );
        }
      } catch (err) {
        // In MCP capture mode, output() throws MCPOutputCapture which we need to propagate
        clearInterval(poll);
        reject(err);
      }
    }, 250);
  });
}

/**
 * Daemon entry point — runs in the detached child process.
 * Starts the proxy + browser, writes lock, and stays alive.
 * Logs go to the daemon log file (stdout is redirected), not to the user.
 */
export async function handleOpenDaemon({
  url,
  connectionId,
  headless,
  sessionName,
  autoUnblock,
  disableBlockDetection,
  run,
}: OpenOptions): Promise<void> {
  const apiKey = process.env.ALUVIA_API_KEY!;

  const blockDetectionEnabled = !disableBlockDetection;

  const updateLockWithDetection = (result: BlockDetectionResult) => {
    const lock = readLock(sessionName);
    if (!lock) return;
    const lastDetection: LockDetection = {
      hostname: result.hostname,
      lastUrl: result.url,
      blockStatus: result.blockStatus,
      score: result.score,
      signals: result.signals.map((s) => s.name),
      pass: result.pass,
      persistentBlock: result.persistentBlock,
      timestamp: Date.now(),
    };
    writeLock({ ...lock, lastDetection }, sessionName);
  };

  const client = new AluviaClient({
    apiKey,
    startPlaywright: true,
    ...(connectionId != null ? { connectionId } : {}),
    headless: headless ?? true,
    blockDetection: blockDetectionEnabled
      ? autoUnblock
        ? {
            enabled: true,
            autoUnblock: true,
            onDetection: updateLockWithDetection,
          }
        : { enabled: true, onDetection: updateLockWithDetection }
      : { enabled: false },
  });

  const connection = await client.start();

  // Write early lock so parent knows daemon is alive
  writeLock(
    {
      pid: process.pid,
      session: sessionName,
      url,
      proxyUrl: connection.url,
      blockDetection: blockDetectionEnabled,
      autoUnblock: blockDetectionEnabled && !!autoUnblock,
    },
    sessionName,
  );

  if (autoUnblock) console.log('[daemon] Auto-unblock enabled');
  console.log(`[daemon] Browser initialized — proxy: ${connection.url}`);
  if (connection.cdpUrl) console.log(`[daemon] CDP URL: ${connection.cdpUrl}`);
  if (connectionId != null) console.log(`[daemon] Connection ID: ${connectionId}`);
  if (sessionName) console.log(`[daemon] Session: ${sessionName}`);
  console.log(`[daemon] Opening ${url}`);

  // Navigate to URL in the browser
  const page = await connection.browserContext.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  // Gather session info
  const pageTitle = await page.title().catch(() => '');
  const cdpUrl = connection.cdpUrl ?? '';

  // Get connection ID: use the one passed in, or read from ConfigManager
  const connId: number | undefined = connectionId ?? client.connectionId;

  // Write lock file with full session metadata (marks session as ready)
  // Read existing lock first to preserve lastDetection written by the onDetection callback
  const existingLock = readLock(sessionName);
  writeLock(
    {
      pid: process.pid,
      session: sessionName,
      connectionId: connId,
      cdpUrl,
      proxyUrl: connection.url,
      url,
      ready: true,
      blockDetection: blockDetectionEnabled,
      autoUnblock: blockDetectionEnabled && !!autoUnblock,
      lastDetection: existingLock?.lastDetection,
    },
    sessionName,
  );

  console.log(
    `[daemon] Session ready — session: ${sessionName ?? 'default'}, url: ${url}, cdpUrl: ${cdpUrl}, connectionId: ${connId ?? 'unknown'}, pid: ${process.pid}`,
  );
  if (pageTitle) console.log(`[daemon] Page title: ${pageTitle}`);

  // If --run was provided, execute the script and then shut down
  if (run) {
    const scriptPath = path.resolve(run);
    if (!fs.existsSync(scriptPath)) {
      console.error(`[daemon] Script not found: ${scriptPath}`);
      removeLock(sessionName);
      await connection.close();
      process.exit(1);
    }

    console.log(`[daemon] Running script: ${scriptPath}`);

    // Inject page, browser, context as globals so the script can use them directly
    const browser = connection.browser;
    const context = connection.browserContext;
    (globalThis as any).page = page;
    (globalThis as any).browser = browser;
    (globalThis as any).context = context;

    let exitCode = 0;
    try {
      await import(pathToFileURL(scriptPath).href);
    } catch (err: any) {
      console.error(`[daemon] Script error: ${err.message}`);
      if (err.stack) console.error(err.stack);
      exitCode = 1;
    }

    // Clean up globals
    delete (globalThis as any).page;
    delete (globalThis as any).browser;
    delete (globalThis as any).context;

    console.log(`[daemon] Script finished.`);
    removeLock(sessionName);
    await connection.close();
    process.exit(exitCode);
  }

  // Graceful shutdown handler
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    console.log('[daemon] Shutting down...');
    try {
      await connection.close();
    } catch {
      // ignore
    }
    removeLock(sessionName);
    console.log('[daemon] Stopped.');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Detect when the browser is closed by the user
  if (connection.browser) {
    connection.browser.on('disconnected', () => {
      if (!stopping) {
        console.log('[daemon] Browser closed by user.');
        removeLock(sessionName);
        client
          .stop()
          .catch(() => {})
          .finally(() => process.exit(0));
      }
    });
  }
}
