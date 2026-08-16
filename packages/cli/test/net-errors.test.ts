import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
  ApiError,
  InvalidApiKeyError,
  MissingApiKeyError,
  PaymentRequiredError,
  ProxyStartError,
} from '../src/net/errors.js';

describe('Error classes', () => {
  test('MissingApiKeyError has correct name', () => {
    const error = new MissingApiKeyError();
    assert.strictEqual(error.name, 'MissingApiKeyError');
  });

  test('InvalidApiKeyError has correct name', () => {
    const error = new InvalidApiKeyError();
    assert.strictEqual(error.name, 'InvalidApiKeyError');
  });

  test('ApiError has correct name and statusCode', () => {
    const error = new ApiError('Test error', 500);
    assert.strictEqual(error.name, 'ApiError');
    assert.strictEqual(error.statusCode, 500);
  });

  test('PaymentRequiredError has name, status, and claimUrl', () => {
    const error = new PaymentRequiredError('pay up', 'https://dashboard.aluvia.io/cli-auth');
    assert.strictEqual(error.name, 'PaymentRequiredError');
    assert.strictEqual(error.statusCode, 402);
    assert.strictEqual(error.claimUrl, 'https://dashboard.aluvia.io/cli-auth');
  });

  test('ProxyStartError has correct name', () => {
    const error = new ProxyStartError();
    assert.strictEqual(error.name, 'ProxyStartError');
  });
});
