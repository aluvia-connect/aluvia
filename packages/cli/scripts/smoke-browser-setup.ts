/** Run only in a disposable Linux container with Chromium, Xvfb, and Node 22+. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createMockAluviaApi } from '../test/helpers/mock-aluvia-api.js';
import { createMockGateway, MOCK_EGRESS_IP } from '../test/helpers/mock-gateway.js';
import { readRunningChrome } from '../src/chrome-process.js';

assert.equal(process.platform, 'linux');
assert.ok(fs.existsSync('/.dockerenv'), 'This smoke test restarts Chromium. Use a disposable container.');
assert.ok(Number(process.versions.node.split('.')[0]) >= 22, 'Node 22+ provides WebSocket for CDP.');
const tarball = path.resolve(process.argv[2] ?? 'missing-tarball');
assert.ok(fs.existsSync(tarball), 'Pass the freshly packed CLI tarball.');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aluvia-browser-smoke-'));
const profile = path.join(dir, 'agent profile');
const install = path.join(dir, 'install');
fs.mkdirSync(install);
fs.writeFileSync(path.join(install, 'package.json'), '{"private":true}');
const api = await createMockAluviaApi();
const gateway = await createMockGateway();
const env = {
  ...process.env,
  DISPLAY: ':99',
  ALUVIA_HOME: path.join(dir, 'state'),
  ALUVIA_SKILL_DIRS: path.join(dir, 'skills'),
  ALUVIA_API_BASE_URL: api.url,
  ALUVIA_GATEWAY_HOST: '127.0.0.1',
  ALUVIA_GATEWAY_PORT: String(gateway.port),
  ALUVIA_PROBE_URL: `https://${MOCK_EGRESS_IP}/`,
  ALUVIA_CHROME_POLICY_DIR: path.join(dir, 'unwritable-policy'),
  ALUVIA_PROBE_RETRY_DELAY_MS: '50',
  ALUVIA_PROBE_RETRY_ATTEMPTS: '2',
  npm_config_cache: path.join(dir, 'npm-cache'),
};
// Force the launch-flags path, which must work without system policy access.
fs.writeFileSync(env.ALUVIA_CHROME_POLICY_DIR, 'not a directory');
for (const key of [
  'ALUVIA_API_KEY',
  'ALUVIA_UPSTREAM',
  'ALUVIA_CHROME',
  'ALUVIA_SKIP_CHROME_RESTART',
  'ALUVIA_ATTRIBUTION_TOKEN',
]) {
  delete env[key as keyof typeof env];
}
async function run(command: string, args: string[], timeout = 60000) {
  const started = Date.now();
  return await new Promise<{ stdout: string; stderr: string; ms: number }>((resolve, reject) => {
    const child = spawn(command, args, { cwd: install, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '',
      stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Timed out: ${command}`));
    }, timeout);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`${command} exited ${code}: ${stderr}\n${stdout}`));
      else resolve({ stdout, stderr, ms: Date.now() - started });
    });
  });
}
async function pages() {
  const response = await fetch('http://127.0.0.1:9222/json/list');
  return (await response.json()) as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
}
async function waitPages() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const list = await pages();
      if (list.some((page) => page.type === 'page')) return list;
    } catch {
      /* Browser is starting. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Browser control did not reconnect on port 9222.');
}
async function cdp(url: string, method: string, params: Record<string, unknown> = {}) {
  return await new Promise<any>((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`CDP timed out: ${method}`));
    }, 5000);
    socket.onopen = () => socket.send(JSON.stringify({ id: 1, method, params }));
    socket.onerror = (error) => {
      clearTimeout(timer);
      reject(error);
    };
    socket.onmessage = (event) => {
      const response = JSON.parse(String(event.data));
      if (response.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      if (response.error) reject(new Error(JSON.stringify(response.error)));
      else resolve(response.result);
    };
  });
}
const xvfb = spawn('Xvfb', [':99', '-screen', '0', '1280x720x24'], { stdio: 'ignore' });
try {
  const installed = await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball]);
  const chrome = spawn(
    '/usr/bin/chromium',
    [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--ignore-certificate-errors',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${profile}`,
      '--remote-debugging-port=9222',
      `${api.url}/original-tab`,
    ],
    { env, stdio: 'ignore' },
  );
  chrome.unref();
  const initialPages = await waitPages();
  const before = readRunningChrome()!;
  assert.ok(before);
  const tab = initialPages.find((page) => page.type === 'page')!;
  await cdp(tab.webSocketDebuggerUrl, 'Network.setCookie', {
    name: 'setup_smoke',
    value: 'preserved',
    url: 'https://example.com/',
    expires: Date.now() / 1000 + 3600,
  });
  const first = await run('npx', ['aluvia-cli', 'setup']);
  const result = JSON.parse(first.stdout);
  assert.equal(result.ready, true, JSON.stringify(result));
  assert.equal(result.aimed, true);
  assert.equal(result.healthy, true);
  assert.equal(result.needsChromeRestart, false);
  assert.equal(result.aim, 'flags');
  assert.equal(result.restoreUrl, 'https://example.com/');
  assert.ok(result.binPath && fs.existsSync(result.binPath));
  const after = readRunningChrome()!;
  assert.ok(after && after.pid !== before.pid, 'Setup must restart the initial browser.');
  assert.ok(after.args.includes(`--user-data-dir=${profile}`));
  assert.ok(after.args.includes('--remote-debugging-port=9222'));
  assert.ok(after.args.includes('--proxy-server=http://127.0.0.1:18787'));
  const reconnected = await waitPages();
  assert.ok(
    reconnected.some((page) => page.url === `${api.url}/original-tab`),
    'The original tab must be restored.',
  );
  const target = reconnected.find((page) => page.url === 'https://example.com/');
  assert.ok(target, 'Default test page must be open in the configured browser.');
  const cookies = await cdp(target.webSocketDebuggerUrl, 'Network.getCookies', {
    urls: ['https://example.com/'],
  });
  assert.ok(
    cookies.cookies.some((cookie: any) => cookie.name === 'setup_smoke' && cookie.value === 'preserved'),
  );
  await cdp(target.webSocketDebuggerUrl, 'Page.reload');
  let body = '';
  for (let attempt = 0; attempt < 50; attempt++) {
    const evaluated = await cdp(target.webSocketDebuggerUrl, 'Runtime.evaluate', {
      expression: 'document.body?.innerText',
    });
    body = evaluated.result.value ?? '';
    if (body.trim() === MOCK_EGRESS_IP) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(body.trim(), MOCK_EGRESS_IP, 'Real Chromium must load the page through the fixture gateway.');
  const second = await run('npx', ['aluvia-cli', 'setup']);
  const repeated = JSON.parse(second.stdout);
  assert.equal(repeated.ready, true);
  assert.equal(repeated.connectionId, result.connectionId);
  assert.equal(repeated.sessionId, result.sessionId);
  assert.equal(readRunningChrome()?.pid, after.pid, 'Repeated setup must not restart Chrome.');
  assert.equal(
    api.requests.filter((request) => request.method === 'POST' && request.url === '/account/connections')
      .length,
    1,
  );
  assert.ok(
    api.requests.every((request) => !request.headers.authorization),
    'Trial needs no API key.',
  );
  assert.ok(fs.existsSync(path.join(env.ALUVIA_SKILL_DIRS, 'aluvia', 'SKILL.md')));
  // A second fresh installation starts a browser even when no Chrome is open.
  // The launcher supplies container-only sandbox/display settings, not proxy settings or a URL.
  await run('npx', ['aluvia-cli', 'stop']);
  await cdp(target.webSocketDebuggerUrl, 'Browser.close');
  for (let attempt = 0; readRunningChrome() && attempt < 50; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(readRunningChrome(), null);
  const launcher = path.join(dir, 'container-chrome');
  fs.writeFileSync(
    launcher,
    `#!/bin/sh\nexec /usr/bin/chromium --no-sandbox --no-first-run --ignore-certificate-errors --user-data-dir='${path.join(dir, 'new-profile')}' --remote-debugging-port=9222 "$@"\n`,
    { mode: 0o755 },
  );
  Object.assign(env, { ALUVIA_CHROME: launcher, ALUVIA_HOME: path.join(dir, 'fresh-state') });
  const noBrowser = await run('npx', ['aluvia-cli', 'setup']);
  const fresh = JSON.parse(noBrowser.stdout);
  assert.equal(fresh.ready, true, JSON.stringify(fresh));
  assert.equal(fresh.restoreUrl, 'https://example.com/');
  assert.ok((await waitPages()).some((page) => page.url === 'https://example.com/'));
  console.log(
    JSON.stringify(
      {
        passed: true,
        node: process.version,
        platform: process.platform,
        browser: 'real Chromium on Xvfb',
        network: 'local API and TLS gateway fixtures',
        installMs: installed.ms,
        setupMs: first.ms,
        repeatSetupMs: second.ms,
        ready: result.ready,
        profilePreserved: true,
        cookiePreserved: true,
        originalTabRestored: true,
        browserControlReconnected: true,
        browserPageLoadedThroughProxy: true,
        repeatKeptBrowserAndSession: true,
        noApiKey: true,
        startsBrowserWhenNoneIsOpen: true,
        note: 'Fixture timings do not validate a production setup speed claim.',
      },
      null,
      2,
    ),
  );
} finally {
  await run('npx', ['aluvia-cli', 'stop']).catch(() => undefined);
  const browser = readRunningChrome();
  if (browser) process.kill(browser.pid, 'SIGTERM');
  xvfb.kill();
  await gateway.close();
  await api.close();
}
