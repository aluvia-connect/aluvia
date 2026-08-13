// ConfigManager - Control plane for connection configuration

import type { GatewayProtocol, LogLevel } from './types.js';
import { Logger } from './logger.js';
import { InvalidApiKeyError, ApiError } from '../errors.js';
import { requestCore } from '../api/request.js';
import { isRecord, throwIfAuthError } from '../api/apiUtils.js';
import { normalizeRules } from './rules.js';
import type { NormalizedRules } from './rules.js';

// Config types

/**
 * Raw proxy configuration derived from the account-connection response and client options.
 */
export type RawProxyConfig = {
  protocol: GatewayProtocol;
  host: string;
  port: number;
  username: string;
  password: string;
};

/**
 * Complete connection network configuration including proxy, rules, and metadata.
 */
export type ConnectionNetworkConfig = {
  rawProxy: RawProxyConfig;
  rules: string[];
  /** Pre-normalized rules for efficient per-request matching. */
  normalizedRules: NormalizedRules;
  sessionId: string | null;
  targetGeo: string | null;
  /**
   * ETag returned by the API for this config snapshot (if present).
   * Used for efficient conditional polling via If-None-Match.
   */
  etag: string | null;
};

type AccountConnectionData = {
  id?: string | number;
  connection_id?: string | number;
  proxy_username?: string;
  proxy_password?: string;
  rules?: string[];
  session_id?: string | null;
  target_geo?: string | null;
};

type AccountConnectionApiResponse = {
  data?: AccountConnectionData;
};

function toAccountConnectionApiResponse(value: unknown): AccountConnectionApiResponse {
  if (!isRecord(value)) return {};
  const data = value['data'];
  if (!isRecord(data)) return {};
  return { data: data as AccountConnectionData };
}

function toValidationErrors(value: unknown): string[] | null {
  if (!isRecord(value)) return null;

  const apiError = value['error'];
  if (!isRecord(apiError)) return null;
  if (apiError['code'] !== 'validation_error') return null;

  const details = apiError['details'];
  const errors: string[] = [];

  if (isRecord(details)) {
    for (const fieldMessages of Object.values(details)) {
      if (Array.isArray(fieldMessages)) {
        for (const message of fieldMessages) {
          if (typeof message === 'string') {
            errors.push(message);
          }
        }
      }
    }
  }

  return errors.length ? errors : null;
}

/**
 * Options for ConfigManager constructor.
 */
export type ConfigManagerOptions = {
  apiKey: string;
  apiBaseUrl: string;
  pollIntervalMs: number;
  gatewayProtocol: GatewayProtocol;
  gatewayPort: number;
  gatewayHost?: string;
  logLevel: LogLevel;

  /**
   * Optional: if provided, use /account/connections/:id.
   * If omitted, init() will attempt POST /account/connections.
   */
  connectionId?: number;

  /**
   * Optional: strict behavior (default true).
   *
   * If true, init() throws when it cannot load/create a usable config.
   * If false, init() may return without config (client proxy mode can still start
   * and will route direct until config becomes available).
   */
  strict?: boolean;
};

/**
 * ConfigManager handles fetching and maintaining connection configuration from the Aluvia API.
 *
 * Responsibilities:
 * - Initial fetch of account connection config
 * - Polling for updates using ETag
 * - Providing current config to ProxyServer
 */
export class ConfigManager {
  private config: ConnectionNetworkConfig | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly logger: Logger;
  private readonly options: ConfigManagerOptions;
  private readonly strict: boolean;

  private accountConnectionId: number | undefined;
  private pollInFlight = false;

  /** Public read-only access to the account connection ID. */
  get connectionId(): number | undefined {
    return this.accountConnectionId;
  }

  constructor(options: ConfigManagerOptions) {
    this.options = options;
    this.logger = new Logger(options.logLevel);
    this.strict = options.strict ?? true;
  }

  /**
   * Fetch initial configuration from the account connections API.
   * Must be called before starting the proxy.
   *
   * @throws InvalidApiKeyError if apiKey is invalid (401/403)
   * @throws ApiError for other API errors
   */
  async init(): Promise<void> {
    if (this.options.connectionId) {
      this.accountConnectionId = this.options.connectionId;
      this.logger.info(`Using account connection API (connection id: ${this.accountConnectionId})`);
      let result: Awaited<ReturnType<typeof requestCore>>;
      try {
        result = await requestCore({
          apiBaseUrl: this.options.apiBaseUrl,
          apiKey: this.options.apiKey,
          method: 'GET',
          path: `/account/connections/${this.accountConnectionId}`,
        });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        throw new ApiError(`Failed to fetch account connection config: ${msg}`);
      }

      throwIfAuthError(result.status);

      if (result.status === 200 && result.body) {
        this.config = this.buildConfigFromAny(result.body, result.etag);
        this.logger.info('Configuration loaded successfully');
        this.logger.debug('Config summary:', this.redactConfig(this.config));
        return;
      }

      throw new ApiError(`Failed to fetch account connection config: HTTP ${result.status}`, result.status);
    }

    // No connectionId: create an account connection (preferred)
    this.logger.info('No connectionId provided; creating account connection...');
    try {
      const created = await requestCore({
        apiBaseUrl: this.options.apiBaseUrl,
        apiKey: this.options.apiKey,
        method: 'POST',
        path: '/account/connections',
        body: {},
      });

      throwIfAuthError(created.status);

      if ((created.status === 200 || created.status === 201) && created.body) {
        const createdResponse = toAccountConnectionApiResponse(created.body);
        const rawId = Number(createdResponse.data?.connection_id);
        this.accountConnectionId = Number.isFinite(rawId) ? rawId : undefined;

        if (this.accountConnectionId != null) {
          this.logger.info(`Account connection created (connection id: ${this.accountConnectionId})`);
        } else {
          this.logger.info('Account connection created (connection id unavailable in response)');
        }

        this.config = this.buildConfigFromAny(created.body, created.etag);
        this.logger.info('Configuration loaded successfully');
        this.logger.debug('Config summary:', this.redactConfig(this.config));
        return;
      }

      const msg = `Failed to create account connection config: HTTP ${created.status}`;
      if (this.strict) {
        throw new ApiError(msg, created.status);
      }
      this.logger.warn(`${msg}; continuing without config (strict=false)`);
      return;
    } catch (err) {
      if (err instanceof InvalidApiKeyError) throw err;
      if (err instanceof ApiError) {
        if (this.strict) throw err;
        this.logger.warn('Create account connection failed; continuing without config (strict=false)', err);
        return;
      }

      const msg = err instanceof Error ? err.message : String(err);
      if (this.strict) {
        throw new ApiError(`Failed to create account connection config: ${msg}`);
      }
      this.logger.warn('Create account connection failed; continuing without config (strict=false)', err);
      return;
    }
  }

  /**
   * Start polling for configuration updates.
   * Uses ETag for efficient conditional requests.
   */
  startPolling(): void {
    if (this.options.pollIntervalMs === 0) {
      this.logger.debug('Config polling disabled (pollIntervalMs=0)');
      return;
    }

    // Don't start if already polling
    if (this.timer) {
      this.logger.debug('Polling already active, skipping startPolling()');
      return;
    }

    this.logger.info(`Starting config polling every ${this.options.pollIntervalMs}ms`);

    this.timer = setInterval(async () => {
      if (this.pollInFlight) {
        this.logger.debug('Previous poll still running, skipping this poll tick');
        return;
      }

      this.pollInFlight = true;
      try {
        await this.pollOnce();
      } finally {
        this.pollInFlight = false;
      }
    }, this.options.pollIntervalMs);
    this.timer.unref();
  }

  /**
   * Stop polling for configuration updates.
   */
  stopPolling(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.info('Config polling stopped');
    }
  }

  /**
   * Get the current configuration.
   * Returns null if init() hasn't been called or failed.
   */
  getConfig(): ConnectionNetworkConfig | null {
    return this.config;
  }

  async setConfig(body: Record<string, unknown>): Promise<ConnectionNetworkConfig | null> {
    if (this.accountConnectionId == null || !Number.isFinite(this.accountConnectionId)) {
      throw new ApiError('Cannot update config: no account connection ID. Ensure init() succeeds first.');
    }

    this.logger.debug(`Setting config: ${JSON.stringify(body)}`);

    let result: Awaited<ReturnType<typeof requestCore>>;
    try {
      result = await requestCore({
        apiBaseUrl: this.options.apiBaseUrl,
        apiKey: this.options.apiKey,
        method: 'PATCH',
        path: `/account/connections/${this.accountConnectionId}`,
        body,
      });
    } catch (err) {
      if (err instanceof ApiError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new ApiError(`Failed to update account connection config: ${msg}`);
    }

    throwIfAuthError(result.status);

    if (result.status === 200 && result.body) {
      this.config = this.buildConfigFromAny(result.body, result.etag);
      this.logger.debug('Configuration updated from API');
      this.logger.debug('New config summary:', this.redactConfig(this.config));
      return this.config;
    }

    if (result.status === 422 && result.body) {
      const validationErrors = toValidationErrors(result.body);
      if (validationErrors) {
        throw new ApiError(
          `Failed to update account connection config: ${validationErrors[0]}`,
          result.status,
        );
      }
    }

    throw new ApiError(`Failed to update account connection config: HTTP ${result.status}`, result.status);
  }

  /**
   * Perform a single poll iteration.
   * Called by the polling timer.
   */
  private async pollOnce(): Promise<void> {
    if (!this.config || this.accountConnectionId == null) {
      this.logger.warn('No config or connection ID available, skipping poll');
      return;
    }

    try {
      const result = await requestCore({
        apiBaseUrl: this.options.apiBaseUrl,
        apiKey: this.options.apiKey,
        method: 'GET',
        path: `/account/connections/${this.accountConnectionId}`,
        ifNoneMatch: this.config.etag,
      });

      if (result.status === 304) {
        this.logger.debug('Config unchanged (304 Not Modified)');
        return;
      }

      if (result.status === 200 && result.body) {
        this.config = this.buildConfigFromAny(result.body, result.etag);
        this.logger.debug('Configuration updated from API');
        this.logger.debug('New config summary:', this.redactConfig(this.config));
        return;
      }

      this.logger.warn(`Poll returned unexpected status ${result.status}`);
    } catch (error) {
      this.logger.warn('Poll failed, keeping existing config:', error);
    }
  }

  /**
   * Build ConnectionNetworkConfig from API response.
   */
  private buildConfigFromAny(body: unknown, etag: string | null): ConnectionNetworkConfig {
    const response = toAccountConnectionApiResponse(body);
    const data = response.data;

    const rules: string[] = Array.isArray(data?.rules) ? data.rules : [];
    const sessionId: string | null = data?.session_id ?? null;
    const targetGeo: string | null = data?.target_geo ?? null;

    const username: string | null = (data?.proxy_username ?? '').trim() || null;
    const password: string | null = (data?.proxy_password ?? '').trim() || null;

    if (!username || !password) {
      throw new ApiError(
        'Account connection response missing proxy credentials (data.proxy_username and data.proxy_password are required)',
        500,
      );
    }

    return {
      rawProxy: {
        protocol: this.options.gatewayProtocol,
        host: this.options.gatewayHost ?? 'gateway.aluvia.io',
        port: this.options.gatewayPort,
        username,
        password,
      },
      rules,
      normalizedRules: normalizeRules(rules),
      sessionId,
      targetGeo,
      etag,
    };
  }

  private redactConfig(config: ConnectionNetworkConfig | null): object | null {
    if (!config) return null;
    return {
      rulesCount: config.rules?.length ?? 0,
      sessionId: config.sessionId,
      targetGeo: config.targetGeo,
      etag: config.etag,
      rawProxy: {
        protocol: config.rawProxy.protocol,
        host: config.rawProxy.host,
        port: config.rawProxy.port,
        username: config.rawProxy.username ? '[set]' : '[missing]',
        password: config.rawProxy.password ? '[set]' : '[missing]',
      },
    };
  }
}
