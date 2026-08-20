import { requestCore } from './request.js';
import { requestAndUnwrap } from './api-utils.js';
import { MissingApiKeyError } from './errors.js';
import type { Account, AccountUsage, Geo } from './types.js';
import type { AluviaApiRequestArgs } from './api-utils.js';

export type { AluviaApiRequestArgs };

export type AluviaApiOptions = {
  apiKey?: string;
  installId?: string;
  apiBaseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
};

export class AluviaApi {
  private readonly apiKey: string;
  private readonly installId?: string;
  private readonly apiBaseUrl: string;
  private readonly timeoutMs?: number;
  private readonly fetchImpl?: typeof fetch;

  public readonly account: {
    get: () => Promise<Account>;
    usage: {
      get: (params?: { start?: string; end?: string }) => Promise<AccountUsage>;
    };
  };
  public readonly geos: {
    list: () => Promise<Array<Geo>>;
  };

  constructor(options: AluviaApiOptions) {
    const apiKey = String(options.apiKey ?? '').trim();
    const installId = String(options.installId ?? '')
      .trim()
      .toLowerCase();
    if (!apiKey && !installId) {
      throw new MissingApiKeyError('Aluvia apiKey or installId is required');
    }

    this.apiKey = apiKey;
    this.installId = installId || undefined;
    this.apiBaseUrl = options.apiBaseUrl ?? 'https://api.aluvia.io/v1';
    this.timeoutMs = options.timeoutMs;
    this.fetchImpl = options.fetch;

    const ctx = {
      request: async (args: {
        method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
        path: string;
        query?: Record<string, string | number | boolean | null | undefined>;
        body?: unknown;
        headers?: Record<string, string>;
        etag?: string | null;
      }) => {
        return await requestCore({
          apiBaseUrl: this.apiBaseUrl,
          apiKey: this.apiKey || undefined,
          installId: this.installId,
          method: args.method,
          path: args.path,
          query: args.query,
          body: args.body,
          headers: args.headers,
          ifNoneMatch: args.etag,
          timeoutMs: this.timeoutMs,
          fetch: this.fetchImpl,
        });
      },
    };

    this.account = {
      get: async () => {
        const { data } = await requestAndUnwrap<Account>(ctx, {
          method: 'GET',
          path: '/account',
        });
        return data;
      },
      usage: {
        get: async (params: { start?: string; end?: string } = {}) => {
          const { data } = await requestAndUnwrap<AccountUsage>(ctx, {
            method: 'GET',
            path: '/account/usage',
            query: {
              start: params.start,
              end: params.end,
            },
          });
          return data;
        },
      },
    };

    this.geos = {
      list: async () => {
        const { data } = await requestAndUnwrap<Array<Geo>>(ctx, {
          method: 'GET',
          path: '/geos',
        });
        return data;
      },
    };
  }
}
