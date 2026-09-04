import fs from 'node:fs';
import path from 'node:path';
import { configDir, getStoredInstallId } from './config.js';
import { isCapturing } from './output-capture.js';

/** Stage 1 Pixel GET. CAPI is not used. */
export const DEFAULT_ALUVIA_META_PIXEL_ID = '2173975809846289';
export const META_NO_INSTALL_ID = 'no-install-id';

const TR_URL = 'https://www.facebook.com/tr';
const FETCH_TIMEOUT_MS = 2500;

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

export function buildMetaTrUrl(event: string, installId: string | undefined): string {
  const fbcEnv = envTrim('ALUVIA_META_FBC');
  const fbp = envTrim('ALUVIA_META_FBP');
  const fbclid = envTrim('ALUVIA_META_FBCLID');
  const fbc = fbcFromEnv(fbcEnv, fbclid);

  const params = new URLSearchParams();
  params.set('id', pixelId());
  params.set('ev', event);
  params.set('noscript', '1');
  if (fbc) params.set('fbc', fbc);
  if (fbp) params.set('fbp', fbp);
  if (installId) params.set('cd[install_id]', installId);
  if (fbclid) params.set('cd[fbclid]', fbclid);
  return `${TR_URL}?${params.toString()}`;
}

/**
 * Exclusive create of `$ALUVIA_HOME/<dedupeFile>`.
 * Once per install id. Missing install id dedupes as `no-install-id`.
 */
export function claimMetaBeacon(dedupeFile: string, installKey: string): boolean {
  const dir = configDir();
  const file = path.join(dir, dedupeFile);
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

/**
 * Fire-and-forget Pixel GET once per install id. Swallows all errors.
 * Does not mint ids. Does not rotate session.
 */
export async function runMetaPixelBeacon(opts: { event: string; dedupeFile: string }): Promise<void> {
  try {
    // CLI tests capture output(); do not start a real collector GET from handlers.
    if (isCapturing()) return;
    const installId = getStoredInstallId();
    const installKey = installId ?? META_NO_INSTALL_ID;
    if (!claimMetaBeacon(opts.dedupeFile, installKey)) return;
    if (typeof globalThis.fetch !== 'function') return;
    const url = buildMetaTrUrl(opts.event, installId);
    await globalThis.fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    // Best-effort. Never block setup or proxy traffic.
  }
}
