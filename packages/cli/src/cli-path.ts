import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// @ts-ignore - import.meta.url exists at runtime in ESM (the only build the bin/main uses)
const thisModuleDir = path.dirname(fileURLToPath(import.meta.url));

const INSTALLED_CLI_RE = /(?:^|\/)node_modules\/aluvia-cli\/dist\/esm\/cli\.js$/;

function posixPath(p: string): string {
  return p.replace(/\\/g, '/');
}

export function getCliLaunch(): { execPath: string; prefixArgs: string[]; script: string } {
  const js = path.join(thisModuleDir, 'cli.js');
  if (fs.existsSync(js)) {
    return { execPath: process.execPath, prefixArgs: [], script: js };
  }
  const ts = path.join(thisModuleDir, 'cli.ts');
  if (fs.existsSync(ts)) {
    return { execPath: process.execPath, prefixArgs: ['--import', 'tsx'], script: ts };
  }
  throw new Error(`Could not find cli.js or cli.ts in ${thisModuleDir}`);
}

/** True when `script` is the published package entry, not a git checkout. */
export function isInstalledPackageCliJs(script: string): boolean {
  return INSTALLED_CLI_RE.test(posixPath(path.resolve(script)));
}

function pointsAtCheckout(script: string): boolean {
  const inspect = (p: string): boolean => {
    const norm = posixPath(p);
    if (norm.includes('/node_modules/')) return false;
    return /\/packages\/cli\//.test(norm);
  };
  if (inspect(path.resolve(script))) return true;
  try {
    return inspect(fs.realpathSync(script));
  } catch {
    return false;
  }
}

/** Installed `dist/esm/cli.js` only. Never a `packages/cli` checkout path. */
export function acceptInstalledCliJs(script: string): string | null {
  const abs = path.resolve(script);
  if (!fs.existsSync(abs)) return null;
  if (!isInstalledPackageCliJs(abs)) return null;
  if (pointsAtCheckout(abs)) return null;
  return abs;
}

/**
 * The running `cli.js` when this process is the installed package.
 * Checkout `cli.ts` / `packages/cli/dist` is not a PATH-bin target.
 */
export function resolveInstalledCliJs(): string | null {
  try {
    const accepted = acceptInstalledCliJs(getCliLaunch().script);
    if (accepted) return accepted;
  } catch {
    // no sibling cli.js/ts
  }
  try {
    const req = createRequire(import.meta.url);
    const pkg = req.resolve('aluvia-cli/package.json');
    return acceptInstalledCliJs(path.join(path.dirname(pkg), 'dist', 'esm', 'cli.js'));
  } catch {
    return null;
  }
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function pathBinFile(homedir = os.homedir()): string {
  return path.join(homedir, '.local', 'bin', 'aluvia');
}

/**
 * Write `$HOME/.local/bin/aluvia` (mode 0755) as shebang + exec of the
 * installed package `dist/esm/cli.js`. Overwrites a mode-644 checkout shim.
 * Returns the bin path, or null if there is no installed cli.js to point at.
 */
export function writePathBin(opts?: { homedir?: string; cliJs?: string | null }): string | null {
  const cliJs = opts && 'cliJs' in opts ? (opts.cliJs ?? null) : resolveInstalledCliJs();
  if (!cliJs) return null;
  const accepted = acceptInstalledCliJs(cliJs);
  if (!accepted) return null;
  const homedir = opts?.homedir ?? os.homedir();
  const bin = pathBinFile(homedir);
  try {
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    const body = `#!/usr/bin/env bash\nexec ${shQuote(process.execPath)} ${shQuote(accepted)} "$@"\n`;
    fs.writeFileSync(bin, body, { encoding: 'utf8', mode: 0o755 });
    fs.chmodSync(bin, 0o755);
    return bin;
  } catch {
    return null;
  }
}
