// ProxyServer - Local HTTP proxy using proxy-chain

import { Server as ProxyChainServer } from 'proxy-chain';
import type { AddressInfo } from 'net';
import type { ConfigManager } from './ConfigManager.js';
import type { LogLevel } from './types.js';
import { Logger } from './logger.js';
import { ProxyStartError } from '../errors.js';
import { shouldProxy, shouldProxyNormalized } from './rules.js';
import { isLoopbackHostname } from './loopback.js';

/**
 * Result of starting the proxy server.
 */
export type ProxyServerInfo = {
  host: string;
  port: number;
  url: string;
};

/**
 * ProxyServer manages the local HTTP(S) proxy that routes traffic
 * through Aluvia or directly based on rules.
 */
export class ProxyServer {
  private server: ProxyChainServer | null = null;
  private readonly configManager: ConfigManager;
  private readonly logger: Logger;
  private readonly bindHost = '127.0.0.1';
  private static readonly NO_CONFIG_WARN_INTERVAL_MS = 30_000;
  private lastNoConfigWarnAt = 0;
  private suppressedNoConfigWarnCount = 0;
  private requestObserver: ((hostname: string) => void) | null = null;

  setRequestObserver(fn: ((hostname: string) => void) | null): void {
    this.requestObserver = fn;
  }

  constructor(configManager: ConfigManager, options?: { logLevel?: LogLevel }) {
    this.configManager = configManager;
    this.logger = new Logger(options?.logLevel ?? 'info');
  }

  /**
   * Start the local proxy server.
   *
   * @param port - Optional port to listen on. If not provided, OS assigns a free port.
   * @returns ProxyServerInfo with host, port, and url
   * @throws ProxyStartError if server fails to start
   */
  async start(port?: number): Promise<ProxyServerInfo> {
    const listenPort = port ?? 0;

    try {
      this.server = new ProxyChainServer({
        // Security: bind to loopback only (proxy-chain defaults to 0.0.0.0 if host is omitted)
        host: this.bindHost,
        port: listenPort,
        prepareRequestFunction: this.handleRequest.bind(this),
      });

      await this.server.listen();

      // Get the actual port (especially important when port was 0)
      const address = this.server.server.address() as AddressInfo;
      const actualPort = address.port;

      const info: ProxyServerInfo = {
        host: this.bindHost,
        port: actualPort,
        url: `http://${this.bindHost}:${actualPort}`,
      };

      this.logger.info(`Proxy server listening on ${info.url}`);
      return info;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new ProxyStartError(`Failed to start proxy server: ${message}`);
    }
  }

  /**
   * Stop the local proxy server.
   */
  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    try {
      await this.server.close(true);
      this.logger.info('Proxy server stopped');
    } finally {
      this.server = null;
    }
  }

  /**
   * Handle incoming proxy requests.
   * Decides whether to route through Aluvia or direct.
   */
  private handleRequest(params: {
    request: {
      url?: string;
      headers?: Record<string, string | string[] | undefined>;
    };
    hostname?: string;
    port?: number;
    isHttp?: boolean;
  }): { upstreamProxyUrl: string } | undefined {
    // Extract hostname
    const hostname = this.extractHostname(params);
    if (hostname) {
      this.requestObserver?.(hostname);
    }

    // Get current config
    const config = this.configManager.getConfig();

    if (!config) {
      const now = Date.now();
      const shouldWarn =
        this.lastNoConfigWarnAt === 0 ||
        now - this.lastNoConfigWarnAt >= ProxyServer.NO_CONFIG_WARN_INTERVAL_MS;

      if (shouldWarn) {
        const suppressed = this.suppressedNoConfigWarnCount;
        this.suppressedNoConfigWarnCount = 0;
        this.lastNoConfigWarnAt = now;

        const suffix = suppressed > 0 ? ` (suppressed ${suppressed} similar warnings)` : '';
        this.logger.warn(`No config available, bypassing proxy (direct)${suffix}`);
      } else {
        this.suppressedNoConfigWarnCount += 1;
        this.logger.debug('No config available, bypassing proxy (direct)');
      }
      return undefined;
    }

    if (!hostname) {
      this.logger.debug('Could not extract hostname, going direct');
      return undefined;
    }

    if (isLoopbackHostname(hostname)) {
      this.logger.debug(`Hostname ${hostname} is loopback, going direct`);
      return undefined;
    }

    // Check if we should proxy this hostname (use pre-normalized rules if available)
    const useProxy = config.normalizedRules
      ? shouldProxyNormalized(hostname, config.normalizedRules)
      : shouldProxy(hostname, config.rules);

    if (!useProxy) {
      this.logger.debug(`Hostname ${hostname} bypassing proxy (direct)`);
      return undefined;
    }

    // Build upstream proxy URL
    const { protocol, host, port, username, password } = config.rawProxy;
    const upstreamProxyUrl = `${protocol}://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;

    this.logger.debug(`Hostname ${hostname} routing through Aluvia`);

    return { upstreamProxyUrl };
  }

  /**
   * Extract hostname from request parameters.
   */
  private extractHostname(params: {
    request: {
      url?: string;
      headers?: Record<string, string | string[] | undefined>;
    };
    hostname?: string;
    port?: number;
    isHttp?: boolean;
  }): string | null {
    // For CONNECT requests (HTTPS), hostname is provided directly
    if (typeof params.hostname === 'string') {
      const trimmed = params.hostname.trim();
      if (trimmed.length > 0) return trimmed;
    }

    const urlLikeRaw = params.request?.url;
    if (typeof urlLikeRaw === 'string') {
      const urlLike = urlLikeRaw.trim();
      if (urlLike.length > 0) {
        const fromUrlLike = (() => {
          try {
            return new URL(urlLike).hostname;
          } catch {
            // continue
          }

          if (urlLike.startsWith('//')) {
            try {
              return new URL(`http:${urlLike}`).hostname;
            } catch {
              // continue
            }
          }

          if (urlLike.startsWith('/')) {
            return null;
          }

          try {
            return new URL(`http://${urlLike}`).hostname;
          } catch {
            return null;
          }
        })();

        if (fromUrlLike) return fromUrlLike;
      }
    }

    // For origin-form URLs, fall back to Host header if available.
    const hostHeader = (() => {
      const headers = params.request?.headers;
      if (!headers) return null;
      const host = headers['host'];
      if (Array.isArray(host)) return typeof host[0] === 'string' ? host[0] : null;
      return typeof host === 'string' ? host : null;
    })();

    if (hostHeader) {
      const value = hostHeader.trim();
      if (!value) return null;

      if (value.startsWith('[')) {
        const end = value.indexOf(']');
        if (end > 1) return value.slice(1, end);
        return null;
      }

      const hostOnly = value.split(':')[0]?.trim();
      return hostOnly && hostOnly.length > 0 ? hostOnly : null;
    }

    return null;
  }
}
