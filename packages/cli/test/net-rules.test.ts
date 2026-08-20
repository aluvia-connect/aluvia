import { describe, test } from 'node:test';
import assert from 'node:assert';
import { matchPattern, shouldProxy } from '../src/net/rules.js';

describe('matchPattern', () => {
  test('* matches any hostname', () => {
    assert.strictEqual(matchPattern('example.com', '*'), true);
    assert.strictEqual(matchPattern('foo.bar.com', '*'), true);
  });

  test('exact match works', () => {
    assert.strictEqual(matchPattern('example.com', 'example.com'), true);
    assert.strictEqual(matchPattern('example.com', 'other.com'), false);
  });

  test('*.example.com matches subdomains', () => {
    assert.strictEqual(matchPattern('foo.example.com', '*.example.com'), true);
    assert.strictEqual(matchPattern('bar.example.com', '*.example.com'), true);
    assert.strictEqual(matchPattern('example.com', '*.example.com'), false);
  });

  test('google.* matches TLD variations', () => {
    assert.strictEqual(matchPattern('google.com', 'google.*'), true);
    assert.strictEqual(matchPattern('google.co.uk', 'google.*'), true);
    assert.strictEqual(matchPattern('notgoogle.com', 'google.*'), false);
  });

  test('trims whitespace in patterns', () => {
    assert.strictEqual(matchPattern('example.com', ' example.com '), true);
    assert.strictEqual(matchPattern('foo.example.com', ' *.example.com '), true);
  });
});

describe('shouldProxy', () => {
  test('empty rules returns false', () => {
    assert.strictEqual(shouldProxy('example.com', []), false);
  });

  test('["*"] proxies everything', () => {
    assert.strictEqual(shouldProxy('example.com', ['*']), true);
    assert.strictEqual(shouldProxy('any.domain.com', ['*']), true);
  });

  test('specific domain only proxies that domain', () => {
    assert.strictEqual(shouldProxy('example.com', ['example.com']), true);
    assert.strictEqual(shouldProxy('other.com', ['example.com']), false);
  });

  test('negative rules exclude hosts', () => {
    assert.strictEqual(shouldProxy('example.com', ['*', '-example.com']), false);
    assert.strictEqual(shouldProxy('other.com', ['*', '-example.com']), true);
  });

  test('AUTO is ignored as placeholder', () => {
    assert.strictEqual(shouldProxy('example.com', ['AUTO']), false);
    assert.strictEqual(shouldProxy('example.com', ['AUTO', 'example.com']), true);
  });

  test('trims hostname and rules and drops empty rules', () => {
    assert.strictEqual(shouldProxy(' example.com ', [' example.com ']), true);
    assert.strictEqual(shouldProxy('example.com', ['   ', '\n']), false);
    assert.strictEqual(shouldProxy('example.com', ['*', ' -example.com ']), false);
  });
});
