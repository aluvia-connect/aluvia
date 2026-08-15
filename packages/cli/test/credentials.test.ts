import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PaymentRequiredError } from '@aluvia/sdk';
import { captureOutput } from '../src/mcp-helpers.js';
import { handleAuth, paymentRequiredPayload } from '../src/auth.js';
import { paymentRequiredOutput, resolveCredential } from '../src/api-helpers.js';
import {
  ensureInstallId,
  getStoredApiKey,
  getStoredUpstream,
  saveApiKey,
  saveUpstream,
} from '../src/config.js';

const ENV_KEYS = ['ALUVIA_HOME', 'ALUVIA_API_KEY', 'ALUVIA_UPSTREAM'] as const;

describe('credential resolver', { concurrency: 1 }, () => {
  const original: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) original[key] = process.env[key];
  let home: string | undefined;

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
    if (home) {
      fs.rmSync(home, { recursive: true, force: true });
      home = undefined;
    }
  });

  function tempHome(): void {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'aluvia-cred-'));
    process.env.ALUVIA_HOME = home;
    delete process.env.ALUVIA_API_KEY;
    delete process.env.ALUVIA_UPSTREAM;
  }

  test('order is BYO, env key, stored key, then install id', () => {
    tempHome();
    const install = ensureInstallId();
    assert.strictEqual(resolveCredential().kind, 'install');
    assert.strictEqual((resolveCredential() as { installId: string }).installId, install);

    saveApiKey('stored-token');
    assert.deepStrictEqual(resolveCredential(), { kind: 'token', apiKey: 'stored-token' });

    process.env.ALUVIA_API_KEY = 'env-token';
    assert.deepStrictEqual(resolveCredential(), { kind: 'token', apiKey: 'env-token' });

    saveUpstream('http://user:pass@byo.example:8080');
    const byo = resolveCredential();
    assert.strictEqual(byo.kind, 'byo');
    assert.strictEqual(byo.kind === 'byo' && byo.upstream.host, 'byo.example');
  });

  test('paymentRequiredPayload uses the auth-login claim URL', async () => {
    tempHome();
    ensureInstallId();
    const origFetch = globalThis.fetch;
    let initCalls = 0;
    globalThis.fetch = (async (url: string | URL) => {
      if (String(url).includes('/auth/cli/init')) {
        initCalls += 1;
        return new Response(
          JSON.stringify({
            device_code: 'dev-1',
            user_code: 'ABCD',
            verification_uri: 'https://dashboard.aluvia.io/cli-auth',
            verification_uri_complete: 'https://dashboard.aluvia.io/cli-auth?cli_code=ABCD',
            interval: 5,
            expires_in: 600,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      throw new Error(`unexpected fetch ${String(url)}`);
    }) as typeof fetch;
    try {
      const first = await paymentRequiredPayload(
        new PaymentRequiredError('used up', 'https://dashboard.aluvia.io/cli-auth'),
      );
      assert.strictEqual(first.claim_url, 'https://dashboard.aluvia.io/cli-auth?cli_code=ABCD');
      assert.strictEqual(first.code, 'payment_required');
      const second = await paymentRequiredPayload(
        new PaymentRequiredError('used up', 'https://dashboard.aluvia.io/cli-auth'),
      );
      assert.strictEqual(second.claim_url, first.claim_url);
      assert.strictEqual(initCalls, 1);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test('paymentRequiredOutput maps PaymentRequiredError', () => {
    const err = new PaymentRequiredError('used up', 'https://dashboard.aluvia.io/cli-auth');
    assert.deepStrictEqual(paymentRequiredOutput(err), {
      error: 'used up',
      code: 'payment_required',
      claim_url: 'https://dashboard.aluvia.io/cli-auth',
    });
    assert.strictEqual(paymentRequiredOutput(new Error('nope')), null);
  });

  test('auth <key> saves the key and does not echo it', async () => {
    tempHome();
    const secret = 'aluvia_secret_test_key';
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL) => {
      if (String(url).includes('/account')) {
        return new Response(JSON.stringify({ success: true, data: { id: 'acct-1' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch ${String(url)}`);
    }) as typeof fetch;
    try {
      const result = await captureOutput(() => handleAuth([secret]));
      assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
      assert.strictEqual(result.data.status, 'authenticated');
      assert.strictEqual(getStoredApiKey(), secret);
      assert.strictEqual(getStoredUpstream(), undefined);
      assert.ok(!JSON.stringify(result.data).includes(secret));
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test('auth with no args or --key errors', async () => {
    tempHome();
    const empty = await captureOutput(() => handleAuth([]));
    assert.strictEqual(empty.isError, true);
    assert.match(String(empty.data.error), /aluvia auth <key>/);
    const dashed = await captureOutput(() => handleAuth(['--key', 'secret']));
    assert.strictEqual(dashed.isError, true);
    assert.match(String(dashed.data.error), /aluvia auth <key>/);
  });

  test('auth status reports trial, stored key, and custom provider', async () => {
    tempHome();
    ensureInstallId();
    const trial = await captureOutput(() => handleAuth(['status']));
    assert.strictEqual(trial.isError, false);
    assert.deepStrictEqual(trial.data, { authenticated: false, provider: 'aluvia', trial: true });

    saveApiKey('stored-token');
    const keyed = await captureOutput(() => handleAuth(['status']));
    assert.strictEqual(keyed.isError, false);
    assert.deepStrictEqual(keyed.data, {
      authenticated: true,
      source: 'config',
      provider: 'aluvia',
      configFile: '~/.aluvia/config.json',
    });

    saveUpstream('http://user:pass@byo.example:8080');
    const byo = await captureOutput(() => handleAuth(['status']));
    assert.strictEqual(byo.isError, false);
    assert.deepStrictEqual(byo.data, { authenticated: false, provider: 'custom' });
  });

  test('auth login sends stored install_id', async () => {
    tempHome();
    const installId = ensureInstallId();
    const origFetch = globalThis.fetch;
    let initBody: unknown;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes('/auth/cli/init')) {
        initBody = JSON.parse(String(init?.body ?? '{}'));
        return new Response('nope', { status: 500 });
      }
      throw new Error(`unexpected fetch ${String(url)}`);
    }) as typeof fetch;
    try {
      const result = await captureOutput(() => handleAuth(['login']));
      assert.strictEqual(result.isError, true);
      assert.match(String(result.data.error), /Could not start authentication/);
      assert.ok(initBody && typeof initBody === 'object');
      assert.strictEqual((initBody as { install_id?: string }).install_id, installId);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
