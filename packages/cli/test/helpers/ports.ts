import net from 'node:net';

export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

export function occupyPort(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(port, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}
