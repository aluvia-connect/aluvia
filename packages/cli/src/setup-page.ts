/** A small HTTPS page with no account, target URL, or website deployment required. */
export const DEFAULT_SETUP_URL = 'https://example.com/';

/** Automatic browser setup is not evidence of a customer's first proxy request. */
export function isSetupPageHostname(hostname: string): boolean {
  return hostname.trim().toLowerCase().replace(/\.$/, '') === new URL(DEFAULT_SETUP_URL).hostname;
}
