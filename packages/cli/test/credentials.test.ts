import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PaymentRequiredError } from '@aluvia/sdk';
import { captureOutput } from '../src/mcp-helpers.js';
import { handleAuth } from '../src/auth.js';
import {
  paymentRequiredOutput,
  resolveCredential,
} from '../src/api-helpers.js';
import { ensureInstallId, saveApiKey, saveUpstream } from '../src/config.js';

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

  test('paymentRequiredOutput maps PaymentRequiredError', () => {
    const err = new PaymentRequiredError('used up', 'https://dashboard.aluvia.io/cli-auth');
    assert.deepStrictEqual(paymentRequiredOutput(err), {
      error: 'used up',
      code: 'payment_required',
      claim_url: 'https://dashboard.aluvia.io/cli-auth',
    });
    assert.strictEqual(paymentRequiredOutput(new Error('nope')), null);
  });

  test('auth init sends stored install_id', async () => {
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
      const result = await captureOutput(() => handleAuth([]));
      assert.strictEqual(result.isError, true);
      assert.match(String(result.data.error), /Could not start authentication/);
      assert.ok(initBody && typeof initBody === 'object');
      assert.strictEqual((initBody as { install_id?: string }).install_id, installId);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
