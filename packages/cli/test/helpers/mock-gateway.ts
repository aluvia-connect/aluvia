import http from 'node:http';
import tls from 'node:tls';

export const MOCK_EGRESS_IP = '172.59.0.1';

export const MOCK_TLS = {
  key: `-----BEGIN PRIVATE KEY-----
MIIEugIBADANBgkqhkiG9w0BAQEFAASCBKQwggSgAgEAAoIBAQDP+ipRrOswmzWm
K8k89awkN+Y1ANmOV35s2jHNAgcrB6dWc5FAJa+gNCuAf0M+Z53xWjblD1rPyyPh
mfQzYj3cyj4oeM6vwXW9Wgfppp9YSlcB9A/YD+mHy4czuggNqGec/FnJp6lBwKGh
R9NaaDu7lvYe55TCQ0CuqqQotNoKTR4AAElCCt04VvSmW4TSaVeawieTzagrMxaq
NEfdAz/A6vmOb7So7BwBnWBIsMCfhhhmdDzXR3boQ/1ROaWwpsiGInCtyyMoPCKT
O91GEkZFO2VJyuFAbduZXoc7f0P8PCFRZN3uNv3cQf77KTwj9oTaJyohSTHnkMpD
OgNOwoFRAgMBAAECgf8g2jR0fvITwSVtsEcBELcGvdVIOwu0NhAf5r6CbmqPD1G9
GCEqj0vs54f/KUha/UCjjmdEX3g9O0sQ9DORybJaD16n3xMSXC+8bXuuGqrMBGqp
v08ZPrqJ9vTsmVjJLuRXQG7m8CiEN0rOTyy8djHRKmyKdnUMTEG+3RPEwUAb8H0Y
wIq4NjAisZZ6W0JT09Nvnh70zzPSUGVHBpLDRoW62weSybK5Vf4ATH6KwvvmM/hY
GORYIPrw9cvL6Nry+CU8iFdBE8OG1SHSXXPSITgsQdaDFmGFmKR4+RPafwiwvIBk
QHrlm3TAgP9gp6UBJNZGKB2uroFAPX9S2oOZBEECgYEA7kjLlNhsBADlaaFvK1J+
TfoPuql/PLi4Sj9ui4hGVL8MocZw4f8q6ntT30l4c/abV3J77SUvUBEJijXOQ4qP
/2ssfTgoZBUatcTdi7oljJcERPYK5g3/qU3d1tcpQwKLAfFjKEdXs4RYnP4XuOCf
MoNHiuEb/B60tpjYkv2PgOECgYEA33CKu7K5s8Ak7DobtYpbDgrP0y3ewRLzkQQy
gH16hOiLAgn6J+k7kNzfA7wLRxhZW3liszbD0M9xvHDGWvWgI/vXUF6l0DbIKgaR
9VJOIPqv5anDO/ew8ipvuRvjxetF7sqAyroyEY+yfWFQncujq9vuy4NO47Jce7ct
uhwYXnECgYB8gNa2kBpoQRudhLc0eKb8EVOUoamUzaOlT91v1KWC9EwiXzBuNUh0
OjpJqfbhCJKEL5JnB43gFPbaG2EJ02WH/LTDPMuF96z8Gr/zmTCzc9jMO47YQ6o5
CTGHZubtV2/QdRLtYdGGP/mZFf7JH7yuxP9lpldb9aNQ4S4QJ6KKoQKBgFtrMngF
chFnZjP4ummWiBbAubNPqzoXxOvqabdEn6JNesKEzoMR3DszA1QF1h9qiPTyPz3Q
BGIk3gYZpi6FHNZcLgZGE1WTdGYtdf6HhEveBaXTxXt9pjoOvtNf49uQnXZMCFHp
yJ6Cyqad8Fv/e6HPRG6j9N0YltpPYjgpUpchAoGAbTo7VlkHdhCChdijlTr9s6vV
xtK7ztnIDZBbUI43dj5gsFAofh+gm+PCBXPbplt8S3CLKB/C6YEk/Y6jMyqyLb7q
TKTQDyytD7CUVJVUKoIKI0hQi5/pKf/G7iO+lk5hActZ2MRk3ke+LtntaVqduQmD
r07I6IUKdDXSp9qV9cQ=
-----END PRIVATE KEY-----`,
  cert: `-----BEGIN CERTIFICATE-----
MIIDCTCCAfGgAwIBAgIUSDzVxyaE5Qmb3E4sKdrnxzRK85YwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI2MDgxNzEwMTk0OVoXDTM2MDgx
NDEwMTk0OVowFDESMBAGA1UEAwwJbG9jYWxob3N0MIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAz/oqUazrMJs1pivJPPWsJDfmNQDZjld+bNoxzQIHKwen
VnORQCWvoDQrgH9DPmed8Vo25Q9az8sj4Zn0M2I93Mo+KHjOr8F1vVoH6aafWEpX
AfQP2A/ph8uHM7oIDahnnPxZyaepQcChoUfTWmg7u5b2HueUwkNArqqkKLTaCk0e
AABJQgrdOFb0pluE0mlXmsInk82oKzMWqjRH3QM/wOr5jm+0qOwcAZ1gSLDAn4YY
ZnQ810d26EP9UTmlsKbIhiJwrcsjKDwikzvdRhJGRTtlScrhQG3bmV6HO39D/Dwh
UWTd7jb93EH++yk8I/aE2icqIUkx55DKQzoDTsKBUQIDAQABo1MwUTAdBgNVHQ4E
FgQUmiwOnXW4ukTTGwtYyOJMLeXGXDMwHwYDVR0jBBgwFoAUmiwOnXW4ukTTGwtY
yOJMLeXGXDMwDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEANRgH
WkxT6aZ+bTEJWIMr9g7GVv41go5f6fSePN1MbGpMQBLqw+bBN8oUrQMUBwRwUCNP
ortX791jFewjeEjHJJUlMdqXERwbYEH8TL+Fzbtm4ksy3MyTmVJ589kn8RFIrOMA
EiLFUyqdGskZI3W6uqAcaNWtkVvx0BF+1HF6Lk1kl0D6pO1gyuz7kUSBEqc/N8XQ
EW1//rvS1Z723DgVyZtzrccf3VAtFheoKuRbmXYLVqigunsWztYM2PPZiOzgKmIw
+d2YyFVlwU0zPL2BX9qg4/ufgafc01KPrHm1MjUAiUQHR02wE4WkAU4VUupeZGZL
cVeiaGBpKA9VvUNhoA==
-----END CERTIFICATE-----`,
};

function writeIpHttp(stream: { write: (s: string) => void; end: () => void }, body = MOCK_EGRESS_IP): void {
  stream.write(
    `HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`,
  );
  stream.end();
}

function connectHost(target: string): string {
  const value = target.trim();
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    return end > 1 ? value.slice(1, end).toLowerCase() : value.toLowerCase();
  }
  return (value.split(':')[0] ?? value).toLowerCase();
}

export async function createMockGateway(opts?: {
  failUpstream?: boolean;
  failConnectHosts?: string[];
  connectFailStatus?: number;
  /** Fail this many CONNECTs (optionally only failConnectHosts), then succeed. */
  failFirstConnects?: number;
}): Promise<{
  port: number;
  connects: string[];
  close: () => Promise<void>;
}> {
  const connects: string[] = [];
  const sockets = new Set<import('node:net').Socket>();
  const failUpstream = opts?.failUpstream === true;
  const failConnectHosts = (opts?.failConnectHosts ?? []).map((host) => host.toLowerCase());
  const connectFailStatus = opts?.connectFailStatus ?? 503;
  let remainingFirstFails = opts?.failFirstConnects;
  const track = (socket: import('node:net').Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
  };
  const server = http.createServer((req, res) => {
    connects.push(req.url ?? '');
    if (failUpstream) {
      res.writeHead(503, { connection: 'close', 'content-length': 0 });
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain', 'content-length': MOCK_EGRESS_IP.length });
    res.end(MOCK_EGRESS_IP);
  });
  server.on('connection', track);
  server.on('connect', (req, socket, head) => {
    track(socket);
    const target = req.url ?? '';
    connects.push(target);
    const host = connectHost(target);
    const hostListed = failConnectHosts.includes(host);
    const alwaysFailHost = failConnectHosts.length > 0 && remainingFirstFails == null && hostListed;
    const countedFail =
      remainingFirstFails != null && remainingFirstFails > 0 && (failConnectHosts.length === 0 || hostListed);
    if (failUpstream || alwaysFailHost || countedFail) {
      if (countedFail) remainingFirstFails = (remainingFirstFails ?? 1) - 1;
      const status = failUpstream ? 503 : connectFailStatus;
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
    track(secure);
    let acc = '';
    secure.on('data', (chunk) => {
      acc += chunk.toString('utf8');
      if (acc.includes('\r\n\r\n')) writeIpHttp(secure);
    });
    secure.on('error', () => {
      secure.destroy();
      socket.destroy();
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
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        sockets.clear();
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
