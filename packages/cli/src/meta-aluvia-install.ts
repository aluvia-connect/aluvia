import fs from 'node:fs';
import path from 'node:path';
import { configDir, getStoredInstallId } from './config.js';
import { isCapturing } from './output-capture.js';

/** Stage 1 Pixel GET. CAPI is not used. */
export const DEFAULT_ALUVIA_META_PIXEL_ID = '2173975809846289';
export const ALUVIA_INSTALL_EVENT = 'aluvia_install';
export const META_ALUVIA_INSTALL_DEDUPE_FILE = 'meta-aluvia-install-fired';

const TR_URL = 'https://www.facebook.com/tr';
const NO_INSTALL_ID = 'no-install-id';
const FETCH_TIMEOUT_MS = 2500;

let pendingBeacon: Promise<void> | undefined;

function envTrim(name: string): string {
  return (process.env[name] ?? '').trim();
}

function pixelId(): string {
  return envTrim('ALUVIA_META_PIXEL_ID') || DEFAULT_ALUVIA_META_PIXEL_ID;
}

/** Prefer env fbc. If only fbclid is present, build fbc — never invent fbc/fbp/fbclid. */
function fbcFromEnv(fbc: string, fbclid: string): string | undefined {
  if (fbc) return fbc;
  if (!fbclid) return undefined;
  return `fb.1.${Date.now()}.${fbclid}`;
}

function buildTrUrl(installId: string | undefined): string {
  const fbcEnv = envTrim('ALUVIA_META_FBC');
  const fbp = envTrim('ALUVIA_META_FBP');
  const fbclid = envTrim('ALUVIA_META_FBCLID');
  const fbc = fbcFromEnv(fbcEnv, fbclid);

  const params = new URLSearchParams();
  params.set('id', pixelId());
  params.set('ev', ALUVIA_INSTALL_EVENT);
  params.set('noscript', '1');
  if (fbc) params.set('fbc', fbc);
  if (fbp) params.set('fbp', fbp);
  if (installId) params.set('cd[install_id]', installId);
  if (fbclid) params.set('cd[fbclid]', fbclid);
  return `${TR_URL}?${params.toString()}`;
}

/**
 * Exclusive create of `$ALUVIA_HOME/meta-aluvia-install-fired`.
 * Once per install id. Missing install id dedupes as `no-install-id`.
 */
function claimInstallBeacon(installKey: string): boolean {
  const dir = configDir();
  const file = path.join(dir, META_ALUVIA_INSTALL_DEDUPE_FILE);
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, installKey + '\n', { flag: 'wx', mode: 0o600 });
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST') return false;
    try {
      const existing = fs.readFileSync(file, 'utf8').trim();
      if (existing === installKey) return false;
      fs.writeFileSync(file, installKey + '\n', { mode: 0o600 });
      return true;
    } catch {
      return false;
    }
  }
}

async function fireAluviaInstallBeacon(): Promise<void> {
  try {
    // CLI tests capture output(); do not start a real collector GET from handleSetup.
    if (isCapturing()) return;
    const installId = getStoredInstallId();
    const installKey = installId ?? NO_INSTALL_ID;
    if (!claimInstallBeacon(installKey)) return;
    if (typeof globalThis.fetch !== 'function') return;
    const url = buildTrUrl(installId);
    await globalThis.fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    // Best-effort. Never block setup.
  }
}

/** In-flight GET so `output()` can print JSON first, then exit after the beacon. */
export function pendingAluviaInstallBeacon(): Promise<void> | undefined {
  return pendingBeacon;
}

/**
 * Fire-and-forget Meta Pixel GET (`ev=aluvia_install`) once per install id.
 * Swallows all errors. Does not mint ids. Does not rotate session.
 */
export function maybeFireAluviaInstallBeacon(): Promise<void> {
  const run = fireAluviaInstallBeacon();
  if (!isCapturing()) pendingBeacon = run;
  return run;
}
