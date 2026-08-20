import http from 'node:http';

export function connectViaProxy(proxyPort: number, host: string, port = 443): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: proxyPort,
      method: 'CONNECT',
      path: `${host}:${port}`,
    });
    req.on('connect', (_res, socket) => {
      socket.destroy();
      resolve();
    });
    req.on('error', reject);
    req.setTimeout(2000, () => {
      req.destroy(new Error('CONNECT timeout'));
    });
    req.end();
  });
}
