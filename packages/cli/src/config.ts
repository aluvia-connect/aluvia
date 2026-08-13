import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Local credential store for the Aluvia CLI.
 *
 * The API key obtained via `aluvia auth` is persisted to
 * `$ALUVIA_HOME/config.json` (default `/workspace/.aluvia` when `/workspace`
 * exists, else `~/.aluvia`) with restrictive permissions. The env var
 * ALUVIA_API_KEY always takes precedence over this file (see api-helpers.ts).
 */

interface AluviaConfig {
  apiKey?: string;
}

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

/**
 * Read the stored API key, if any. Returns undefined when no key is stored.
 */
export function getStoredApiKey(): string | undefined {
  const key = readConfig().apiKey;
  const trimmed = typeof key === 'string' ? key.trim() : '';
  return trimmed ? trimmed : undefined;
}

/**
 * Persist the API key to the config file (mode 0600, dir 0700).
 */
export function saveApiKey(apiKey: string): void {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const config = readConfig();
  config.apiKey = apiKey.trim();

  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2) + '\n', {
    mode: 0o600,
  });
  // writeFileSync only applies mode on creation; enforce it on existing files too.
  try {
    fs.chmodSync(configPath(), 0o600);
  } catch {
    // Best-effort (e.g. on platforms without POSIX permissions).
  }
}

/**
 * Remove the stored API key. Returns true if a key was present.
 */
export function clearApiKey(): boolean {
  const config = readConfig();
  if (!config.apiKey) {
    return false;
  }
  delete config.apiKey;
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2) + '\n', {
    mode: 0o600,
  });
  return true;
}
