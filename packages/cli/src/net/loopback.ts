const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) return false;
  const unbracketed =
    normalized.startsWith('[') && normalized.endsWith(']') ? normalized.slice(1, -1) : normalized;
  return LOOPBACK.has(unbracketed);
}
