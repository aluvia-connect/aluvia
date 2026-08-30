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
  /** When set, the next status/setup requires a CONNECT after this time. */
  reloadAskedAt: number | null;
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
  lastConnect: LastConnectSnapshot;
  error?: string | null;
  code?: string | null;
  claimUrl?: string | null;
};

export function defaultAttach(): ProxyAttachState {
  return {
    status: 'needs_ui',
    method: null,
    expectConnectAfter: null,
    reloadAskedAt: null,
  };
}

export function defaultLastConnect(): LastConnectSnapshot {
  return { hostname: null, at: null };
}

export function normalizeLastConnect(raw: unknown): LastConnectSnapshot {
  if (!raw || typeof raw !== 'object') return defaultLastConnect();
  const value = raw as Record<string, unknown>;
  const hostname = typeof value.hostname === 'string' && value.hostname.length > 0 ? value.hostname : null;
  const at = typeof value.at === 'number' && Number.isFinite(value.at) ? value.at : null;
  return { hostname, at };
}

function hasConnect(lastConnect: LastConnectSnapshot | undefined): boolean {
  return Boolean(lastConnect?.hostname && lastConnect.at != null);
}

/**
 * Chrome is aimed when attach is verified and a non-loopback CONNECT exists
 * (idle tabs stay aimed), or when lastConnect landed at or after expectConnectAfter
 * even if attach is still needs_ui.
 */
export function isLiveAim(
  attach: ProxyAttachState | undefined,
  lastConnect: LastConnectSnapshot | undefined,
): boolean {
  if (!hasConnect(lastConnect)) return false;
  if (attach?.status === 'verified') return true;
  const expectAfter = attach?.expectConnectAfter ?? null;
  return expectAfter != null && lastConnect!.at! >= expectAfter;
}

export function resolveAimProbe(
  attach: ProxyAttachState,
  lastConnect: LastConnectSnapshot | undefined,
): { aimed: boolean; attach: ProxyAttachState; failed: boolean } {
  const normalized = normalizeAttach(attach);
  const connected = hasConnect(lastConnect);

  if (normalized.status === 'verified' && connected) {
    const stamp = normalized.reloadAskedAt;
    if (stamp == null) {
      return { aimed: true, attach: normalized, failed: false };
    }
    const at = lastConnect!.at!;
    if (at > stamp) {
      return { aimed: true, attach: { ...normalized, reloadAskedAt: null }, failed: false };
    }
    return {
      aimed: false,
      attach: {
        status: 'needs_ui',
        method: normalized.method,
        expectConnectAfter: stamp,
        reloadAskedAt: null,
      },
      failed: true,
    };
  }

  if (
    connected &&
    normalized.expectConnectAfter != null &&
    lastConnect!.at! >= normalized.expectConnectAfter
  ) {
    return {
      aimed: true,
      attach: {
        status: 'verified',
        method: normalized.method,
        expectConnectAfter: normalized.expectConnectAfter,
        reloadAskedAt: null,
      },
      failed: false,
    };
  }

  return { aimed: false, attach: normalized, failed: false };
}

export function nextAsksReload(next: string): boolean {
  return /\breload\b/i.test(next);
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
  const reloadAskedAt =
    typeof value.reloadAskedAt === 'number' && Number.isFinite(value.reloadAskedAt)
      ? value.reloadAskedAt
      : null;
  return { status, method, expectConnectAfter, reloadAskedAt };
}

export function proxyJsonPath(): string {
  return path.join(configDir(), 'proxy.json');
}

export function readProxyJson(): ProxyJson | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(proxyJsonPath(), 'utf8')) as ProxyJson;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      ...parsed,
      attach: normalizeAttach(parsed.attach),
      lastConnect: normalizeLastConnect(parsed.lastConnect),
    };
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
