import fs from 'node:fs';
import path from 'node:path';
import { configDir } from './config.js';

export const DEFAULT_DATA_PORT = 18787;
export const DEFAULT_CONTROL_PORT = 18788;

export type AttachStatus = 'needs_ui' | 'verified';
export type AttachMethod = 'policy' | 'flags' | null;

export type ProxyEgress = 'aluvia' | 'direct';

export function egressFromRules(rules: string[] | undefined): ProxyEgress {
  return (rules ?? []).some((rule) => rule.trim() === '*') ? 'aluvia' : 'direct';
}

export type LastConnectSnapshot = {
  hostname: string | null;
  at: number | null;
};

export type ProxyAttachState = {
  status: AttachStatus;
  method: AttachMethod;
  /** Only CONNECTs at or after this timestamp can mark attach verified. */
  expectConnectAfter: number | null;
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
  error?: string | null;
  code?: string | null;
  claimUrl?: string | null;
};

export function defaultAttach(): ProxyAttachState {
  return {
    status: 'needs_ui',
    method: null,
    expectConnectAfter: null,
  };
}

export function normalizeAttach(raw: unknown): ProxyAttachState {
  const base = defaultAttach();
  if (!raw || typeof raw !== 'object') return base;
  const value = raw as Record<string, unknown>;
  const status: AttachStatus = value.status === 'verified' ? 'verified' : 'needs_ui';
  const method: AttachMethod = value.method === 'policy' || value.method === 'flags' ? value.method : null;
  const expectConnectAfter =
    typeof value.expectConnectAfter === 'number' && Number.isFinite(value.expectConnectAfter)
      ? value.expectConnectAfter
      : null;
  return { status, method, expectConnectAfter };
}

export function proxyJsonPath(): string {
  return path.join(configDir(), 'proxy.json');
}

export function readProxyJson(): ProxyJson | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(proxyJsonPath(), 'utf8')) as ProxyJson;
    if (!parsed || typeof parsed !== 'object') return null;
    return { ...parsed, attach: normalizeAttach(parsed.attach) };
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
