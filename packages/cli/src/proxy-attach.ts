import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { isLoopbackHostname } from '@aluvia/sdk';
import { controlRequest } from './proxy-control-client.js';

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

export async function waitForExternalConnect(opts: { timeoutMs: number }): Promise<boolean> {
  try {
    await controlRequest('POST', '/last-connect', {});
  } catch {
    // daemon may be restarting; GET poll still times out to needs_ui
  }
  const deadline = Date.now() + opts.timeoutMs;
  for (;;) {
    try {
      const res = await controlRequest('GET', '/last-connect');
      const hostname = res.json.hostname;
      if (typeof hostname === 'string' && hostname.length > 0 && !isLoopbackHostname(hostname)) {
        return true;
      }
    } catch {
      // keep polling until timeout
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await new Promise((resolve) => setTimeout(resolve, Math.min(100, remaining)));
  }
}
