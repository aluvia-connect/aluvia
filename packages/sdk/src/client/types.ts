// Public types for Aluvia Client Node

import type {
  BlockDetectionConfig,
  BlockDetectionResult,
  DetectionBlockStatus,
  DetectionSignal,
  RedirectHop,
} from './BlockDetection.js';

/**
 * Protocol used to connect to the Aluvia gateway.
 */
export type GatewayProtocol = 'http' | 'https';

/**
 * Log level for the client.
 */
export type LogLevel = 'silent' | 'info' | 'debug';

export type PlaywrightProxySettings = {
  server: string;
  username?: string;
  password?: string;
};

/**
 * Options for creating an AluviaClient instance.
 */
export type AluviaClientOptions = {
  /**
   * Account API token (Bearer). Optional when `installId` or `upstream` is set.
   */
  apiKey?: string;

  /**
   * CLI trial install id. Sent as X-Aluvia-Install-Id when no apiKey is set.
   */
  installId?: string;

  /**
   * Bring-your-own upstream proxy. Skips the Aluvia API.
   */
  upstream?: {
    protocol: GatewayProtocol;
    host: string;
    port: number;
    username?: string;
    password?: string;
  };

  /**
   * Optional: base URL for the Aluvia API.
   * Default: 'https://api.aluvia.io/v1'
   */
  apiBaseUrl?: string;

  /**
   * Optional: polling interval for refreshing account connection config.
   * Default: 5000 ms. `0` disables polling. Other values below 1000 are capped at 1000.
   */
  pollIntervalMs?: number;

  /**
   * Optional: request timeout for API calls made via `client.api`.
   * Default: 30000 ms.
   */
  timeoutMs?: number;

  /**
   * Optional: how the client talks to the Aluvia gateway.
   *
   * - 'http'  -> gatewayPort defaults to 8080
   * - 'https' -> gatewayPort defaults to 8443
   *
   * Default: 'http'.
   */
  gatewayProtocol?: GatewayProtocol;

  /**
   * Optional: upstream Aluvia gateway port.
   *
   * If omitted:
   *   - 8080 is used when gatewayProtocol === 'http'
   *   - 8443 is used when gatewayProtocol === 'https'
   */
  gatewayPort?: number;

  /**
   * Optional: upstream Aluvia gateway hostname.
   * Default: 'gateway.aluvia.io'.
   */
  gatewayHost?: string;

  /**
   * Optional: local port for the agent's *local* proxy (127.0.0.1:<localPort>).
   *
   * If omitted, the client will pick a free port automatically by binding to port 0.
   */
  localPort?: number;

  /**
   * Optional: logging verbosity for the client.
   */
  logLevel?: LogLevel;

  /**
   * Optional: use an existing account connection by ID.
   *
   * If provided, the client retrieves config via:
   *   GET /account/connections/:connection_id
   *
   * If omitted, the client will attempt to create a new account connection via:
   *   POST /account/connections
   */
  connectionId?: number;

  /**
   * Optional: strict startup behavior.
   *
   * If true (default): `client.start()` throws if the SDK cannot load/create
   * an account connection config (proxy credentials + rules). This prevents
   * "silent direct routing" where the local proxy starts but bypasses Aluvia.
   *
   * If false: the SDK may still start a local proxy and route traffic directly
   * when config is unavailable.
   */
  strict?: boolean;

  /**
   * Optional: automatically start Playwright and return the Playwright object.
   *
   * If true: the SDK will import and initialize Playwright, making it available
   * via `connection.playwright`. The Playwright instance is automatically configured
   * to use the Aluvia proxy.
   *
   * If false (default): Playwright is not initialized automatically.
   *
   * Note: Playwright must be installed as a dependency for this option to work.
   */
  startPlaywright?: boolean;

  /**
   * Optional: configuration for website block detection.
   *
   * When enabled (default), the SDK monitors pages using a weighted scoring
   * system across multiple signal types (HTTP status, WAF headers, DOM
   * selectors, visible text, redirect chains) with two-pass analysis.
   */
  blockDetection?: BlockDetectionConfig;

  /**
   * Optional: run the Playwright browser in headless or headed mode.
   *
   * If true (default): the browser runs without a visible window.
   * If false: the browser opens a visible window.
   *
   * Only applies when `startPlaywright` is true.
   */
  headless?: boolean;
};

/**
 * Represents an active Aluvia Client connection.
 */
export type AluviaClientConnection = {
  /**
   * Proxy host: `'127.0.0.1'` (the local proxy).
   */
  host: string;

  /**
   * The local proxy port.
   */
  port: number;

  /**
   * Proxy URL: `'http://127.0.0.1:<port>'`.
   */
  url: string;

  /**
   * Playwright adapter for chromium/firefox/webkit launch options.
   */
  asPlaywright(): PlaywrightProxySettings;

  /**
   * Puppeteer adapter for launch args.
   */
  asPuppeteer(): Array<string>;

  /**
   * Selenium adapter for launch args.
   */
  asSelenium(): string;

  /**
   * Node HTTP(S) proxy agents for libraries that accept per-protocol agents.
   *
   * Useful for: Axios, got, node-fetch (legacy).
   */
  asNodeAgents(): {
    http: import('node:http').Agent;
    https: import('node:http').Agent;
  };

  /**
   * Axios adapter config.
   *
   * Returns `{ proxy: false, httpAgent, httpsAgent }` so Axios uses the provided agents
   * instead of its built-in proxy option handling.
   */
  asAxiosConfig(): {
    proxy: false;
    httpAgent: import('node:http').Agent;
    httpsAgent: import('node:http').Agent;
  };

  /**
   * got adapter options.
   *
   * Returns `{ agent: { http, https } }`.
   */
  asGotOptions(): {
    agent: {
      http: import('node:http').Agent;
      https: import('node:http').Agent;
    };
  };

  /**
   * undici proxy dispatcher (for undici fetch / undici clients).
   */
  // @ts-ignore
  asUndiciDispatcher(): import('undici').Dispatcher;

  /**
   * Returns a `fetch` function powered by undici that uses the proxy dispatcher per request.
   *
   * Note: Node's built-in `fetch()` does not accept a Node `Agent`. Use this for proxying
   * fetch calls through Aluvia.
   */
  asUndiciFetch(): typeof fetch;

  /**
   * Playwright Chromium browser instance, automatically configured with Aluvia proxy.
   *
   * Only available if `startPlaywright: true` was passed to AluviaClientOptions.
   * Otherwise this property is undefined.
   *
   * The browser is already configured to use the Aluvia proxy, so you can use it directly.
   */
  browser?: any;

  browserContext?: any;

  /**
   * Chrome DevTools Protocol HTTP endpoint URL (for example: http://127.0.0.1:<port>).
   *
   * Only available if `startPlaywright: true` was passed to AluviaClientOptions.
   * Intended for use by external tools that connect to the browser via CDP.
   * Tools that require a WebSocket debugger URL should derive it from this HTTP
   * endpoint (for example, by fetching `${cdpUrl}/json/version` and using the
   * `webSocketDebuggerUrl` field from the response).
   */
  cdpUrl?: string;

  /**
   * Close this proxy instance:
   * - Close the local proxy server.
   * - Close the browser (if started).
   * - Stop config polling.
   */
  close(): Promise<void>;

  /** @deprecated Use `close()` instead. */
  stop(): Promise<void>;
};

// Re-export BlockDetection types for public API
export type {
  BlockDetectionConfig,
  BlockDetectionResult,
  DetectionBlockStatus,
  DetectionSignal,
  RedirectHop,
} from './BlockDetection.js';
