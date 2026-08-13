import { ApiError } from '../errors.js';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export type RequestQuery = Record<
  string,
  string | number | boolean | null | undefined | Array<string | number | boolean>
>;

export type RequestCoreOptions = {
  apiBaseUrl: string;
  apiKey?: string;
  installId?: string;
  method: HttpMethod;
  path: string;
  query?: RequestQuery;
  body?: unknown;
  headers?: Record<string, string>;
  ifNoneMatch?: string | null;
  timeoutMs?: number;
  fetch?: typeof fetch;
};

export type RequestCoreResult = {
  status: number;
  etag: string | null;
  body: unknown | null;
};

const DEFAULT_TIMEOUT_MS = 30_000;

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

function buildQueryString(query: RequestQuery | undefined): string {
  if (!query) return '';

  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value == null) continue;

    if (Array.isArray(value)) {
      for (const v of value) params.append(key, String(v));
      continue;
    }

    params.set(key, String(value));
  }

  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

function isJsonResponse(contentType: string | null): boolean {
  if (!contentType) return false;
  return contentType.toLowerCase().includes('application/json');
}

export async function requestCore(options: RequestCoreOptions): Promise<RequestCoreResult> {
  const url = `${joinUrl(options.apiBaseUrl, options.path)}${buildQueryString(options.query)}`;
  const fetchImpl = options.fetch ?? globalThis.fetch;

  if (typeof fetchImpl !== 'function') {
    throw new Error('globalThis.fetch is not available; Node 18+ is required');
  }

  const apiKey = (options.apiKey ?? '').trim();
  const installId = (options.installId ?? '').trim().toLowerCase();

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.headers ?? {}),
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  } else if (installId) {
    headers['X-Aluvia-Install-Id'] = installId;
  }

  if (options.ifNoneMatch) headers['If-None-Match'] = options.ifNoneMatch;

  const hasJsonBody = options.body !== undefined && options.body !== null;
  if (hasJsonBody) headers['Content-Type'] = 'application/json';

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response: Response;

    try {
      response = await fetchImpl(url, {
        method: options.method,
        headers,
        body: hasJsonBody ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new ApiError(`Request timed out after ${timeoutMs}ms`, 408);
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new ApiError(`Network request failed: ${message}`);
    }

    const etag = response.headers.get('etag');

    if (response.status === 204 || response.status === 304) {
      return { status: response.status, etag, body: null };
    }

    const contentType = response.headers.get('content-type');
    if (!isJsonResponse(contentType)) {
      return { status: response.status, etag, body: null };
    }

    const text = await response.text();
    if (!text) return { status: response.status, etag, body: null };

    try {
      return { status: response.status, etag, body: JSON.parse(text) };
    } catch {
      return { status: response.status, etag, body: null };
    }
  } finally {
    clearTimeout(timeoutId);
  }
}
