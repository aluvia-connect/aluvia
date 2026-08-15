import { ApiError, InvalidApiKeyError, PaymentRequiredError } from '../errors.js';
import type { ErrorEnvelope, SuccessEnvelope } from './types.js';

export type ApiRequestArgs = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  etag?: string | null;
};

export type ApiRequestResult = {
  status: number;
  etag: string | null;
  body: unknown | null;
};

export type ApiContext = {
  request: (args: ApiRequestArgs) => Promise<ApiRequestResult>;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asErrorEnvelope(value: unknown): ErrorEnvelope | null {
  if (!isRecord(value)) return null;
  if (value['success'] !== false) return null;
  const error = value['error'];
  if (!isRecord(error)) return null;
  const code = error['code'];
  const message = error['message'];
  if (typeof code !== 'string' || typeof message !== 'string') return null;
  return {
    success: false,
    error: { code, message, details: error['details'] },
  };
}

export function formatErrorDetails(details: unknown): string {
  if (details == null) return '';
  try {
    const json = JSON.stringify(details);
    if (!json) return '';
    return json.length > 500 ? `${json.slice(0, 500)}…` : json;
  } catch {
    return String(details);
  }
}

export function paymentRequiredFromBody(body: unknown): PaymentRequiredError {
  const maybeError = asErrorEnvelope(body);
  let claimUrl: string | null = null;
  if (isRecord(body) && isRecord(body['error']) && typeof body['error']['claim_url'] === 'string') {
    claimUrl = body['error']['claim_url'];
  }
  return new PaymentRequiredError(
    maybeError?.error.message ??
      'Trial data is used up. Ask the human for an API key (`aluvia auth <key>`) or a proxy URL (`aluvia proxy-provider <url>`).',
    claimUrl,
  );
}

export function throwForNon2xx(result: ApiRequestResult): never {
  const status = result.status;

  if (status === 402) {
    throw paymentRequiredFromBody(result.body);
  }

  if (status === 401 || status === 403) {
    throw new InvalidApiKeyError(
      `Authentication failed (HTTP ${status}). Check token validity and that you are using an account API token for account endpoints.`,
    );
  }

  const maybeError = asErrorEnvelope(result.body);
  if (maybeError) {
    const details = formatErrorDetails(maybeError.error.details);
    const detailsSuffix = details ? ` details=${details}` : '';
    throw new ApiError(
      `API request failed (HTTP ${status}) code=${maybeError.error.code} message=${maybeError.error.message}${detailsSuffix}`,
      status,
    );
  }

  throw new ApiError(`API request failed (HTTP ${status})`, status);
}

export type AluviaApiRequestArgs = Omit<ApiRequestArgs, 'etag'>;

export function throwIfAuthError(status: number, body?: unknown): void {
  if (status === 402) {
    throw paymentRequiredFromBody(body ?? null);
  }
  if (status === 401 || status === 403) {
    throw new InvalidApiKeyError(`Authentication failed with status ${status}`);
  }
}

export function unwrapSuccess<T>(value: unknown): T | null {
  if (!isRecord(value)) return null;

  if (value['success'] === true && 'data' in value) {
    return (value as SuccessEnvelope<T>).data;
  }

  if ('data' in value) {
    return (value as { data: T }).data;
  }

  return null;
}

export async function requestAndUnwrap<T>(
  ctx: ApiContext,
  args: ApiRequestArgs,
): Promise<{ data: T; etag: string | null }> {
  const result = await ctx.request(args);

  if (result.status < 200 || result.status >= 300) {
    throwForNon2xx(result);
  }

  const data = unwrapSuccess<T>(result.body);
  if (data == null) {
    throw new ApiError('API response missing expected success envelope data', result.status);
  }

  return { data, etag: result.etag };
}
