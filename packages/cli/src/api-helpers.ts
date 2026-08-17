import { AluviaApi } from './net/aluvia-api.js';
import { output } from './cli.js';
import {
  ensureInstallId,
  getStoredApiKey,
  getStoredUpstream,
  parseUpstreamUrl,
  type ParsedUpstream,
} from './config.js';

export type Credential =
  | { kind: 'byo'; upstream: ParsedUpstream }
  | { kind: 'token'; apiKey: string }
  | { kind: 'install'; installId: string };

/**
 * BYO upstream wins, then ALUVIA_API_KEY / stored key, then a sticky install id.
 */
export function resolveCredential(): Credential {
  const upstreamRaw = getStoredUpstream();
  if (upstreamRaw) {
    return { kind: 'byo', upstream: parseUpstreamUrl(upstreamRaw) };
  }
  const envKey = (process.env.ALUVIA_API_KEY ?? '').trim();
  if (envKey) return { kind: 'token', apiKey: envKey };
  const stored = getStoredApiKey();
  if (stored) return { kind: 'token', apiKey: stored };
  return { kind: 'install', installId: ensureInstallId() };
}

export function requireApi(): AluviaApi {
  const cred = resolveCredential();
  if (cred.kind === 'byo') {
    return output(
      {
        error: 'This command needs the Aluvia network. Run `aluvia proxy-provider aluvia`.',
        next: 'Run `aluvia proxy-provider aluvia`, then retry.',
      },
      1,
    );
  }
  const fromEnv = (process.env.ALUVIA_API_BASE_URL ?? '').trim();
  const apiBaseUrl = fromEnv || undefined;
  if (cred.kind === 'token') {
    return new AluviaApi({ apiKey: cred.apiKey, ...(apiBaseUrl ? { apiBaseUrl } : {}) });
  }
  return new AluviaApi({ installId: cred.installId, ...(apiBaseUrl ? { apiBaseUrl } : {}) });
}

export function credentialNext(recycled: boolean): string {
  return recycled
    ? 'Reload the tab. Do not restart Chrome.'
    : 'Saved. If Chrome is not aimed yet, run `aluvia setup`.';
}
