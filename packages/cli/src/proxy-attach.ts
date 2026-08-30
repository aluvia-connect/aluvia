import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { isLoopbackHostname } from './net/loopback.js';
import { controlRequest } from './proxy-control-client.js';
import { isWindows } from './chrome-launch.js';

export type PolicyWriteResult = {
  wrote: boolean;
  path: string | null;
  mtimeMs: number | null;
};

export type ChromeProxyPolicyBody = {
  ProxySettings: {
    ProxyMode: string;
    ProxyServer: string;
    ProxyBypassList: string;
  };
  QuicAllowed: boolean;
};

export function chromeProxyPolicyBody(dataPort: number): ChromeProxyPolicyBody {
  return {
    ProxySettings: {
      ProxyMode: 'fixed_servers',
      ProxyServer: `127.0.0.1:${dataPort}`,
      ProxyBypassList: 'localhost,127.0.0.1,::1,<local>',
    },
    QuicAllowed: false,
  };
}

function policyDirCandidates(): string[] {
  const override = (process.env.ALUVIA_CHROME_POLICY_DIR ?? '').trim();
  if (override) return [override];

  if (isWindows()) {
    // Chrome for Windows reads managed policies from ProgramData. Writing
    // here requires an elevated shell; if the write fails, setup falls
    // back to launching Chrome with --proxy-server flags directly. Do NOT
    // fall back to any /etc/... Linux path — the writeFileSync would
    // "succeed" writing to C:\etc\... which Chrome never reads (issue #24).
    const programData = (process.env.PROGRAMDATA ?? 'C:\\ProgramData').trim();
    return [path.join(programData, 'Google', 'Chrome', 'Policies', 'Managed')];
  }

  // Branded Chrome on Linux reads /etc/opt/chrome. Managed is what the
  // Grok Bot image already uses. Home-dir policy files are ignored — do
  // not write them (they make setup report a useless policyPath).
  return [
    '/etc/opt/chrome/policies/managed',
    '/etc/opt/chrome/policies/recommended',
    '/etc/chromium/policies/managed',
    '/etc/chromium/policies/recommended',
  ];
}

function tryWritePolicyFile(dir: string, dest: string, body: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(dest, body);
    return true;
  } catch {
    // fall through to sudo for system dirs
  }
  if (isWindows()) {
    // Elevation on Windows is out of scope for a background daemon; report
    // failure so the caller uses the launch-flags path instead.
    return false;
  }
  if (!dir.startsWith('/etc/')) return false;
  const mkdir = spawnSync('sudo', ['-n', 'mkdir', '-p', dir], { encoding: 'utf8' });
  if (mkdir.status !== 0) return false;
  const tee = spawnSync('sudo', ['-n', 'tee', dest], { input: body, encoding: 'utf8' });
  return tee.status === 0;
}

function policyFileMtime(dest: string): number | null {
  try {
    return fs.statSync(dest).mtimeMs;
  } catch {
    return null;
  }
}

export function writeChromeProxyPolicy(dataPort: number): PolicyWriteResult {
  const expected = chromeProxyPolicyBody(dataPort);
  const filename = 'aluvia-proxy.json';
  for (const dir of policyDirCandidates()) {
    const dest = path.join(dir, filename);
    try {
      if (fs.existsSync(dest)) {
        const parsed = JSON.parse(fs.readFileSync(dest, 'utf8')) as {
          ProxySettings?: { ProxyServer?: string; ProxyMode?: string };
          QuicAllowed?: boolean;
        };
        if (
          parsed.ProxySettings?.ProxyServer === expected.ProxySettings.ProxyServer &&
          parsed.ProxySettings?.ProxyMode === expected.ProxySettings.ProxyMode &&
          parsed.QuicAllowed === false
        ) {
          return { wrote: false, path: dest, mtimeMs: policyFileMtime(dest) };
        }
      }
    } catch {
      // rewrite below
    }
  }
  const body = JSON.stringify(expected, null, 2) + '\n';
  for (const dir of policyDirCandidates()) {
    const dest = path.join(dir, filename);
    if (tryWritePolicyFile(dir, dest, body)) {
      return { wrote: true, path: dest, mtimeMs: policyFileMtime(dest) ?? Date.now() };
    }
  }
  return { wrote: false, path: null, mtimeMs: null };
}

export const DEFAULT_ATTACH_WAIT_MS = 30_000;

/** Explicit `ALUVIA_ATTACH_WAIT_MS`, or null to use `DEFAULT_ATTACH_WAIT_MS`. */
export function attachWaitOverrideMs(): number | null {
  const raw = (process.env.ALUVIA_ATTACH_WAIT_MS ?? '').trim();
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 1) return n;
  return null;
}

export function attachWaitMs(): number {
  return attachWaitOverrideMs() ?? DEFAULT_ATTACH_WAIT_MS;
}

/**
 * Wait for a GUI CONNECT that happens at or after `sinceMs`.
 * Pre-existing CONNECTs (including `curl -x` before attach started) do not count.
 * lastConnect after sinceMs proves Chrome reached the local proxy (aimed).
 * 590/503 is not ready — that is the session probe, not this wait.
 */
export async function waitForExternalConnect(opts: { timeoutMs: number; sinceMs: number }): Promise<boolean> {
  const deadline = Date.now() + opts.timeoutMs;
  for (;;) {
    try {
      const res = await controlRequest('GET', '/last-connect');
      const hostname = res.json.hostname;
      const at = typeof res.json.at === 'number' ? res.json.at : null;
      const recent =
        typeof hostname === 'string' &&
        hostname.length > 0 &&
        !isLoopbackHostname(hostname) &&
        at != null &&
        at >= opts.sinceMs;
      if (recent) return true;
    } catch {
      // keep polling until timeout
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await new Promise((resolve) => setTimeout(resolve, Math.min(100, remaining)));
  }
}
