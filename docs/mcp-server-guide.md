# MCP Server Guide

A complete reference for the Aluvia MCP (Model Context Protocol) server — an MCP-compatible interface that exposes all Aluvia CLI functionality as structured tools for AI agents.

## Table of Contents

- [Overview](#overview)
- [Installation and setup](#installation-and-setup)
- [Client configuration](#client-configuration)
  - [Claude Desktop](#claude-desktop)
  - [Claude Code](#claude-code)
  - [Generic MCP client](#generic-mcp-client)
- [Tool reference](#tool-reference)
  - [Session tools](#session-tools)
  - [Account tools](#account-tools)
  - [Geo tools](#geo-tools)
- [Architecture](#architecture)
- [Error handling](#error-handling)

---

## Overview

The Aluvia MCP server implements the [Model Context Protocol](https://modelcontextprotocol.io) over stdio transport. It exposes browser session management, account operations, and geo-targeting as structured MCP tools that AI agents can invoke programmatically.

**Binary:** `aluvia-mcp`

**Transport:** stdio (stdin/stdout JSON-RPC)

**Server name:** `aluvia`

**Version:** Matches the `@aluvia/sdk` package version

---

## Installation and setup

For MCP only (recommended if you only need the MCP server):

```bash
npm install @aluvia/mcp
```

For the full SDK (CLI + programmatic API + MCP):

```bash
npm install @aluvia/sdk
```

Set the API key:

```bash
export ALUVIA_API_KEY="your-api-key"
```

Run the server:

```bash
npx aluvia-mcp
```

The server starts and listens on stdio. It logs startup messages to stderr:

```
Aluvia MCP server running on stdio
```

---

## Client configuration

### Claude Desktop

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

### Claude Code

Add to your `.claude/settings.json` or project-level MCP config:

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

### Generic MCP client

Any MCP-compatible client can connect by spawning the server process:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "npx",
  args: ["aluvia-mcp"],
  env: {
    ALUVIA_API_KEY: "your-api-key",
  },
});

const client = new Client({ name: "my-agent", version: "1.0.0" });
await client.connect(transport);

// List available tools
const tools = await client.listTools();

// Call a tool
const result = await client.callTool({
  name: "session_start",
  arguments: {
    url: "https://example.com",
    autoUnblock: true,
  },
});
```

---

## Tool reference

All tools return JSON content. On success, `isError` is `false`. On failure, `isError` is `true` and the JSON contains an `error` field.

### Session tools

#### `session_start`

Start a browser session with Aluvia smart proxy. Spawns a headless browser connected through the Aluvia gateway.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | yes | URL to open in the browser |
| `connectionId` | integer | no | Use a specific Aluvia connection ID |
| `headful` | boolean | no | Run browser in headful mode (default: headless) |
| `browserSession` | string | no | Custom session name (auto-generated if omitted) |
| `autoUnblock` | boolean | no | Auto-detect blocks and reload through Aluvia proxy |
| `disableBlockDetection` | boolean | no | Disable block detection entirely |

**Response:**

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

---

#### `session_close`

Close one or all running browser sessions.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `browserSession` | string | no | Name of session to close (auto-selects if only one) |
| `all` | boolean | no | Close all sessions |

**Response (single):**

```json
{
  "browserSession": "swift-falcon",
  "pid": 12345,
  "message": "Browser session closed.",
  "startUrl": "https://example.com",
  "cdpUrl": "http://127.0.0.1:38209",
  "connectionId": 3449
}
```

**Response (all):**

```json
{
  "message": "All browser sessions closed.",
  "closed": ["swift-falcon", "bold-tiger"],
  "count": 2
}
```

---

#### `session_list`

List all active browser sessions with their PIDs, URLs, and proxy configuration.

**Parameters:** None

**Response:**

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

---

#### `session_get`

Get detailed information about a running session including proxy URLs, connection data, and block detection state.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `browserSession` | string | no | Name of session (auto-selects if only one) |

**Response:**

```json
{
  "browserSession": "swift-falcon",
  "pid": 12345,
  "startUrl": "https://example.com",
  "cdpUrl": "http://127.0.0.1:38209",
  "connectionId": 3449,
  "blockDetection": true,
  "autoUnblock": true,
  "lastDetection": {
    "hostname": "example.com",
    "lastUrl": "https://example.com/page",
    "blockStatus": "clear",
    "score": 0.1,
    "signals": ["waf_header_cloudflare"],
    "pass": "full",
    "persistentBlock": false,
    "timestamp": 1739290800000
  },
  "connection": {
    "connection_id": "3449",
    "rules": ["example.com"],
    "session_id": "abc-123",
    "target_geo": "us"
  }
}
```

---

#### `session_rotate_ip`

Rotate the IP address for a running session by generating a new session ID on the Aluvia connection.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `browserSession` | string | no | Name of session (auto-selects if only one) |

**Response:**

```json
{
  "browserSession": "swift-falcon",
  "connectionId": 3449,
  "sessionId": "550e8400-e29b-41d4-a716-446655440000"
}
```

---

#### `session_set_geo`

Set or clear the target geographic region for a running session.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `geo` | string | no | Geo code to set (e.g., `"US"`, `"GB"`) |
| `clear` | boolean | no | Clear the target geo instead of setting one |
| `browserSession` | string | no | Name of session (auto-selects if only one) |

Provide either `geo` or `clear`, not both.

**Response:**

```json
{
  "browserSession": "swift-falcon",
  "connectionId": 3449,
  "targetGeo": "US"
}
```

---

#### `session_set_rules`

Append or remove proxy routing rules for a running session.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `rules` | string | no | Comma-separated rules to append (e.g., `"a.com,b.com"`) |
| `remove` | string | no | Comma-separated rules to remove instead of appending |
| `browserSession` | string | no | Name of session (auto-selects if only one) |

Provide either `rules` or `remove`, not both.

**Response:**

```json
{
  "browserSession": "swift-falcon",
  "connectionId": 3449,
  "rules": ["existing.com", "new-site.com"],
  "count": 2
}
```

---

### Account tools

#### `account_get`

Get Aluvia account information including plan details and current balance.

**Parameters:** None

**Response:**

```json
{
  "account": {
    "account_id": "1",
    "created_at": 1705478400,
    "aluvia_username": "user@example.com",
    "balance_gb": 84.25,
    "service": "agent_connect",
    "connection_count": 5
  }
}
```

---

#### `account_usage`

Get Aluvia account usage statistics for a date range.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `start` | string | no | Start date filter (ISO 8601, e.g., `"2024-01-01T00:00:00Z"`) |
| `end` | string | no | End date filter (ISO 8601) |

**Response:**

```json
{
  "usage": {
    "account_id": "1",
    "start": 1705478400,
    "end": 1706083200,
    "data_used_gb": 15.75
  }
}
```

---

### Geo tools

#### `geos_list`

List all available geographic regions for proxy targeting.

**Parameters:** None

**Response:**

```json
{
  "geos": [
    { "code": "us", "label": "United States" },
    { "code": "gb", "label": "United Kingdom" },
    { "code": "ca", "label": "Canada" },
    { "code": "de", "label": "Germany" }
  ],
  "count": 4
}
```

---

## Architecture

The MCP server reuses the CLI handler functions but intercepts their output:

```
MCP Client (stdio JSON-RPC)
       │
       ▼
MCP Server (mcp-server.ts)
       │
       ▼
Tool handler
       │
       ▼
captureOutput(fn) ─── AsyncLocalStorage context
       │
       ▼
CLI handler function (e.g., handleOpen, handleSession)
       │
       ▼
output() ── detects capture mode ── throws MCPOutputCapture
       │
       ▼
captureOutput catches MCPOutputCapture
       │
       ▼
Returns { data, isError } as MCP tool result
```

**Why this design?**
- CLI handlers contain all the business logic (validation, API calls, session management)
- The MCP server avoids duplicating this logic
- `AsyncLocalStorage` ensures concurrent MCP tool calls don't interfere with each other
- The same handlers power both the CLI and MCP server

---

## Error handling

When a tool call fails, the response has `isError: true` and the content contains an error message:

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"error\": \"No API key found. Run `aluvia auth` to log in, or set ALUVIA_API_KEY.\"\n}"
    }
  ],
  "isError": true
}
```

Common errors:

| Error | Cause |
|-------|-------|
| `No API key found. Run \`aluvia auth\` to log in, or set ALUVIA_API_KEY.` | No env var and no key from `aluvia auth` (MCP uses the CLI credential resolver) |
| `URL is required.` | `session_start` called without `url` parameter |
| `No running browser sessions found.` | No active sessions for `session_close`/`session_get` etc. |
| `Multiple sessions running. Specify --browser-session <name>.` | Ambiguous session target when multiple sessions exist |
| `Session '...' has no connection ID.` | Session mutation without a connection ID |
| `A browser session named '...' is already running.` | Session name conflict |
