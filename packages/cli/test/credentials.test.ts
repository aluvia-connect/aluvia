import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PaymentRequiredError } from '../src/net/errors.js';
import { captureOutput } from '../src/mcp-helpers.js';
import { handleAuth, paymentRequiredPayload } from '../src/auth.js';
import { resolveCredential } from '../src/api-helpers.js';
import {
  ensureInstallId,
  getPendingCliAuth,
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

    process.env.ALUVIA_UPSTREAM = 'http://user:pass@env.example:8080';
    saveApiKey('after-byo');
    assert.strictEqual(resolveCredential().kind, 'token');
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

  test('auth logout is usage, not a key', async () => {
    tempHome();
    const result = await captureOutput(() => handleAuth(['logout']));
    assert.strictEqual(result.isError, true);
    assert.match(String(result.data.error), /aluvia auth <key>/);
    assert.strictEqual(getStoredApiKey(), undefined);
  });

  test('auth <key> 402 is payment_required with a minted claim_url', async () => {
    tempHome();
    ensureInstallId();
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL) => {
      const href = String(url);
      if (href.includes('/account')) {
        return new Response(
          JSON.stringify({
            success: false,
            error: {
              code: 'payment_required',
              message: 'Trial data is used up.',
              claim_url: 'https://dashboard.aluvia.io/cli-auth',
            },
          }),
          { status: 402, headers: { 'content-type': 'application/json' } },
        );
      }
      if (href.includes('/auth/cli/init')) {
        return new Response(
          JSON.stringify({
            device_code: 'dev-402',
            user_code: 'CODE1',
            verification_uri: 'https://dashboard.aluvia.io/cli-auth',
            verification_uri_complete: 'https://dashboard.aluvia.io/cli-auth?cli_code=CODE1',
            interval: 5,
            expires_in: 600,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      throw new Error(`unexpected fetch ${href}`);
    }) as typeof fetch;
    try {
      const result = await captureOutput(() => handleAuth(['aluvia_paid_key']));
      assert.strictEqual(result.isError, true);
      assert.strictEqual(result.data.code, 'payment_required');
      assert.strictEqual(result.data.claim_url, 'https://dashboard.aluvia.io/cli-auth?cli_code=CODE1');
      assert.strictEqual(getStoredApiKey(), undefined);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test('auth <key> beats leftover ALUVIA_UPSTREAM', async () => {
    tempHome();
    process.env.ALUVIA_UPSTREAM = 'http://user:pass@byo.example:8080';
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
      const result = await captureOutput(() => handleAuth(['aluvia_secret_test_key']));
      assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
      assert.strictEqual(result.data.status, 'authenticated');
      assert.strictEqual(resolveCredential().kind, 'token');
      const status = await captureOutput(() => handleAuth(['status']));
      assert.strictEqual(status.data.provider, 'aluvia');
      assert.strictEqual(status.data.authenticated, true);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test('auth login with a pending session does not reprint the URL', async () => {
    tempHome();
    ensureInstallId();
    const origFetch = globalThis.fetch;
    const origError = console.error;
    const stderr: string[] = [];
    console.error = (...args: unknown[]) => {
      stderr.push(args.map(String).join(' '));
    };
    globalThis.fetch = (async (url: string | URL) => {
      const href = String(url);
      if (href.includes('/auth/cli/init')) {
        return new Response(
          JSON.stringify({
            device_code: 'dev-wait',
            user_code: 'WAIT1',
            verification_uri: 'https://dashboard.aluvia.io/cli-auth',
            verification_uri_complete: 'https://dashboard.aluvia.io/cli-auth?cli_code=WAIT1',
            interval: 1,
            expires_in: 600,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (href.includes('/auth/cli/poll')) {
        return new Response(JSON.stringify({ status: 'approved', api_key: 'aluvia_from_login' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (href.includes('/account')) {
        return new Response(JSON.stringify({ success: true, data: { id: 'acct-1' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch ${href}`);
    }) as typeof fetch;
    try {
      await paymentRequiredPayload(
        new PaymentRequiredError('used up', 'https://dashboard.aluvia.io/cli-auth'),
      );
      stderr.length = 0;
      const result = await captureOutput(() => handleAuth(['login']));
      assert.strictEqual(result.isError, false, String(result.data.error ?? ''));
      assert.strictEqual(result.data.status, 'authenticated');
      assert.ok(!stderr.some((line) => line.includes('cli-auth')));
    } finally {
      globalThis.fetch = origFetch;
      console.error = origError;
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
      configFile: path.join(home!, 'config.json'),
    });

    saveUpstream('http://user:pass@byo.example:8080');
    const byo = await captureOutput(() => handleAuth(['status']));
    assert.strictEqual(byo.isError, false);
    assert.deepStrictEqual(byo.data, { authenticated: false, provider: 'custom' });
  });

  function mockDeviceFlow(opts: {
    poll: () => Record<string, unknown>;
    interval?: number;
    expiresIn?: number;
  }): typeof fetch {
    return (async (url: string | URL) => {
      const href = String(url);
      if (href.includes('/auth/cli/init')) {
        return new Response(
          JSON.stringify({
            device_code: 'dev-login',
            user_code: 'LOGIN',
            verification_uri: 'https://dashboard.aluvia.io/cli-auth',
            verification_uri_complete: 'https://dashboard.aluvia.io/cli-auth?cli_code=LOGIN',
            interval: opts.interval ?? 1,
            expires_in: opts.expiresIn ?? 600,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (href.includes('/auth/cli/poll')) {
        return new Response(JSON.stringify(opts.poll()), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch ${href}`);
    }) as typeof fetch;
  }

  test('auth login denied clears the pending session', async () => {
    tempHome();
    const origFetch = globalThis.fetch;
    globalThis.fetch = mockDeviceFlow({ poll: () => ({ status: 'denied' }) });
    try {
      const result = await captureOutput(() => handleAuth(['login']));
      assert.strictEqual(result.isError, true);
      assert.match(String(result.data.error), /denied/);
      assert.strictEqual(getPendingCliAuth(), undefined);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test('auth login expired tells the agent to run login again', async () => {
    tempHome();
    const origFetch = globalThis.fetch;
    globalThis.fetch = mockDeviceFlow({ poll: () => ({ status: 'expired' }) });
    try {
      const result = await captureOutput(() => handleAuth(['login']));
      assert.strictEqual(result.isError, true);
      assert.match(String(result.data.error), /auth login/);
      assert.strictEqual(getPendingCliAuth(), undefined);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test('auth login times out while still pending', async () => {
    tempHome();
    const origFetch = globalThis.fetch;
    globalThis.fetch = mockDeviceFlow({
      poll: () => ({ status: 'pending' }),
      interval: 1,
      expiresIn: 1,
    });
    try {
      const result = await captureOutput(() => handleAuth(['login']));
      assert.strictEqual(result.isError, true);
      assert.match(String(result.data.error), /Timed out/);
      assert.match(String(result.data.error), /auth login/);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test('auth login approved without api_key is an error', async () => {
    tempHome();
    const origFetch = globalThis.fetch;
    globalThis.fetch = mockDeviceFlow({ poll: () => ({ status: 'approved' }) });
    try {
      const result = await captureOutput(() => handleAuth(['login']));
      assert.strictEqual(result.isError, true);
      assert.match(String(result.data.error), /no API key/);
      assert.strictEqual(getPendingCliAuth(), undefined);
    } finally {
      globalThis.fetch = origFetch;
    }
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
