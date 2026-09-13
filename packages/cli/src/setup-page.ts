/** HTTPS echo page so a bare setup tab shows the proxied exit IP. */
export const DEFAULT_SETUP_URL = 'https://aluvia-ip.aluvia.workers.dev/';

/** Automatic browser setup is not evidence of a customer's first proxy request. */
export function isSetupPageHostname(hostname: string): boolean {
  return hostname.trim().toLowerCase().replace(/\.$/, '') === new URL(DEFAULT_SETUP_URL).hostname;
}
