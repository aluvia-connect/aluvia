import net from 'node:net';

export async function createMockGateway(): Promise<{
  port: number;
  connects: string[];
  close: () => Promise<void>;
}> {
  const connects: string[] = [];
  const server = net.createServer((socket) => {
    let buf = '';
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      const end = buf.indexOf('\r\n\r\n');
      if (end === -1) return;
      const first = buf.slice(0, buf.indexOf('\r\n'));
      const match = first.match(/^CONNECT\s+(\S+)\s/i);
      if (match) connects.push(match[1]);
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      socket.end();
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
    connects,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
