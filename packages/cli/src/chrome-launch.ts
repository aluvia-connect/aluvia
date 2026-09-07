import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { DEFAULT_SETUP_URL } from './setup-page.js';
import { readRunningChrome, retainedChromeArgs } from './chrome-process.js';
import { closeChromeGracefully } from './chrome-close.js';

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

const WINDOWS_CANDIDATE_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

function windowsLocalAppDataCandidates(): string[] {
  const localAppData = (process.env.LOCALAPPDATA ?? '').trim();
  if (!localAppData) return [];
  return [
    path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(localAppData, 'Chromium', 'Application', 'chrome.exe'),
  ];
}

export function isWindows(): boolean {
  return process.platform === 'win32';
}

export function detectChromeBinary(): string {
  const override = (process.env.ALUVIA_CHROME ?? '').trim();
  if (override) return override;

  if (isWindows()) {
    for (const candidate of WINDOWS_CANDIDATE_PATHS) {
      if (existsSync(candidate)) return candidate;
    }
    for (const candidate of windowsLocalAppDataCandidates()) {
      if (existsSync(candidate)) return candidate;
    }
    // Last resort: hope chrome.exe is on PATH.
    return 'chrome.exe';
  }

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

function quoteWindowsArg(value: string): string {
  // cmd.exe treats these characters as unquoted metacharacters:
  //   space, tab, ", &, |, <, >, ^, (, ), %, !
  // Any of them in an unquoted argument (a URL with ?a=1&b=2 for example)
  // splits the command line, which corrupts the intent AND lets a caller
  // that influences restoreUrl inject cmd.exe commands into the copy-
  // pasteable chromeCommand.
  //
  // Empty strings must also be quoted, otherwise cmd.exe drops them.
  //
  // Inside a double-quoted token cmd.exe treats &|<>^() literally, so
  // wrapping is enough; embedded double-quotes are escaped as \".
  if (value === '' || /[\s"&|<>^()%!]/.test(value)) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
}

export function chromeLaunchArgs(
  dataPort: number,
  restoreUrl?: string | null,
  existingArgs: string[] = [],
): string[] {
  const args = [
    ...retainedChromeArgs(existingArgs),
    `--proxy-server=http://127.0.0.1:${dataPort}`,
    '--disable-quic',
    '--restore-last-session',
  ];
  args.push(restoreUrl ?? DEFAULT_SETUP_URL);
  return args;
}

/** One shell line: quit existing Chrome, then launch with proxy flags. */
export function chromeRestartCommand(dataPort: number, restoreUrl?: string | null): string {
  if (isWindows()) {
    // cmd.exe one-liner: taskkill is quiet on "process not found" thanks to
    // 2>NUL, so a first-run Chrome-not-open case doesn't surface a stderr.
    const quit = 'taskkill /F /IM chrome.exe /T >NUL 2>NUL';
    const launch = [
      quoteWindowsArg(detectChromeBinary()),
      ...chromeLaunchArgs(dataPort, restoreUrl).map(quoteWindowsArg),
    ].join(' ');
    // Start /B detaches so the caller shell returns immediately, matching
    // the Linux `&`-less spawn behavior via child.unref() below.
    return `${quit} & timeout /T 1 /NOBREAK >NUL & start "" ${launch}`;
  }

  const running = process.platform === 'linux' ? readRunningChrome('/proc', process.env.ALUVIA_CHROME) : null;
  const quit = running
    ? `kill -TERM ${running.pid}`
    : CHROME_PROCESS_NAMES.map((name) => `pkill -x ${name}`).join('; ');
  const launch = [
    quoteShellArg(running?.binary ?? detectChromeBinary()),
    ...chromeLaunchArgs(dataPort, restoreUrl, running?.args).map(quoteShellArg),
  ].join(' ');
  return `${quit}; sleep 1; ${launch}`;
}

export function skipChromeRestart(): boolean {
  return (process.env.ALUVIA_SKIP_CHROME_RESTART ?? '').trim().length > 0;
}

export function quitExistingChrome(pid?: number): void {
  if (pid != null) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // The discovered browser may already have exited.
    }
    return;
  }
  if (isWindows()) {
    // /T kills any child processes (helpers, renderers). Suppress stderr so
    // "process not found" doesn't produce noise.
    spawnSync('taskkill', ['/F', '/IM', 'chrome.exe', '/T'], {
      encoding: 'utf8',
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return;
  }
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

  const running = process.platform === 'linux' ? readRunningChrome('/proc', process.env.ALUVIA_CHROME) : null;
  const closed = running ? await closeChromeGracefully(running) : false;
  if (!closed) quitExistingChrome(running?.pid);
  if (isWindows()) {
    // Give the OS a moment to release the profile lock. spawnSync sleep 1s
    // is fine on Windows too if we shell out, but Node's setTimeout is
    // simpler and doesn't depend on cmd.exe.
    await new Promise((resolve) => setTimeout(resolve, 1000));
  } else {
    spawnSync('sleep', ['1']);
  }

  const bin = running?.binary ?? detectChromeBinary();
  const args = chromeLaunchArgs(dataPort, restoreUrl, running?.args);
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
