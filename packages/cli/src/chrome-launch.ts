import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const CANDIDATE_NAMES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];

const CANDIDATE_PATHS = [
  '/opt/google/chrome/chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
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

export function chromeRestartCommand(dataPort: number, restoreUrl?: string | null): string {
  const bin = quoteShellArg(detectChromeBinary());
  const parts = [
    bin,
    `--proxy-server=http://127.0.0.1:${dataPort}`,
    '--disable-quic',
    '--restore-last-session',
  ];
  if (restoreUrl) parts.push(quoteShellArg(restoreUrl));
  return parts.join(' ');
}
