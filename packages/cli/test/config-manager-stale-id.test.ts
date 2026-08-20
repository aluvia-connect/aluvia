import { describe, test } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { ConfigManager } from '../src/net/config-manager.js';

function envelope(id: number) {
  return {
    data: {
      connection_id: id,
      id,
      proxy_username: 'user',
      proxy_password: 'pass',
      rules: [],
      session_id: 's'.repeat(32),
      target_geo: null,
    },
  };
}

describe('ConfigManager stale connection id', () => {
  test('GET 404 falls back to POST create', async () => {
    const requests: Array<{ method: string; url: string }> = [];
    const server = http.createServer((req, res) => {
      const url = req.url ?? '';
      requests.push({ method: req.method ?? '', url });
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.method === 'GET' && url.startsWith('/account/connections/9999')) {
        send(404, { error: 'not found' });
        return;
      }
      if (req.method === 'POST' && url === '/account/connections') {
        send(201, envelope(77));
        return;
      }
      send(500, { error: 'unexpected' });
    });
    const url: string = await new Promise((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve(`http://127.0.0.1:${port}`);
      });
      server.on('error', reject);
    });
    try {
      const manager = new ConfigManager({
        apiKey: 'test-key',
        apiBaseUrl: url,
        pollIntervalMs: 0,
        gatewayProtocol: 'http',
        gatewayPort: 8080,
        logLevel: 'silent',
        connectionId: 9999,
      });
      await manager.init();
      assert.strictEqual(manager.connectionId, 77);
      assert.ok(
        requests.some((req) => req.method === 'GET' && req.url.startsWith('/account/connections/9999')),
      );
      assert.ok(requests.some((req) => req.method === 'POST' && req.url === '/account/connections'));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
