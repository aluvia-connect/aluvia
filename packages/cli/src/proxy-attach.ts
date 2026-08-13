import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isLoopbackHostname } from '@aluvia/sdk';
import { controlRequest } from './proxy-control-client.js';
import type { AttachMethod } from './proxy-state.js';

export function writeAttachExtension(extDir: string, dataPort: number): void {
  fs.mkdirSync(extDir, { recursive: true });
  const manifest = {
    manifest_version: 3,
    name: 'Aluvia proxy',
    version: '1.0.0',
    permissions: ['proxy'],
    background: { service_worker: 'background.js' },
  };
  fs.writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const background = `chrome.proxy.settings.set({
  value: {
    mode: 'fixed_servers',
    rules: {
      singleProxy: { scheme: 'http', host: '127.0.0.1', port: ${dataPort} },
      bypassList: ['localhost', '127.0.0.1', '::1', '<local>'],
    },
  },
  scope: 'regular',
});
`;
  fs.writeFileSync(path.join(extDir, 'background.js'), background);
}

export type PolicyWriteResult = {
  written: boolean;
  path: string | null;
};

export function chromeProxyPolicyBody(dataPort: number): Record<string, string> {
  return {
    ProxyMode: 'fixed_servers',
    ProxyServer: `127.0.0.1:${dataPort}`,
    ProxyBypassList: 'localhost,127.0.0.1,::1,<local>',
  };
}

function policyDirCandidates(): string[] {
  const override = (process.env.ALUVIA_CHROME_POLICY_DIR ?? '').trim();
  if (override) return [override];
  return [
    path.join(os.homedir(), '.config/google-chrome/policies/recommended'),
    path.join(os.homedir(), '.config/google-chrome/policies/managed'),
    path.join(os.homedir(), '.config/chromium/policies/recommended'),
    path.join(os.homedir(), '.config/chromium/policies/managed'),
    '/etc/opt/chrome/policies/recommended',
    '/etc/opt/chrome/policies/managed',
    '/etc/chromium/policies/recommended',
    '/etc/chromium/policies/managed',
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
  if (!dir.startsWith('/etc/')) return false;
  const mkdir = spawnSync('sudo', ['-n', 'mkdir', '-p', dir], { encoding: 'utf8' });
  if (mkdir.status !== 0) return false;
  const tee = spawnSync('sudo', ['-n', 'tee', dest], { input: body, encoding: 'utf8' });
  return tee.status === 0;
}

export function writeChromeProxyPolicy(dataPort: number): PolicyWriteResult {
  const body = JSON.stringify(chromeProxyPolicyBody(dataPort), null, 2) + '\n';
  const filename = 'aluvia-proxy.json';
  for (const dir of policyDirCandidates()) {
    const dest = path.join(dir, filename);
    if (tryWritePolicyFile(dir, dest, body)) {
      return { written: true, path: dest };
    }
  }
  return { written: false, path: null };
}

export async function tryGsettings(dataPort: number): Promise<boolean> {
  const commands: string[][] = [
    ['set', 'org.gnome.system.proxy', 'mode', 'manual'],
    ['set', 'org.gnome.system.proxy.http', 'host', '127.0.0.1'],
    ['set', 'org.gnome.system.proxy.http', 'port', String(dataPort)],
    ['set', 'org.gnome.system.proxy.https', 'host', '127.0.0.1'],
    ['set', 'org.gnome.system.proxy.https', 'port', String(dataPort)],
    ['set', 'org.gnome.system.proxy', 'ignore-hosts', "['localhost','127.0.0.1','::1']"],
  ];
  try {
    for (const args of commands) {
      const result = spawnSync('gsettings', args, { encoding: 'utf8' });
      if (result.error || result.status !== 0) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for a GUI CONNECT that happens at or after `sinceMs`.
 * Pre-existing CONNECTs (including `curl -x` before attach started) do not count.
 */
export async function waitForExternalConnect(opts: { timeoutMs: number; sinceMs: number }): Promise<boolean> {
  const deadline = Date.now() + opts.timeoutMs;
  for (;;) {
    try {
      const res = await controlRequest('GET', '/last-connect');
      const hostname = res.json.hostname;
      const at = typeof res.json.at === 'number' ? res.json.at : null;
      if (typeof hostname === 'string' && hostname.length > 0 && !isLoopbackHostname(hostname)) {
        if (at != null && at >= opts.sinceMs) return true;
      }
    } catch {
      // keep polling until timeout
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await new Promise((resolve) => setTimeout(resolve, Math.min(100, remaining)));
  }
}

export function pickAttachMethod(opts: { policyWritten: boolean; gsettings: boolean }): AttachMethod {
  if (opts.policyWritten) return 'policy';
  if (opts.gsettings) return 'gsettings';
  return 'extension';
}

export function attachInstructions(opts: { extensionPath: string; policyPath: string | null }): string {
  const parts: string[] = [];
  if (opts.policyPath) {
    parts.push(
      `Chrome policy written to ${opts.policyPath}. Open chrome://policy → Reload policies, then open a non-localhost page.`,
    );
  }
  parts.push(
    `Or open chrome://extensions → enable Developer mode → Load unpacked → select ${opts.extensionPath}`,
  );
  parts.push(
    'Then open a new tab to a site (not F5 — Chrome reuses CONNECT tunnels). After `route`/`unroute`, use a new tab the same way.',
  );
  return parts.join(' ');
}
