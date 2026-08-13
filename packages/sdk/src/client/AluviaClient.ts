// AluviaClient - Main public class for Aluvia Client

import type { AluviaClientConnection, AluviaClientOptions, GatewayProtocol, LogLevel } from './types.js';
import { ConfigManager } from './ConfigManager.js';
import { ProxyServer } from './ProxyServer.js';
import { ApiError, MissingApiKeyError } from '../errors.js';
import {
  createNodeProxyAgents,
  createUndiciDispatcher,
  createUndiciFetch,
  toAxiosConfig,
  toGotOptions,
  toPlaywrightProxySettings,
  toPuppeteerArgs,
  toSeleniumArgs,
} from './adapters.js';
import { Logger } from './logger.js';
import { AluviaApi } from '../api/AluviaApi.js';
import { BlockDetection, type BlockDetectionResult } from './BlockDetection.js';
import * as net from 'node:net';

export type NetworkState = {
  connectionId: number | undefined;
  sessionId: string | null;
  targetGeo: string | null;
  rules: string[];
};

/**
 * AluviaClient is the main entry point for the Aluvia Client.
 *
 * It manages the local proxy server and configuration polling.
 */
export class AluviaClient {
  private readonly options: AluviaClientOptions;
  private readonly configManager: ConfigManager;
  private readonly proxyServer: ProxyServer;
  private connection: AluviaClientConnection | null = null;
  private started = false;
  private startPromise: Promise<AluviaClientConnection> | null = null;
  private readonly logger: Logger;
  public readonly api: AluviaApi;
  private blockDetection: BlockDetection | null = null;
  private pageStates = new WeakMap<
    any,
    {
      lastResponse: any;
      lastAnalysisTs: number;
      skipFullPass: boolean;
      fastResult: BlockDetectionResult | null;
    }
  >();
  /** Promise-based mutex to serialize handleDetectionResult's critical section. */
  private _detectionMutex: Promise<void> = Promise.resolve();

  /** Read-only access to the connection ID from ConfigManager. */
  get connectionId(): number | undefined {
    return this.configManager.connectionId;
  }

  getNetworkState(): NetworkState {
    const config = this.configManager.getConfig();
    return {
      connectionId: this.connectionId,
      sessionId: config?.sessionId ?? null,
      targetGeo: config?.targetGeo ?? null,
      rules: config?.rules ?? [],
    };
  }

  constructor(options: AluviaClientOptions) {
    const apiKey = String(options.apiKey ?? '').trim();
    if (!apiKey) {
      throw new MissingApiKeyError('Aluvia apiKey is required');
    }

    const strict = options.strict ?? true;
    this.options = { ...options, apiKey, strict };

    const connectionId = options.connectionId != null ? Number(options.connectionId) : undefined;
    if (connectionId !== undefined && !Number.isFinite(connectionId)) {
      throw new Error('connectionId must be a finite number');
    }

    const apiBaseUrl = options.apiBaseUrl ?? 'https://api.aluvia.io/v1';
    const pollIntervalMs = Math.max(options.pollIntervalMs ?? 5000, 1000);
    const timeoutMs = options.timeoutMs;
    const gatewayProtocol: GatewayProtocol = options.gatewayProtocol ?? 'http';
    const gatewayPort = options.gatewayPort ?? (gatewayProtocol === 'https' ? 8443 : 8080);
    const logLevel: LogLevel = options.logLevel ?? 'info';

    this.logger = new Logger(logLevel);

    // Create ConfigManager
    this.configManager = new ConfigManager({
      apiKey,
      apiBaseUrl,
      pollIntervalMs,
      gatewayProtocol,
      gatewayPort,
      gatewayHost: options.gatewayHost,
      logLevel,
      connectionId,
      strict,
    });

    // Create ProxyServer
    this.proxyServer = new ProxyServer(this.configManager, { logLevel });

    this.api = new AluviaApi({
      apiKey,
      apiBaseUrl,
      timeoutMs,
    });

    // Initialize block detection if configured
    if (options.blockDetection !== undefined || options.startPlaywright) {
      this.logger.debug('Initializing block detection');
      const detectionConfig = options.blockDetection ?? { enabled: true };
      this.blockDetection = new BlockDetection(detectionConfig, this.logger);
    }
  }

  /**
   * Attaches per-page listeners for two-pass detection and SPA navigation.
   */
  private attachPageListeners(page: any): void {
    const pageState = {
      lastResponse: null as any,
      lastAnalysisTs: 0,
      skipFullPass: false,
      fastResult: null as BlockDetectionResult | null,
    };
    this.pageStates.set(page, pageState);

    // Capture navigation responses on main frame
    page.on('response', (response: any) => {
      try {
        if (response.request().isNavigationRequest() && response.request().frame() === page.mainFrame()) {
          pageState.lastResponse = response;
          pageState.skipFullPass = false;
          pageState.fastResult = null;
        }
      } catch {
        // Ignore errors
      }
    });

    // Fast pass at domcontentloaded
    page.on('domcontentloaded', async () => {
      if (!this.blockDetection) return;
      try {
        const result = await this.blockDetection.analyzeFast(page, pageState.lastResponse);
        pageState.fastResult = result;
        pageState.lastAnalysisTs = Date.now();

        if (result.score >= 0.9) {
          pageState.skipFullPass = true;
          await this.handleDetectionResult(result, page);
        }
      } catch (error: any) {
        this.logger.warn(`Error in fast-pass detection: ${error.message}`);
      }
    });

    // Full pass at load
    page.on('load', async () => {
      if (!this.blockDetection || pageState.skipFullPass) return;
      try {
        // Wait for networkidle with timeout cap
        try {
          await page.waitForLoadState('networkidle', {
            timeout: this.blockDetection.getNetworkIdleTimeoutMs(),
          });
        } catch {
          // Timeout is ok, proceed anyway
        }

        const result = await this.blockDetection.analyzeFull(
          page,
          pageState.lastResponse,
          pageState.fastResult ?? undefined,
        );
        pageState.lastAnalysisTs = Date.now();

        await this.handleDetectionResult(result, page);
      } catch (error: any) {
        this.logger.warn(`Error in full-pass detection: ${error.message}`);
      }
    });

    // SPA detection via framenavigated
    page.on('framenavigated', async (frame: any) => {
      if (!this.blockDetection) return;
      try {
        // Only handle main frame
        if (frame !== page.mainFrame()) return;

        // Debounce per-page
        const now = Date.now();
        if (now - pageState.lastAnalysisTs < 200) return;

        // Wait 50ms and check if a new response arrived
        const responseBefore = pageState.lastResponse;
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (pageState.lastResponse !== responseBefore) return; // Not SPA

        const result = await this.blockDetection.analyzeSpa(page);
        pageState.lastAnalysisTs = Date.now();

        await this.handleDetectionResult(result, page);
      } catch (error: any) {
        this.logger.warn(`Error in SPA detection: ${error.message}`);
      }
    });
  }

  /**
   * Attaches page listeners to all existing and future pages in a context.
   */
  private attachBlockDetectionListener(context: any): void {
    this.logger.debug('Attaching block detection listener to context');

    // Attach to existing pages
    try {
      const existingPages = context.pages();
      for (const page of existingPages) {
        this.attachPageListeners(page);
        // Check if page has already loaded (not about:blank)
        if (page.url() !== 'about:blank' && this.blockDetection) {
          this.blockDetection
            .analyzeFull(page, null)
            .then((result: BlockDetectionResult) => {
              return this.handleDetectionResult(result, page);
            })
            .catch((error: any) => {
              this.logger.warn(`Error analyzing existing page: ${error.message}`);
            });
        }
      }
    } catch {
      // Ignore errors
    }

    // Attach to future pages
    context.on('page', (page: any) => {
      this.logger.debug(`New page detected: ${page.url()}`);
      this.attachPageListeners(page);
    });
  }

  /**
   * Handle a detection result: fire callback, check persistent block, reload if needed.
   *
   * The auto-unblock critical section (persistent-block checks, rule updates, page reload)
   * is serialized via a promise-based mutex to prevent concurrent calls from reading stale
   * state and producing duplicate rule additions or missed persistent-block escalation.
   */
  private async handleDetectionResult(result: BlockDetectionResult, page: any): Promise<void> {
    if (!this.blockDetection) return;

    // Fire user's onDetection callback for all tiers (including clear).
    // Pass a shallow clone so later internal mutations (e.g. persistentBlock)
    // don't affect the object the user received.
    // This runs outside the mutex so user code can execute concurrently
    // without risk of deadlock if it triggers navigation.
    const onDetection = this.blockDetection.getOnDetection();
    if (onDetection) {
      try {
        const snapshot = { ...result, signals: [...result.signals] };
        await onDetection(snapshot, page);
      } catch (error: any) {
        this.logger.warn(`Error in onDetection callback: ${error.message}`);
      }
    }

    // If auto-reload is disabled, stop here (detection-only mode)
    if (!this.blockDetection.isAutoUnblock()) return;

    // Check if auto-reload should fire for this blockStatus
    const shouldReload =
      result.blockStatus === 'blocked' ||
      (result.blockStatus === 'suspected' && this.blockDetection.isAutoUnblockOnSuspected());

    if (!shouldReload) return;

    // Serialize the critical section: persistent-block state, rule updates, reload.
    // This prevents concurrent handlers from reading stale retriedUrls/persistentHostnames.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const acquired = this._detectionMutex;
    this._detectionMutex = this._detectionMutex.then(() => gate);

    await acquired;
    try {
      await this._handleAutoUnblock(result, page);
    } finally {
      release();
    }
  }

  /**
   * Auto-unblock critical section. Must only be called under _detectionMutex.
   */
  private async _handleAutoUnblock(result: BlockDetectionResult, page: any): Promise<void> {
    const url = result.url;
    const hostname = result.hostname;

    // Check persistent block escalation
    if (this.blockDetection!.persistentHostnames.has(hostname)) {
      result.persistentBlock = true;
      this.logger.warn(`Persistent block on ${hostname}, skipping reload`);
      return;
    }

    if (this.blockDetection!.retriedUrls.has(url)) {
      // Second block for this URL - mark hostname as persistent
      result.persistentBlock = true;
      this.blockDetection!.persistentHostnames.add(hostname);
      this.logger.warn(`Persistent block detected for ${hostname} after retry of ${url}`);
      return;
    }

    // First block for this URL — cap set size to prevent unbounded growth
    if (this.blockDetection!.retriedUrls.size >= 10_000) {
      this.blockDetection!.retriedUrls.clear();
    }
    this.blockDetection!.retriedUrls.add(url);

    // Add hostname to proxy routing rules
    try {
      const config = this.configManager.getConfig();
      const currentRules = config?.rules ?? [];
      if (!currentRules.includes(hostname)) {
        this.logger.info(
          `Auto-adding ${hostname} to routing rules due to detection (blockStatus: ${result.blockStatus})`,
        );
        await this.updateRules([...currentRules, hostname]);
      }
    } catch (error: any) {
      this.logger.warn(`Failed to auto-add rule for ${hostname}: ${error.message}`);
    }

    // Reload page
    try {
      this.logger.info(`Reloading page after adding ${hostname} to rules`);
      await page.reload();
    } catch (error: any) {
      this.logger.warn(`Failed to reload page for ${hostname}: ${error.message}`);
    }
  }

  /**
   * Start the Aluvia Client connection:
   * - Fetch initial account connection config from Aluvia.
   * - Start polling for config updates.
   * - Start a local HTTP proxy on 127.0.0.1:<localPort or free port>.
   *
   * Returns the active connection with host/port/url and a stop() method.
   */
  async start(): Promise<AluviaClientConnection> {
    // Return existing connection if already started
    if (this.started && this.connection) {
      return this.connection;
    }

    // If a start is already in-flight, await it.
    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = (async () => {
      // Fetch initial configuration (may throw InvalidApiKeyError or ApiError)
      await this.configManager.init();

      const browserInstance = this.options.startPlaywright ? await this._initPlaywright() : undefined;

      // Keep config fresh so routing decisions update without restarting.
      this.configManager.startPolling();

      try {
        const { host, port, url } = await this.proxyServer.start(this.options.localPort);

        let nodeAgents: ReturnType<typeof createNodeProxyAgents> | null = null;
        let undiciDispatcher: ReturnType<typeof createUndiciDispatcher> | null = null;
        let undiciFetchFn: ReturnType<typeof createUndiciFetch> | null = null;

        const getNodeAgents = () => {
          if (!nodeAgents) {
            nodeAgents = createNodeProxyAgents(url);
          }
          return nodeAgents;
        };

        const getUndiciDispatcher = () => {
          if (!undiciDispatcher) {
            undiciDispatcher = createUndiciDispatcher(url);
          }
          return undiciDispatcher;
        };

        const closeUndiciDispatcher = async () => {
          const d: any = undiciDispatcher as any;
          if (!d) return;
          try {
            if (typeof d.close === 'function') {
              await d.close();
            } else if (typeof d.destroy === 'function') {
              d.destroy();
            }
          } finally {
            undiciDispatcher = null;
          }
        };

        const stop = async () => {
          await this.proxyServer.stop();
          this.configManager.stopPolling();
          nodeAgents?.http?.destroy?.();
          nodeAgents?.https?.destroy?.();
          nodeAgents = null;
          await closeUndiciDispatcher();
          undiciFetchFn = null;
          this.connection = null;
          this.started = false;
        };

        // Launch browser if Playwright was requested
        let launchedBrowser: any = undefined;
        let launchedBrowserContext: any = undefined;
        let browserCdpUrl: string | undefined;
        if (browserInstance) {
          const proxySettings = toPlaywrightProxySettings(url);
          for (let attempt = 0; attempt < 3; attempt++) {
            const cdpPort = await AluviaClient.findFreePort();
            try {
              launchedBrowser = await browserInstance.launch({
                proxy: proxySettings,
                headless: this.options.headless !== false,
                args: [`--remote-debugging-port=${cdpPort}`],
              });
              browserCdpUrl = `http://127.0.0.1:${cdpPort}`;
              break;
            } catch (err: any) {
              if (attempt === 2 || !err.message?.includes('EADDRINUSE')) throw err;
              this.logger.debug(`Port ${cdpPort} taken, retrying browser launch`);
            }
          }

          launchedBrowserContext = await launchedBrowser.newContext();

          // Attach block detection
          this.attachBlockDetectionListener(launchedBrowserContext);
        }

        const stopWithBrowser = async () => {
          if (launchedBrowser) await launchedBrowser.close();
          await stop();
        };

        // Build connection object
        const connection: AluviaClientConnection = {
          host,
          port,
          url,
          asPlaywright: () => toPlaywrightProxySettings(url),
          asPuppeteer: () => toPuppeteerArgs(url),
          asSelenium: () => toSeleniumArgs(url),
          asNodeAgents: () => getNodeAgents(),
          asAxiosConfig: () => toAxiosConfig(getNodeAgents()),
          asGotOptions: () => toGotOptions(getNodeAgents()),
          asUndiciDispatcher: () => getUndiciDispatcher(),
          asUndiciFetch: () => {
            if (!undiciFetchFn) {
              undiciFetchFn = createUndiciFetch(getUndiciDispatcher());
            }
            return undiciFetchFn;
          },
          browser: launchedBrowser,
          browserContext: launchedBrowserContext,
          cdpUrl: browserCdpUrl,
          stop: stopWithBrowser,
          close: stopWithBrowser,
        };

        this.connection = connection;
        this.started = true;

        return connection;
      } catch (err) {
        this.configManager.stopPolling();
        throw err;
      }
    })();

    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  /**
   * Global cleanup:
   * - Stop the local proxy server (if running).
   * - Stop config polling.
   */
  async stop(): Promise<void> {
    // If start is in-flight, wait for it to settle so we don't leave a running proxy behind.
    if (this.startPromise) {
      try {
        await this.startPromise;
      } catch {
        // ignore startup errors; if startup failed there is nothing to stop
      }
    }

    if (!this.started) {
      return;
    }

    if (this.connection) {
      await this.connection.close();
      // connection.close() sets this.connection = null and this.started = false
    } else {
      await this.proxyServer.stop();
      this.configManager.stopPolling();
      this.connection = null;
      this.started = false;
    }
  }

  /**
   * Update the filtering rules used by the proxy.
   * @param rules
   */
  async updateRules(rules: Array<string>): Promise<void> {
    await this.configManager.setConfig({ rules: rules });
  }

  /**
   * Update the upstream session_id.
   * @param sessionId
   */
  async updateSessionId(sessionId: string): Promise<void> {
    await this.configManager.setConfig({ session_id: sessionId });
  }

  /**
   * Update the upstream target_geo (geo targeting).
   *
   * Pass null to clear geo targeting.
   */
  async updateTargetGeo(targetGeo: string | null): Promise<void> {
    if (targetGeo === null) {
      await this.configManager.setConfig({ target_geo: null });
      return;
    }

    const trimmed = targetGeo.trim();
    await this.configManager.setConfig({
      target_geo: trimmed.length > 0 ? trimmed : null,
    });
  }

  /**
   * Get a list of hostnames that have been detected as blocked.
   *
   * This list is maintained in-memory and cleared when the client is stopped.
   * Only available when block detection is enabled.
   */
  getBlockedHostnames(): string[] {
    if (!this.blockDetection) {
      return [];
    }
    return Array.from(this.blockDetection.persistentHostnames);
  }

  /**
   * Clear the list of blocked hostnames and retried URLs.
   *
   * Only available when block detection is enabled.
   */
  clearBlockedHostnames(): void {
    if (this.blockDetection) {
      this.blockDetection.persistentHostnames.clear();
      this.blockDetection.retriedUrls.clear();
    }
  }

  /**
   * Import Playwright, auto-installing if necessary.
   * Returns the chromium browser type for launching.
   */
  private async _initPlaywright(): Promise<any> {
    try {
      const pw = await import('playwright');
      // @ts-ignore
      return pw.chromium;
    } catch {
      // Playwright not installed — attempt auto-install
      this.logger.info('Playwright not found. Installing playwright...');
      const { execSync } = await import('node:child_process');
      try {
        execSync('npm install playwright', {
          stdio: 'inherit',
          cwd: process.cwd(),
        });
        const pw = await import('playwright');
        // @ts-ignore
        return pw.chromium;
      } catch (installError: any) {
        throw new ApiError(
          `Failed to auto-install Playwright. Install it manually: npm install playwright\n${installError.message}`,
          500,
        );
      }
    }
  }

  /**
   * Find a free TCP port by briefly binding to port 0.
   */
  private static findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        server.close(() => resolve(port));
      });
      server.on('error', reject);
    });
  }
}
