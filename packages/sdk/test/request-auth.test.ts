import { describe, test } from 'node:test';
import assert from 'node:assert';
import { requestCore } from '../src/api/request.js';
import { throwForNon2xx } from '../src/api/apiUtils.js';
import { PaymentRequiredError } from '../src/errors.js';

describe('requestCore auth headers', () => {
  test('sends Bearer when apiKey is set', async () => {
    const headers: Record<string, string> = {};
    await requestCore({
      apiBaseUrl: 'https://api.example.test/v1',
      apiKey: 'tok',
      method: 'GET',
      path: '/account',
      fetch: async (_url, init) => {
        Object.assign(headers, init?.headers as Record<string, string>);
        return new Response(JSON.stringify({ success: true, data: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    assert.strictEqual(headers.Authorization, 'Bearer tok');
    assert.strictEqual(headers['X-Aluvia-Install-Id'], undefined);
  });

  test('sends install id header when no apiKey', async () => {
    const installId = 'a'.repeat(64);
    const headers: Record<string, string> = {};
    await requestCore({
      apiBaseUrl: 'https://api.example.test/v1',
      installId,
      method: 'GET',
      path: '/account',
      fetch: async (_url, init) => {
        Object.assign(headers, init?.headers as Record<string, string>);
        return new Response(JSON.stringify({ success: true, data: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    assert.strictEqual(headers.Authorization, undefined);
    assert.strictEqual(headers['X-Aluvia-Install-Id'], installId);
  });

  test('throwForNon2xx maps 402 to PaymentRequiredError', () => {
    assert.throws(
      () =>
        throwForNon2xx({
          status: 402,
          etag: null,
          body: {
            success: false,
            error: {
              code: 'payment_required',
              message: 'Trial data is used up.',
              claim_url: 'https://dashboard.aluvia.io/cli-auth',
            },
          },
        }),
      (err: unknown) => {
        assert.ok(err instanceof PaymentRequiredError);
        assert.strictEqual(err.claimUrl, 'https://dashboard.aluvia.io/cli-auth');
        return true;
      },
    );
  });
});
