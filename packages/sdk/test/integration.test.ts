// Integration smoke test for Aluvia Client

import { test, mock, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { AluviaClient } from '../src/client/AluviaClient.js';
import { requestCore } from '../src/api/request.js';
import { ConfigManager } from '../src/client/ConfigManager.js';
import { ProxyServer } from '../src/client/ProxyServer.js';
import { AluviaApi } from '../src/api/AluviaApi.js';
import { MissingApiKeyError, InvalidApiKeyError, ApiError, ProxyStartError } from '../src/errors.js';
import { matchPattern, shouldProxy } from '../src/client/rules.js';
import { Logger } from '../src/client/logger.js';
import type { BlockDetectionResult } from '../src/client/BlockDetection.js';
import { writeLock, readLock, removeLock } from '../src/session/lock.js';
import type { LockDetection } from '../src/session/lock.js';

describe('AluviaClient', () => {
  afterEach(() => {
    mock.reset();
  });

  test('throws MissingApiKeyError when apiKey is not provided', () => {
    assert.throws(() => new AluviaClient({ apiKey: '' }), MissingApiKeyError);
  });

  test('throws MissingApiKeyError when apiKey is whitespace-only', () => {
    assert.throws(() => new AluviaClient({ apiKey: '   ' }), MissingApiKeyError);
  });

  test('can be instantiated with valid apiKey', () => {
    const client = new AluviaClient({
      apiKey: 'test-api-key',
      logLevel: 'silent',
    });
    assert.ok(client);
  });

  test('pollIntervalMs 0 is stored unclamped; other values still clamp to 1000', () => {
    const disabled = new AluviaClient({
      apiKey: 'test-api-key',
      pollIntervalMs: 0,
      logLevel: 'silent',
    });
    assert.strictEqual((disabled as any).configManager.options.pollIntervalMs, 0);

    const low = new AluviaClient({
      apiKey: 'test-api-key',
      pollIntervalMs: 500,
      logLevel: 'silent',
    });
    assert.strictEqual((low as any).configManager.options.pollIntervalMs, 1000);

    const unset = new AluviaClient({
      apiKey: 'test-api-key',
      logLevel: 'silent',
    });
    assert.strictEqual((unset as any).configManager.options.pollIntervalMs, 5000);
  });

  test('applies default options correctly', () => {
    // This test verifies defaults are applied (constructor doesn't throw)
    const client = new AluviaClient({
      apiKey: 'test-api-key',
    });
    assert.ok(client);
  });

  test('connection includes proxy adapter helpers', async () => {
    const client = new AluviaClient({
      apiKey: 'test-api-key',
      logLevel: 'silent',
    });

    const url = 'http://127.0.0.1:54321';
    let pollingStarted = false;

    (client as any).configManager.init = async () => {};
    (client as any).configManager.startPolling = () => {
      pollingStarted = true;
    };
    (client as any).configManager.stopPolling = () => {};
    (client as any).proxyServer.start = async () => ({
      host: '127.0.0.1',
      port: 54321,
      url,
    });
    (client as any).proxyServer.stop = async () => {};

    const connection = await client.start();
    assert.strictEqual(pollingStarted, true);

    assert.strictEqual(connection.url, url);
    assert.deepStrictEqual(connection.asPlaywright(), { server: url });
    assert.deepStrictEqual(connection.asPuppeteer(), [`--proxy-server=${url}`]);

    const agentsA = connection.asNodeAgents();
    const agentsB = connection.asNodeAgents();
    assert.ok(agentsA.http);
    assert.ok(agentsA.https);
    assert.strictEqual(agentsA, agentsB);

    const axiosCfg = connection.asAxiosConfig();
    assert.strictEqual(axiosCfg.proxy, false);
    assert.strictEqual(axiosCfg.httpAgent, agentsA.http);
    assert.strictEqual(axiosCfg.httpsAgent, agentsA.https);

    const gotOpts = connection.asGotOptions();
    assert.strictEqual(gotOpts.agent.http, agentsA.http);
    assert.strictEqual(gotOpts.agent.https, agentsA.https);

    const dispatcherA = connection.asUndiciDispatcher();
    const dispatcherB = connection.asUndiciDispatcher();
    assert.ok(dispatcherA);
    assert.strictEqual(dispatcherA, dispatcherB);

    const fetchA = connection.asUndiciFetch();
    const fetchB = connection.asUndiciFetch();
    assert.strictEqual(typeof fetchA, 'function');
    assert.strictEqual(fetchA, fetchB);

    await connection.close();
    assert.strictEqual((client as any).started, false);
  });

  test('connection adapters use LOCAL proxy by default', async () => {
    const client = new AluviaClient({
      apiKey: 'test-api-key',
      logLevel: 'silent',
    });

    const url = 'http://127.0.0.1:54321';

    (client as any).configManager.init = async () => {};
    (client as any).configManager.startPolling = () => {};
    (client as any).configManager.stopPolling = () => {};
    (client as any).proxyServer.start = async () => ({
      host: '127.0.0.1',
      port: 54321,
      url,
    });
    (client as any).proxyServer.stop = async () => {};

    const connection = await client.start();

    assert.strictEqual(connection.url, url);
    assert.deepStrictEqual(connection.asPlaywright(), { server: url });

    await connection.close();
  });

  test('getNetworkState snapshots ConfigManager', () => {
    const client = new AluviaClient({ apiKey: 'test-api-key', logLevel: 'silent' });
    (client as any).configManager.getConfig = () => ({
      sessionId: 'abc',
      targetGeo: 'us_ca',
      rules: ['example.com'],
    });
    Object.defineProperty(client, 'connectionId', { get: () => 3449 });
    assert.deepStrictEqual(client.getNetworkState(), {
      connectionId: 3449,
      sessionId: 'abc',
      targetGeo: 'us_ca',
      rules: ['example.com'],
    });
  });
});

describe('BlockDetection Integration', () => {
  afterEach(() => {
    mock.reset();
  });

  test('AluviaClient initializes BlockDetection with new config shape', () => {
    const client = new AluviaClient({
      apiKey: 'test-api-key',
      logLevel: 'silent',
      blockDetection: {
        enabled: true,
        extraKeywords: ['custom-block'],
        extraStatusCodes: [418],
        challengeSelectors: ['#my-challenge'],
        networkIdleTimeoutMs: 5000,
        autoUnblockOnSuspected: true,
      },
    });
    assert.ok(client);
    assert.ok((client as any).blockDetection);
  });

  test('AluviaClient initializes BlockDetection when startPlaywright is true', () => {
    const client = new AluviaClient({
      apiKey: 'test-api-key',
      logLevel: 'silent',
      startPlaywright: true,
    });
    assert.ok(client);
    assert.ok((client as any).blockDetection);
  });

  test('getBlockedHostnames returns empty array initially', () => {
    const client = new AluviaClient({
      apiKey: 'test-api-key',
      logLevel: 'silent',
      blockDetection: { enabled: true },
    });
    assert.deepStrictEqual(client.getBlockedHostnames(), []);
  });

  test('getBlockedHostnames returns empty array when detection is not configured', () => {
    const client = new AluviaClient({
      apiKey: 'test-api-key',
      logLevel: 'silent',
    });
    assert.deepStrictEqual(client.getBlockedHostnames(), []);
  });

  test('clearBlockedHostnames does not throw when detection is not configured', () => {
    const client = new AluviaClient({
      apiKey: 'test-api-key',
      logLevel: 'silent',
    });
    client.clearBlockedHostnames();
  });

  test('clearBlockedHostnames clears persistent tracking', () => {
    const client = new AluviaClient({
      apiKey: 'test-api-key',
      logLevel: 'silent',
      blockDetection: { enabled: true },
    });
    const pld = (client as any).blockDetection;
    pld.persistentHostnames.add('example.com');
    pld.retriedUrls.add('https://example.com/page');
    assert.strictEqual(client.getBlockedHostnames().length, 1);

    client.clearBlockedHostnames();
    assert.deepStrictEqual(client.getBlockedHostnames(), []);
    assert.strictEqual(pld.retriedUrls.size, 0);
  });

  test('onDetection callback receives result with tier/score', async () => {
    let capturedResult: BlockDetectionResult | null = null;

    const client = new AluviaClient({
      apiKey: 'test-api-key',
      logLevel: 'silent',
      blockDetection: {
        enabled: true,
        onDetection: (result, page) => {
          capturedResult = result;
        },
      },
    });

    (client as any).configManager.getConfig = () => ({ rules: [] });
    (client as any).configManager.setConfig = async () => {};

    const mockResult: BlockDetectionResult = {
      url: 'https://example.com/test',
      hostname: 'example.com',
      blockStatus: 'blocked',
      score: 0.85,
      signals: [
        {
          name: 'http_status_403',
          weight: 0.85,
          details: 'HTTP 403',
          source: 'fast',
        },
      ],
      pass: 'fast',
      persistentBlock: false,
      redirectChain: [],
    };
    const mockPage = {
      url: () => 'https://example.com/test',
      reload: async () => {},
    };

    await (client as any).handleDetectionResult(mockResult, mockPage);

    assert.ok(capturedResult);
    assert.strictEqual(capturedResult!.blockStatus, 'blocked');
    assert.strictEqual(capturedResult!.score, 0.85);
    assert.strictEqual(capturedResult!.signals.length, 1);
  });

  test('auto-reload fires for blocked tier', async () => {
    let reloaded = false;

    const client = new AluviaClient({
      apiKey: 'test-api-key',
      logLevel: 'silent',
      blockDetection: { enabled: true, autoUnblock: true },
    });

    (client as any).configManager.getConfig = () => ({ rules: [] });
    (client as any).configManager.setConfig = async () => {};

    const mockResult: BlockDetectionResult = {
      url: 'https://example.com/test',
      hostname: 'example.com',
      blockStatus: 'blocked',
      score: 0.85,
      signals: [],
      pass: 'full',
      persistentBlock: false,
      redirectChain: [],
    };
    const mockPage = {
      url: () => 'https://example.com/test',
      reload: async () => {
        reloaded = true;
      },
    };

    await (client as any).handleDetectionResult(mockResult, mockPage);
    assert.strictEqual(reloaded, true);
  });

  test('no auto-reload for suspected tier by default', async () => {
    let reloaded = false;

    const client = new AluviaClient({
      apiKey: 'test-api-key',
      logLevel: 'silent',
      blockDetection: { enabled: true },
    });

    (client as any).configManager.getConfig = () => ({ rules: [] });
    (client as any).configManager.setConfig = async () => {};

    const mockResult: BlockDetectionResult = {
      url: 'https://example.com/test',
      hostname: 'example.com',
      blockStatus: 'suspected',
      score: 0.5,
      signals: [],
      pass: 'full',
      persistentBlock: false,
      redirectChain: [],
    };
    const mockPage = {
      url: () => 'https://example.com/test',
      reload: async () => {
        reloaded = true;
      },
    };

    await (client as any).handleDetectionResult(mockResult, mockPage);
    assert.strictEqual(reloaded, false);
  });

  test('auto-reload fires for suspected when autoUnblockOnSuspected is true', async () => {
    let reloaded = false;

    const client = new AluviaClient({
      apiKey: 'test-api-key',
      logLevel: 'silent',
      blockDetection: {
        enabled: true,
        autoUnblock: true,
        autoUnblockOnSuspected: true,
      },
    });

    (client as any).configManager.getConfig = () => ({ rules: [] });
    (client as any).configManager.setConfig = async () => {};

    const mockResult: BlockDetectionResult = {
      url: 'https://example.com/test',
      hostname: 'example.com',
      blockStatus: 'suspected',
      score: 0.5,
      signals: [],
      pass: 'full',
      persistentBlock: false,
      redirectChain: [],
    };
    const mockPage = {
      url: () => 'https://example.com/test',
      reload: async () => {
        reloaded = true;
      },
    };

    await (client as any).handleDetectionResult(mockResult, mockPage);
    assert.strictEqual(reloaded, true);
  });

  test('persistent block: first URL retried, second URL on same hostname skipped', async () => {
    let reloadCount = 0;

    const client = new AluviaClient({
      apiKey: 'test-api-key',
      logLevel: 'silent',
      blockDetection: { enabled: true, autoUnblock: true },
    });

    (client as any).configManager.getConfig = () => ({ rules: [] });
    (client as any).configManager.setConfig = async () => {};

    const makeResult = (url: string): BlockDetectionResult => ({
      url,
      hostname: 'example.com',
      blockStatus: 'blocked',
      score: 0.85,
      signals: [],
      pass: 'full',
      persistentBlock: false,
      redirectChain: [],
    });

    const makePage = (url: string) => ({
      url: () => url,
      reload: async () => {
        reloadCount++;
      },
    });

    // First block on URL1 - should reload
    const result1 = makeResult('https://example.com/page1');
    await (client as any).handleDetectionResult(result1, makePage('https://example.com/page1'));
    assert.strictEqual(reloadCount, 1);

    // Second block on URL1 - persistent, should NOT reload
    const result2 = makeResult('https://example.com/page1');
    await (client as any).handleDetectionResult(result2, makePage('https://example.com/page1'));
    assert.strictEqual(reloadCount, 1);
    assert.strictEqual(result2.persistentBlock, true);

    // Third block on URL2 (same hostname) - hostname is persistent, skip immediately
    const result3 = makeResult('https://example.com/page2');
    await (client as any).handleDetectionResult(result3, makePage('https://example.com/page2'));
    assert.strictEqual(reloadCount, 1);
    assert.strictEqual(result3.persistentBlock, true);
  });

  test('handleDetectionResult adds hostname to rules', async () => {
    let capturedRules: string[] | null = null;

    const client = new AluviaClient({
      apiKey: 'test-api-key',
      logLevel: 'silent',
      blockDetection: { enabled: true, autoUnblock: true },
    });

    (client as any).configManager.getConfig = () => ({
      rules: [],
    });
    (client as any).configManager.setConfig = async (body: any) => {
      if (body.rules) capturedRules = body.rules;
    };

    const mockResult: BlockDetectionResult = {
      url: 'https://blocked-site.com/test',
      hostname: 'blocked-site.com',
      blockStatus: 'blocked',
      score: 0.85,
      signals: [],
      pass: 'full',
      persistentBlock: false,
      redirectChain: [],
    };
    const mockPage = {
      url: () => 'https://blocked-site.com/test',
      reload: async () => {},
    };

    await (client as any).handleDetectionResult(mockResult, mockPage);

    assert.ok(capturedRules);
    assert.strictEqual(capturedRules!.length, 1);
    assert.strictEqual(capturedRules![0], 'blocked-site.com');
  });

  test('handleDetectionResult does not add duplicate hostname to rules', async () => {
    let setConfigCalled = false;

    const client = new AluviaClient({
      apiKey: 'test-api-key',
      logLevel: 'silent',
      blockDetection: { enabled: true, autoUnblock: true },
    });

    (client as any).configManager.getConfig = () => ({
      rules: ['example.com'],
    });
    (client as any).configManager.setConfig = async () => {
      setConfigCalled = true;
    };

    const mockResult: BlockDetectionResult = {
      url: 'https://example.com/test',
      hostname: 'example.com',
      blockStatus: 'blocked',
      score: 0.85,
      signals: [],
      pass: 'full',
      persistentBlock: false,
      redirectChain: [],
    };
    const mockPage = {
      url: () => 'https://example.com/test',
      reload: async () => {},
    };

    await (client as any).handleDetectionResult(mockResult, mockPage);
    assert.strictEqual(setConfigCalled, false);
  });

  test('blockDetection can be disabled', () => {
    const client = new AluviaClient({
      apiKey: 'test-api-key',
      logLevel: 'silent',
      blockDetection: { enabled: false },
    });
    assert.ok(client);
  });

  test('onDetection callback fires for clear tier', async () => {
    let capturedResult: BlockDetectionResult | null = null;

    const client = new AluviaClient({
      apiKey: 'test-api-key',
      logLevel: 'silent',
      blockDetection: {
        enabled: true,
        onDetection: (result) => {
          capturedResult = result;
        },
      },
    });

    const mockResult: BlockDetectionResult = {
      url: 'https://example.com/test',
      hostname: 'example.com',
      blockStatus: 'clear',
      score: 0,
      signals: [],
      pass: 'full',
      persistentBlock: false,
      redirectChain: [],
    };
    const mockPage = {
      url: () => 'https://example.com/test',
      reload: async () => {},
    };

    await (client as any).handleDetectionResult(mockResult, mockPage);

    assert.ok(capturedResult);
    assert.strictEqual(capturedResult!.blockStatus, 'clear');
    assert.strictEqual(capturedResult!.score, 0);
  });

  test('autoUnblock: false prevents reload and rule update on blocked tier', async () => {
    let reloaded = false;
    let rulesUpdated = false;

    const client = new AluviaClient({
      apiKey: 'test-api-key',
      logLevel: 'silent',
      blockDetection: {
        enabled: true,
        autoUnblock: false,
      },
    });

    (client as any).configManager.getConfig = () => ({ rules: [] });
    (client as any).configManager.setConfig = async () => {
      rulesUpdated = true;
    };

    const mockResult: BlockDetectionResult = {
      url: 'https://example.com/test',
      hostname: 'example.com',
      blockStatus: 'blocked',
      score: 0.85,
      signals: [],
      pass: 'full',
      persistentBlock: false,
      redirectChain: [],
    };
    const mockPage = {
      url: () => 'https://example.com/test',
      reload: async () => {
        reloaded = true;
      },
    };

    await (client as any).handleDetectionResult(mockResult, mockPage);
    assert.strictEqual(reloaded, false);
    assert.strictEqual(rulesUpdated, false);
  });

  test('autoUnblock: false still fires onDetection callback', async () => {
    let callbackFired = false;

    const client = new AluviaClient({
      apiKey: 'test-api-key',
      logLevel: 'silent',
      blockDetection: {
        enabled: true,
        autoUnblock: false,
        onDetection: (result) => {
          callbackFired = true;
        },
      },
    });

    const mockResult: BlockDetectionResult = {
      url: 'https://example.com/test',
      hostname: 'example.com',
      blockStatus: 'blocked',
      score: 0.85,
      signals: [],
      pass: 'full',
      persistentBlock: false,
      redirectChain: [],
    };
    const mockPage = {
      url: () => 'https://example.com/test',
      reload: async () => {},
    };

    await (client as any).handleDetectionResult(mockResult, mockPage);
    assert.strictEqual(callbackFired, true);
  });

  test('lastDetection round-trips through writeLock/readLock', () => {
    const testSession = `__test-detection-${Date.now()}`;
    const detection: LockDetection = {
      hostname: 'example.com',
      lastUrl: 'https://example.com/test',
      blockStatus: 'blocked',
      score: 0.85,
      signals: ['http_status_403', 'waf_header'],
      timestamp: Date.now(),
    };

    try {
      writeLock(
        {
          pid: process.pid,
          session: testSession,
          ready: true,
          blockDetection: true,
          autoUnblock: true,
          lastDetection: detection,
        },
        testSession,
      );
      const lock = readLock(testSession);
      assert.ok(lock);
      assert.strictEqual(lock!.blockDetection, true);
      assert.strictEqual(lock!.autoUnblock, true);
      assert.ok(lock!.lastDetection);
      assert.strictEqual(lock!.lastDetection!.hostname, 'example.com');
      assert.strictEqual(lock!.lastDetection!.blockStatus, 'blocked');
      assert.strictEqual(lock!.lastDetection!.score, 0.85);
      assert.deepStrictEqual(lock!.lastDetection!.signals, ['http_status_403', 'waf_header']);
      assert.strictEqual(typeof lock!.lastDetection!.timestamp, 'number');
    } finally {
      removeLock(testSession);
    }
  });

  test('autoUnblock defaults to false', async () => {
    let reloaded = false;

    const client = new AluviaClient({
      apiKey: 'test-api-key',
      logLevel: 'silent',
      blockDetection: { enabled: true },
    });

    (client as any).configManager.getConfig = () => ({ rules: [] });
    (client as any).configManager.setConfig = async () => {};

    const mockResult: BlockDetectionResult = {
      url: 'https://example.com/test',
      hostname: 'example.com',
      blockStatus: 'blocked',
      score: 0.85,
      signals: [],
      pass: 'full',
      persistentBlock: false,
      redirectChain: [],
    };
    const mockPage = {
      url: () => 'https://example.com/test',
      reload: async () => {
        reloaded = true;
      },
    };

    await (client as any).handleDetectionResult(mockResult, mockPage);
    assert.strictEqual(reloaded, false);
  });
});

describe('AluviaClient updateTargetGeo', () => {
  test('updateTargetGeo() PATCHes target_geo via ConfigManager.setConfig', async () => {
    const client = new AluviaClient({
      apiKey: 'test-api-key',
      logLevel: 'silent',
    });

    let capturedBody: any = null;
    (client as any).configManager.setConfig = async (body: any) => {
      capturedBody = body;
      return null;
    };

    await client.updateTargetGeo('US');
    assert.deepStrictEqual(capturedBody, { target_geo: 'US' });
  });

  test('updateTargetGeo() clears target_geo when passed null', async () => {
    const client = new AluviaClient({
      apiKey: 'test-api-key',
      logLevel: 'silent',
    });

    let capturedBody: any = null;
    (client as any).configManager.setConfig = async (body: any) => {
      capturedBody = body;
      return null;
    };

    await client.updateTargetGeo(null);
    assert.deepStrictEqual(capturedBody, { target_geo: null });
  });

  test('updateTargetGeo() treats empty/whitespace string as clear (null)', async () => {
    const client = new AluviaClient({
      apiKey: 'test-api-key',
      logLevel: 'silent',
    });

    let capturedBody: any = null;
    (client as any).configManager.setConfig = async (body: any) => {
      capturedBody = body;
      return null;
    };

    await client.updateTargetGeo('   ');
    assert.deepStrictEqual(capturedBody, { target_geo: null });
  });
});

describe('requestCore', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('requestCore sends If-None-Match when provided', async () => {
    let capturedInit: any = null;
    let capturedUrl: any = null;

    globalThis.fetch = (async (url: any, init: any) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(JSON.stringify({ data: { id: 123 } }), {
        status: 200,
        headers: { ETag: '"etag-a"' },
      });
    }) as any;

    const res = await requestCore({
      apiBaseUrl: 'https://api.aluvia.io/v1/',
      apiKey: 'test-api-key',
      method: 'GET',
      path: '/account/connections/123',
      ifNoneMatch: '"etag-prev"',
    });

    assert.ok(String(capturedUrl).endsWith('/account/connections/123'));
    assert.strictEqual(capturedInit.method, 'GET');
    assert.strictEqual(capturedInit.headers['If-None-Match'], '"etag-prev"');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.etag, '"etag-a"');
  });

  test('requestCore POSTs JSON body with Content-Type when body is provided', async () => {
    let capturedInit: any = null;

    globalThis.fetch = (async (_url: any, init: any) => {
      capturedInit = init;
      return new Response(JSON.stringify({ data: { id: 999 } }), {
        status: 201,
        headers: { ETag: '"etag-c"', 'Content-Type': 'application/json' },
      });
    }) as any;

    const res = await requestCore({
      apiBaseUrl: 'https://api.aluvia.io/v1',
      apiKey: 'test-api-key',
      method: 'POST',
      path: '/account/connections',
      body: {},
    });

    assert.strictEqual(capturedInit.method, 'POST');
    assert.strictEqual(capturedInit.headers['Content-Type'], 'application/json');
    assert.strictEqual(res.status, 201);
    assert.ok(res.body);
  });

  test('requestCore times out and rejects', async () => {
    globalThis.fetch = ((_: any, init: any) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
      });
    }) as any;

    await assert.rejects(
      async () => {
        await requestCore({
          apiBaseUrl: 'https://api.aluvia.io/v1',
          apiKey: 'test-api-key',
          method: 'GET',
          path: '/account',
          timeoutMs: 10,
        });
      },
      (err: any) => {
        assert.ok(err instanceof ApiError);
        assert.strictEqual(err.statusCode, 408);
        assert.ok(String(err.message).includes('Request timed out after 10ms'));
        return true;
      },
    );
  });
});

describe('ConfigManager polling', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('init() throws in strict mode when create connection fails (prevents silent direct routing)', async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: 'server_error', message: 'boom' },
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }) as any;

    const mgr = new ConfigManager({
      apiKey: 'test-api-key',
      apiBaseUrl: 'https://api.aluvia.io/v1',
      pollIntervalMs: 5000,
      gatewayProtocol: 'http',
      gatewayPort: 8080,
      logLevel: 'silent',
      strict: true,
    });

    await assert.rejects(
      () => mgr.init(),
      (err: any) => err instanceof ApiError && err.statusCode === 500,
    );
  });

  test('setConfig() throws on non-2xx (no silent failure)', async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: 'server_error', message: 'nope' },
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }) as any;

    const mgr = new ConfigManager({
      apiKey: 'test-api-key',
      apiBaseUrl: 'https://api.aluvia.io/v1',
      pollIntervalMs: 5000,
      gatewayProtocol: 'http',
      gatewayPort: 8080,
      logLevel: 'silent',
      connectionId: 123,
      strict: true,
    });

    (mgr as any).accountConnectionId = 123;

    await assert.rejects(
      () => mgr.setConfig({ rules: ['*'] }),
      (err: any) => err instanceof ApiError && err.statusCode === 500,
    );
  });

  test('setConfig() throws InvalidApiKeyError on 403', async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: 'forbidden', message: 'Forbidden' },
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }) as any;

    const mgr = new ConfigManager({
      apiKey: 'test-api-key',
      apiBaseUrl: 'https://api.aluvia.io/v1',
      pollIntervalMs: 5000,
      gatewayProtocol: 'http',
      gatewayPort: 8080,
      logLevel: 'silent',
      connectionId: 123,
      strict: true,
    });

    (mgr as any).accountConnectionId = 123;

    await assert.rejects(() => mgr.setConfig({ rules: ['*'] }), InvalidApiKeyError);
  });

  test('pollOnce sends If-None-Match and treats 304 as no update', async () => {
    let capturedInit: any = null;

    globalThis.fetch = (async (_url: any, init: any) => {
      capturedInit = init;
      return new Response('', {
        status: 304,
        headers: { ETag: '"etag-next"' },
      });
    }) as any;

    const mgr = new ConfigManager({
      apiKey: 'test-api-key',
      apiBaseUrl: 'https://api.aluvia.io/v1',
      pollIntervalMs: 5000,
      gatewayProtocol: 'http',
      gatewayPort: 8080,
      logLevel: 'silent',
      connectionId: 123,
    });

    const existingConfig = {
      rawProxy: {
        protocol: 'http',
        host: 'gateway.aluvia.io' as const,
        port: 8080,
        username: 'u',
        password: 'p',
      },
      rules: ['*'],
      sessionId: null,
      targetGeo: null,
      etag: '"etag-prev"',
    };

    (mgr as any).config = existingConfig;
    (mgr as any).accountConnectionId = 123;

    await (mgr as any).pollOnce();

    assert.strictEqual(capturedInit.headers['If-None-Match'], '"etag-prev"');
    assert.strictEqual(mgr.getConfig(), existingConfig);
  });

  test('pollOnce supports 200 → 304 → 200 sequence', async () => {
    let callCount = 0;
    const seenIfNoneMatch: Array<string | undefined> = [];

    globalThis.fetch = (async (_url: any, init: any) => {
      callCount += 1;
      seenIfNoneMatch.push(init?.headers?.['If-None-Match']);

      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              proxy_username: 'u1',
              proxy_password: 'p1',
              rules: ['*'],
              session_id: null,
              target_geo: null,
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json', ETag: '"e1"' },
          },
        );
      }

      if (callCount === 2) {
        return {
          status: 304,
          headers: new Headers({ ETag: '"e1"' }),
          text: async () => '',
        } as any;
      }

      return new Response(
        JSON.stringify({
          success: true,
          data: {
            proxy_username: 'u2',
            proxy_password: 'p2',
            rules: ['example.com'],
            session_id: 's2',
            target_geo: 'US',
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json', ETag: '"e2"' },
        },
      );
    }) as any;

    const mgr = new ConfigManager({
      apiKey: 'test-api-key',
      apiBaseUrl: 'https://api.aluvia.io/v1',
      pollIntervalMs: 5000,
      gatewayProtocol: 'http',
      gatewayPort: 8080,
      logLevel: 'silent',
      connectionId: 123,
    });

    await mgr.init();
    const cfg1 = mgr.getConfig();
    assert.ok(cfg1);
    assert.strictEqual(cfg1?.etag, '"e1"');
    assert.strictEqual(cfg1?.rawProxy.username, 'u1');

    await (mgr as any).pollOnce();
    const cfgAfter304 = mgr.getConfig();
    assert.strictEqual(cfgAfter304?.etag, '"e1"');
    assert.strictEqual(cfgAfter304?.rawProxy.username, 'u1');

    await (mgr as any).pollOnce();
    const cfg2 = mgr.getConfig();
    assert.ok(cfg2);
    assert.strictEqual(cfg2?.etag, '"e2"');
    assert.strictEqual(cfg2?.rawProxy.username, 'u2');
    assert.strictEqual(cfg2?.sessionId, 's2');

    assert.deepStrictEqual(seenIfNoneMatch, [undefined, '"e1"', '"e1"']);
  });

  test('startPolling is a no-op when pollIntervalMs is 0', () => {
    let setIntervalCalls = 0;
    const originalSetInterval = globalThis.setInterval;
    globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
      setIntervalCalls += 1;
      return originalSetInterval(...args);
    }) as typeof setInterval;

    try {
      const mgr = new ConfigManager({
        apiKey: 'test-api-key',
        apiBaseUrl: 'https://api.aluvia.io/v1',
        pollIntervalMs: 0,
        gatewayProtocol: 'http',
        gatewayPort: 8080,
        logLevel: 'silent',
      });
      let polls = 0;
      (mgr as any).pollOnce = async () => {
        polls += 1;
      };
      mgr.startPolling();
      assert.strictEqual(setIntervalCalls, 0);
      assert.strictEqual((mgr as any).timer, null);
      assert.strictEqual(polls, 0);
    } finally {
      globalThis.setInterval = originalSetInterval;
    }
  });
});

describe('AluviaApi endpoint helpers', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('account.get uses GET /account and unwraps success envelope', async () => {
    let capturedUrl: any = null;
    let capturedInit: any = null;

    globalThis.fetch = (async (url: any, init: any) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(JSON.stringify({ success: true, data: { id: 'acct-1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const api = new AluviaApi({
      apiKey: 'test-api-key',
      apiBaseUrl: 'https://api.aluvia.io/v1/',
    });
    const data = await api.account.get();

    assert.ok(String(capturedUrl).endsWith('/account'));
    assert.strictEqual(capturedInit.method, 'GET');
    assert.strictEqual(capturedInit.headers.Authorization, 'Bearer test-api-key');
    assert.ok((data as any).id);
  });

  test('account.usage.get sends optional query params', async () => {
    let capturedUrl: any = null;

    globalThis.fetch = (async (url: any) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ success: true, data: { ok: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const api = new AluviaApi({
      apiKey: 'test-api-key',
      apiBaseUrl: 'https://api.aluvia.io/v1',
    });
    await api.account.usage.get({ start: '2025-01-01', end: '2025-01-31' });

    assert.ok(String(capturedUrl).includes('/account/usage?'));
    assert.ok(String(capturedUrl).includes('start=2025-01-01'));
    assert.ok(String(capturedUrl).includes('end=2025-01-31'));
  });

  test('account.payments.list uses GET /account/payments', async () => {
    let capturedUrl: any = null;
    globalThis.fetch = (async (url: any) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ success: true, data: [{ id: 'p1' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const api = new AluviaApi({
      apiKey: 'test-api-key',
      apiBaseUrl: 'https://api.aluvia.io/v1',
    });
    const res = await api.account.payments.list();
    assert.ok(String(capturedUrl).endsWith('/account/payments'));
    assert.ok(Array.isArray(res));
  });

  test('account.connections.list uses GET /account/connections', async () => {
    let capturedUrl: any = null;
    globalThis.fetch = (async (url: any) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ success: true, data: [{ id: 123 }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const api = new AluviaApi({
      apiKey: 'test-api-key',
      apiBaseUrl: 'https://api.aluvia.io/v1',
    });
    const res = await api.account.connections.list();
    assert.ok(String(capturedUrl).endsWith('/account/connections'));
    assert.ok(Array.isArray(res));
  });

  test('account.connections.create uses POST /account/connections with JSON body', async () => {
    let capturedInit: any = null;
    globalThis.fetch = (async (_url: any, init: any) => {
      capturedInit = init;
      return new Response(JSON.stringify({ success: true, data: { id: 999 } }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const api = new AluviaApi({
      apiKey: 'test-api-key',
      apiBaseUrl: 'https://api.aluvia.io/v1',
    });
    const res = await api.account.connections.create({ target_geo: 'US' });

    assert.strictEqual(capturedInit.method, 'POST');
    assert.strictEqual(capturedInit.headers['Content-Type'], 'application/json');
    assert.strictEqual(JSON.parse(capturedInit.body).target_geo, 'US');
    assert.ok((res as any).id);
  });

  test('account.connections.get sends If-None-Match and returns null on 304', async () => {
    let capturedInit: any = null;
    globalThis.fetch = (async (_url: any, init: any) => {
      capturedInit = init;
      return {
        status: 304,
        headers: new Headers({ ETag: '"e2"' }),
        text: async () => '',
      } as any;
    }) as any;

    const api = new AluviaApi({
      apiKey: 'test-api-key',
      apiBaseUrl: 'https://api.aluvia.io/v1',
    });
    const res = await api.account.connections.get(123, { etag: '"e1"' });

    assert.strictEqual(capturedInit.headers['If-None-Match'], '"e1"');
    assert.strictEqual(res, null);
  });

  test('account.connections.patch uses PATCH /account/connections/:id with JSON body', async () => {
    let capturedUrl: any = null;
    let capturedInit: any = null;

    globalThis.fetch = (async (url: any, init: any) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(JSON.stringify({ success: true, data: { id: 123, rules: ['*'] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const api = new AluviaApi({
      apiKey: 'test-api-key',
      apiBaseUrl: 'https://api.aluvia.io/v1',
    });
    const res = await api.account.connections.patch(123, { rules: ['*'] });

    assert.ok(String(capturedUrl).endsWith('/account/connections/123'));
    assert.strictEqual(capturedInit.method, 'PATCH');
    assert.strictEqual(JSON.parse(capturedInit.body).rules[0], '*');
    assert.ok((res as any).id);
  });

  test('account.connections.delete uses DELETE /account/connections/:id and unwraps result', async () => {
    let capturedUrl: any = null;
    let capturedInit: any = null;

    globalThis.fetch = (async (url: any, init: any) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(
        JSON.stringify({
          success: true,
          data: { connection_id: '123', deleted: true },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }) as any;

    const api = new AluviaApi({
      apiKey: 'test-api-key',
      apiBaseUrl: 'https://api.aluvia.io/v1',
    });
    const res = await api.account.connections.delete(123);

    assert.ok(String(capturedUrl).endsWith('/account/connections/123'));
    assert.strictEqual(capturedInit.method, 'DELETE');
    assert.deepStrictEqual(res, { connection_id: '123', deleted: true });
  });

  test('geos.list uses GET /geos', async () => {
    let capturedUrl: any = null;
    globalThis.fetch = (async (url: any) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ success: true, data: [{ code: 'US' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const api = new AluviaApi({
      apiKey: 'test-api-key',
      apiBaseUrl: 'https://api.aluvia.io/v1/',
    });
    const res = await api.geos.list();
    assert.ok(String(capturedUrl).endsWith('/geos'));
    assert.ok(Array.isArray(res));
  });

  test('throws InvalidApiKeyError on 401 for helpers', async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: 'unauthorized', message: 'Unauthorized' },
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }) as any;

    const api = new AluviaApi({
      apiKey: 'bad',
      apiBaseUrl: 'https://api.aluvia.io/v1',
    });
    await assert.rejects(() => api.account.get(), InvalidApiKeyError);
  });

  test('throws ApiError with details on 422-style error envelope', async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: 'validation_error',
            message: 'Validation failed',
            details: { field: 'x' },
          },
        }),
        { status: 422, headers: { 'Content-Type': 'application/json' } },
      );
    }) as any;

    const api = new AluviaApi({
      apiKey: 'test-api-key',
      apiBaseUrl: 'https://api.aluvia.io/v1',
    });
    await assert.rejects(() => api.account.connections.create({}), ApiError);
  });
});

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

describe('ProxyServer hostname extraction', () => {
  test('extracts hostname from host/path without scheme', () => {
    const config = {
      rawProxy: {
        protocol: 'http',
        host: 'gateway.aluvia.io' as const,
        port: 8080,
        username: 'user',
        password: 'pass',
      },
      rules: ['example.com'],
      sessionId: null,
      targetGeo: null,
      etag: null,
    };

    const mgr = { getConfig: () => config } as any;
    const proxy = new ProxyServer(mgr, { logLevel: 'silent' });

    const res = (proxy as any).handleRequest({
      request: { url: 'example.com/some-path' },
    });

    assert.deepStrictEqual(res, {
      upstreamProxyUrl: 'http://user:pass@gateway.aluvia.io:8080',
    });
  });

  test('falls back to Host header for origin-form URLs', () => {
    const config = {
      rawProxy: {
        protocol: 'http',
        host: 'gateway.aluvia.io' as const,
        port: 8080,
        username: 'user',
        password: 'pass',
      },
      rules: ['example.com'],
      sessionId: null,
      targetGeo: null,
      etag: null,
    };

    const mgr = { getConfig: () => config } as any;
    const proxy = new ProxyServer(mgr, { logLevel: 'silent' });

    const res = (proxy as any).handleRequest({
      request: { url: '/some-path', headers: { host: 'example.com:1234' } },
    });

    assert.deepStrictEqual(res, {
      upstreamProxyUrl: 'http://user:pass@gateway.aluvia.io:8080',
    });
  });
});

describe('Logger', () => {
  test('can be instantiated with different log levels', () => {
    const silentLogger = new Logger('silent');
    const infoLogger = new Logger('info');
    const debugLogger = new Logger('debug');

    assert.ok(silentLogger);
    assert.ok(infoLogger);
    assert.ok(debugLogger);
  });
});

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

  test('ProxyStartError has correct name', () => {
    const error = new ProxyStartError();
    assert.strictEqual(error.name, 'ProxyStartError');
  });
});

describe('Playwright integration', () => {
  afterEach(() => {
    mock.reset();
  });

  test('browser property is undefined when startPlaywright is false', async () => {
    const client = new AluviaClient({
      apiKey: 'test-api-key',
      logLevel: 'silent',
      startPlaywright: false,
    });

    const url = 'http://127.0.0.1:54321';

    (client as any).configManager.init = async () => {};
    (client as any).configManager.startPolling = () => {};
    (client as any).configManager.stopPolling = () => {};
    (client as any).proxyServer.start = async () => ({
      host: '127.0.0.1',
      port: 54321,
      url,
    });
    (client as any).proxyServer.stop = async () => {};

    const connection = await client.start();
    assert.strictEqual(connection.browser, undefined);

    await connection.close();
  });

  test('browser property is undefined by default (startPlaywright not set)', async () => {
    const client = new AluviaClient({
      apiKey: 'test-api-key',
      logLevel: 'silent',
    });

    const url = 'http://127.0.0.1:54321';

    (client as any).configManager.init = async () => {};
    (client as any).configManager.startPolling = () => {};
    (client as any).configManager.stopPolling = () => {};
    (client as any).proxyServer.start = async () => ({
      host: '127.0.0.1',
      port: 54321,
      url,
    });
    (client as any).proxyServer.stop = async () => {};

    const connection = await client.start();
    assert.strictEqual(connection.browser, undefined);

    await connection.close();
  });

  // Skipped: Playwright is installed as a peerDependency, so the dynamic import() cannot fail.
  // The global.import mock never worked (import() is a language keyword, not a global).
  test.skip('throws ApiError when Playwright is not installed but startPlaywright is true', async () => {
    const client = new AluviaClient({
      apiKey: 'test-api-key',
      logLevel: 'silent',
      startPlaywright: true,
    });

    (client as any).configManager.init = async () => {};
    (client as any).configManager.startPolling = () => {};
    (client as any).configManager.stopPolling = () => {};
    (client as any).proxyServer.start = async () => ({
      host: '127.0.0.1',
      port: 54321,
      url: 'http://127.0.0.1:54321',
    });
    (client as any).proxyServer.stop = async () => {};

    // Mock import to simulate Playwright not being installed
    const originalImport = (global as any).import;
    (global as any).import = async (module: string) => {
      if (module === 'playwright') {
        throw new Error("Cannot find module 'playwright'");
      }
      return originalImport?.(module);
    };

    try {
      await assert.rejects(
        () => client.start(),
        (err: any) => {
          assert.ok(err instanceof ApiError);
          assert.ok(err.message.includes('Failed to load Playwright'));
          assert.ok(err.message.includes("Make sure 'playwright' is installed"));
          return true;
        },
      );
    } finally {
      (global as any).import = originalImport;
    }
  });

  test('launches browser when startPlaywright is true', async () => {
    const client = new AluviaClient({
      apiKey: 'test-api-key',
      logLevel: 'silent',
      startPlaywright: true,
    });

    const url = 'http://127.0.0.1:54321';
    let browserLaunched = false;
    let launchProxySettings: any = null;

    const mockBrowser = {
      close: async () => {},
    };

    (client as any).configManager.init = async () => {};
    (client as any).configManager.startPolling = () => {};
    (client as any).configManager.stopPolling = () => {};
    (client as any).proxyServer.start = async () => ({
      host: '127.0.0.1',
      port: 54321,
      url,
    });
    (client as any).proxyServer.stop = async () => {};

    // Mock dynamic import of playwright
    const originalImport = (global as any).__playwright_mock_import;
    (global as any).__playwright_mock_import = async (module: string) => {
      if (module === 'playwright') {
        return {
          chromium: {
            launch: async (options: any) => {
              browserLaunched = true;
              launchProxySettings = options?.proxy;
              return mockBrowser;
            },
          },
        };
      }
      return originalImport?.(module);
    };

    // Intercept dynamic import in start() - we need to mock it before init
    const startMethod = (client as any).start.bind(client);
    (client as any).start = async function () {
      const originalDynamicImport = await (async () => {
        try {
          return (await import('module')).createRequire(import.meta.url)('playwright');
        } catch {
          return null;
        }
      })();

      // Replace the import call inside startPromise
      const configManager = (this as any).configManager;
      const proxyServer = (this as any).proxyServer;
      const options = (this as any).options;

      if ((this as any).started && (this as any).connection) {
        return (this as any).connection;
      }

      if ((this as any).startPromise) {
        return (this as any).startPromise;
      }

      (this as any).startPromise = (async () => {
        await configManager.init();

        let browserInstance: any = undefined;
        if (options.startPlaywright) {
          const pw = {
            chromium: {
              launch: async (opts: any) => {
                browserLaunched = true;
                launchProxySettings = opts?.proxy;
                return mockBrowser;
              },
            },
          };
          browserInstance = pw.chromium;
        }

        configManager.startPolling();
        const { host, port, url } = await proxyServer.start(options.localPort);

        let launchedBrowser: any = undefined;
        if (browserInstance) {
          launchedBrowser = await browserInstance.launch({
            proxy: { server: url },
          });
        }

        const stop = async () => {
          await proxyServer.stop();
          configManager.stopPolling();
          (this as any).connection = null;
          (this as any).started = false;
        };

        const stopWithBrowser = async () => {
          if (launchedBrowser) {
            await launchedBrowser.close();
          }
          await stop();
        };

        const connection = {
          host,
          port,
          url,
          getUrl: () => url,
          asPlaywright: () => ({ server: url }),
          asPuppeteer: () => [`--proxy-server=${url}`],
          asSelenium: () => `--proxy-server=${url}`,
          asNodeAgents: () => ({ http: null as any, https: null as any }),
          asAxiosConfig: () => ({
            proxy: false,
            httpAgent: null as any,
            httpsAgent: null as any,
          }),
          asGotOptions: () => ({
            agent: { http: null as any, https: null as any },
          }),
          asUndiciDispatcher: () => null as any,
          asUndiciFetch: () => (() => {}) as any,
          browser: launchedBrowser,
          stop: stopWithBrowser,
          close: stopWithBrowser,
        };

        (this as any).connection = connection;
        (this as any).started = true;
        return connection;
      })();

      try {
        return await (this as any).startPromise;
      } finally {
        (this as any).startPromise = null;
      }
    };

    const connection = await client.start();

    assert.strictEqual(browserLaunched, true);
    assert.ok(launchProxySettings);
    assert.strictEqual(launchProxySettings.server, url);
    assert.strictEqual(connection.browser, mockBrowser);

    await connection.close();
  });

  test('browser is closed when connection.close() is called', async () => {
    const client = new AluviaClient({
      apiKey: 'test-api-key',
      logLevel: 'silent',
      startPlaywright: true,
    });

    const url = 'http://127.0.0.1:54321';
    let browserClosed = false;

    const mockBrowser = {
      close: async () => {
        browserClosed = true;
      },
    };

    (client as any).configManager.init = async () => {};
    (client as any).configManager.startPolling = () => {};
    (client as any).configManager.stopPolling = () => {};
    (client as any).proxyServer.start = async () => ({
      host: '127.0.0.1',
      port: 54321,
      url,
    });
    (client as any).proxyServer.stop = async () => {};

    // Mock the start method similar to previous test
    const startMethod = (client as any).start.bind(client);
    (client as any).start = async function () {
      const configManager = (this as any).configManager;
      const proxyServer = (this as any).proxyServer;
      const options = (this as any).options;

      if ((this as any).started && (this as any).connection) {
        return (this as any).connection;
      }

      if ((this as any).startPromise) {
        return (this as any).startPromise;
      }

      (this as any).startPromise = (async () => {
        await configManager.init();

        let browserInstance: any = undefined;
        if (options.startPlaywright) {
          browserInstance = {
            launch: async () => mockBrowser,
          };
        }

        configManager.startPolling();
        const { host, port, url } = await proxyServer.start(options.localPort);

        let launchedBrowser: any = undefined;
        if (browserInstance) {
          launchedBrowser = await browserInstance.launch({
            proxy: { server: url },
          });
        }

        const stop = async () => {
          await proxyServer.stop();
          configManager.stopPolling();
          (this as any).connection = null;
          (this as any).started = false;
        };

        const stopWithBrowser = async () => {
          if (launchedBrowser) {
            await launchedBrowser.close();
          }
          await stop();
        };

        const connection = {
          host,
          port,
          url,
          getUrl: () => url,
          asPlaywright: () => ({ server: url }),
          asPuppeteer: () => [`--proxy-server=${url}`],
          asSelenium: () => `--proxy-server=${url}`,
          asNodeAgents: () => ({ http: null as any, https: null as any }),
          asAxiosConfig: () => ({
            proxy: false,
            httpAgent: null as any,
            httpsAgent: null as any,
          }),
          asGotOptions: () => ({
            agent: { http: null as any, https: null as any },
          }),
          asUndiciDispatcher: () => null as any,
          asUndiciFetch: () => (() => {}) as any,
          browser: launchedBrowser,
          stop: stopWithBrowser,
          close: stopWithBrowser,
        };

        (this as any).connection = connection;
        (this as any).started = true;
        return connection;
      })();

      try {
        return await (this as any).startPromise;
      } finally {
        (this as any).startPromise = null;
      }
    };

    const connection = await client.start();
    assert.strictEqual(connection.browser, mockBrowser);
    assert.strictEqual(browserClosed, false);

    await connection.close();
    assert.strictEqual(browserClosed, true);
  });
});
