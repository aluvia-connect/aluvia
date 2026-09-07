/** ipify alone flakes 503 while other echo hosts already succeed on the same session. */
export const DEFAULT_PROBE_URLS = [
  'https://api.ipify.org/',
  'https://ifconfig.me/ip',
  'https://icanhazip.com/',
];

export function probeTargetUrls(): string[] {
  const raw = (process.env.ALUVIA_PROBE_URL ?? '').trim();
  if (raw) return [raw];
  return DEFAULT_PROBE_URLS;
}

/** Hosts used by setup/status/rotate-ip session probes — not client traffic. */
export function isSessionProbeHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return false;
  for (const raw of probeTargetUrls()) {
    try {
      if (new URL(raw).hostname.toLowerCase() === host) return true;
    } catch {
      // ignore invalid probe URL
    }
  }
  return false;
}
