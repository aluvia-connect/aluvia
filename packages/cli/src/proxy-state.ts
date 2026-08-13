import fs from 'node:fs';
import path from 'node:path';
import { configDir } from './config.js';

export const DEFAULT_DATA_PORT = 18787;
export const DEFAULT_CONTROL_PORT = 18788;

export type AttachStatus = 'unverified' | 'verified' | 'needs_ui';
export type AttachMethod = 'gsettings' | 'extension' | 'policy' | null;

export type LastConnectSnapshot = {
  hostname: string | null;
  at: number | null;
};

export type ProxyAttachState = {
  status: AttachStatus;
  method: AttachMethod;
  verifiedAt: string | null;
  extensionPath: string | null;
};

export type ProxyJson = {
  pid: number | null;
  ready: boolean;
  dataPort: number;
  controlPort: number;
  proxyUrl: string;
  controlUrl: string;
  connectionId: number | null;
  sessionId: string | null;
  targetGeo: string | null;
  rules: string[];
  attach: ProxyAttachState;
};

export function defaultAttach(_home?: string): ProxyAttachState {
  return {
    status: 'unverified',
    method: null,
    verifiedAt: null,
    extensionPath: null,
  };
}

export function proxyJsonPath(): string {
  return path.join(configDir(), 'proxy.json');
}

export function readProxyJson(): ProxyJson | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(proxyJsonPath(), 'utf8')) as ProxyJson;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeProxyJson(data: ProxyJson): void {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const filePath = proxyJsonPath();
  const tmpPath = filePath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
    try {
      fs.rmSync(filePath, { force: true });
    } catch {
      // Windows overwrite
    }
    fs.renameSync(tmpPath, filePath);
  } finally {
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      // ignore
    }
  }
}
