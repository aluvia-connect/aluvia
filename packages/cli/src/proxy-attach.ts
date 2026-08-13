import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { isLoopbackHostname } from '@aluvia/sdk';
import { controlRequest } from './proxy-control-client.js';
import type { AttachMethod } from './proxy-state.js';

export type ArtifactWrite = {
  wrote: boolean;
  path: string;
  mtimeMs: number;
};

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

export function ensureAttachExtension(extDir: string, dataPort: number): ArtifactWrite {
  const backgroundPath = path.join(extDir, 'background.js');
  const needle = `port: ${dataPort}`;
  if (fs.existsSync(backgroundPath)) {
    const existing = fs.readFileSync(backgroundPath, 'utf8');
    if (existing.includes(needle)) {
      return { wrote: false, path: extDir, mtimeMs: fs.statSync(backgroundPath).mtimeMs };
    }
  }
  writeAttachExtension(extDir, dataPort);
  return { wrote: true, path: extDir, mtimeMs: fs.statSync(backgroundPath).mtimeMs };
}

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

export function pickAttachMethod(opts: { policyPath: string | null; gsettings: boolean }): AttachMethod {
  const policyPath = opts.policyPath ?? '';
  if (policyPath.startsWith('/etc/') || (process.env.ALUVIA_CHROME_POLICY_DIR ?? '').trim().length > 0) {
    return 'policy';
  }
  if (opts.gsettings) return 'gsettings';
  return 'extension';
}

export function attachInstructions(opts: {
  extensionPath: string;
  policyPath: string | null;
  dataPort: number;
}): string {
  const body = JSON.stringify(chromeProxyPolicyBody(opts.dataPort));
  const parts: string[] = [];
  if (opts.policyPath?.startsWith('/etc/')) {
    parts.push(
      `Chrome policy at ${opts.policyPath}. Open chrome://policy → Reload policies. Confirm ProxySettings and QuicAllowed.`,
    );
  } else {
    parts.push(
      `Write the policy yourself (this process often cannot sudo): sudo -n mkdir -p /etc/opt/chrome/policies/managed && echo '${body}' | sudo -n tee /etc/opt/chrome/policies/managed/aluvia-proxy.json. Then chrome://policy → Reload policies. Confirm ProxySettings and QuicAllowed. Home-dir policy is ignored. Do not use chrome://settings/system.`,
    );
  }
  parts.push(
    'Open a new tab to a site, then run `aluvia proxy setup` again. Do not load the unpacked extension unless asked. QuicAllowed needs one Chrome restart at setup.',
  );
  parts.push(
    `After route/unroute, reload the tab (live tunnels for that host are dropped). Extension fallback only if /etc policy cannot be written: chrome://extensions → Load unpacked → ${opts.extensionPath}`,
  );
  return parts.join(' ');
}
