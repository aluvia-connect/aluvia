import { isCapturing } from './output-capture.js';
import { DEFAULT_ALUVIA_META_PIXEL_ID, runMetaPixelBeacon } from './meta-pixel.js';

export { DEFAULT_ALUVIA_META_PIXEL_ID };

export const ALUVIA_INSTALL_EVENT = 'aluvia_install';
export const META_ALUVIA_INSTALL_DEDUPE_FILE = 'meta-aluvia-install-fired';

let pendingBeacon: Promise<void> | undefined;

/** In-flight GET so `output()` can print JSON first, then exit after the beacon. */
export function pendingAluviaInstallBeacon(): Promise<void> | undefined {
  return pendingBeacon;
}

/**
 * Fire-and-forget Meta Pixel GET (`ev=aluvia_install`) once per install id.
 * Swallows all errors. Does not mint ids. Does not rotate session.
 */
export function maybeFireAluviaInstallBeacon(): Promise<void> {
  const run = runMetaPixelBeacon({
    event: ALUVIA_INSTALL_EVENT,
    dedupeFile: META_ALUVIA_INSTALL_DEDUPE_FILE,
  });
  if (!isCapturing()) pendingBeacon = run;
  return run;
}
