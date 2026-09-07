import fs from 'node:fs';
import path from 'node:path';

export type RunningChrome = { pid: number; binary: string; args: string[] };

export function chromeArgValue(args: string[], flag: string): string | null {
  const i = args.findIndex((arg) => arg === flag || arg.startsWith(`${flag}=`));
  if (i < 0) return null;
  return args[i] === flag ? (args[i + 1] ?? null) : args[i].slice(flag.length + 1);
}

export function chromeDebugPort(browser: RunningChrome): number | null {
  const raw = chromeArgValue(browser.args, '--remote-debugging-port');
  if (raw == null) return null;
  let port = Number(raw);
  if (port === 0) {
    const profile = chromeArgValue(browser.args, '--user-data-dir');
    if (!profile) return null;
    try {
      port = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
    } catch {
      return null;
    }
  }
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

const BROWSER_NAMES = new Set([
  'chrome',
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
]);

/** Linux exposes exact argv boundaries, including profiles with spaces, in /proc. */
export function readRunningChrome(procDir = '/proc', binaryOverride?: string): RunningChrome | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(procDir);
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const dir = path.join(procDir, entry);
    try {
      if (process.getuid && fs.statSync(dir).uid !== process.getuid()) continue;
      const binary = fs.readlinkSync(path.join(dir, 'exe'));
      if (!BROWSER_NAMES.has(path.basename(binary))) continue;
      if (binaryOverride && fs.realpathSync(binaryOverride) !== binary) continue;
      const [, ...args] = fs.readFileSync(path.join(dir, 'cmdline'), 'utf8').split('\0').filter(Boolean);
      if (args.some((arg) => arg === '--type' || arg.startsWith('--type='))) continue;
      return { pid: Number(entry), binary, args };
    } catch {
      // Process exited or belongs to another user. Continue discovery.
    }
  }
  return null;
}

/** Preserve the agent's profile and browser-control flags; replace routing and startup pages. */
export function retainedChromeArgs(args: string[]): string[] {
  const withValue = new Set(['--proxy-server', '--proxy-pac-url', '--proxy-bypass-list']);
  const switches = new Set([
    '--no-proxy-server',
    '--proxy-auto-detect',
    '--restore-last-session',
    '--no-startup-window',
  ]);
  const kept: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const name = arg.split('=')[0];
    if (withValue.has(name)) {
      if (arg === name && args[i + 1] && !args[i + 1].startsWith('--')) i++;
      continue;
    }
    if (switches.has(name) || /^(?:https?:|about:|chrome:)/i.test(arg)) continue;
    kept.push(arg);
  }
  return kept;
}
