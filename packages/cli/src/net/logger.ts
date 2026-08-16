import type { LogLevel } from './types.js';

/**
 * Simple logger that respects log levels.
 *
 * Log level hierarchy:
 * - 'silent': only error() logs
 * - 'info': info(), warn(), error() log
 * - 'debug': all methods log
 */
export class Logger {
  private readonly level: LogLevel;

  constructor(level: LogLevel) {
    this.level = level;
  }

  /**
   * Log informational messages.
   * Logs when level is 'info' or 'debug'.
   */
  info(...args: unknown[]): void {
    if (this.level === 'info' || this.level === 'debug') {
      console.log('[aluvia][info]', ...args);
    }
  }

  /**
   * Log debug messages.
   * Logs only when level is 'debug'.
   */
  debug(...args: unknown[]): void {
    if (this.level === 'debug') {
      console.debug('[aluvia][debug]', ...args);
    }
  }

  /** Check if debug logging is enabled. */
  get isDebug(): boolean {
    return this.level === 'debug';
  }

  /**
   * Log warning messages.
   * Logs when level is not 'silent'.
   */
  warn(...args: unknown[]): void {
    if (this.level !== 'silent') {
      console.warn('[aluvia][warn]', ...args);
    }
  }

  /**
   * Log error messages.
   * Always logs regardless of level.
   */
  error(...args: unknown[]): void {
    console.error('[aluvia][error]', ...args);
  }
}
