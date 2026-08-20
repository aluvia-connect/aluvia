import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Local credential store for the Aluvia CLI.
 *
 * `$ALUVIA_HOME/config.json` (default `/workspace/.aluvia` when `/workspace`
 * exists, else `~/.aluvia`) with restrictive permissions.
 *
 * Agents persist credentials with `aluvia auth <key>` and `aluvia proxy-provider`.
 * Resolution order lives in api-helpers.ts: stored/env BYO upstream, then
 * ALUVIA_API_KEY / stored apiKey, then installId. Env vars are optional
 * overrides, not the human/agent path.
 */

export type PendingCliAuth = {
  deviceCode: string;
  userCode: string;
  claimUrl: string;
  interval: number;
  expiresAt: number;
};

export interface AluviaConfig {
  apiKey?: string;
  installId?: string;
  /** Persisted Aluvia account connection. Reused across stop/start; there is no DELETE API. */
  connectionId?: number;
  upstream?: string;
  source?: string;
  cliAuth?: PendingCliAuth;
  /** When true, ignore ALUVIA_UPSTREAM and a stored BYO URL. */
  preferAluvia?: boolean;
}

export type ParsedUpstream = {
  protocol: 'http' | 'https';
  host: string;
  port: number;
  username?: string;
  password?: string;
  href: string;
};

const WORKSPACE_DIR = '/workspace';

export function resolveConfigDir(opts: {
  aluviaHome?: string;
  workspaceExists: boolean;
  homedir: string;
}): string {
  const fromEnv = (opts.aluviaHome ?? '').trim();
  if (fromEnv) return path.resolve(fromEnv);
  if (opts.workspaceExists) return path.resolve(path.join(WORKSPACE_DIR, '.aluvia'));
  return path.join(opts.homedir, '.aluvia');
}

export function configDir(): string {
  return resolveConfigDir({
    aluviaHome: process.env.ALUVIA_HOME,
    workspaceExists: fs.existsSync(WORKSPACE_DIR),
    homedir: os.homedir(),
  });
}

export function configPath(): string {
  return path.join(configDir(), 'config.json');
}

function installIdPath(): string {
  return path.join(configDir(), 'install_id');
}

function readConfig(): AluviaConfig {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') {
      return parsed as AluviaConfig;
    }
  } catch {
    // Missing or unreadable/corrupt config — treat as empty.
  }
  return {};
}

function writeConfig(config: AluviaConfig): void {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2) + '\n', {
    mode: 0o600,
  });
  try {
    fs.chmodSync(configPath(), 0o600);
  } catch {
    // Best-effort (e.g. on platforms without POSIX permissions).
  }
}

export function getStoredApiKey(): string | undefined {
  const key = readConfig().apiKey;
  const trimmed = typeof key === 'string' ? key.trim() : '';
  return trimmed ? trimmed : undefined;
}

export function getStoredInstallId(): string | undefined {
  const fromFile = (() => {
    try {
      return fs.readFileSync(installIdPath(), 'utf8').trim();
    } catch {
      return '';
    }
  })();
  if (/^[a-f0-9]{64}$/.test(fromFile)) return fromFile;

  const fromConfig = (readConfig().installId ?? '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(fromConfig) ? fromConfig : undefined;
}

/**
 * Persist-first install id. Exclusive create of `$ALUVIA_HOME/install_id`
 * so two processes cannot mint two ids.
 */
export function ensureInstallId(): string {
  const existing = getStoredInstallId();
  if (existing) {
    persistInstallId(existing);
    return existing;
  }

  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const generated = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(installIdPath(), generated + '\n', { flag: 'wx', mode: 0o600 });
    persistInstallId(generated);
    return generated;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      const winner = getStoredInstallId();
      if (winner) {
        persistInstallId(winner);
        return winner;
      }
    }
    throw err;
  }
}

function persistInstallId(installId: string): void {
  const config = readConfig();
  if (config.installId === installId) return;
  config.installId = installId;
  writeConfig(config);
}

export function saveApiKey(apiKey: string): void {
  delete process.env.ALUVIA_UPSTREAM;
  const config = readConfig();
  config.apiKey = apiKey.trim();
  config.source = 'auth';
  config.preferAluvia = true;
  delete config.upstream;
  writeConfig(config);
}

export function clearApiKey(): boolean {
  const config = readConfig();
  if (!config.apiKey) {
    return false;
  }
  delete config.apiKey;
  writeConfig(config);
  return true;
}

function parseStoredConnectionId(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) return raw;
  return undefined;
}

/** Account connection id from `$ALUVIA_HOME/config.json`. Survives a wiped proxy.json. */
export function getStoredConnectionId(): number | undefined {
  return parseStoredConnectionId(readConfig().connectionId);
}

export function saveConnectionId(connectionId: number): void {
  const id = parseStoredConnectionId(connectionId);
  if (id == null) return;
  const config = readConfig();
  if (config.connectionId === id) return;
  config.connectionId = id;
  writeConfig(config);
}

export function clearConnectionId(): boolean {
  const config = readConfig();
  if (config.connectionId == null) {
    return false;
  }
  delete config.connectionId;
  writeConfig(config);
  return true;
}

export function getPendingCliAuth(): PendingCliAuth | undefined {
  const raw = readConfig().cliAuth;
  if (!raw || typeof raw !== 'object') return undefined;
  if (typeof raw.deviceCode !== 'string' || typeof raw.claimUrl !== 'string') return undefined;
  if (typeof raw.userCode !== 'string' || typeof raw.expiresAt !== 'number') return undefined;
  if (!Number.isFinite(raw.expiresAt) || raw.expiresAt <= Date.now()) return undefined;
  return {
    deviceCode: raw.deviceCode,
    userCode: raw.userCode,
    claimUrl: raw.claimUrl,
    interval: typeof raw.interval === 'number' && raw.interval > 0 ? raw.interval : 5,
    expiresAt: raw.expiresAt,
  };
}

export function savePendingCliAuth(session: PendingCliAuth): void {
  const config = readConfig();
  config.cliAuth = session;
  writeConfig(config);
}

export function clearPendingCliAuth(): void {
  const config = readConfig();
  if (!config.cliAuth) return;
  delete config.cliAuth;
  writeConfig(config);
}

export function getStoredUpstream(): string | undefined {
  const config = readConfig();
  if (config.preferAluvia) return undefined;
  const fromEnv = (process.env.ALUVIA_UPSTREAM ?? '').trim();
  if (fromEnv) return fromEnv;
  const fromFile = (config.upstream ?? '').trim();
  return fromFile || undefined;
}

export function saveUpstream(upstream: string): ParsedUpstream {
  const parsed = parseUpstreamUrl(upstream);
  const config = readConfig();
  config.upstream = parsed.href;
  config.preferAluvia = false;
  writeConfig(config);
  return parsed;
}

export function clearUpstream(): boolean {
  const envWas = Boolean((process.env.ALUVIA_UPSTREAM ?? '').trim());
  delete process.env.ALUVIA_UPSTREAM;
  const config = readConfig();
  const fileWas = Boolean(config.upstream);
  const alreadyPreferred = config.preferAluvia === true && !fileWas;
  delete config.upstream;
  config.preferAluvia = true;
  writeConfig(config);
  return envWas || fileWas || !alreadyPreferred;
}

export function parseUpstreamUrl(raw: string): ParsedUpstream {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('Invalid upstream URL. Use http(s)://user:pass@host:port');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Invalid upstream URL. Use http(s)://user:pass@host:port');
  }
  if (!url.hostname) {
    throw new Error('Invalid upstream URL. Host is required.');
  }
  const protocol = url.protocol === 'https:' ? 'https' : 'http';
  const port = url.port ? Number(url.port) : protocol === 'https' ? 443 : 80;
  const username = url.username ? decodeURIComponent(url.username) : undefined;
  const password = url.password ? decodeURIComponent(url.password) : undefined;
  return {
    protocol,
    host: url.hostname,
    port,
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
    href: url.href,
  };
}
