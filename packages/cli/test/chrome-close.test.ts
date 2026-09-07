import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { closeChromeGracefully } from '../src/chrome-close.js';
import { chromeDebugPort } from '../src/chrome-process.js';

test('graceful restart uses Browser.close on the existing local debugging connection', async () => {
  const server = http.createServer((_req, res) => {
    const address = server.address() as { port: number };
    res.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${address.port}/devtools/browser/test` }));
  });
  const ws = new WebSocketServer({ server });
  const commands: unknown[] = [];
  ws.on('connection', (socket) => {
    socket.on('message', (data) => {
      commands.push(JSON.parse(data.toString()));
      socket.send(JSON.stringify({ id: 1, result: {} }));
      socket.close();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address() as { port: number };
    assert.equal(
      await closeChromeGracefully({ pid: 1, binary: 'chrome', args: [`--remote-debugging-port=${port}`] }),
      true,
    );
    assert.deepEqual(commands, [{ id: 1, method: 'Browser.close' }]);
  } finally {
    ws.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('a browser without a debugging port falls back without opening one', async () => {
  assert.equal(await closeChromeGracefully({ pid: 1, binary: 'chrome', args: [] }), false);
  for (const raw of ['bad', '-1', '65536']) {
    assert.equal(
      chromeDebugPort({ pid: 1, binary: 'chrome', args: [`--remote-debugging-port=${raw}`] }),
      null,
    );
  }
});

test('a debugging response cannot redirect the close command to another host', async () => {
  const server = http.createServer((_req, res) => {
    res.end(JSON.stringify({ webSocketDebuggerUrl: 'ws://remote.example:9222/devtools/browser/test' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address() as { port: number };
    assert.equal(
      await closeChromeGracefully({
        pid: 1,
        binary: 'chrome',
        args: ['--remote-debugging-port', String(port)],
      }),
      false,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
