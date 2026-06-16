# @aluvia/sdk

Core SDK for Aluvia — a local smart proxy for automation workloads and AI agents. Route traffic through premium US mobile carrier IPs and bypass 403s, CAPTCHAs, and WAFs.

This package provides the programmatic API: `AluviaClient`, `AluviaApi`, `connect()`, and framework adapters (Playwright, Puppeteer, Selenium, Axios, got, fetch).

---

## Table of Contents

- [Get an Aluvia API Key](#get-an-aluvia-api-key)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [What's Included](#whats-included)
- [AluviaClient](#aluviaclient)
- [AluviaApi](#aluviaapi)
- [connect()](#connect)
- [Framework Adapters](#framework-adapters)
- [Error Classes](#error-classes)
- [CLI and MCP](#cli-and-mcp)
- [Documentation](#documentation)
- [License](#license)

---

## Get an Aluvia API Key

You need an API key to use the SDK. Get one from the [Aluvia dashboard](https://dashboard.aluvia.io/?utm_source=npmjs.com&utm_medium=referral):

1. Sign up or sign in at [dashboard.aluvia.io](https://dashboard.aluvia.io/?utm_source=npmjs.com&utm_medium=referral)
2. In your account, open the API & SDKs section
3. Copy your API key

Use it as an environment variable: `export ALUVIA_API_KEY="your-api-key"` or add `ALUVIA_API_KEY=your-api-key` to a `.env` file (never commit it).

---

## Installation

```bash
npm install @aluvia/sdk playwright
```

Playwright is required for browser automation. For HTTP clients only (Axios, got, fetch), omit Playwright.

---

## Quick Start

```typescript
import { AluviaClient } from '@aluvia/sdk';
import { chromium } from 'playwright';

const client = new AluviaClient({
  apiKey: process.env.ALUVIA_API_KEY!,
});

const connection = await client.start();
const browser = await chromium.launch({ proxy: connection.asPlaywright() });
const page = await browser.newPage();
await page.goto('https://example.com');

// ... do your work ...

await browser.close();
await connection.close();
```

With auto-launched browser and block detection:

```typescript
const client = new AluviaClient({
  apiKey: process.env.ALUVIA_API_KEY!,
  startPlaywright: true,
  blockDetection: { enabled: true, autoUnblock: true },
});

const connection = await client.start();
const page = await connection.browser!.newPage();
await page.goto('https://example.com'); // auto-reloads through Aluvia if blocked

await connection.close();
```

---

## What's Included

| Component         | Description                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| **AluviaClient**  | Core proxy client. Manages local proxy, config polling, block detection, and framework adapters. |
| **AluviaApi**     | REST API wrapper for account info, connections, usage, and geo-targeting.                        |
| **connect()**     | Helper to connect to a browser session started by the CLI (`aluvia session start`).              |
| **Adapters**      | Proxy config for Playwright, Puppeteer, Selenium, Axios, got, Node fetch.                        |
| **Error classes** | `MissingApiKeyError`, `InvalidApiKeyError`, `ApiError`, `ProxyStartError`, `ConnectError`.       |

---

## AluviaClient

Create a client, call `start()` to get a connection, then use adapters or the auto-launched browser.

### Constructor options

| Option            | Type                            | Default                      | Description                                  |
| ----------------- | ------------------------------- | ---------------------------- | -------------------------------------------- |
| `apiKey`          | string                          | —                            | **Required.** Your Aluvia API key.           |
| `connectionId`    | number                          | —                            | Reuse an existing Aluvia connection.         |
| `startPlaywright` | boolean                         | false                        | Auto-launch Chromium browser.                |
| `headless`        | boolean                         | true                         | Only with `startPlaywright`.                 |
| `blockDetection`  | BlockDetectionConfig            | —                            | Enable/configure block detection.            |
| `localPort`       | number                          | —                            | Local proxy port (auto-assigned if omitted). |
| `gatewayProtocol` | `"http" \| "https"`             | `"http"`                     | Gateway protocol.                            |
| `gatewayPort`     | number                          | 8080 / 8443                  | Gateway port.                                |
| `pollIntervalMs`  | number                          | 5000                         | Config poll interval.                        |
| `timeoutMs`       | number                          | —                            | API request timeout.                         |
| `logLevel`        | `"silent" \| "info" \| "debug"` | `"info"`                     | Log verbosity.                               |
| `strict`          | boolean                         | true                         | Throw if config fails to load.               |
| `apiBaseUrl`      | string                          | `"https://api.aluvia.io/v1"` | API base URL.                                |

### Runtime updates

Update rules, rotate IP, or change geo without restarting:

```typescript
await client.updateRules(['blocked-site.com']);
await client.updateSessionId('new-session-id');
await client.updateTargetGeo('us');
```

### Rule patterns

| Pattern         | Matches               |
| --------------- | --------------------- |
| `*`             | All hostnames         |
| `example.com`   | Exact match           |
| `*.example.com` | Subdomains            |
| `-example.com`  | Exclude from proxying |

---

## AluviaApi

Use `AluviaApi` for account/connection management without starting a proxy. Also available as `client.api` when using `AluviaClient`.

### Endpoints

| Method                                    | Description                             |
| ----------------------------------------- | --------------------------------------- |
| `api.account.get()`                       | Account info (balance, usage)           |
| `api.account.connections.list()`          | List all connections                    |
| `api.account.connections.create(body)`    | Create a connection                     |
| `api.account.connections.get(id)`         | Get connection details                  |
| `api.account.connections.patch(id, body)` | Update connection (rules, geo, session) |
| `api.account.connections.delete(id)`      | Delete a connection                     |
| `api.account.usage.get(params?)`          | Usage stats for date range              |
| `api.geos.list()`                         | List geo-targeting options              |

### Example

```typescript
import { AluviaApi } from '@aluvia/sdk';

const api = new AluviaApi({ apiKey: process.env.ALUVIA_API_KEY! });

const account = await api.account.get();
console.log('Balance:', account.balance_gb, 'GB');

const geos = await api.geos.list();
console.log(
  'Geos:',
  geos.map((g) => g.code),
);
```

---

## connect()

Connect to a browser session started by the CLI (`aluvia session start`). Useful for AI agents that generate automation code at runtime.

```typescript
import { connect } from '@aluvia/sdk';

const { page, browser, context, disconnect } = await connect();
console.log('URL:', page.url());

// With multiple sessions
const conn = await connect('swift-falcon');

// Disconnect when done (session keeps running)
await disconnect();
```

---

## Framework Adapters

The connection returned by `client.start()` exposes adapter methods:

| Tool       | Method                       | Returns                                   |
| ---------- | ---------------------------- | ----------------------------------------- |
| Playwright | `connection.asPlaywright()`  | `{ server, username?, password? }`        |
| Puppeteer  | `connection.asPuppeteer()`   | `['--proxy-server=...']`                  |
| Selenium   | `connection.asSelenium()`    | `'--proxy-server=...'`                    |
| Axios      | `connection.asAxiosConfig()` | `{ proxy: false, httpAgent, httpsAgent }` |
| got        | `connection.asGotOptions()`  | `{ agent: { http, https } }`              |
| fetch      | `connection.asUndiciFetch()` | Proxy-enabled `fetch` function            |
| Node http  | `connection.asNodeAgents()`  | `{ http: Agent, https: Agent }`           |

### Examples

```typescript
// Playwright
const browser = await chromium.launch({ proxy: connection.asPlaywright() });

// Puppeteer
const browser = await puppeteer.launch({ args: connection.asPuppeteer() });

// Axios
const axiosClient = axios.create(connection.asAxiosConfig());
await axiosClient.get('https://example.com');

// Node fetch
const myFetch = connection.asUndiciFetch();
await myFetch('https://example.com');
```

---

## Error Classes

| Class                | When thrown                            |
| -------------------- | -------------------------------------- |
| `MissingApiKeyError` | `apiKey` not provided or empty         |
| `InvalidApiKeyError` | API key rejected by server             |
| `ApiError`           | REST API error (includes status, body) |
| `ProxyStartError`    | Failed to start local proxy            |
| `ConnectError`       | Failed to connect to running session   |

```typescript
import { MissingApiKeyError, ApiError } from '@aluvia/sdk';

try {
  const client = new AluviaClient({ apiKey: process.env.ALUVIA_API_KEY! });
  await client.start();
} catch (err) {
  if (err instanceof MissingApiKeyError) {
    console.error('Set ALUVIA_API_KEY');
  } else if (err instanceof ApiError) {
    console.error('API error:', err.status, err.body);
  }
}
```

---

## CLI and MCP

- **CLI** — `npm install -g @aluvia/cli` for `aluvia session start`, `aluvia session close`, etc.
- **MCP** — `npm install @aluvia/mcp` for Model Context Protocol integration with Claude, Cursor, etc.

---

## Documentation

| Resource                   | URL                                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Main SDK README**        | [github.com/aluvia-connect/sdk-node](https://github.com/aluvia-connect/sdk-node)                                      |
| **Client Technical Guide** | [docs/client-technical-guide.md](https://github.com/aluvia-connect/sdk-node/blob/main/docs/client-technical-guide.md) |
| **API Technical Guide**    | [docs/api-technical-guide.md](https://github.com/aluvia-connect/sdk-node/blob/main/docs/api-technical-guide.md)       |
| **Aluvia Dashboard**       | [dashboard.aluvia.io](https://dashboard.aluvia.io/?utm_source=npmjs.com&utm_medium=referral)                                                                    |

---

## License

MIT
