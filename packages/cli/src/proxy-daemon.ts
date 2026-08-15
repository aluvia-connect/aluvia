import crypto from 'node:crypto';
import { AluviaClient, PaymentRequiredError, isLoopbackHostname } from '@aluvia/sdk';
import { configDir } from './config.js';
import { createControlServer } from './proxy-control-server.js';
import {
  DEFAULT_CONTROL_PORT,
  DEFAULT_DATA_PORT,
  defaultAttach,
  egressFromRules,
  readProxyJson,
  writeProxyJson,
  type LastConnectSnapshot,
  type ProxyAttachState,
  type ProxyJson,
} from './proxy-state.js';

export type ProxyDaemonOptions = {
  dataPort: number;
  controlPort: number;
  connectionId?: number;
  apiKey?: string;
  installId?: string;
  upstream?: {
    protocol: 'http' | 'https';
    host: string;
    port: number;
    username?: string;
    password?: string;
  };
  apiBaseUrl?: string;
  gatewayHost?: string;
  gatewayPort?: number;
};

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (raw == null || raw.trim() === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return undefined;
  return n;
}

function urls(dataPort: number, controlPort: number): { proxyUrl: string; controlUrl: string } {
  return {
    proxyUrl: `http://127.0.0.1:${dataPort}`,
    controlUrl: `http://127.0.0.1:${controlPort}`,
  };
}

export async function handleProxyDaemon(args: string[]): Promise<void> {
  let dataPort = parsePositiveInt(process.env.ALUVIA_PROXY_PORT) ?? DEFAULT_DATA_PORT;
  let controlPort = parsePositiveInt(process.env.ALUVIA_PROXY_CONTROL_PORT) ?? DEFAULT_CONTROL_PORT;
  let connectionId: number | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      dataPort = parsePositiveInt(args[i + 1]) ?? dataPort;
      i++;
    } else if (args[i] === '--control-port' && args[i + 1]) {
      controlPort = parsePositiveInt(args[i + 1]) ?? controlPort;
      i++;
    } else if (args[i] === '--connection-id' && args[i + 1]) {
      connectionId = parsePositiveInt(args[i + 1]);
      i++;
    }
  }

  const apiKey = (process.env.ALUVIA_API_KEY ?? '').trim() || undefined;
  const installId = (process.env.ALUVIA_INSTALL_ID ?? '').trim().toLowerCase() || undefined;
  const upstreamRaw = (process.env.ALUVIA_UPSTREAM ?? '').trim();
  let upstream: ProxyDaemonOptions['upstream'];
  if (upstreamRaw) {
    const url = new URL(upstreamRaw);
    const protocol = url.protocol === 'https:' ? 'https' : 'http';
    upstream = {
      protocol,
      host: url.hostname,
      port: url.port ? Number(url.port) : protocol === 'https' ? 443 : 80,
      ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
      ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    };
  }
  if (!apiKey && !installId && !upstream) {
    throw new Error('No API key found. Run `aluvia auth` to log in, or set ALUVIA_API_KEY.');
  }

  const apiBaseUrl = (process.env.ALUVIA_API_BASE_URL ?? '').trim() || undefined;
  const gatewayHost = (process.env.ALUVIA_GATEWAY_HOST ?? '').trim() || undefined;
  const gatewayPort = parsePositiveInt(process.env.ALUVIA_GATEWAY_PORT);

  await runProxyDaemon({
    dataPort,
    controlPort,
    ...(connectionId != null ? { connectionId } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(installId ? { installId } : {}),
    ...(upstream ? { upstream } : {}),
    ...(apiBaseUrl ? { apiBaseUrl } : {}),
    ...(gatewayHost ? { gatewayHost } : {}),
    ...(gatewayPort != null ? { gatewayPort } : {}),
  });
}

export async function runProxyDaemon(opts: ProxyDaemonOptions): Promise<void> {
  const existing = readProxyJson();
  let attach: ProxyAttachState =
    existing && existing.dataPort === opts.dataPort ? existing.attach : defaultAttach(configDir());
  const { proxyUrl, controlUrl } = urls(opts.dataPort, opts.controlPort);

  const client = new AluviaClient({
    apiKey: opts.apiKey,
    installId: opts.installId,
    upstream: opts.upstream,
    startPlaywright: false,
    localPort: opts.dataPort,
    logLevel: 'info',
    pollIntervalMs: 0,
    ...(opts.connectionId != null ? { connectionId: opts.connectionId } : {}),
    ...(opts.apiBaseUrl ? { apiBaseUrl: opts.apiBaseUrl } : {}),
    ...(opts.gatewayHost ? { gatewayHost: opts.gatewayHost } : {}),
    ...(opts.gatewayPort != null ? { gatewayPort: opts.gatewayPort } : {}),
  });

  let lastConnect: LastConnectSnapshot = { hostname: null, at: null };
  client.setRequestObserver((hostname) => {
    if (isLoopbackHostname(hostname)) return;
    lastConnect = { hostname, at: Date.now() };
    if (attach.status !== 'verified') {
      attach = {
        status: 'verified',
        method: attach.method ?? 'flags',
        verifiedAt: new Date().toISOString(),
        extensionPath: null,
      };
      persist(true);
    }
  });

  const persist = (ready: boolean): void => {
    const netState = client.getNetworkState();
    const data: ProxyJson = {
      pid: process.pid,
      ready,
      dataPort: opts.dataPort,
      controlPort: opts.controlPort,
      proxyUrl,
      controlUrl,
      connectionId: netState.connectionId ?? opts.connectionId ?? existing?.connectionId ?? null,
      sessionId: netState.sessionId,
      targetGeo: netState.targetGeo,
      rules: netState.rules,
      attach,
    };
    writeProxyJson(data);
  };

  writeProxyJson({
    pid: process.pid,
    ready: false,
    dataPort: opts.dataPort,
    controlPort: opts.controlPort,
    proxyUrl,
    controlUrl,
    connectionId: opts.connectionId ?? existing?.connectionId ?? null,
    sessionId: existing?.sessionId ?? null,
    targetGeo: existing?.targetGeo ?? null,
    rules: existing?.rules ?? [],
    attach,
  });

  const failState = (error: string, code?: string | null, claimUrl?: string | null): ProxyJson => ({
    pid: process.pid,
    ready: false,
    dataPort: opts.dataPort,
    controlPort: opts.controlPort,
    proxyUrl,
    controlUrl,
    connectionId: opts.connectionId ?? existing?.connectionId ?? null,
    sessionId: existing?.sessionId ?? null,
    targetGeo: existing?.targetGeo ?? null,
    rules: existing?.rules ?? [],
    attach,
    error,
    code: code ?? null,
    claimUrl: claimUrl ?? null,
  });

  try {
    await client.start();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof PaymentRequiredError) {
      writeProxyJson(failState(err.message, 'payment_required', err.claimUrl));
      throw err;
    }
    if (message.includes('EADDRINUSE')) {
      writeProxyJson(failState(`port ${opts.dataPort} in use`));
      throw new Error(`port ${opts.dataPort} in use`);
    }
    writeProxyJson(failState(message));
    throw err;
  }

  if (!opts.upstream && client.getNetworkState().sessionId == null) {
    await client.updateSessionId(crypto.randomUUID().replace(/-/g, ''));
  }

  let stopping = false;
  const shutdown = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    try {
      server.close();
    } catch {
      // ignore
    }
    try {
      await client.stop();
    } catch {
      // ignore
    }
    const netState = client.getNetworkState();
    writeProxyJson({
      pid: null,
      ready: false,
      dataPort: opts.dataPort,
      controlPort: opts.controlPort,
      proxyUrl,
      controlUrl,
      connectionId: netState.connectionId ?? opts.connectionId ?? existing?.connectionId ?? null,
      sessionId: netState.sessionId ?? existing?.sessionId ?? null,
      targetGeo: netState.targetGeo ?? existing?.targetGeo ?? null,
      rules: netState.rules,
      attach,
    });
    process.exit(0);
  };

  const server = createControlServer({
    getStatus: () => {
      const netState = client.getNetworkState();
      return {
        pid: process.pid,
        proxyUrl,
        controlUrl,
        connectionId: netState.connectionId ?? null,
        sessionId: netState.sessionId,
        targetGeo: netState.targetGeo,
        rules: netState.rules,
        count: netState.rules.length,
        attach,
        egress: egressFromRules(netState.rules),
      };
    },
    proxyOn: async () => {
      await client.updateRules(['*']);
      client.closeAllConnections();
      persist(true);
      return { egress: 'aluvia' as const, rules: client.getNetworkState().rules };
    },
    proxyOff: async () => {
      await client.updateRules([]);
      client.closeAllConnections();
      persist(true);
      return { egress: 'direct' as const, rules: client.getNetworkState().rules };
    },
    route: async (host) => {
      const rules = client.getNetworkState().rules;
      if (!rules.includes(host)) {
        await client.updateRules([...rules, host]);
      }
      client.closeConnectionsForHost(host);
      persist(true);
      return { rules: client.getNetworkState().rules };
    },
    unroute: async (host) => {
      const rules = client.getNetworkState().rules;
      const next = rules.filter((rule) => rule !== host);
      if (next.length !== rules.length) {
        await client.updateRules(next);
      }
      client.closeConnectionsForHost(host);
      persist(true);
      return { rules: client.getNetworkState().rules };
    },
    rotateIp: async () => {
      const sessionId = crypto.randomUUID().replace(/-/g, '');
      await client.updateSessionId(sessionId);
      persist(true);
      const netState = client.getNetworkState();
      return {
        sessionId: netState.sessionId ?? sessionId,
        connectionId: netState.connectionId ?? opts.connectionId ?? 0,
      };
    },
    setGeo: async (body) => {
      if (body.clear) {
        await client.updateTargetGeo(null);
      } else {
        await client.updateTargetGeo(body.geo ?? null);
      }
      persist(true);
      const netState = client.getNetworkState();
      return {
        targetGeo: netState.targetGeo,
        connectionId: netState.connectionId ?? opts.connectionId ?? 0,
      };
    },
    stop: () => {
      void shutdown();
    },
    getLastConnect: () => lastConnect,
    setLastConnect: (snapshot) => {
      lastConnect = snapshot;
    },
    setAttach: (next) => {
      attach = next;
      persist(true);
    },
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      void (async () => {
        try {
          await client.stop();
        } catch {
          // ignore
        }
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`port ${opts.controlPort} in use`));
          return;
        }
        reject(err);
      })();
    };
    server.once('error', onError);
    server.listen(opts.controlPort, '127.0.0.1', () => {
      server.off('error', onError);
      resolve();
    });
  });

  persist(true);

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });

  await new Promise<void>(() => {
    // Stay alive until shutdown calls process.exit.
  });
}
