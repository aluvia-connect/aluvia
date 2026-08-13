# Getting Started with Aluvia SDK

A step-by-step guide to installing, configuring, and running your first Aluvia-powered browser session.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Quick start: CLI](#quick-start-cli)
- [Quick start: Programmatic](#quick-start-programmatic)
- [Quick start: MCP server](#quick-start-mcp-server)
- [Next steps](#next-steps)

---

## Prerequisites

- **Node.js 18+** — Aluvia uses native `fetch`, `AbortController`, and ES modules
- No API key is required to start. The first CLI command creates a sticky install id and uses a free trial. After the trial, sign in with `aluvia auth` (or set `ALUVIA_API_KEY`) to buy data, or point the daemon at your own proxy with `aluvia proxy upstream`.

---

## Installation

```bash
npm install @aluvia/sdk playwright
```

`playwright` is an optional peer dependency — required only if you use browser sessions (`session start`, `connect()`, or `startPlaywright`). If you only need the REST API wrapper (`AluviaApi`) or the proxy client without a browser, you can skip it.

---

## Configuration

**CLI (default):** run a command. The CLI writes `$ALUVIA_HOME/install_id` (`/workspace/.aluvia` when `/workspace` exists, else `~/.aluvia`) and sends it as `X-Aluvia-Install-Id`. No human, no token.

**Paid Aluvia:** log in once after the trial (or immediately if you already have an account):

```bash
aluvia auth
```

Open the printed link, sign up or sign in, approve the code, then buy data if balance is zero. The CLI stores the account token in `$ALUVIA_HOME/config.json` and keeps the install id.

**Or set an API key as an environment variable** (common for CI and scripts):

```bash
export ALUVIA_API_KEY="your-api-key"
```

**Bring your own proxy** (skips Aluvia auth and the gateway):

```bash
aluvia proxy upstream http://user:pass@host:port
# or
export ALUVIA_UPSTREAM="http://user:pass@host:port"
```

Do not point `ALUVIA_UPSTREAM` at `HTTPS_PROXY` / the local daemon — that loops. Resolver order is BYO upstream, then `ALUVIA_API_KEY` / stored key, then install id.

---

## Quick start: CLI

The CLI is the fastest way to get started. It outputs JSON to stdout, making it ideal for AI agent frameworks.

### 0. Start the local proxy (trial)

```bash
aluvia proxy setup
```

No login. If stdout is `{"code":"payment_required",...}`, tell a human to run `aluvia auth` (open the printed link, sign up, buy data) or `aluvia proxy upstream <url>`.

Verify:

```bash
aluvia auth status
# trial only: { "authenticated": false, "provider": "aluvia", "trial": true }
```

### 1. Launch a browser session

```bash
aluvia session start https://example.com --auto-unblock
```

This starts a headless Chromium browser routed through Aluvia's mobile proxy network. The `--auto-unblock` flag enables automatic block detection and remediation.

**Output:**

```json
{
  "browserSession": "swift-falcon",
  "pid": 12345,
  "startUrl": "https://example.com",
  "cdpUrl": "http://127.0.0.1:38209",
  "connectionId": 3449,
  "blockDetection": true,
  "autoUnblock": true
}
```

### 2. Run a script against the browser

```bash
aluvia session start https://example.com --auto-unblock --run scrape.mjs
```

```js
// scrape.mjs — page, browser, context are injected as globals
const title = await page.title();
console.log("Title:", title);

const links = await page.$$eval("a", (els) => els.map((el) => el.href));
console.log("Links found:", links.length);
```

The session starts, runs your script, then exits automatically.

### 3. Connect from your application

Start a session in the background, then connect from a separate process:

```bash
aluvia session start https://example.com --auto-unblock
```

```ts
import { connect } from "@aluvia/sdk";

const { page, browser, context, disconnect } = await connect();
console.log("Page URL:", page.url());
console.log("Title:", await page.title());

await disconnect(); // the session keeps running
```

### 4. Manage sessions

```bash
aluvia session list          # list active sessions
aluvia session get           # full session details + block detection state
aluvia session rotate-ip     # get a new IP address
aluvia session set-geo us # target United States IPs
aluvia session close         # stop the session
```

### 5. Account info

```bash
aluvia account               # balance, connection count
aluvia account usage          # data usage stats
aluvia geos                   # available geo-targeting regions
```

---

## Quick start: Programmatic

For full control, use `AluviaClient` directly in your Node.js application.

### Basic proxy with Playwright

```ts
import { AluviaClient } from "@aluvia/sdk";
import { chromium } from "playwright";

const client = new AluviaClient({
  apiKey: process.env.ALUVIA_API_KEY!,
});

const connection = await client.start();
console.log("Proxy running at:", connection.url);

const browser = await chromium.launch({
  proxy: connection.asPlaywright(),
});

const page = await browser.newPage();
await page.goto("https://example.com");
console.log("Title:", await page.title());

await browser.close();
await connection.close();
```

### Auto-launched browser with block detection

```ts
import { AluviaClient } from "@aluvia/sdk";

const client = new AluviaClient({
  apiKey: process.env.ALUVIA_API_KEY!,
  startPlaywright: true,
  blockDetection: {
    enabled: true,
    autoUnblock: true,
    onDetection: (result) => {
      if (result.blockStatus !== "clear") {
        console.log(
          `${result.blockStatus} on ${result.hostname} (score: ${result.score})`,
        );
      }
    },
  },
});

const connection = await client.start();
const page = await connection.browserContext.newPage();
await page.goto("https://example.com");

// If the site blocks you, Aluvia automatically adds it to proxy rules and reloads
console.log("Title:", await page.title());

await connection.close();
```

### Using with other HTTP clients

```ts
import { AluviaClient } from "@aluvia/sdk";
import axios from "axios";

const client = new AluviaClient({
  apiKey: process.env.ALUVIA_API_KEY!,
});

const connection = await client.start();

// Axios
const response = await axios.get(
  "https://example.com",
  connection.asAxiosConfig(),
);

// Node fetch (via undici)
const myFetch = connection.asUndiciFetch();
const fetchResponse = await myFetch("https://example.com");

await connection.close();
```

### REST API only (no proxy)

```ts
import { AluviaApi } from "@aluvia/sdk";

const api = new AluviaApi({ apiKey: process.env.ALUVIA_API_KEY! });

const account = await api.account.get();
console.log("Balance:", account.balance_gb, "GB");

const geos = await api.geos.list();
console.log("Available regions:", geos.length);

const conn = await api.account.connections.create({
  description: "my-agent",
  rules: ["target-site.com"],
});
console.log("Connection created:", conn.connection_id);
```

---

## Quick start: MCP server

For MCP-only use, install the dedicated package:

```bash
npm install @aluvia/mcp
```

The [MCP Server Guide](mcp-server-guide.md) describes the Model Context Protocol server that exposes CLI functionality as MCP tools for AI agents.

### Run the MCP server

```bash
npx aluvia-mcp
```

The server communicates over stdio and exposes tools like `session_start`, `session_close`, `session_list`, `account_get`, and more. See the [MCP Server Guide](mcp-server-guide.md) for the full reference.

### Configure in Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "aluvia": {
      "command": "npx",
      "args": ["aluvia-mcp"],
      "env": {
        "ALUVIA_API_KEY": "your-api-key"
      }
    }
  }
}
```

---

## Next steps

| Guide | When to read |
|-------|-------------|
| [CLI Technical Guide](cli-technical-guide.md) | Full CLI command reference, daemon architecture, lock files |
| [Client Technical Guide](client-technical-guide.md) | AluviaClient API, routing rules, block detection deep-dive |
| [API Technical Guide](api-technical-guide.md) | REST API wrapper reference, all endpoints and types |
| [MCP Server Guide](mcp-server-guide.md) | MCP tool reference for AI agent integration |
| [Architecture](architecture.md) | System design, component relationships, data flows |
| [Error Reference](error-reference.md) | Complete error hierarchy with troubleshooting |
