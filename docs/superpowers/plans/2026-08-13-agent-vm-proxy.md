# Agent-VM Proxy Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the agent-VM proxy surface from `docs/superpowers/specs/2026-08-13-agent-vm-proxy-design.md`: a detached `proxyd`, `aluvia proxy <verb>` CLI, sticky IP, durable `$ALUVIA_HOME` state, setup-time GUI attach, and an in-repo computer-use skill.

**Architecture:** One `AluviaClient` (`startPlaywright: false`) per `$ALUVIA_HOME` binds a fixed data port (`127.0.0.1:18787`) and a new loopback JSON control port (`127.0.0.1:18788`). `aluvia proxy *` is a thin client of that control server so `route` / `unroute` / `rotate-ip` / `set-geo` take effect in-process before the CLI prints JSON. Loopback is always direct inside `ProxyServer`. Catch-all `*` is refused at parse and at the control server. Attach writes an unpacked MV3 `chrome.proxy` extension and optionally tries gsettings; it never claims the harness Chrome is proxied without a real CONNECT.

**Tech Stack:** TypeScript, Node.js 18+, `node:test` + `node:assert`, `tsx` loader, existing `@aluvia/sdk` (`AluviaClient`, `ConfigManager`, `ProxyServer`, `proxy-chain`), `@aluvia/cli` (`output()`, `captureOutput()`, detached `spawn` as in `open.ts`).

**Spec:** `docs/superpowers/specs/2026-08-13-agent-vm-proxy-design.md`

## Global Constraints

Every task implicitly includes these. Do not weaken them.

- CLI noun is `aluvia proxy <verb>`. Do not add top-level `route` / `start` aliases. Do not reuse `aluvia session *`.
- Home is `ALUVIA_HOME`, default `~/.aluvia`. Auth (`config.json`) and proxyd (`proxy.json`, `proxy.log`, `ext/`) live together. Do not auto-detect `/workspace`.
- Catch-all `*` is a hard refuse. No `--force`. `*.example.com` remains a valid suffix rule.
- Loopback (`localhost`, `127.0.0.1`, `::1`, `::ffff:127.0.0.1`) is always direct, in `ProxyServer`, for every caller including Playwright sessions.
- Data plane: `127.0.0.1:18787`. Control plane: `127.0.0.1:18788`. Override with `--port` / `--control-port` or `ALUVIA_PROXY_PORT` / `ALUVIA_PROXY_CONTROL_PORT`. If the requested port is in use by something else, fail with `"error": "port <n> in use"`. Do not pick a random free port.
- One daemon per `ALUVIA_HOME`. Live pid → `start` fails. Stale pid is replaced. `stop` clears pid/ready and keeps `connectionId`, sticky `session_id`, rules, and attach.
- Sticky `session_id` is set on first start if null, using `crypto.randomUUID().replace(/-/g, '')`. Change only via `rotate-ip`.
- `route` / `unroute` / `rotate-ip` / `set-geo` return only after `ConfigManager.setConfig` swaps in-memory config. No ETag-poll race.
- Control server is `http.createServer` on `127.0.0.1` only. No auth. JSON in/out. Control request timeout is 2 seconds.
- `GET /status` is served from live `ConfigManager` + current attach fields, not a stale file snapshot.
- After every successful config change, rewrite `proxy.json` atomically (temp file + rename, same pattern as `packages/sdk/src/session/lock.ts`).
- Preserve `attach.*` across restart unless the data port changed.
- Playwright session locks stay in `os.tmpdir()/aluvia-sdk/`. Do not reuse them.
- No new MCP tools. Do not export proxy handlers from `cli-adapter.ts`.
- Do not gut `BlockDetection`, `connect()`, or `startPlaywright`. Do not change `aluvia session *` behavior.
- Do not implement hosted rewrite, PAC, MITM, nftables, `/etc` Chrome policy, auto-rotation, or default `*` rules.
- `*.local` is not excluded in this slice.
- All CLI commands print one JSON object to stdout. Exit 0 success, 1 failure. `error` is always a string.
- Tests use `node:test` and `node:assert`. SDK tests import from `packages/sdk/src/` (not `dist/`). Source imports use `.js` extensions.
- Do not claim harness-owned GUI attach works in CI. Attach tests cover extension files, CONNECT-seen → `verified`, timeout → `needs_ui` exit 0.

## File structure

Design units (one responsibility each). Do not dump everything into `proxy.ts`.

| File | Responsibility |
|---|---|
| `packages/sdk/src/client/loopback.ts` | `isLoopbackHostname(hostname: string): boolean` |
| `packages/sdk/src/client/ProxyServer.ts` | Existing data plane + loopback bypass + optional request observer |
| `packages/sdk/src/client/AluviaClient.ts` | Existing client + `getNetworkState()` + `setRequestObserver()` + `gatewayHost` option |
| `packages/sdk/src/client/ConfigManager.ts` | Allow configurable `gatewayHost` (default `gateway.aluvia.io`) |
| `packages/sdk/src/client/types.ts` | `gatewayHost?: string` on `AluviaClientOptions` |
| `packages/sdk/src/index.ts` | Export `isLoopbackHostname` |
| `packages/cli/src/config.ts` | `configDir()` honors `ALUVIA_HOME` |
| `packages/cli/src/cli-path.ts` | Shared `getCliLaunch()` for detached children (`cli.js` in dist, `cli.ts`+tsx in dev) |
| `packages/cli/src/proxy-state.ts` | `proxy.json` types, defaults, atomic read/write, default ports |
| `packages/cli/src/proxy-host.ts` | `parseRouteHost()` for `route` / `unroute` |
| `packages/cli/src/proxy-control-server.ts` | Loopback JSON control HTTP server |
| `packages/cli/src/proxy-control-client.ts` | CLI → control HTTP (2s timeout) |
| `packages/cli/src/proxy-daemon.ts` | `runProxyDaemon()`: AluviaClient + sticky + `*` strip + control + signals |
| `packages/cli/src/proxy-attach.ts` | Extension generate, gsettings try, CONNECT wait |
| `packages/cli/src/proxy.ts` | `handleProxy()` / `handleProxyDaemon()` verbs |
| `packages/cli/src/cli.ts` | Wire `proxy` and `--proxy-daemon`; help text |
| `packages/cli/src/open.ts` | Switch session daemon spawn to `getCliLaunch()` |
| `skills/aluvia-proxy/SKILL.md` | Computer-use unblock skill |

Test files (created with the task that needs them):

- `packages/sdk/test/loopback.test.ts`
- `packages/cli/test/config-home.test.ts`
- `packages/cli/test/proxy-host.test.ts`
- `packages/cli/test/proxy-state.test.ts`
- `packages/cli/test/proxy-control-server.test.ts`
- `packages/cli/test/proxy-lifecycle.test.ts`
- `packages/cli/test/proxy-route.test.ts`
- `packages/cli/test/proxy-attach.test.ts`
- `packages/cli/test/helpers/mock-aluvia-api.ts`
- `packages/cli/test/helpers/mock-gateway.ts`
- `packages/cli/test/helpers/ports.ts`
- `packages/cli/test/helpers/connect-via-proxy.ts`

Do not add files under `packages/mcp/`.

## Implementation hooks (not product flags)

These exist so tests can prove the spec without `/etc/hosts` or a 15s sleep in CI. Do not document them in `aluvia help`.

- `AluviaClientOptions.gatewayHost` (default `'gateway.aluvia.io'`). Daemon reads `ALUVIA_GATEWAY_HOST` / `ALUVIA_GATEWAY_PORT` if set.
- Daemon reads `ALUVIA_API_BASE_URL` and passes it as `apiBaseUrl` so tests can point at a mock API.
- Attach wait reads `ALUVIA_ATTACH_WAIT_MS` (default `15000`).
- `getCliLaunch()` uses `cli.js` when present (published bin); otherwise `node --import tsx <cli.ts>` so `proxy start` works from source.

---

### Task 1: Loopback bypass + `ALUVIA_HOME`

**Files:**
- Create: `packages/sdk/src/client/loopback.ts`
- Create: `packages/sdk/test/loopback.test.ts`
- Create: `packages/cli/test/config-home.test.ts`
- Modify: `packages/sdk/src/client/ProxyServer.ts` (`handleRequest`, after hostname extract, before rule matching)
- Modify: `packages/sdk/src/index.ts` (export `isLoopbackHostname`)
- Modify: `packages/cli/src/config.ts` (`configDir`)
- Modify: `packages/cli/package.json` (add `tsx` devDependency + `"test"` script; include `test` in lint)
- Modify: `package.json` (`test:cli`, include CLI in `test:all`)

**Interfaces:**
- Consumes: existing `ProxyServer.handleRequest`, `configDir()` in `packages/cli/src/config.ts`
- Produces:
  - `export function isLoopbackHostname(hostname: string): boolean`
  - `configDir(): string` — if `process.env.ALUVIA_HOME` is a non-empty trimmed string, return `path.resolve` of it; otherwise `path.join(os.homedir(), '.aluvia')`
  - CLI package script: `"test": "node --import tsx --test test/*.test.ts"`

- [ ] **Step 1: Write the failing SDK loopback tests**

Create `packages/sdk/test/loopback.test.ts`:

```ts
import { describe, test } from 'node:test';
import assert from 'node:assert';
import { isLoopbackHostname } from '../src/client/loopback.js';
import { ProxyServer } from '../src/client/ProxyServer.js';

function configWithCatchAll() {
  return {
    rawProxy: {
      protocol: 'http' as const,
      host: 'gateway.aluvia.io' as const,
      port: 8080,
      username: 'user',
      password: 'pass',
    },
    rules: ['*'],
    sessionId: null,
    targetGeo: null,
    etag: null,
  };
}

function decide(hostname: string, extra: Record<string, unknown> = {}) {
  const mgr = { getConfig: () => configWithCatchAll() } as any;
  const proxy = new ProxyServer(mgr, { logLevel: 'silent' });
  return (proxy as any).handleRequest({
    hostname,
    request: { url: `https://${hostname}/` },
    ...extra,
  });
}

describe('isLoopbackHostname', () => {
  test('matches the four names in the spec, case-insensitive', () => {
    for (const host of ['localhost', 'LOCALHOST', '127.0.0.1', '::1', '::ffff:127.0.0.1', '::FFFF:127.0.0.1']) {
      assert.strictEqual(isLoopbackHostname(host), true, host);
    }
  });

  test('does not match public hosts or suffix wildcards', () => {
    assert.strictEqual(isLoopbackHostname('example.com'), false);
    assert.strictEqual(isLoopbackHostname('127.0.0.2'), false);
    assert.strictEqual(isLoopbackHostname('::2'), false);
  });
});

describe('ProxyServer loopback bypass', () => {
  test('never sets upstreamProxyUrl for loopback even with a * rule', () => {
    for (const host of ['localhost', '127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      assert.strictEqual(decide(host), undefined, host);
    }
  });

  test('still proxies a matching public host when rules include *', () => {
    assert.deepStrictEqual(decide('example.com'), {
      upstreamProxyUrl: 'http://user:pass@gateway.aluvia.io:8080',
    });
  });
});
```

- [ ] **Step 2: Run the SDK test and confirm it fails**

Run: `npm test -w @aluvia/sdk -- test/loopback.test.ts`

Expected: FAIL because `packages/sdk/src/client/loopback.ts` does not exist (ERR_MODULE_NOT_FOUND).

- [ ] **Step 3: Implement `isLoopbackHostname` and the `ProxyServer` bypass**

Create `packages/sdk/src/client/loopback.ts`:

```ts
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) return false;
  const unbracketed =
    normalized.startsWith('[') && normalized.endsWith(']')
      ? normalized.slice(1, -1)
      : normalized;
  return LOOPBACK.has(unbracketed);
}
```

In `packages/sdk/src/client/ProxyServer.ts`:

- Add `import { isLoopbackHostname } from './loopback.js';`
- In `handleRequest`, immediately after a hostname is extracted and before `shouldProxy` / `shouldProxyNormalized`:

```ts
    if (isLoopbackHostname(hostname)) {
      this.logger.debug(`Hostname ${hostname} is loopback, going direct`);
      return undefined;
    }
```

In `packages/sdk/src/index.ts`, add:

```ts
export { isLoopbackHostname } from './client/loopback.js';
```

- [ ] **Step 4: Re-run the SDK loopback tests**

Run: `npm test -w @aluvia/sdk -- test/loopback.test.ts`

Expected: PASS.

- [ ] **Step 5: Write the failing `ALUVIA_HOME` test**

Add `"tsx": "^4.21.0"` to `packages/cli/package.json` `devDependencies` and:

```json
"test": "node --import tsx --test test/*.test.ts",
"lint": "prettier --check src test",
"lint:fix": "prettier --write src test"
```

In root `package.json`, change:

```json
"test:all": "npm test -w @aluvia/sdk && npm test -w @aluvia/cli && npm test -w @aluvia/mcp",
"test:cli": "npm test -w @aluvia/cli"
```

Create `packages/cli/test/config-home.test.ts`:

```ts
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import { configDir } from '../src/config.js';

describe('configDir ALUVIA_HOME', () => {
  const original = process.env.ALUVIA_HOME;

  afterEach(() => {
    if (original === undefined) delete process.env.ALUVIA_HOME;
    else process.env.ALUVIA_HOME = original;
  });

  test('defaults to ~/.aluvia when ALUVIA_HOME is unset', () => {
    delete process.env.ALUVIA_HOME;
    assert.strictEqual(configDir(), path.join(os.homedir(), '.aluvia'));
  });

  test('uses ALUVIA_HOME when set, resolved to an absolute path', () => {
    process.env.ALUVIA_HOME = 'relative-aluvia-home';
    assert.strictEqual(configDir(), path.resolve('relative-aluvia-home'));
  });

  test('treats whitespace-only ALUVIA_HOME as unset', () => {
    process.env.ALUVIA_HOME = '   ';
    assert.strictEqual(configDir(), path.join(os.homedir(), '.aluvia'));
  });

  test('saveApiKey writes config.json under ALUVIA_HOME', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aluvia-home-'));
    process.env.ALUVIA_HOME = home;
    const { saveApiKey, getStoredApiKey } = await import('../src/config.js');
    saveApiKey('test-key');
    assert.strictEqual(getStoredApiKey(), 'test-key');
    assert.strictEqual(fs.existsSync(path.join(home, 'config.json')), true);
    fs.rmSync(home, { recursive: true, force: true });
  });
});
```

- [ ] **Step 6: Run the CLI test and confirm the ALUVIA_HOME cases fail**

Run: `npm install` (picks up CLI `tsx`) then `npm test -w @aluvia/cli -- test/config-home.test.ts`

Expected: FAIL — `configDir()` still always returns `path.join(os.homedir(), '.aluvia')`, so the `ALUVIA_HOME` case does not match `path.resolve('relative-aluvia-home')`.

- [ ] **Step 7: Honor `ALUVIA_HOME` in `configDir()`**

Replace `configDir` in `packages/cli/src/config.ts`:

```ts
export function configDir(): string {
  const fromEnv = (process.env.ALUVIA_HOME ?? '').trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(os.homedir(), '.aluvia');
}
```

- [ ] **Step 8: Re-run CLI + existing SDK tests**

Run:

```bash
npm test -w @aluvia/cli -- test/config-home.test.ts
npm test -w @aluvia/sdk
```

Expected: PASS. Existing `ProxyServer hostname extraction` tests still pass (they use `example.com`, not loopback).

- [ ] **Step 9: Commit**

```bash
git add packages/sdk/src/client/loopback.ts packages/sdk/src/client/ProxyServer.ts packages/sdk/src/index.ts packages/sdk/test/loopback.test.ts packages/cli/src/config.ts packages/cli/test/config-home.test.ts packages/cli/package.json package.json package-lock.json
git commit -m "$(cat <<'EOF'
feat: bypass loopback in ProxyServer and honor ALUVIA_HOME

Always send localhost/127.0.0.1/::1 direct, even under a catch-all rule.
Point CLI configDir() at ALUVIA_HOME when set so auth and proxyd share one home.
EOF
)"
```

---

### Task 2: Control protocol + proxyd + `start` / `stop` / `status`

**Files:**
- Create: `packages/cli/src/cli-path.ts`
- Create: `packages/cli/src/proxy-state.ts`
- Create: `packages/cli/src/proxy-host.ts`
- Create: `packages/cli/src/proxy-control-server.ts`
- Create: `packages/cli/src/proxy-control-client.ts`
- Create: `packages/cli/src/proxy-daemon.ts`
- Create: `packages/cli/src/proxy.ts`
- Create: `packages/cli/test/helpers/mock-aluvia-api.ts`
- Create: `packages/cli/test/helpers/ports.ts`
- Create: `packages/cli/test/proxy-host.test.ts`
- Create: `packages/cli/test/proxy-state.test.ts`
- Create: `packages/cli/test/proxy-control-server.test.ts`
- Create: `packages/cli/test/proxy-lifecycle.test.ts`
- Modify: `packages/sdk/src/client/AluviaClient.ts` (add `getNetworkState()`)
- Modify: `packages/cli/src/cli.ts` (wire `proxy` and `--proxy-daemon`)
- Modify: `packages/cli/src/open.ts` (use `getCliLaunch()`)

**Interfaces:**
- Consumes: `isLoopbackHostname`, `configDir()`, `AluviaClient`, `resolveApiKey()`, `output()`, `isProcessAlive`, `captureOutput`
- Produces (later tasks import these exact names):

```ts
export const DEFAULT_DATA_PORT = 18787;
export const DEFAULT_CONTROL_PORT = 18788;

export type AttachStatus = 'unverified' | 'verified' | 'needs_ui';
export type AttachMethod = 'gsettings' | 'extension' | null;

export type ProxyAttachState = {
  status: AttachStatus;
  method: AttachMethod;
  verifiedAt: string | null;
  extensionPath: string | null;
};

export type ProxyJson = {
  pid: number | null;
  ready: boolean;
  dataPort: number;
  controlPort: number;
  proxyUrl: string;
  controlUrl: string;
  connectionId: number | null;
  sessionId: string | null;
  targetGeo: string | null;
  rules: string[];
  attach: ProxyAttachState;
};

export function defaultAttach(home: string): ProxyAttachState;
export function readProxyJson(): ProxyJson | null;
export function writeProxyJson(data: ProxyJson): void;

export type ParseHostResult = { ok: true; host: string } | { ok: false; error: string };
export function parseRouteHost(input: string): ParseHostResult;

export class ControlError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string);
}

export type ControlStatusBody = {
  pid: number;
  proxyUrl: string;
  controlUrl: string;
  connectionId: number | null;
  sessionId: string | null;
  targetGeo: string | null;
  rules: string[];
  count: number;
  attach: ProxyAttachState;
};

export function createControlServer(handlers: {
  getStatus: () => ControlStatusBody;
  route: (host: string) => Promise<{ rules: string[] }>;
  unroute: (host: string) => Promise<{ rules: string[] }>;
  rotateIp: () => Promise<{ sessionId: string; connectionId: number }>;
  setGeo: (body: { geo?: string; clear?: boolean }) => Promise<{
    targetGeo: string | null;
    connectionId: number;
  }>;
  stop: () => void;
  /** Filled in Task 4. Optional here so Task 2 can omit the routes. */
  getLastConnect?: () => string | null;
  setAttach?: (attach: ProxyAttachState) => void;
}): import('node:http').Server;

export function bothPortsAccept(state: Pick<ProxyJson, 'dataPort' | 'controlPort'>): Promise<boolean>;

export async function controlRequest(
  method: 'GET' | 'POST',
  pathname: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> }>;

export type ProxyDaemonOptions = {
  dataPort: number;
  controlPort: number;
  connectionId?: number;
  apiKey: string;
  apiBaseUrl?: string;
  gatewayHost?: string;
  gatewayPort?: number;
};

export async function runProxyDaemon(opts: ProxyDaemonOptions): Promise<void>;
export async function handleProxy(args: string[]): Promise<void>;
export async function handleProxyDaemon(args: string[]): Promise<void>;

export function getCliLaunch(): {
  execPath: string;
  prefixArgs: string[];
  script: string;
};

export type NetworkState = {
  connectionId: number | undefined;
  sessionId: string | null;
  targetGeo: string | null;
  rules: string[];
};
// AluviaClient.getNetworkState(): NetworkState
```

`parseRouteHost` contract (spec §8): trim; if the input parses as a URL (has a scheme or a `/`), take `.hostname`; strip a trailing dot; lowercase; strip IPv6 brackets; reject empty; reject exact token `*`; reject loopback via `isLoopbackHostname`. `*.example.com` is allowed.

Control HTTP (spec §5.3) — implement the full table now so Task 3 only wires real `AluviaClient` mutations. Task 2's daemon `route` / `unroute` / `rotate-ip` / `set-geo` handlers must call `updateRules` / `updateSessionId` / `updateTargetGeo` and `writeProxyJson` after success. Task 3 adds the CLI verbs and the mock-gateway proof; do not leave those handlers as no-ops.

Error strings (verbatim):

| Situation | `error` |
|---|---|
| No API key on `start` | `No API key found. Run \`aluvia auth\` to log in, or set ALUVIA_API_KEY.` |
| Live daemon on `start` | `proxyd already running` (plus status fields) |
| Verb other than `start`/`attach` and daemon down | `proxyd is not running. Run \`aluvia proxy start\`.` |
| Control request timeout (2s) | `proxyd did not respond. Run \`aluvia proxy status\`.` |
| Requested port busy | `port <n> in use` |
| `parseRouteHost` empty | `host is required` |
| `parseRouteHost` `*` | `catch-all * is not allowed` |
| `parseRouteHost` loopback | `loopback hosts cannot be routed` |

- [ ] **Step 1: Write failing hostname-parse tests**

Create `packages/cli/test/proxy-host.test.ts`:

```ts
import { describe, test } from 'node:test';
import assert from 'node:assert';
import { parseRouteHost } from '../src/proxy-host.js';

describe('parseRouteHost', () => {
  test('parses a URL to a lowercased hostname', () => {
    assert.deepStrictEqual(parseRouteHost('https://Example.COM/path?q=1'), {
      ok: true,
      host: 'example.com',
    });
  });

  test('allows a suffix wildcard and refuses a catch-all *', () => {
    assert.deepStrictEqual(parseRouteHost('*.Example.com'), { ok: true, host: '*.example.com' });
    assert.deepStrictEqual(parseRouteHost('*'), { ok: false, error: 'catch-all * is not allowed' });
    assert.deepStrictEqual(parseRouteHost('  *  '), { ok: false, error: 'catch-all * is not allowed' });
  });

  test('refuses loopback and empty input', () => {
    assert.deepStrictEqual(parseRouteHost('localhost'), {
      ok: false,
      error: 'loopback hosts cannot be routed',
    });
    assert.deepStrictEqual(parseRouteHost('https://127.0.0.1/'), {
      ok: false,
      error: 'loopback hosts cannot be routed',
    });
    assert.deepStrictEqual(parseRouteHost('[::1]'), {
      ok: false,
      error: 'loopback hosts cannot be routed',
    });
    assert.deepStrictEqual(parseRouteHost('   '), { ok: false, error: 'host is required' });
  });
});
```

- [ ] **Step 2: Run hostname tests (expect FAIL)**

Run: `npm test -w @aluvia/cli -- test/proxy-host.test.ts`

Expected: FAIL, `ERR_MODULE_NOT_FOUND` for `proxy-host.js`.

- [ ] **Step 3: Implement `parseRouteHost`**

CLI tests import `@aluvia/sdk` from the package `exports` (dist). After Task 1, run `npm run build:sdk` once before relying on `isLoopbackHostname` from `@aluvia/sdk`.

Create `packages/cli/src/proxy-host.ts`:

```ts
import { isLoopbackHostname } from '@aluvia/sdk';

export type ParseHostResult = { ok: true; host: string } | { ok: false; error: string };

export function parseRouteHost(input: string): ParseHostResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: 'host is required' };

  let host = trimmed;
  const looksLikeUrl = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) || trimmed.includes('/');
  if (looksLikeUrl) {
    try {
      const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `http://${trimmed}`;
      host = new URL(withScheme).hostname;
    } catch {
      return { ok: false, error: 'host is required' };
    }
  }

  host = host.replace(/\.+$/, '').toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }
  if (!host) return { ok: false, error: 'host is required' };
  if (host === '*') return { ok: false, error: 'catch-all * is not allowed' };
  if (isLoopbackHostname(host)) return { ok: false, error: 'loopback hosts cannot be routed' };
  return { ok: true, host };
}
```

- [ ] **Step 4: Re-run hostname tests**

Run: `npm run build:sdk && npm test -w @aluvia/cli -- test/proxy-host.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing `proxy.json` tests**

Create `packages/cli/test/proxy-state.test.ts`:

```ts
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultAttach, readProxyJson, writeProxyJson, type ProxyJson } from '../src/proxy-state.js';

describe('proxy.json', () => {
  let home: string;
  const original = process.env.ALUVIA_HOME;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'aluvia-home-'));
    process.env.ALUVIA_HOME = home;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.ALUVIA_HOME;
    else process.env.ALUVIA_HOME = original;
    fs.rmSync(home, { recursive: true, force: true });
  });

  test('write then read round-trips and leaves no .tmp file', () => {
    const data: ProxyJson = {
      pid: 123,
      ready: true,
      dataPort: 18787,
      controlPort: 18788,
      proxyUrl: 'http://127.0.0.1:18787',
      controlUrl: 'http://127.0.0.1:18788',
      connectionId: 3449,
      sessionId: 'abc',
      targetGeo: null,
      rules: ['example.com'],
      attach: defaultAttach(home),
    };
    writeProxyJson(data);
    assert.deepStrictEqual(readProxyJson(), data);
    assert.strictEqual(fs.existsSync(path.join(home, 'proxy.json.tmp')), false);
    assert.strictEqual(fs.existsSync(path.join(home, 'proxy.json')), true);
  });

  test('readProxyJson returns null when the file is missing', () => {
    assert.strictEqual(readProxyJson(), null);
  });
});
```

- [ ] **Step 6: Run state tests (expect FAIL) then implement `proxy-state.ts`**

Run: `npm test -w @aluvia/cli -- test/proxy-state.test.ts`

Expected: FAIL, module not found.

Create `packages/cli/src/proxy-state.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { configDir } from './config.js';

export const DEFAULT_DATA_PORT = 18787;
export const DEFAULT_CONTROL_PORT = 18788;

export type AttachStatus = 'unverified' | 'verified' | 'needs_ui';
export type AttachMethod = 'gsettings' | 'extension' | null;

export type ProxyAttachState = {
  status: AttachStatus;
  method: AttachMethod;
  verifiedAt: string | null;
  extensionPath: string | null;
};

export type ProxyJson = {
  pid: number | null;
  ready: boolean;
  dataPort: number;
  controlPort: number;
  proxyUrl: string;
  controlUrl: string;
  connectionId: number | null;
  sessionId: string | null;
  targetGeo: string | null;
  rules: string[];
  attach: ProxyAttachState;
};

export function defaultAttach(home: string): ProxyAttachState {
  return {
    status: 'unverified',
    method: null,
    verifiedAt: null,
    extensionPath: path.join(home, 'ext'),
  };
}

export function proxyJsonPath(): string {
  return path.join(configDir(), 'proxy.json');
}

export function readProxyJson(): ProxyJson | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(proxyJsonPath(), 'utf8')) as ProxyJson;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeProxyJson(data: ProxyJson): void {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const filePath = proxyJsonPath();
  const tmpPath = filePath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
    try {
      fs.rmSync(filePath, { force: true });
    } catch {
      // Windows overwrite
    }
    fs.renameSync(tmpPath, filePath);
  } finally {
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      // ignore
    }
  }
}
```

- [ ] **Step 7: Re-run state tests**

Run: `npm test -w @aluvia/cli -- test/proxy-state.test.ts`

Expected: PASS.

- [ ] **Step 8: Write failing control-server tests**

Create `packages/cli/test/proxy-control-server.test.ts`:

```ts
import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert';
import type { Server } from 'node:http';
import { createControlServer, ControlError } from '../src/proxy-control-server.js';
import { defaultAttach } from '../src/proxy-state.js';

async function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : 0);
    });
    server.on('error', reject);
  });
}

describe('control server', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  });

  test('POST /route of * is 400 and POST of a host is 200 after the handler resolves', async () => {
    let routed: string | null = null;
    server = createControlServer({
      getStatus: () => ({
        pid: 1,
        proxyUrl: 'http://127.0.0.1:18787',
        controlUrl: 'http://127.0.0.1:18788',
        connectionId: 1,
        sessionId: 'x',
        targetGeo: null,
        rules: routed ? [routed] : [],
        count: routed ? 1 : 0,
        attach: defaultAttach('/tmp'),
      }),
      route: async (host) => {
        if (host === '*') throw new ControlError(400, 'catch-all * is not allowed');
        routed = host;
        return { rules: [host] };
      },
      unroute: async () => ({ rules: [] }),
      rotateIp: async () => ({ sessionId: 'n', connectionId: 1 }),
      setGeo: async () => ({ targetGeo: null, connectionId: 1 }),
      stop: () => {},
    });
    const port = await listen(server);

    const bad = await fetch(`http://127.0.0.1:${port}/route`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ host: '*' }),
    });
    assert.strictEqual(bad.status, 400);
    assert.deepStrictEqual(await bad.json(), { error: 'catch-all * is not allowed' });

    const ok = await fetch(`http://127.0.0.1:${port}/route`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ host: 'example.com' }),
    });
    assert.strictEqual(ok.status, 200);
    assert.deepStrictEqual(await ok.json(), { rules: ['example.com'] });
    assert.strictEqual(routed, 'example.com');
  });

  test('unknown path is 404 and set-geo with neither field is 400', async () => {
    server = createControlServer({
      getStatus: () => {
        throw new Error('unused');
      },
      route: async () => ({ rules: [] }),
      unroute: async () => ({ rules: [] }),
      rotateIp: async () => ({ sessionId: 'n', connectionId: 1 }),
      setGeo: async () => ({ targetGeo: null, connectionId: 1 }),
      stop: () => {},
    });
    const port = await listen(server);
    const missing = await fetch(`http://127.0.0.1:${port}/nope`);
    assert.strictEqual(missing.status, 404);

    const geo = await fetch(`http://127.0.0.1:${port}/set-geo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(geo.status, 400);
  });
});
```

- [ ] **Step 9: Implement the control server (expect FAIL first)**

Run: `npm test -w @aluvia/cli -- test/proxy-control-server.test.ts`

Expected: FAIL, module not found.

Create `packages/cli/src/proxy-control-server.ts`. Bind nothing here — the caller listens. Parse JSON bodies. Dispatch:

| Method | Path | Behavior |
|---|---|---|
| GET | `/status` | `200` + `handlers.getStatus()` |
| POST | `/route` | Parse `host`; if missing/empty/`*`/loopback → 400 via `parseRouteHost`; else `handlers.route(host)` then 200 `{ rules }` |
| POST | `/unroute` | Missing host → 400 `{ error: 'host is required' }`; else `handlers.unroute(parsed.host)` (unroute of an unknown host is still 200) |
| POST | `/rotate-ip` | `handlers.rotateIp()` → 200 |
| POST | `/set-geo` | Neither `geo` nor `clear`, or both → 400 `{ error: 'set-geo requires either geo or clear, not both' }`; else handler |
| POST | `/stop` | Call `handlers.stop()` after writing `200 { "status": "stopped" }` (use `res.end` then `setImmediate(stop)` so the response flushes) |
| else | | 404 `{ error: 'not found' }` |

```ts
export class ControlError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'ControlError';
    this.statusCode = statusCode;
  }
}
```

Uncaught handler errors: if `ControlError`, use its status; else 500 `{ error: err.message }`. Always `Content-Type: application/json`.

`createControlServer` must pass `{ host: '127.0.0.1' }` only when the daemon later calls `server.listen(port, '127.0.0.1')` — do not listen inside `createControlServer`.

- [ ] **Step 10: Re-run control-server tests**

Run: `npm test -w @aluvia/cli -- test/proxy-control-server.test.ts`

Expected: PASS.

- [ ] **Step 11: Add `AluviaClient.getNetworkState()`**

In `packages/sdk/src/client/AluviaClient.ts`, add a public method:

```ts
  getNetworkState(): {
    connectionId: number | undefined;
    sessionId: string | null;
    targetGeo: string | null;
    rules: string[];
  } {
    const config = this.configManager.getConfig();
    return {
      connectionId: this.connectionId,
      sessionId: config?.sessionId ?? null,
      targetGeo: config?.targetGeo ?? null,
      rules: config?.rules ?? [],
    };
  }
```

Add this test to the existing `describe('AluviaClient')` block in `packages/sdk/test/integration.test.ts`:

```ts
  test('getNetworkState snapshots ConfigManager', () => {
    const client = new AluviaClient({ apiKey: 'test-api-key', logLevel: 'silent' });
    (client as any).configManager.getConfig = () => ({
      sessionId: 'abc',
      targetGeo: 'us_ca',
      rules: ['example.com'],
    });
    Object.defineProperty(client, 'connectionId', { get: () => 3449 });
    assert.deepStrictEqual(client.getNetworkState(), {
      connectionId: 3449,
      sessionId: 'abc',
      targetGeo: 'us_ca',
      rules: ['example.com'],
    });
  });
```

Run: `npm test -w @aluvia/sdk -- test/integration.test.ts` — the new test must pass; existing AluviaClient tests stay green.

- [ ] **Step 12: Write failing lifecycle tests + helpers**

Create `packages/cli/test/helpers/ports.ts`:

```ts
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
```

Create `packages/cli/test/helpers/mock-aluvia-api.ts`:

```ts
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
```

Create `packages/cli/test/proxy-lifecycle.test.ts` with these cases. Each test sets `process.env.ALUVIA_HOME` to a `mkdtempSync` dir, `ALUVIA_API_KEY=test-key`, `ALUVIA_API_BASE_URL` to the mock API, and unique `--port` / `--control-port` from `findFreePort()`. Use `captureOutput` from `../src/mcp-helpers.js` around `handleProxy([...])`. Always `handleProxy(['stop'])` in `afterEach` (ignore errors).

Required cases:

1. **`start` without an API key** — delete `ALUVIA_API_KEY` and ensure no key in `config.json`. Expect `isError: true` and the verbatim no-key message.
2. **`start` writes `proxy.json` + `proxy.log` under `ALUVIA_HOME`** — after start, file exists, `ready: true`, `sessionId` is 32 hex chars, `connectionId === 3449`, `rules` is `[]`. Mock API received a PATCH with `session_id`.
3. **sticky id reused** — first start PATCHes a UUID; `stop`; second `start` with the stored `connectionId` does **not** PATCH a different `session_id` (seed the mock with the first id, or assert `state.session_id` is unchanged after the second start).
4. **singleton** — second `start` is `isError: true`, `error === 'proxyd already running'`, and includes `proxyUrl`.
5. **stale pid** — write `proxy.json` with `pid` that is not alive (e.g. `999999991`) and `ready: false`; `start` succeeds (exit 0).
6. **fixed ports** — `occupyPort(dataPort)` then `start --port dataPort` → `isError: true` and `error === \`port ${dataPort} in use\``.
7. **`status` healthy** — after start, `healthy === true`, both URLs present.
8. **`stop` then status** — `stop` → `{ status: 'stopped' }`; `proxy.json` has `pid: null`, `ready: false`, same `sessionId`/`rules`; subsequent `status` is error `proxyd is not running. Run \`aluvia proxy start\`.`
9. **`stop` when already dead** — kill the pid, then `stop` → exit 0 `{ status: 'stopped' }` and pidfile cleared.
10. **start strips `*`** — seed mock rules `['*', 'example.com']`; after start, `state.rules` is `['example.com']` (no start failure).
11. **control timeout** — do not start proxyd. Write `proxy.json` with `pid: process.pid` (so `isProcessAlive` is true), `ready: true`, and `controlUrl` pointing at `http://127.0.0.1:<freePort>` where a TCP server accepts connections and never responds. `handleProxy(['status'])` → `isError: true`, `error === 'proxyd did not respond. Run \`aluvia proxy status\`.'` in at most ~3s.

- [ ] **Step 13: Run lifecycle tests (expect FAIL)**

Run: `npm test -w @aluvia/cli -- test/proxy-lifecycle.test.ts`

Expected: FAIL, `handleProxy` / daemon modules missing.

- [ ] **Step 14: Implement `getCliLaunch` and switch `open.ts`**

`packages/cli/src/cli-path.ts` — extract the “find cli.js next to this module” logic from `open.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const thisModuleDir = path.dirname(fileURLToPath(import.meta.url));

export function getCliLaunch(): { execPath: string; prefixArgs: string[]; script: string } {
  const js = path.join(thisModuleDir, 'cli.js');
  if (fs.existsSync(js)) {
    return { execPath: process.execPath, prefixArgs: [], script: js };
  }
  const ts = path.join(thisModuleDir, 'cli.ts');
  if (fs.existsSync(ts)) {
    return { execPath: process.execPath, prefixArgs: ['--import', 'tsx'], script: ts };
  }
  throw new Error(`Could not find cli.js or cli.ts in ${thisModuleDir}`);
}
```

Switch `packages/cli/src/open.ts` `getCliScriptPath()` / `spawn(...)` to `getCliLaunch()` so session start keeps working from source.

- [ ] **Step 15: Implement `bothPortsAccept` and `controlRequest`**

In `packages/cli/src/proxy-control-client.ts` (import `net` from `node:net` and `isProcessAlive` from `@aluvia/sdk`):

```ts
export async function bothPortsAccept(state: {
  dataPort: number;
  controlPort: number;
}): Promise<boolean> {
  const check = (port: number) =>
    new Promise<boolean>((resolve) => {
      const sock = net.connect({ host: '127.0.0.1', port }, () => {
        sock.end();
        resolve(true);
      });
      sock.setTimeout(200);
      sock.on('timeout', () => {
        sock.destroy();
        resolve(false);
      });
      sock.on('error', () => resolve(false));
    });
  const [dataOk, controlOk] = await Promise.all([check(state.dataPort), check(state.controlPort)]);
  return dataOk && controlOk;
}
```

`controlRequest(method, pathname, body?)`:
- If no `proxy.json` or `pid` is null or `!isProcessAlive(pid)` → throw a tagged error `not_running` (the CLI verb turns this into the verbatim “not running” message).
- `fetch(controlUrl + pathname)` with `AbortSignal.timeout(2000)` (or `AbortController` + 2s).
- Abort → tagged `timeout`.
- Return `{ status, json }`.

CLI verbs catch `not_running` → verbatim not-running message, `timeout` → verbatim timeout message.

- [ ] **Step 16: Implement `runProxyDaemon` and `handleProxyDaemon`**

`packages/cli/src/proxy-daemon.ts` — `runProxyDaemon(opts)`:

1. Construct `AluviaClient` with `{ apiKey, startPlaywright: false, localPort: opts.dataPort, logLevel: 'info', connectionId?, apiBaseUrl?, gatewayHost?, gatewayPort? }`.
2. Preserve `attach` from existing `proxy.json` if `existing.dataPort === opts.dataPort`; else `defaultAttach(configDir())`.
3. `writeProxyJson` early with `pid: process.pid`, `ready: false`.
4. `await client.start()`. On failure, if the message includes `EADDRINUSE`, throw `new Error(\`port ${opts.dataPort} in use\`)`.
5. Strip every rule whose trimmed value is exactly `*`; if anything was stripped, `await client.updateRules(stripped)`.
6. If `getNetworkState().sessionId == null`, `await client.updateSessionId(crypto.randomUUID().replace(/-/g, ''))`.
7. Create the control server. Handlers:
   - `getStatus`: live `getNetworkState()` + attach + urls + pid. Do **not** read rules from the file.
   - `route` / `unroute` / `rotateIp` / `setGeo`: call the matching `AluviaClient` method, then `persist()` (`writeProxyJson` with `ready: true` and live network state). `route` dedupes the normalized host (case already lowered). `unroute` removes the exact normalized string; missing host still returns current rules.
   - `stop`: begin graceful shutdown.
8. `server.listen(opts.controlPort, '127.0.0.1')`. On `EADDRINUSE`, `await client.stop()` and throw `new Error(\`port ${opts.controlPort} in use\`)`.
9. `persist()` with `ready: true`.
10. SIGINT/SIGTERM: close control server, `client.stop()`, rewrite `proxy.json` with `pid: null`, `ready: false`, keep connection/sticky/rules/attach, `process.exit(0)`.

`handleProxyDaemon(args)` parses `--port`, `--control-port`, `--connection-id`; reads ports from flags, else `ALUVIA_PROXY_PORT` / `ALUVIA_PROXY_CONTROL_PORT`, else defaults; reads `ALUVIA_API_KEY`, `ALUVIA_API_BASE_URL`, `ALUVIA_GATEWAY_HOST`, `ALUVIA_GATEWAY_PORT`; calls `runProxyDaemon`. Stdio is already redirected to `$ALUVIA_HOME/proxy.log` by the parent spawn.

Daemon `route` / `unroute` / `rotateIp` / `setGeo` handlers are required here (real `AluviaClient` calls + `writeProxyJson`). Do not stub them.

- [ ] **Step 17: Implement CLI `start` / `stop` / `status` and wire `cli.ts`**

`packages/cli/src/proxy.ts` — `handleProxy(args)`:

- `start`: require API key (verbatim message). If live pid → `output({ ...statusFields, error: 'proxyd already running' }, 1)`. If stale pid, ignore it and keep `connectionId` / `sessionId`. Probe requested ports with a brief bind to `127.0.0.1`; if taken, `output({ error: \`port ${n} in use\` }, 1)`. Spawn detached via `getCliLaunch()`:

```ts
spawn(launch.execPath, [...launch.prefixArgs, launch.script, '--proxy-daemon', '--port', String(dataPort), '--control-port', String(controlPort), ...(connectionId != null ? ['--connection-id', String(connectionId)] : [])], {
  detached: true,
  stdio: ['ignore', logFd, logFd],
  env: {
    ...process.env,
    ALUVIA_API_KEY: apiKey,
    ALUVIA_HOME: configDir(),
  },
});
child.unref();
```

  Parent polls `readProxyJson()` every 250ms for up to 60s (`maxAttempts = 240`). Child death → `{ error: 'proxyd process exited unexpectedly.', logFile }` exit 1. Timeout → same pattern as `session start`. Success: TCP-connect both ports, print start/status JSON (`healthy` true only if both accept), exit 0.

- `stop`: if no live pid, clear pid/ready if a file exists, `output({ status: 'stopped' })`. Else `POST /stop`. If control is dead, `process.kill(pid, 'SIGTERM')`; if still alive after 10s, `SIGKILL`. Always rewrite pid/ready cleared. Exit 0.

- `status`: require live daemon. GET `/status`, then `healthy = await bothPortsAccept(state)`. Print the spec §8 start/status shape including `healthy` and `count`. Exit 0 even when `healthy: false`.

CLI verbs `route` / `unroute` / `rotate-ip` / `set-geo` / `attach` wait until later tasks. Task 2 default:

```ts
output({ error: `Unknown proxy subcommand: '${subcommand}'. Run "aluvia help" for usage.` }, 1);
```

`packages/cli/src/cli.ts`:

```ts
  if (command === '--proxy-daemon') {
    await handleProxyDaemon(args.slice(1));
    return;
  }
  // ...
  } else if (command === 'proxy') {
    if (wantsHelp) printHelpAndExit(args);
    await handleProxy(args.slice(1));
```

Do not add a `proxy` section to help yet (Task 5). Unknown command text stays as-is.

- [ ] **Step 18: Run lifecycle + existing tests**

Run:

```bash
npm run build:sdk
npm test -w @aluvia/cli -- test/proxy-lifecycle.test.ts test/proxy-host.test.ts test/proxy-state.test.ts test/proxy-control-server.test.ts test/config-home.test.ts
npm test -w @aluvia/sdk
```

Expected: PASS. If a lifecycle test flakes on spawn-from-source, fix `getCliLaunch()` / env plumbing — do not lengthen the 60s poll.

- [ ] **Step 19: Commit**

```bash
git add packages/sdk/src/client/AluviaClient.ts packages/cli/src packages/cli/test
git commit -m "$(cat <<'EOF'
feat: add proxyd and aluvia proxy start/stop/status

Detached loopback control plane, durable proxy.json, sticky session_id,
and a hard fail when the requested data or control port is already taken.
EOF
)"
```

---

### Task 3: `route` / `unroute` / `rotate-ip` / `set-geo` + synchronous mock-gateway proof

**Files:**
- Create: `packages/cli/test/helpers/mock-gateway.ts`
- Create: `packages/cli/test/helpers/connect-via-proxy.ts`
- Create: `packages/cli/test/proxy-route.test.ts`
- Modify: `packages/sdk/src/client/types.ts` (`gatewayHost?: string`)
- Modify: `packages/sdk/src/client/ConfigManager.ts` (`RawProxyConfig.host` becomes `string`; default `'gateway.aluvia.io'`)
- Modify: `packages/sdk/src/client/AluviaClient.ts` (pass `gatewayHost` into `ConfigManager`)
- Modify: `packages/cli/src/proxy.ts` (add `route` / `unroute` / `rotate-ip` / `set-geo` to the switch)
- Modify: `packages/cli/src/proxy-daemon.ts` (read `ALUVIA_GATEWAY_HOST` / `ALUVIA_GATEWAY_PORT`)

**Interfaces:**
- Consumes: `handleProxy`, `createMockAluviaApi`, `parseRouteHost`, `controlRequest`, `AluviaClient.updateRules` / `updateSessionId` / `updateTargetGeo`
- Produces:
  - CLI success shapes (spec §8):
    - `route` / `unroute`: `{ rules: string[], count: number }`
    - `rotate-ip`: `{ sessionId: string, connectionId: number }`
    - `set-geo`: `{ targetGeo: string | null, connectionId: number }`
  - `AluviaClientOptions.gatewayHost?: string` (default `'gateway.aluvia.io'`)
  - After `handleProxy(['route', host])` returns, the next CONNECT through the data port for that host uses `upstreamProxyUrl` pointing at the mock gateway. No 5s sleep anywhere in the test.

- [ ] **Step 1: Add `gatewayHost` so tests can point the upstream at loopback**

In `packages/sdk/src/client/types.ts`, add to `AluviaClientOptions`:

```ts
  /**
   * Optional: upstream Aluvia gateway hostname.
   * Default: 'gateway.aluvia.io'.
   */
  gatewayHost?: string;
```

In `ConfigManagerOptions` add `gatewayHost?: string`. Change `RawProxyConfig.host` from the `'gateway.aluvia.io'` literal to `string`. In `buildConfigFromAny`:

```ts
        host: this.options.gatewayHost ?? 'gateway.aluvia.io',
```

In `AluviaClient` constructor, pass `gatewayHost: options.gatewayHost`.

Existing ProxyServer unit tests that hardcode `host: 'gateway.aluvia.io' as const` stay valid.

- [ ] **Step 2: Write the mock gateway + CONNECT helper**

`packages/cli/test/helpers/mock-gateway.ts`:

```ts
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
```

`packages/cli/test/helpers/connect-via-proxy.ts` (machine form of `curl -x http://127.0.0.1:PORT https://host`):

```ts
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
```

- [ ] **Step 3: Write failing route tests**

Create `packages/cli/test/proxy-route.test.ts`. Shared `beforeEach`: temp `ALUVIA_HOME`, mock API, mock gateway, two free ports, `ALUVIA_API_KEY`, `ALUVIA_API_BASE_URL`, `ALUVIA_GATEWAY_HOST=127.0.0.1`, `ALUVIA_GATEWAY_PORT=<mock gateway port>`. `handleProxy(['start', '--port', ...])` via `captureOutput`. `afterEach`: stop + close mocks.

Cases:

1. **Synchronous route** — `captureOutput(() => handleProxy(['route', 'example.com']))` is success `{ rules: ['example.com'], count: 1 }`. Immediately `await connectViaProxy(dataPort, 'example.com')`. Assert `gateway.connects` includes `'example.com:443'`. There is no `setTimeout` / `sleep` in this test. If someone waits 5s for an ETag poll, this task failed.
2. **Unroute goes direct** — after route, `unroute example.com`, then CONNECT `example.com` again. Assert `gateway.connects.length` did **not** increase (local proxy went direct; the mock gateway is not the origin).
3. **Unrouted host never hits the gateway** — start with empty rules, CONNECT `other.com`, `gateway.connects` stays `[]`.
4. **CLI refuses `*`** — `handleProxy(['route', '*'])` → exit 1, `error === 'catch-all * is not allowed'`. Mock API `rules` unchanged. No `--force` flag exists (do not add one).
5. **Control refuses `*`** — with daemon up, `POST { host: '*' }` to the control port → HTTP 400.
6. **URL parse** — `handleProxy(['route', 'https://Example.COM/path?q=1'])` → rules `['example.com']`.
7. **Loopback refuse** — `handleProxy(['route', 'localhost'])` → exit 1, `error === 'loopback hosts cannot be routed'`.
8. **Unroute of a missing host succeeds** — `handleProxy(['unroute', 'nope.example'])` → `{ rules: [...current], count }`, exit 0.
9. **rotate-ip** — capture previous `sessionId` from status; `rotate-ip` returns a different 32-hex `sessionId` and the same `connectionId`; mock API `session_id` matches; `handleProxy(['rotate-ip'])` is the only thing that changed it.
10. **set-geo** — `set-geo us_ca` → `{ targetGeo: 'us_ca', connectionId }`; `set-geo --clear` → `{ targetGeo: null, connectionId }`; `set-geo` with neither → exit 1; `set-geo us_ca --clear` → exit 1.
11. **Daemon down** — after stop, `route example.com` → exit 1, verbatim not-running message.
12. **PATCH failure leaves memory unchanged** — point `ALUVIA_API_BASE_URL` at a server that 500s PATCH after start (or close the mock API). `route` is exit 1; `status.rules` is still `[]`. (`setConfig` already refuses to swap on non-200 — do not add a second cache.)
13. **Missing host** — `handleProxy(['route'])` → exit 1, `error === 'host is required'`.
14. **Control up, data port dead** — do not start proxyd. Write `proxy.json` with `pid: process.pid`, `ready: true`, `dataPort` equal to a port nothing listens on, and `controlUrl` pointing at a tiny `http.createServer` that returns `200 { rules: ['example.com'] }` for `POST /route`. `handleProxy(['route', 'example.com'])` → exit 1, `error === 'proxyd data port is not healthy. Run \`aluvia proxy status\`.'`

- [ ] **Step 4: Run route tests (expect FAIL on missing verbs / gatewayHost)**

Run: `npm test -w @aluvia/cli -- test/proxy-route.test.ts`

Expected: FAIL until verbs and `gatewayHost` exist.

- [ ] **Step 5: Implement the CLI verbs and daemon gateway env**

In `handleProxy`:

```ts
    case 'route': {
      const parsed = parseRouteHost(args[1] ?? '');
      if (!parsed.ok) output({ error: parsed.error }, 1);
      const healthy = await bothPortsAccept(readProxyJson()!);
      if (!healthy) {
        output({ error: 'proxyd data port is not healthy. Run `aluvia proxy status`.' }, 1);
      }
      const res = await controlRequest('POST', '/route', { host: parsed.host });
      if (res.status !== 200) output({ error: String(res.json.error ?? 'route failed') }, 1);
      const rules = res.json.rules as string[];
      output({ rules, count: rules.length });
    }
```

`unroute` is the same without the `*` / loopback special case beyond `parseRouteHost` (empty host still fails; loopback unroute of something that cannot be in the list is still a parse error — that matches “reject loopback” on both verbs).

`rotate-ip` → `POST /rotate-ip` `{}` → `{ sessionId, connectionId }`.

`set-geo`: parse `--clear` and one positional. Neither or both → `{ error: 'set-geo requires either geo or clear, not both' }` exit 1. Else POST `{ geo }` or `{ clear: true }`.

Daemon `handleProxyDaemon` must pass through:

```ts
gatewayHost: process.env.ALUVIA_GATEWAY_HOST,
gatewayPort: process.env.ALUVIA_GATEWAY_PORT
  ? Number(process.env.ALUVIA_GATEWAY_PORT)
  : undefined,
apiBaseUrl: process.env.ALUVIA_API_BASE_URL,
```

Daemon handlers already exist from Task 2. Do not rewrite them unless a test proves they skip `updateRules` / `writeProxyJson`.

- [ ] **Step 6: Run route tests + lifecycle + SDK**

Run:

```bash
npm run build:sdk
npm test -w @aluvia/cli
npm test -w @aluvia/sdk
```

Expected: PASS. The synchronous-route test must finish well under 5 seconds.

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/src/client/types.ts packages/sdk/src/client/ConfigManager.ts packages/sdk/src/client/AluviaClient.ts packages/cli/src packages/cli/test
git commit -m "$(cat <<'EOF'
feat: make aluvia proxy route take effect before the CLI returns

Route, unroute, rotate-ip, and set-geo PATCH inside proxyd. Tests prove
the next CONNECT hits a mock gateway with no ETag poll wait.
EOF
)"
```

---

### Task 4: `aluvia proxy attach`

**Files:**
- Create: `packages/cli/src/proxy-attach.ts`
- Create: `packages/cli/test/proxy-attach.test.ts`
- Modify: `packages/sdk/src/client/ProxyServer.ts` (request observer)
- Modify: `packages/sdk/src/client/AluviaClient.ts` (`setRequestObserver`)
- Modify: `packages/cli/src/proxy-daemon.ts` (install observer, `/attach` is **not** a control route — attach is CLI-side)
- Modify: `packages/cli/src/proxy.ts` (`attach` verb)
- Modify: `packages/cli/src/proxy-control-server.ts` (add `GET /last-connect` and `POST /attach-state`)

**Interfaces:**
- Consumes: running proxyd, `defaultAttach`, `writeProxyJson`, `readProxyJson`, `handleProxy(['start'])`
- Produces:

```ts
export function writeAttachExtension(extDir: string, dataPort: number): void;
export async function tryGsettings(dataPort: number): Promise<boolean>;
export async function waitForExternalConnect(opts: {
  client: { setRequestObserver(fn: ((hostname: string) => void) | null): void };
  timeoutMs: number;
  isIgnorableHost: (hostname: string) => boolean;
}): Promise<boolean>;

// AluviaClient.setRequestObserver(fn: ((hostname: string) => void) | null): void
// ProxyServer.setRequestObserver(fn: ((hostname: string) => void) | null): void
```

Attach is **CLI-side**, not a control POST. The CLI: require/start proxyd → write `$ALUVIA_HOME/ext` with the **live** data port baked in → try gsettings (ignore errors) → wait `ALUVIA_ATTACH_WAIT_MS` or 15000ms for a data-plane hostname that is **not** loopback → `verified` + method `gsettings` if gsettings returned true, else `extension` if a CONNECT arrived (tests inject CONNECT; treat any non-loopback CONNECT as success and set `method` to `'gsettings'` only when the gsettings spawn exited 0, otherwise `'extension'`) → timeout `needs_ui` exit **0**.

Do **not** self-verify with `connectViaProxy` / `curl -x` inside production attach code. Tests may inject CONNECT from the harness.

Success shapes (spec §8):

```json
{ "status": "verified", "method": "gsettings", "proxyUrl": "http://127.0.0.1:18787" }
```

```json
{ "status": "needs_ui", "extensionPath": "…", "instructions": "…" }
```

`instructions` must tell a human: open `chrome://extensions` → Developer mode → Load unpacked → select `extensionPath`.

- [ ] **Step 1: Write failing attach tests**

Create `packages/cli/test/proxy-attach.test.ts` (same home/API/port fixture as route tests).

1. **`attach` writes a valid MV3 extension** — set `ALUVIA_ATTACH_WAIT_MS=50` so this case ends in `needs_ui` without a 15s sleep. After `handleProxy(['attach'])`, assert:
   - `$ALUVIA_HOME/ext/manifest.json` exists
   - `manifest_version === 3`
   - `permissions` includes `'proxy'`
   - `background.service_worker` is present
   - `background.js` contains `chrome.proxy.settings.set`
   - `background.js` contains the live `dataPort` as a number (e.g. `port: 19123`)
   - `bypassList` includes `localhost`, `127.0.0.1`, `::1`, `<local>`
2. **CONNECT flips to verified** — set `ALUVIA_ATTACH_WAIT_MS=2000`. Start `handleProxy(['attach'])` without awaiting; after ~50ms `connectViaProxy(dataPort, 'verify.example')`; await attach. Expect exit 0, `{ status: 'verified', method: 'extension' | 'gsettings', proxyUrl }`. `proxy.json` `attach.status === 'verified'` and `verifiedAt` is an ISO string.
3. **No CONNECT → needs_ui exit 0** — `ALUVIA_ATTACH_WAIT_MS=80`, no CONNECT. Expect `isError: false`, `status === 'needs_ui'`, `extensionPath` set, `instructions` is a non-empty string mentioning `chrome://extensions`.
4. **Attach starts proxyd when down** — do not call `start` first; `attach` with API key + mock API starts the daemon and then writes `ext/`.
5. **Restart preserves attach unless data port changed** — verified attach, `stop`, `start` same ports → `attach.status` still `verified`. `stop`, `start` with a different `--port` → `attach.status === 'unverified'`.

- [ ] **Step 2: Run attach tests (expect FAIL)**

Run: `npm test -w @aluvia/cli -- test/proxy-attach.test.ts`

Expected: FAIL, `proxy-attach` / observer / verb missing.

- [ ] **Step 3: Add the request observer on `ProxyServer`**

In `ProxyServer`:

```ts
  private requestObserver: ((hostname: string) => void) | null = null;

  setRequestObserver(fn: ((hostname: string) => void) | null): void {
    this.requestObserver = fn;
  }
```

In `handleRequest`, after a hostname is extracted (including loopback), call `this.requestObserver?.(hostname)` before returning.

In `AluviaClient`:

```ts
  setRequestObserver(fn: ((hostname: string) => void) | null): void {
    this.proxyServer.setRequestObserver(fn);
  }
```

The daemon must expose CONNECTs to the CLI waiter. Attach is CLI-side, so the waiter cannot call `setRequestObserver` on the child's client.

Do **not** add `POST /attach` as a “do the whole attach” route. Add exactly these two control endpoints (Task 2 left the handlers optional):

- `GET /last-connect` → `{ "hostname": string | null }`
- `POST /attach-state` → body is `ProxyAttachState`; 400 if `status` is not `unverified` | `verified` | `needs_ui`; 200 `{ "attach": ... }` after `setAttach` + persist

In `runProxyDaemon`:

```ts
let lastConnect: string | null = null;
client.setRequestObserver((hostname) => {
  lastConnect = hostname;
});
```

Pass `getLastConnect: () => lastConnect` and `setAttach: (next) => { attach = next; persist(); }` into `createControlServer`.

CLI attach polls `GET /last-connect` every 100ms until `hostname` is non-null and `!isLoopbackHostname(hostname)`, or timeout. Do not reset `lastConnect` unless you want a cleaner test; not required.

Add a control-server unit test: `GET /last-connect` returns the handler value; `POST /attach-state` with `{ status: 'nope' }` is 400. Unknown-path test still 404s `/nope`.

- [ ] **Step 4: Implement extension writer + gsettings + attach verb**

`packages/cli/src/proxy-attach.ts`:

`writeAttachExtension(extDir, dataPort)` writes:

`manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "Aluvia proxy",
  "version": "1.0.0",
  "permissions": ["proxy"],
  "background": { "service_worker": "background.js" }
}
```

`background.js` (port baked in; the extension cannot read `ALUVIA_HOME`):

```js
chrome.proxy.settings.set({
  value: {
    mode: 'fixed_servers',
    rules: {
      singleProxy: { scheme: 'http', host: '127.0.0.1', port: __PORT__ },
      bypassList: ['localhost', '127.0.0.1', '::1', '<local>'],
    },
  },
  scope: 'regular',
});
```

Replace `__PORT__` with the numeric `dataPort` at write time.

`tryGsettings(dataPort)`: `spawnSync('gsettings', ...)` for:

```
org.gnome.system.proxy mode manual
org.gnome.system.proxy.http host 127.0.0.1
org.gnome.system.proxy.http port <dataPort>
org.gnome.system.proxy.https host 127.0.0.1
org.gnome.system.proxy.https port <dataPort>
org.gnome.system.proxy ignore-hosts ['localhost','127.0.0.1','::1']
```

Return `true` only if every spawn exited 0. Catch `ENOENT` and return `false`. Never throw.

`handleProxy(['attach'])`:
1. If daemon down, run the same path as `start` (requires API key).
2. `writeAttachExtension(path.join(configDir(), 'ext'), dataPort)`.
3. `const gok = await tryGsettings(dataPort)`.
4. Poll `GET /last-connect` until a non-loopback hostname appears or timeout (`Number(process.env.ALUVIA_ATTACH_WAIT_MS) || 15_000`).
5. On success: `POST /attach-state` with `{ status: 'verified', method: gok ? 'gsettings' : 'extension', verifiedAt: new Date().toISOString(), extensionPath }`, then `output({ status: 'verified', method, proxyUrl })`.
6. On timeout: `POST /attach-state` with `{ status: 'needs_ui', method: null, verifiedAt: null, extensionPath }`, then `output({ status: 'needs_ui', extensionPath, instructions }, 0)` — **exit 0**.

Do not write `proxy.json` from the attach CLI verb. The daemon owns the file (`setAttach` + persist) so a concurrent `route` cannot clobber attach or the reverse.

- [ ] **Step 5: Run attach + full CLI + SDK tests**

Run:

```bash
npm run build:sdk
npm test -w @aluvia/cli
npm test -w @aluvia/sdk
```

Expected: PASS. Attach timeout test must use the short env, not a real 15s sleep.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/client/ProxyServer.ts packages/sdk/src/client/AluviaClient.ts packages/cli/src packages/cli/test
git commit -m "$(cat <<'EOF'
feat: add aluvia proxy attach for the GUI browser

Generate an unpacked MV3 chrome.proxy extension with the data port baked
in, try gsettings, and report verified or needs_ui without false-positive
self-CONNECT checks.
EOF
)"
```

---

### Task 5: Computer-use skill + CLI help

**Files:**
- Create: `skills/aluvia-proxy/SKILL.md`
- Modify: `packages/cli/src/cli.ts` (`printHelp` + `printHelpJson`)
- Modify: `README.md` (one short “computer-use VM” paragraph only)
- Modify: `packages/cli/README.md` (a `proxy` command section, not a marketing rewrite)

**Interfaces:**
- Consumes: the shipped CLI contract from Tasks 2–4
- Produces: in-repo skill at `skills/aluvia-proxy/SKILL.md`; help lists every `aluvia proxy` verb; `aluvia help --json` includes those commands

Do not add MCP tools. Do not change `session` help except to keep it intact. Do not rewrite the root README beyond one paragraph.

- [ ] **Step 1: Write a failing help assertion**

Export `buildHelpJson(): { commands: Array<{ command: string; description: string; options: unknown[] }>; environment: string[] }` from `packages/cli/src/cli.ts` and have `printHelpJson` call `output(buildHelpJson())`. Importing `cli.ts` does not run `main()` (existing entry guard).

Add `packages/cli/test/proxy-help.test.ts`:

```ts
import { describe, test } from 'node:test';
import assert from 'node:assert';
import { buildHelpJson } from '../src/cli.js';

describe('proxy help', () => {
  test('help JSON lists every proxy verb and ALUVIA_HOME', () => {
    const help = buildHelpJson();
    const names = help.commands.map((c) => c.command);
    for (const verb of [
      'proxy start',
      'proxy stop',
      'proxy status',
      'proxy route <host>',
      'proxy unroute <host>',
      'proxy rotate-ip',
      'proxy set-geo <geo>',
      'proxy attach',
    ]) {
      assert.ok(names.includes(verb), verb);
    }
    assert.ok(help.environment.includes('ALUVIA_HOME'));
  });
});
```

- [ ] **Step 2: Run help test (expect FAIL)**

Run: `npm test -w @aluvia/cli -- test/proxy-help.test.ts`

Expected: FAIL — help JSON has no `proxy` commands.

- [ ] **Step 3: Add help text and `buildHelpJson`**

Refactor `printHelpJson` to `buildHelpJson()` + `output(buildHelpJson())`. Add a human-readable `proxy` section to `printHelp()` **after** the session commands and **before** account:

```
  aluvia proxy start [options]                 Start the local egress daemon
  aluvia proxy stop                            Stop the local egress daemon
  aluvia proxy status                          Show daemon status
  aluvia proxy route <host>                    Send a hostname through Aluvia
  aluvia proxy unroute <host>                  Stop sending a hostname through Aluvia
  aluvia proxy rotate-ip                       Rotate the sticky upstream IP
  aluvia proxy set-geo <geo>                   Set or clear target geo
  aluvia proxy attach                          Point the GUI browser at the local proxy
```

Start options: `--port`, `--control-port`, `--connection-id`.

Environment block becomes:

```
  ALUVIA_API_KEY             Optional. Takes precedence over the key stored by `aluvia auth`.
  ALUVIA_HOME                Optional. Default ~/.aluvia. Auth + proxyd state live here.
  ALUVIA_PROXY_PORT          Optional. Data port (default 18787).
  ALUVIA_PROXY_CONTROL_PORT  Optional. Control port (default 18788).
```

JSON help: one object per verb. Add an `environment` string array:

```ts
environment: [
  'ALUVIA_API_KEY',
  'ALUVIA_HOME',
  'ALUVIA_PROXY_PORT',
  'ALUVIA_PROXY_CONTROL_PORT',
]
```

Keep every existing `session` / `account` / `auth` / `geos` / `help` command entry unchanged.

- [ ] **Step 4: Re-run help test**

Run: `npm test -w @aluvia/cli -- test/proxy-help.test.ts`

Expected: PASS.

- [ ] **Step 5: Write the skill file**

Create `skills/aluvia-proxy/SKILL.md` with exactly this content (edit only if a command name in Tasks 2–4 differs — then change the skill to match the shipped CLI, not the other way around):

```markdown
---
name: aluvia-proxy
description: Use when a computer-use screenshot shows a block page, Cloudflare interstitial, Access Denied, CAPTCHA, or unusual-traffic warning in a GUI browser, or when setting up Aluvia egress on an agent VM.
---

# Aluvia proxy (computer-use VM)

Opt-in mobile egress in front of the browser that is already on screen. Same tab, same origin, same cookies. Route only the hostname that is blocked.

## Setup (once per VM)

1. `npm install -g @aluvia/cli` (or `npx aluvia`).
2. `aluvia auth` (device flow; human approves on their laptop). Never print the API key.
3. If `$HOME` is not durable, `export ALUVIA_HOME=/workspace/.aluvia`.
4. `aluvia proxy start` once. One daemon per machine; every agent shares it.
5. `aluvia proxy attach` at **setup**, never mid-task.
   - `verified` → do not touch Chrome proxy settings again.
   - `needs_ui` → stop and ask the human to load the unpacked extension at `extensionPath` (`chrome://extensions` → Developer mode → Load unpacked). After they confirm, do not change proxy settings again.
   - If attach stays `unverified` / `needs_ui` and the browser is still not on the proxy, stop. Do not invent MITM, PAC, nftables, or `https://aluvia.io/https://…`. Do not launch a second Chrome.

## Unblock

A screenshot is a **block** (Cloudflare, Access Denied, CAPTCHA, unusual traffic), not a normal login.

1. Read the hostname from the address bar. `www.example.com` is not `example.com` — route what the bar shows.
2. `aluvia proxy status`. Daemon down → `start`. Attach `unverified` → `attach`. `needs_ui` and still direct → stop and say so.
3. `aluvia proxy route <host>` then **reload the tab**.
4. Parse the CLI JSON. Exit 1 → stop and report `error`. Do not retry with `*`.

If a redirect lands on a new host that is still blocked, route that host too.

## Do not

- Do not route a host where a login still works (Gmail, Slack, Salesforce, or any session that is already fine).
- Do not `aluvia proxy route '*'`. There is no `--force`.
- Do not `aluvia proxy rotate-ip` unless the human explicitly asks. A block after route+reload is not a reason to hop IP (that hops every routed host on the shared browser).
- Do not open a hosted rewrite URL. Do not start `aluvia session *` for this job.
- Chrome on Linux ignores `HTTP_PROXY`. Terminal `curl`/`node` do not use the GUI proxy. For a shell: `export https_proxy=http://127.0.0.1:18787 http_proxy=http://127.0.0.1:18787`, then `aluvia proxy route <host>`.

## Last-resort attach (human takeover only)

Only if `attach` returned `needs_ui` and the unpacked extension cannot be loaded: `chrome://settings/system`, or Chrome Preferences + restart, or a `--proxy-server=127.0.0.1:18787` relaunch. Never do these mid-task. Never kill the harness Chrome as the default.
```

- [ ] **Step 6: Skill checklist (spec §9)**

Confirm each required point is in `skills/aluvia-proxy/SKILL.md` by reading the file, not by memory:

1. Install/auth + `ALUVIA_HOME=/workspace/.aluvia` when `$HOME` is not durable
2. `proxy start` once per VM; one daemon
3. `proxy attach` at setup only; `needs_ui` → human loads unpacked extension
4. Block screenshot → hostname from the address bar → `route` → reload; parse JSON; exit 1 stops
5. Do not route working logins; do not `route '*'`; do not `rotate-ip` unless asked
6. Routing only affects traffic already sent to `http://127.0.0.1:18787`; do not open `aluvia.io/https://…`; do not launch a second Chrome
7. Terminal vs Chrome `HTTP_PROXY` note
8. Never print the API key

- [ ] **Step 7: README paragraph**

In root `README.md`, after the existing Features list (do not rewrite the list), add one paragraph:

```markdown
Computer-use VMs can run a local unauthenticated proxy (`aluvia proxy`) in front of the GUI browser that is already on the machine. Route only the hostnames that block you; signed-in tabs stay on the datacenter IP.
```

In `packages/cli/README.md`, add a short **Proxy daemon** section documenting `proxy start|status|route|unroute|rotate-ip|set-geo|attach` and `ALUVIA_HOME`. Do not remove the session docs.

- [ ] **Step 8: Full regression**

Run:

```bash
npm run build:sdk
npm test -w @aluvia/sdk
npm test -w @aluvia/cli
npm test -w @aluvia/mcp
npm run lint
```

Expected: PASS. MCP smoke still passes because no tools were added. Session help JSON entries are unchanged.

- [ ] **Step 9: Commit**

```bash
git add skills/aluvia-proxy/SKILL.md packages/cli/src/cli.ts packages/cli/test/proxy-help.test.ts README.md packages/cli/README.md
git commit -m "$(cat <<'EOF'
docs: add computer-use proxy skill and CLI help

Document aluvia proxy verbs and the model-driven unblock loop. No new MCP tools.
EOF
)"
```

---

## Out of scope (do not do in this plan)

- Probing a real Agent Computer / Grok Bot GUI Chrome
- New MCP tools wrapping `aluvia proxy`
- Changing `aluvia session set-rules` to be synchronous
- PAC, MITM, transparent proxy, nftables, `/etc` Chrome policy
- Hosted rewrite (`aluvia.io/https://…`) or a remote-browser stream
- Auto-rotation or default `*` rules
- Claiming attach `verified` without a CONNECT on the data port
