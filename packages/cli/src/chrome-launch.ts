import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';

const CANDIDATE_NAMES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];

const CANDIDATE_PATHS = [
  '/opt/google/chrome/chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

const CHROME_PROCESS_NAMES = [
  'google-chrome',
  'google-chrome-stable',
  'chrome',
  'chromium',
  'chromium-browser',
];

export function detectChromeBinary(): string {
  const override = (process.env.ALUVIA_CHROME ?? '').trim();
  if (override) return override;

  for (const name of CANDIDATE_NAMES) {
    const found = spawnSync('which', [name], { encoding: 'utf8' });
    if (found.status === 0) {
      const bin = found.stdout.trim();
      if (bin) return bin;
    }
  }
  for (const candidate of CANDIDATE_PATHS) {
    if (existsSync(candidate)) return candidate;
  }
  return 'google-chrome';
}

export function quoteShellArg(value: string): string {
  if (!/[^\w./:=+-]/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function chromeLaunchArgs(dataPort: number, restoreUrl?: string | null): string[] {
  const args = [`--proxy-server=http://127.0.0.1:${dataPort}`, '--disable-quic', '--restore-last-session'];
  if (restoreUrl) args.push(restoreUrl);
  return args;
}

/** One shell line: quit existing Chrome, then launch with proxy flags. */
export function chromeRestartCommand(dataPort: number, restoreUrl?: string | null): string {
  const quit = CHROME_PROCESS_NAMES.map((name) => `pkill -x ${name}`).join('; ');
  const launch = [
    quoteShellArg(detectChromeBinary()),
    ...chromeLaunchArgs(dataPort, restoreUrl).map(quoteShellArg),
  ].join(' ');
  return `${quit}; sleep 1; ${launch}`;
}

export function skipChromeRestart(): boolean {
  return (process.env.ALUVIA_SKIP_CHROME_RESTART ?? '').trim().length > 0;
}

export function quitExistingChrome(): void {
  for (const name of CHROME_PROCESS_NAMES) {
    spawnSync('pkill', ['-x', name], { encoding: 'utf8' });
  }
}

/**
 * Quit this Chrome/Chromium and launch one process with proxy flags.
 * Does not open a second Chrome. Returns launched:false if spawn fails or tests skip it.
 */
export async function tryRestartChrome(
  dataPort: number,
  restoreUrl?: string | null,
): Promise<{ launched: boolean }> {
  if (skipChromeRestart()) return { launched: false };

  quitExistingChrome();
  spawnSync('sleep', ['1']);

  const bin = detectChromeBinary();
  const args = chromeLaunchArgs(dataPort, restoreUrl);
  return await new Promise((resolve) => {
    let settled = false;
    const done = (launched: boolean) => {
      if (settled) return;
      settled = true;
      resolve({ launched });
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, args, { detached: true, stdio: 'ignore' });
    } catch {
      done(false);
      return;
    }
    child.once('error', () => done(false));
    if (child.pid == null) {
      done(false);
      return;
    }
    child.unref();
    setTimeout(() => done(true), 50);
  });
}
