import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import tls from 'node:tls';
import { DEFAULT_PROBE_URLS, probeAluviaTunnel, probeUntilReady } from '../src/proxy.js';
import { MOCK_EGRESS_IP, MOCK_TLS } from './helpers/mock-gateway.js';

const ENV_KEYS = [
  'ALUVIA_PROBE_URL',
  'ALUVIA_DATACENTER_IP',
  'ALUVIA_PROBE_RETRY_DELAY_MS',
  'ALUVIA_PROBE_RETRY_ATTEMPTS',
] as const;

function snapshotEnv(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) out[key] = process.env[key];
  return out;
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
}

function writeIpHttp(
  stream: { write: (s: string) => void; end: () => void },
  body: string,
  status = 200,
): void {
  const reason = status === 200 ? 'OK' : 'Error';
  stream.write(
    `HTTP/1.1 ${status} ${reason}\r\nContent-Type: text/plain\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`,
  );
  stream.end();
}

async function listenProxy(opts: {
  connectStatus?: number;
  ip?: string;
  tunnelStatus?: number;
  connectStatuses?: number[];
  connectStatusForHost?: Record<string, number>;
}): Promise<{ port: number; methods: string[]; close: () => Promise<void> }> {
  const methods: string[] = [];
  const queued = opts.connectStatuses ? [...opts.connectStatuses] : [];
  const connectStatus = opts.connectStatus ?? 200;
  const ip = opts.ip ?? MOCK_EGRESS_IP;
  const tunnelStatus = opts.tunnelStatus ?? 200;
  const server = http.createServer((req, res) => {
    methods.push(`${req.method ?? 'GET'} ${req.url ?? ''}`);
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('9.9.9.9');
  });
  server.on('connect', (req, socket, head) => {
    methods.push(`CONNECT ${req.url ?? ''}`);
    const host = (req.url ?? '').split(':')[0] ?? '';
    const status = queued.length > 0 ? queued.shift()! : (opts.connectStatusForHost?.[host] ?? connectStatus);
    if (status !== 200) {
      socket.write(`HTTP/1.1 ${status} Fail\r\nConnection: close\r\n\r\n`);
      socket.end();
      return;
    }
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length) socket.unshift(head);
    const secure = new tls.TLSSocket(socket, {
      isServer: true,
      secureContext: tls.createSecureContext({ key: MOCK_TLS.key, cert: MOCK_TLS.cert }),
    });
    let acc = '';
    secure.on('data', (chunk) => {
      acc += chunk.toString('utf8');
      if (!acc.includes('\r\n\r\n')) return;
      writeIpHttp(secure, ip, tunnelStatus);
    });
  });
  const port: number = await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : 0);
    });
    server.on('error', reject);
  });
  return {
    port,
    methods,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

describe('probeAluviaTunnel', { concurrency: 1 }, () => {
  const originalEnv = snapshotEnv();

  beforeEach(() => {
    process.env.ALUVIA_PROBE_URL = 'https://api.ipify.org/';
    delete process.env.ALUVIA_DATACENTER_IP;
  });

  afterEach(() => {
    restoreEnv(originalEnv);
  });

  test('probes with HTTPS CONNECT, not a plain HTTP GET', async () => {
    const proxy = await listenProxy({ ip: '107.77.213.210' });
    try {
      const result = await probeAluviaTunnel(proxy.port);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.status, 200);
      assert.strictEqual(result.ip, '107.77.213.210');
      assert.strictEqual(result.upstreamUnavailable, false);
      assert.deepStrictEqual(proxy.methods, ['CONNECT api.ipify.org:443']);
    } finally {
      await proxy.close();
    }
  });

  test('ready is false when CONNECT 200 returns the datacenter IP', async () => {
    process.env.ALUVIA_DATACENTER_IP = '104.30.175.37';
    const proxy = await listenProxy({ ip: '104.30.175.37' });
    try {
      const result = await probeAluviaTunnel(proxy.port);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.status, 200);
      assert.strictEqual(result.ip, '104.30.175.37');
      assert.strictEqual(result.upstreamUnavailable, false);
      assert.deepStrictEqual(proxy.methods, ['CONNECT api.ipify.org:443']);
    } finally {
      await proxy.close();
    }
  });

  test('CONNECT 590 sets upstreamUnavailable and is not ok', async () => {
    const proxy = await listenProxy({ connectStatus: 590 });
    try {
      const result = await probeAluviaTunnel(proxy.port);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.status, 590);
      assert.strictEqual(result.ip, null);
      assert.strictEqual(result.upstreamUnavailable, true);
      assert.deepStrictEqual(proxy.methods, ['CONNECT api.ipify.org:443']);
    } finally {
      await proxy.close();
    }
  });

  test('CONNECT 503 sets upstreamUnavailable and is not ok', async () => {
    const proxy = await listenProxy({ connectStatus: 503 });
    try {
      const result = await probeAluviaTunnel(proxy.port);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.status, 503);
      assert.strictEqual(result.ip, null);
      assert.strictEqual(result.upstreamUnavailable, true);
      assert.deepStrictEqual(proxy.methods, ['CONNECT api.ipify.org:443']);
    } finally {
      await proxy.close();
    }
  });

  test('HTTP GET 200 through the proxy is ignored when CONNECT returns 590', async () => {
    const proxy = await listenProxy({ connectStatus: 590 });
    try {
      const result = await probeAluviaTunnel(proxy.port);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.upstreamUnavailable, true);
      assert.ok(!proxy.methods.some((method) => method.startsWith('GET')));
      assert.deepStrictEqual(proxy.methods, ['CONNECT api.ipify.org:443']);
    } finally {
      await proxy.close();
    }
  });

  test('default health check is not only api.ipify.org', () => {
    assert.ok(DEFAULT_PROBE_URLS.includes('https://api.ipify.org/'));
    assert.ok(DEFAULT_PROBE_URLS.includes('https://ifconfig.me/ip'));
    assert.ok(DEFAULT_PROBE_URLS.includes('https://icanhazip.com/'));
    assert.ok(DEFAULT_PROBE_URLS.length >= 3);
  });

  test('590 on api.ipify.org then success on ifconfig.me is a live tunnel', async () => {
    delete process.env.ALUVIA_PROBE_URL;
    process.env.ALUVIA_PROBE_RETRY_ATTEMPTS = '1';
    const proxy = await listenProxy({
      ip: '107.77.213.210',
      connectStatusForHost: { 'api.ipify.org': 590 },
    });
    try {
      const result = await probeUntilReady(proxy.port);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.ip, '107.77.213.210');
      assert.ok(proxy.methods.includes('CONNECT api.ipify.org:443'));
      assert.ok(proxy.methods.includes('CONNECT ifconfig.me:443'));
    } finally {
      await proxy.close();
    }
  });

  test('590 then success on the next attempt of the same host is ok', async () => {
    process.env.ALUVIA_PROBE_RETRY_DELAY_MS = '10';
    process.env.ALUVIA_PROBE_RETRY_ATTEMPTS = '3';
    const proxy = await listenProxy({
      ip: '107.77.213.210',
      connectStatuses: [590, 200],
    });
    try {
      const result = await probeUntilReady(proxy.port);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.ip, '107.77.213.210');
      assert.deepStrictEqual(proxy.methods, ['CONNECT api.ipify.org:443', 'CONNECT api.ipify.org:443']);
    } finally {
      await proxy.close();
    }
  });
});
