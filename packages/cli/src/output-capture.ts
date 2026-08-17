/**
 * Test output capture.
 *
 * CLI handlers call `output()` which normally does `console.log` + `process.exit()`.
 * Tests switch `output()` to throw OutputCapture so they can read the JSON
 * without exiting the process.
 *
 * Uses AsyncLocalStorage so concurrent captures do not interfere.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/** Thrown by output() when in capture mode. */
export class OutputCapture {
  constructor(
    public readonly data: Record<string, unknown>,
    public readonly exitCode: number,
  ) {}
}

const captureContext = new AsyncLocalStorage<boolean>();

export function isCapturing(): boolean {
  return captureContext.getStore() ?? false;
}

/**
 * Run a CLI handler in capture mode.
 * Returns the data that output() would have written to stdout.
 */
export async function captureOutput(
  fn: () => Promise<void> | void,
): Promise<{ data: Record<string, unknown>; isError: boolean }> {
  return captureContext.run(true, async () => {
    try {
      await fn();
      return {
        data: { error: 'Handler did not produce output' },
        isError: true,
      };
    } catch (err) {
      if (err instanceof OutputCapture) {
        return {
          data: err.data,
          isError: err.exitCode !== 0,
        };
      }
      return {
        data: { error: err instanceof Error ? err.message : String(err) },
        isError: true,
      };
    }
  });
}
