# Aluvia Node.js SDK

[![npm](https://img.shields.io/npm/v/@aluvia/sdk.svg)](https://www.npmjs.com/package/@aluvia/sdk)
[![downloads](https://img.shields.io/npm/dm/@aluvia/sdk.svg)](https://www.npmjs.com/package/@aluvia/sdk)
[![license](https://img.shields.io/npm/l/@aluvia/sdk.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/@aluvia/sdk.svg)](./package.json)

**Stop getting blocked.** Aluvia routes your AI agent's web traffic through premium US mobile carrier IPs — the same IPs used by real people on their phones. Websites trust them, so your agent stops hitting 403s, CAPTCHAs, and rate limits.

## Packages

This repository is organized as a monorepo with three packages:

- **[@aluvia/sdk](./packages/sdk)** — Core SDK with `AluviaClient`, `AluviaApi`, framework adapters, and block detection
- **[@aluvia/cli](./packages/cli)** — Command-line tools for browser automation and session management
- **[@aluvia/mcp](./packages/mcp)** — Model Context Protocol server for AI agent integration

## Features

- **CLI for browser automation** — launch headless Chromium sessions from the command line, with JSON output designed for AI agent frameworks
- **Automatic block detection and unblocking** — the SDK detects 403s, WAF challenges, and CAPTCHAs, then reroutes through Aluvia and reloads the page automatically
- **Smart routing** — proxy only the sites that block you; everything else goes direct to save cost and latency
- **Runtime rule updates** — add hostnames to proxy rules on the fly, no restarts or redeployments
- **Adapters for every tool** — Playwright, Puppeteer, Selenium, Axios, got, and Node's fetch
- **IP rotation and geo targeting** — rotate IPs or target specific US regions at runtime
- **REST API wrapper** — manage connections, check usage, and build custom tooling with `AluviaApi`

---

## Table of contents

- [Quick start](#quick-start)
- [CLI reference](#cli-reference)
- [Connecting to a running browser](#connecting-to-a-running-browser)
- [Programmatic usage (AluviaClient)](#programmatic-usage)
- [Routing rules](#routing-rules)
- [Block detection and auto-unblocking](#block-detection-and-auto-unblocking)
- [Tool integration adapters](#tool-integration-adapters)
- [REST API (AluviaApi)](#rest-api)
- [Architecture](#architecture)

---

## Quick start

### 1. Get Aluvia API key

[Aluvia dashboard](https://dashboard.aluvia.io/?utm_source=npmjs.com&utm_medium=referral)

### 2. Install

For programmatic use:
```bash
npm install @aluvia/sdk playwright
export ALUVIA_API_KEY="your-api-key"
```

For CLI use:
```bash
npm install -g @aluvia/cli
export ALUVIA_API_KEY="your-api-key"
```

For MCP integration:
```bash
npm install @aluvia/mcp
```

### 3. Run

Aluvia automatically detects website blocks and uses mobile IPs when necessary.

```bash
aluvia session start https://example.com --auto-unblock --run your-script.js
```

---

## Skills

- Claude code skill
- OpenClaw skill

---

## CLI reference

The CLI outputs JSON for easy integration with AI agent frameworks. All commands are available via the `aluvia` binary. Run `aluvia help --json` for machine-readable help.

### `session start` — Launch a browser session

```bash
aluvia session start <url> [options]
```

| Option                      | Description                                                              |
| --------------------------- | ------------------------------------------------------------------------ |
| `--auto-unblock`            | Auto-detect blocks and reload through Aluvia                             |
| `--run <script>`            | Run a script with `page`, `browser`, `context` injected; exits when done |
| `--headful`                 | Show the browser window (default: headless)                              |
| `--browser-session <name>`  | Name this session (auto-generated if omitted, e.g. `swift-falcon`)       |
| `--connection-id <id>`      | Reuse an existing Aluvia connection                                      |
| `--disable-block-detection` | Disable block detection entirely                                         |

**Examples:**

```bash
# Launch with auto-unblocking
aluvia session start https://example.com --auto-unblock

# Run a script inline
aluvia session start https://example.com --auto-unblock --run scrape.mjs

# Debug with a visible browser window
aluvia session start https://example.com --headful

# Reuse an existing connection
aluvia session start https://example.com --connection-id 3449
```

### `session close` — Stop a session

```bash
aluvia session close                              # auto-selects if only one is running
aluvia session close --browser-session swift-falcon  # close by name
aluvia session close --all                          # close all sessions
```

### `session list` — List active sessions

```bash
aluvia session list
```

```json
{
  "sessions": [
    {
      "browserSession": "swift-falcon",
      "pid": 12345,
      "startUrl": "https://example.com",
      "cdpUrl": "http://127.0.0.1:38209",
      "connectionId": 3449,
      "blockDetection": true,
      "autoUnblock": true
    }
  ],
  "count": 1
}
```

### `session get` — Full session details

```bash
aluvia session get [--browser-session <name>]
```

Returns session info enriched with block detection history and the full connection object from the API.

### `session rotate-ip` — Get a new IP

```bash
aluvia session rotate-ip [--browser-session <name>]
```

### `session set-geo` — Target a specific country

```bash
aluvia session set-geo US                          # target United States
aluvia session set-geo GB                          # target United Kingdom
aluvia session set-geo --clear                     # clear country targeting
```

### `session set-rules` — Update routing rules

```bash
aluvia session set-rules "example.com,api.example.com"    # add rules
aluvia session set-rules --remove "example.com"           # remove rules
```

Rules are comma-separated. By default rules are appended; use `--remove` to remove specific rules.

### Account and other commands

```bash
aluvia account                # account info
aluvia account usage          # usage stats
aluvia account usage --start 2025-01-01T00:00:00Z --end 2025-02-01T00:00:00Z

aluvia geos                   # list available geo-targeting options
aluvia help                   # plain text help
aluvia help --json            # machine-readable help
```

---

## Connecting to a running browser

There are two ways to run code against a browser session started by the CLI.

### Option A: `--run` (simplest)

Pass a script to `session start`. The globals `page`, `browser`, and `context` are available — no imports needed:

```bash
aluvia session start https://example.com --auto-unblock --run script.mjs
```

```js
// script.mjs
console.log("URL:", page.url());

const newPage = await context.newPage();
await newPage.goto("https://another-site.com");
console.log("Other site title:", await newPage.title());
```

The session starts, runs your script, and exits.

### Option B: `connect()` (for AI agents and long-running processes)

Start a session as a background daemon, then connect from your application:

```bash
aluvia session start https://example.com --auto-unblock
```

```ts
import { connect } from "@aluvia/sdk";

// Auto-discovers the running session
const { page, browser, context, disconnect } = await connect();
console.log("URL:", page.url());

// When running multiple sessions, specify by name
const conn = await connect("swift-falcon");
console.log("URL:", conn.page.url());

// Disconnect when done (the session keeps running)
await disconnect();
```

Use this when your agent generates automation code dynamically at runtime or needs a persistent browser across multiple operations.

---

## Programmatic usage

For full control, use `AluviaClient` directly instead of the CLI.

### Basic example

```ts
import { AluviaClient } from "@aluvia/sdk";
import { chromium } from "playwright";

const client = new AluviaClient({
  apiKey: process.env.ALUVIA_API_KEY!,
});

const connection = await client.start();
const browser = await chromium.launch({ proxy: connection.asPlaywright() });
const page = await browser.newPage();
await page.goto("https://example.com");

// ... do your work ...

await browser.close();
await connection.close();
```

### With auto-launched browser

```ts
const client = new AluviaClient({
  apiKey: process.env.ALUVIA_API_KEY!,
  startPlaywright: true,
  blockDetection: {
    enabled: true,
    autoUnblock: true,
  },
});

const connection = await client.start();
const page = await connection.browser.newPage();
await page.goto("https://example.com"); // auto-reloads through Aluvia if blocked

await connection.close(); // stops proxy, closes browser, releases resources
```

### Runtime updates

While your agent is running, update routing, rotate IPs, or change geo — no restarts needed:

```ts
await client.updateRules(["blocked-site.com"]); // proxy this hostname
await client.updateSessionId("new-session-id"); // rotate to a new IP
await client.updateTargetGeo("us"); // target United States IPs
```

### Constructor options

```ts
new AluviaClient({
  apiKey: string;                        // Required
  connectionId?: number;                 // Reuse an existing connection
  startPlaywright?: boolean;             // Auto-launch Chromium browser
  headless?: boolean;                    // Default: true (only with startPlaywright)
  blockDetection?: BlockDetectionConfig; // See "Block detection" section
  localPort?: number;                    // Local proxy port (auto-assigned if omitted)
  gatewayProtocol?: "http" | "https";    // Default: "http"
  gatewayPort?: number;                  // Default: 8080 (http) or 8443 (https)
  pollIntervalMs?: number;               // Config poll interval (default: 5000ms)
  timeoutMs?: number;                    // API request timeout
  logLevel?: "silent" | "info" | "debug";
  strict?: boolean;                      // Throw if config fails to load (default: true)
  apiBaseUrl?: string;                   // Default: "https://api.aluvia.io/v1"
});
```

For all options in detail, see the [Client Technical Guide](docs/client-technical-guide.md#constructor-options).

---

## Routing rules

The local proxy routes each request based on hostname rules. Only hostnames matching a rule go through Aluvia; everything else goes direct.

### Why this matters

- **Save money** — proxy only the sites that block you
- **Lower latency** — non-blocked sites skip the proxy entirely
- **Adapt on the fly** — rules update at runtime, no restarts needed

### Rule patterns

| Pattern         | Matches                        |
| --------------- | ------------------------------ |
| `*`             | All hostnames                  |
| `example.com`   | Exact match                    |
| `*.example.com` | Subdomains of example.com      |
| `google.*`      | google.com, google.co.uk, etc. |
| `-example.com`  | Exclude from proxying          |

### Examples

```ts
// Proxy all traffic
await client.updateRules(["*"]);

// Proxy specific hosts only
await client.updateRules(["target-site.com", "*.google.com"]);

// Proxy everything except Stripe
await client.updateRules(["*", "-api.stripe.com"]);

// Route all traffic direct (no proxy)
await client.updateRules([]);
```

Or from the CLI:

```bash
aluvia session set-rules "target-site.com,*.google.com"
aluvia session set-rules --remove "target-site.com"
```

---

## Block detection and auto-unblocking

Most proxy solutions require you to decide upfront which sites to proxy. If a site blocks you later, you're stuck.

Aluvia detects blocks automatically and can unblock your agent on the fly. The SDK analyzes every page load using a weighted scoring system across multiple signals — HTTP status codes, WAF headers, CAPTCHA selectors, page content, redirect chains, and more.

### Automatic unblocking (recommended)

When a block is detected, the SDK adds the hostname to proxy rules and reloads the page through Aluvia:

```ts
const client = new AluviaClient({
  apiKey: process.env.ALUVIA_API_KEY!,
  startPlaywright: true,
  blockDetection: {
    enabled: true,
    autoUnblock: true,
    onDetection: (result, page) => {
      console.log(
        `${result.blockStatus} on ${result.hostname} (score: ${result.score})`,
      );
    },
  },
});
```

Or from the CLI:

```bash
aluvia session start https://example.com --auto-unblock
```

### Detection-only mode

Run detection without automatic remediation. Your agent inspects the results and decides what to do:

```ts
blockDetection: {
  enabled: true,
  onDetection: (result, page) => {
    if (result.blockStatus === "blocked") {
      // Agent decides: retry, rotate IP, update rules, etc.
    }
  },
}
```

### Block status scores

Each page analysis produces a score from 0.0 to 1.0:

| Score  | Status        | Meaning                                                         |
| ------ | ------------- | --------------------------------------------------------------- |
| >= 0.7 | `"blocked"`   | High confidence block. Auto-reloads when `autoUnblock: true`.   |
| >= 0.4 | `"suspected"` | Possible block. Reloads only if `autoUnblockOnSuspected: true`. |
| < 0.4  | `"clear"`     | No block detected.                                              |

Scores use probabilistic combination (`1 - product(1 - weight)`) so weak signals don't stack into false positives.

### How detection works

Detection runs in two passes:

1. **Fast pass** (at `domcontentloaded`) — checks HTTP status codes and WAF response headers. High-confidence blocks (score >= 0.9) trigger immediate remediation.
2. **Full pass** (after `networkidle`) — analyzes page title, visible text, challenge selectors, meta refreshes, and redirect chains.

The SDK also detects SPA navigations and tracks persistent blocks per hostname to prevent infinite retry loops.

### Detection config options

```ts
blockDetection: {
  enabled?: boolean;                 // Default: true
  autoUnblock?: boolean;             // Auto-remediate blocked pages
  autoUnblockOnSuspected?: boolean;  // Also remediate "suspected" pages
  challengeSelectors?: string[];     // Custom CSS selectors for challenge detection
  extraKeywords?: string[];          // Additional keywords for text analysis
  extraStatusCodes?: number[];       // Additional HTTP status codes to flag
  networkIdleTimeoutMs?: number;     // Default: 3000ms
  onDetection?: (result, page) => void | Promise<void>;
}
```

### Manual detection

You can also check responses yourself and update rules on the fly:

```ts
const response = await page.goto(url);

if (response?.status() === 403) {
  await client.updateRules([...currentRules, new URL(url).hostname]);
  await page.goto(url); // retried through Aluvia
}
```

For the full list of signal detectors and weights, see the [Client Technical Guide](docs/client-technical-guide.md#signal-detectors).

---

## Tool integration adapters

The SDK handles proxy configuration for every major tool:

| Tool         | Method                       | Returns                                               |
| ------------ | ---------------------------- | ----------------------------------------------------- |
| Playwright   | `connection.asPlaywright()`  | `{ server, username?, password? }`                    |
| Playwright   | `connection.browser`         | Auto-launched Chromium (with `startPlaywright: true`) |
| Playwright   | `connection.cdpUrl`          | CDP endpoint for `connectOverCDP()`                   |
| Puppeteer    | `connection.asPuppeteer()`   | `['--proxy-server=...']`                              |
| Selenium     | `connection.asSelenium()`    | `'--proxy-server=...'`                                |
| Axios        | `connection.asAxiosConfig()` | `{ proxy: false, httpAgent, httpsAgent }`             |
| got          | `connection.asGotOptions()`  | `{ agent: { http, https } }`                          |
| fetch        | `connection.asUndiciFetch()` | Proxy-enabled `fetch` function                        |
| Node.js http | `connection.asNodeAgents()`  | `{ http: Agent, https: Agent }`                       |

### Examples

```ts
// Playwright
const browser = await chromium.launch({ proxy: connection.asPlaywright() });

// Puppeteer
const browser = await puppeteer.launch({ args: connection.asPuppeteer() });

// Axios
const axiosClient = axios.create(connection.asAxiosConfig());
await axiosClient.get("https://example.com");

// got
const gotClient = got.extend(connection.asGotOptions());
await gotClient("https://example.com");

// Node's fetch (via undici)
const myFetch = connection.asUndiciFetch();
await myFetch("https://example.com");
```

For more details, see the [Client Technical Guide](docs/client-technical-guide.md#tool-adapters).

---

## REST API

`AluviaApi` is a typed wrapper for the Aluvia REST API. Use it to manage connections, check account info, or build custom tooling — without starting a proxy.

### Endpoints

| Method                                    | Description                             |
| ----------------------------------------- | --------------------------------------- |
| `api.account.get()`                       | Get account info (balance, usage)       |
| `api.account.connections.list()`          | List all connections                    |
| `api.account.connections.create(body)`    | Create a new connection                 |
| `api.account.connections.get(id)`         | Get connection details                  |
| `api.account.connections.patch(id, body)` | Update connection (rules, geo, session) |
| `api.account.connections.delete(id)`      | Delete a connection                     |
| `api.account.usage.get(params?)`          | Get usage stats                         |
| `api.geos.list()`                         | List available geo-targeting options    |

### Example

```ts
import { AluviaApi } from "@aluvia/sdk";

const api = new AluviaApi({ apiKey: process.env.ALUVIA_API_KEY! });

// Check account balance
const account = await api.account.get();
console.log("Balance:", account.balance_gb, "GB");

// Create a connection for a new agent
const conn = await api.account.connections.create({
  description: "pricing-scraper",
  rules: ["competitor-site.com"],
  target_geo: "us",
});
console.log("Created connection:", conn.connection_id);

// List available geos
const geos = await api.geos.list();
console.log(
  "Geos:",
  geos.map((g) => g.code),
);
```

`AluviaApi` is also available as `client.api` when using `AluviaClient`.

For the complete API reference, see the [API Technical Guide](docs/api-technical-guide.md).

---

## Architecture

The client is split into two independent planes:

```
┌─────────────────────────────────────────────────────────────────┐
│                        AluviaClient                             │
├─────────────────────────────┬───────────────────────────────────┤
│       Control Plane         │          Data Plane               │
│       (ConfigManager)       │          (ProxyServer)            │
├─────────────────────────────┼───────────────────────────────────┤
│ • Fetches/creates config    │ • Local HTTP proxy (proxy-chain)  │
│ • Polls for updates (ETag)  │ • Per-request routing decisions   │
│ • PATCH updates (rules,     │ • Uses rules engine to decide:    │
│   session, geo)             │   direct vs gateway               │
└─────────────────────────────┴───────────────────────────────────┘
```

**Control Plane (ConfigManager)** — communicates with the Aluvia REST API to fetch proxy credentials and routing rules, polls for configuration updates using ETags, and pushes updates (rules, session ID, geo).

**Data Plane (ProxyServer)** — runs a local HTTP proxy on `127.0.0.1` that reads the latest config per-request, so rule updates take effect immediately without restarts.

```
┌──────────────────┐      ┌──────────────────────────┐      ┌──────────────────────┐
│                  │      │                          │      │                      │
│    Your Agent    │─────▶│     Aluvia Client        │─────▶│  gateway.aluvia.io   │
│                  │      │     127.0.0.1:port       │      │    (Mobile IPs)      │
│                  │      │                          │      │                      │
└──────────────────┘      │  Per-request routing:    │      └──────────────────────┘
                          │                          │
                          │  not-blocked.com ──────────────▶ Direct
                          │  blocked-site.com ─────────────▶ Via Aluvia
                          │                          │
                          └──────────────────────────┘
```

---

## Learn more

- [What is Aluvia?](https://docs.aluvia.io/)
- [Understanding connections](https://docs.aluvia.io/fundamentals/connections)
- [Playwright integration guide](https://docs.aluvia.io/integrations/integration-playwright)
- [Puppeteer](https://docs.aluvia.io/integrations/integration-puppeteer), [Selenium](https://docs.aluvia.io/integrations/integration-selenium), [Axios](https://docs.aluvia.io/integrations/integration-axios), [got](https://docs.aluvia.io/integrations/integration-got), [fetch](https://docs.aluvia.io/integrations/integration-fetch)
- [CLI Technical Guide](docs/cli-technical-guide.md)
- [Client Technical Guide](docs/client-technical-guide.md)
- [API Technical Guide](docs/api-technical-guide.md)

## License

MIT — see [LICENSE](./LICENSE)
