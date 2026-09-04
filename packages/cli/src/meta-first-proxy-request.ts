import { isLoopbackHostname } from './net/loopback.js';
import { DEFAULT_ALUVIA_META_PIXEL_ID, runMetaPixelBeacon } from './meta-pixel.js';
import { isSessionProbeHostname } from './session-probe-hosts.js';

export { DEFAULT_ALUVIA_META_PIXEL_ID };

export const FIRST_PROXY_REQUEST_EVENT = 'first_proxy_request';
export const META_FIRST_PROXY_REQUEST_DEDUPE_FILE = 'meta-first-proxy-request-fired';

export type FirstProxyRequestTrigger = {
  hostname: string;
  viaUpstream: boolean;
  /** HTTP forwarded through upstream. CONNECT uses connectOk instead. */
  isHttp: boolean;
  /** CONNECT tunnel outcome. Ignored for HTTP. */
  connectOk?: boolean;
};

/**
 * True for the first successful client request the local proxy sends through upstream.
 * False for direct/loopback, session probes, failed CONNECT, and command-only paths.
 */
export function isFirstProxyRequestTrigger(info: FirstProxyRequestTrigger): boolean {
  const hostname = info.hostname.trim();
  if (!hostname) return false;
  if (isLoopbackHostname(hostname)) return false;
  if (isSessionProbeHostname(hostname)) return false;
  if (!info.viaUpstream) return false;
  if (info.isHttp) return true;
  return info.connectOk === true;
}

/**
 * Fire-and-forget Meta Pixel GET (`ev=first_proxy_request`) once per install id.
 * Swallows all errors. Does not mint ids. Does not rotate session.
 */
export function maybeFireFirstProxyRequestBeacon(): Promise<void> {
  return runMetaPixelBeacon({
    event: FIRST_PROXY_REQUEST_EVENT,
    dedupeFile: META_FIRST_PROXY_REQUEST_DEDUPE_FILE,
  });
}

/** Call from proxy observers. Never throws; never awaits in the request path. */
export function maybeFireFirstProxyRequestFromTraffic(info: FirstProxyRequestTrigger): void {
  if (!isFirstProxyRequestTrigger(info)) return;
  void maybeFireFirstProxyRequestBeacon();
}
