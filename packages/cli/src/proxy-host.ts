import { isLoopbackHostname } from '@aluvia/sdk';

export type ParseHostResult = { ok: true; host: string } | { ok: false; error: string };

export function parseRouteHost(input: string): ParseHostResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: 'host is required' };

  let host = trimmed;
  const looksLikeUrl = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) || trimmed.includes('/');
  if (looksLikeUrl) {
    try {
      const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `http://${trimmed}`;
      host = new URL(withScheme).hostname;
    } catch {
      return { ok: false, error: 'host is required' };
    }
  }

  host = host.replace(/\.+$/, '').toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }
  if (!host) return { ok: false, error: 'host is required' };
  if (host === '*') return { ok: false, error: 'catch-all * is not allowed' };
  if (isLoopbackHostname(host)) return { ok: false, error: 'loopback hosts cannot be routed' };
  return { ok: true, host };
}
