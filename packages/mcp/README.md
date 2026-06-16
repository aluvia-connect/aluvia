# @aluvia/mcp

<p align="center">
  <img src="https://raw.githubusercontent.com/aluvia-connect/sdk-node/main/mcp/assets/aluvia-logo.png" alt="Aluvia Logo" width="200" />
</p>

<p align="center">
  <strong>Unblockable browser automation for AI agents.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@aluvia/mcp"><img src="https://img.shields.io/npm/v/@aluvia/mcp.svg" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@aluvia/mcp"><img src="https://img.shields.io/npm/dm/@aluvia/mcp.svg" alt="npm downloads"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/@aluvia/mcp.svg" alt="license"></a>
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/MCP-1.0-compatible?labelColor=2d2d2d&color=5f5f5f" alt="MCP compatible"></a>
</p>

---

**Stop getting blocked.** The Aluvia MCP server exposes browser session management, geo-targeting, and account operations as [Model Context Protocol](https://modelcontextprotocol.io) tools for AI agents. Route traffic through premium US mobile carrier IPs and bypass 403s, CAPTCHAs, and WAFs that stop other tools. Works with Claude Desktop, Claude Code, Cursor, VS Code, and any MCP-compatible client.

## Table of Contents

- [Get an Aluvia API Key](#-get-an-aluvia-api-key)
- [Quick Start](#-quick-start)
- [Requirements](#-requirements)
- [Installation](#-installation)
- [Client Configuration](#-client-configuration)
- [Available Tools](#-available-tools)
- [Use Cases](#-use-cases)
- [Why Aluvia](#-why-aluvia)
- [Links](#-links)
- [License](#license)

---

## Get an Aluvia API Key

You need an API key to run the MCP server. Get one from the [Aluvia dashboard](https://dashboard.aluvia.io/?utm_source=npmjs.com&utm_medium=referral):

1. Sign up or sign in at [dashboard.aluvia.io](https://dashboard.aluvia.io/?utm_source=npmjs.com&utm_medium=referral)
2. In your account, open the API & SDKs section
3. Copy your API key

Use it as an environment variable: `export ALUVIA_API_KEY="your-api-key"` or add `ALUVIA_API_KEY=your-api-key` to a `.env` file (never commit it).

---

## Quick Start

```bash
npm install @aluvia/mcp
export ALUVIA_API_KEY="your-api-key"
npx aluvia-mcp
```

The server runs on **stdio** (stdin/stdout JSON-RPC) — MCP clients spawn it and communicate over stdio.

---

## Requirements

- **Node.js** 18+
- **Aluvia API key** — See [Get an Aluvia API Key](#-get-an-aluvia-api-key)
- **Playwright** — Required for session tools (`session_start`, etc.); install with `npm install playwright`

---

## Installation

```bash
npm install @aluvia/mcp
```

Set your API key in the environment:

```bash
export ALUVIA_API_KEY="your-api-key"
```

Or in a `.env` file (never commit):

```
ALUVIA_API_KEY=your-api-key
```

---

## Client Configuration

Add the config below for your MCP client. Replace `your-api-key` with your actual key.

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "aluvia": {
      "command": "npx",
      "args": ["-y", "aluvia-mcp"],
      "env": {
        "ALUVIA_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Claude Code

Add to `.claude/settings.json` or project MCP config:

```json
{
  "mcpServers": {
    "aluvia": {
      "command": "npx",
      "args": ["-y", "aluvia-mcp"],
      "env": {
        "ALUVIA_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Cursor

1. Open **Settings → MCP**
2. Add a new MCP server
3. Use:
   - **Command**: `npx`
   - **Args**: `["-y", "aluvia-mcp"]`
   - **Environment variables**: `ALUVIA_API_KEY` = your key

### VS Code / Cursor (mcp.json)

For workspace-level config, add `.vscode/mcp.json` or `mcp.json`:

```json
{
  "mcpServers": {
    "aluvia": {
      "command": "npx",
      "args": ["-y", "aluvia-mcp"],
      "env": {
        "ALUVIA_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Other MCP Clients

Spawn with `command: "npx"`, `args: ["-y", "aluvia-mcp"]`, and `ALUVIA_API_KEY` in the process environment. See the [MCP Server Guide](https://github.com/aluvia-connect/sdk-node/blob/main/docs/mcp-server-guide.md#client-configuration) for a Node.js client example.

---

## Available Tools

All tools return JSON. On success, `isError` is `false`. On failure, `isError` is `true` and the payload includes an `error` field.

### Session Tools

| Tool                | Description                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `session_start`     | Start a browser session with Aluvia smart proxy. **Params**: `url` (required), `connectionId`, `headful`, `browserSession`, `autoUnblock`, `disableBlockDetection` |
| `session_close`     | Close one or all running sessions. **Params**: `browserSession`, `all`                                                                                             |
| `session_list`      | List active sessions (PIDs, URLs, CDP URLs, connection IDs)                                                                                                        |
| `session_get`       | Full session details including block detection state and connection config. **Params**: `browserSession`                                                           |
| `session_rotate_ip` | Rotate IP for a session (new session ID). **Params**: `browserSession`                                                                                             |
| `session_set_geo`   | Set or clear geo-targeting (e.g. `us`, `gb`, `de`). **Params**: `geo`, `clear`, `browserSession`                                                             |
| `session_set_rules` | Append or remove proxy routing rules (comma-separated hostnames). **Params**: `rules`, `remove`, `browserSession`                                                  |

### Account Tools

| Tool            | Description                                                              |
| --------------- | ------------------------------------------------------------------------ |
| `account_get`   | Account info (balance, plan, connection count)                           |
| `account_usage` | Usage statistics for a date range. **Params**: `start`, `end` (ISO 8601) |

### Geo Tools

| Tool        | Description                                                              |
| ----------- | ------------------------------------------------------------------------ |
| `geos_list` | List available geo-targeting countries (e.g. `us`, `gb`, `de`) |

Full parameter and response details: [MCP Server Guide — Tool Reference](https://github.com/aluvia-connect/sdk-node/blob/main/docs/mcp-server-guide.md#tool-reference).

---

## Use Cases

| Scenario                        | Tools Used                                       | Flow                                                                            |
| ------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------- |
| **Scrape a protected site**     | `session_start`, `session_list`                  | Start with `autoUnblock: true`; agent receives CDP URL for Playwright/Puppeteer |
| **Bypass regional restriction** | `session_start`, `session_set_geo`               | Set `geo: "us"` to access United States-only content                            |
| **Recover from block**          | `session_rotate_ip`, `session_set_rules`         | Rotate IP or add hostname to proxy rules at runtime                             |
| **Monitor usage**               | `account_get`, `account_usage`                   | Check balance and data consumed                                                 |
| **Multi-session automation**    | `session_start`, `session_close`, `session_list` | Name sessions via `browserSession`, manage multiple browsers                    |

**Example agent prompt:** _"Open target-site.com. If you get blocked, rotate the IP to a US-based address and try again."_

→ Agent calls `session_start` with `autoUnblock: true`, then `session_set_geo` with `geo: "us"` if needed.

---

## Why Aluvia

- **Mobile carrier IPs** — Same IPs real users use; sites trust them
- **Block detection** — Detects 403s, WAF challenges, CAPTCHAs; auto-reloads through Aluvia when blocked
- **Smart routing** — Proxy only hostnames that block you; everything else goes direct (saves cost and latency)
- **Geo-targeting** — Target countries (e.g. `us`, `gb`, `de`) for localized content
- **Runtime updates** — Add rules, rotate IPs, change geo without restarting

---

## Links

| Resource             | URL                                                                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Aluvia Dashboard** | [dashboard.aluvia.io](https://dashboard.aluvia.io/?utm_source=npmjs.com&utm_medium=referral)                                                                                                   |
| **npm**              | [npmjs.com/package/@aluvia/mcp](https://www.npmjs.com/package/@aluvia/mcp)                                                                           |
| **Full MCP Guide**   | [docs/mcp-server-guide.md](https://github.com/aluvia-connect/sdk-node/blob/main/docs/mcp-server-guide.md)                                            |
| **Aluvia SDK**       | [@aluvia/sdk](https://github.com/aluvia-connect/sdk-node) — CLI, adapters, and [quick start](https://github.com/aluvia-connect/sdk-node#quick-start) |
| **MCP Protocol**     | [modelcontextprotocol.io](https://modelcontextprotocol.io)                                                                                           |

---

## Dependencies

- **@aluvia/sdk** — CLI handlers and proxy logic. For programmatic use (`AluviaClient`, `connect()`), install the full SDK: `npm install @aluvia/sdk`.

---

## License

MIT
