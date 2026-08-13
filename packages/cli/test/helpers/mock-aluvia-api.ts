import http from 'node:http';

export type MockConnection = {
  id: number;
  session_id: string | null;
  target_geo: string | null;
  rules: string[];
  proxy_username: string;
  proxy_password: string;
};

export async function createMockAluviaApi(seed?: Partial<MockConnection>): Promise<{
  url: string;
  state: MockConnection;
  close: () => Promise<void>;
}> {
  const state: MockConnection = {
    id: seed?.id ?? 3449,
    session_id: seed?.session_id ?? null,
    target_geo: seed?.target_geo ?? null,
    rules: seed?.rules ?? [],
    proxy_username: seed?.proxy_username ?? 'user',
    proxy_password: seed?.proxy_password ?? 'pass',
  };

  const envelope = () => ({
    data: {
      connection_id: state.id,
      id: state.id,
      proxy_username: state.proxy_username,
      proxy_password: state.proxy_password,
      rules: state.rules,
      session_id: state.session_id,
      target_geo: state.target_geo,
    },
  });

  const server = http.createServer((req, res) => {
    const url = req.url ?? '';
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json', etag: '"t1"' });
      res.end(JSON.stringify(body));
    };
    const readBody = (cb: (body: any) => void) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        cb(raw ? JSON.parse(raw) : {});
      });
    };

    if (req.method === 'POST' && url === '/account/connections') {
      return send(201, envelope());
    }
    if (req.method === 'GET' && url.startsWith('/account/connections/')) {
      return send(200, envelope());
    }
    if (req.method === 'PATCH' && url.startsWith('/account/connections/')) {
      return readBody((body) => {
        if ('rules' in body) state.rules = body.rules;
        if ('session_id' in body) state.session_id = body.session_id;
        if ('target_geo' in body) state.target_geo = body.target_geo;
        send(200, envelope());
      });
    }
    send(404, { error: 'not found' });
  });

  const url: string = await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
    server.on('error', reject);
  });

  return {
    url,
    state,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}
