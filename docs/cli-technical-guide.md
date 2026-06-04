# CLI Technical Guide

A comprehensive reference for the Aluvia CLI — a JSON-output command-line interface for managing browser sessions, account info, and proxy connections. Designed for AI agent frameworks and automation pipelines.

## Table of Contents

- [Overview](#overview)
- [Installation and setup](#installation-and-setup)
- [Output format](#output-format)
- [Command reference](#command-reference)
  - [session start](#session-start)
  - [session close](#session-close)
  - [session list](#session-list)
  - [session get](#session-get)
  - [session rotate-ip](#session-rotate-ip)
  - [session set-geo](#session-set-geo)
  - [session set-rules](#session-set-rules)
  - [account](#account)
  - [account usage](#account-usage)
  - [geos](#geos)
  - [auth](#auth)
  - [auth status](#auth-status)
  - [auth logout](#auth-logout)
  - [help](#help)
- [Connecting to a running browser](#connecting-to-a-running-browser)
  - [Using --run](#using---run)
  - [Using connect()](#using-connect)
- [Session management internals](#session-management-internals)
  - [Daemon architecture](#daemon-architecture)
  - [Lock files](#lock-files)
  - [Session naming](#session-naming)
  - [Process lifecycle](#process-lifecycle)
- [Block detection in sessions](#block-detection-in-sessions)
- [Error handling](#error-handling)
- [Validation rules](#validation-rules)

---

## Overview

The CLI is available via two equivalent binary names:

```bash
aluvia <command>
aluvia-sdk <command>
```

Both point to the same entry point. All commands output JSON to stdout and use exit code `0` for success, `1` for errors. This makes the CLI easy to integrate with AI agent frameworks that parse JSON output.

**Environment variables:**

| Variable | Required | Description |
|----------|----------|-------------|
| `ALUVIA_API_KEY` | No | Optional override for your Aluvia account API key. If unset, the CLI uses the key stored by `aluvia auth` in `~/.aluvia/config.json`. |

---

## Installation and setup

```bash
npm install @aluvia/sdk playwright
```

Requires Node.js 18+. The `playwright` dependency is required for browser session commands.

**Authenticate (recommended for headless/remote servers):**

```bash
aluvia auth
```

This prints a link and confirmation code to stderr. Open the link in any browser, approve the code, and the CLI stores your API key in `~/.aluvia/config.json`.

**Or set an API key directly (CI/scripts):**

```bash
export ALUVIA_API_KEY="your-api-key"
```

Verify the CLI is available:

```bash
aluvia help
```

---

## Output format

**All commands** output a single JSON object to stdout. No other text is written to stdout.

**Success (exit code 0):**

```json
{ "browserSession": "swift-falcon", "pid": 12345, ... }
```

**Error (exit code 1):**

```json
{ "error": "Human-readable error message" }
```

Some error responses include additional context fields:

```json
{
  "error": "A browser session named 'swift-falcon' is already running.",
  "browserSession": "swift-falcon",
  "pid": 99999,
  "startUrl": "https://example.com",
  "cdpUrl": "http://127.0.0.1:55432",
  "connectionId": 42
}
```

Daemon logs (browser process output) are written to a separate log file, never to the CLI's stdout. See [Lock files](#lock-files) for log file location.

---

## Command reference

### `session start`

Launches a headless Chromium browser routed through Aluvia's mobile proxy network. The browser runs as a background daemon process.

```bash
aluvia session start <url> [options]
```

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `<url>` | Yes | URL to navigate to in the browser. |

**Options:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--auto-unblock` | boolean | `false` | Auto-detect blocks and reload through Aluvia. |
| `--run <script>` | string | — | Path to a script file. `page`, `browser`, `context` are injected as globals. Session exits when the script finishes. |
| `--headful` | boolean | `false` | Show the browser window (default: headless). |
| `--browser-session <name>` | string | auto-generated | Name for this session. If omitted, generates a name like `swift-falcon`. |
| `--connection-id <id>` | integer | — | Reuse an existing Aluvia connection ID. |
| `--disable-block-detection` | boolean | `false` | Disable block detection entirely. |

**Success output:**

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

| Field | Type | Description |
|-------|------|-------------|
| `browserSession` | string | Session name. |
| `pid` | number | Process ID of the daemon. |
| `startUrl` | string \| null | URL the browser navigated to. |
| `cdpUrl` | string \| null | Chrome DevTools Protocol endpoint for connecting external tools. |
| `connectionId` | number \| null | Aluvia connection ID used for proxy routing. |
| `blockDetection` | boolean | Whether block detection is enabled. |
| `autoUnblock` | boolean | Whether auto-unblock is enabled. |

**Error outputs:**

Session name already in use:
```json
{
  "error": "A browser session named 'swift-falcon' is already running.",
  "browserSession": "swift-falcon",
  "startUrl": "https://example.com",
  "cdpUrl": "http://127.0.0.1:55432",
  "connectionId": 42,
  "pid": 99999
}
```

Browser process died during startup:
```json
{
  "browserSession": "swift-falcon",
  "error": "Browser process exited unexpectedly.",
  "logFile": "/tmp/aluvia-sdk/cli-swift-falcon.log"
}
```

Startup timeout (60 seconds):
```json
{
  "browserSession": "swift-falcon",
  "error": "Browser is still initializing (timeout).",
  "logFile": "/tmp/aluvia-sdk/cli-swift-falcon.log"
}
```

Missing URL:
```json
{ "error": "URL is required. Usage: aluvia session start <url> [options]" }
```

Missing API key:
```json
{ "error": "No API key found. Run `aluvia auth` to log in, or set ALUVIA_API_KEY." }
```

**Examples:**

```bash
# Start with auto-unblocking
aluvia session start https://example.com --auto-unblock

# Run a script inline (session exits when script finishes)
aluvia session start https://example.com --auto-unblock --run scrape.mjs

# Debug with a visible browser
aluvia session start https://example.com --headful

# Reuse an existing connection
aluvia session start https://example.com --connection-id 3449

# Named session
aluvia session start https://example.com --browser-session my-scraper
```

---

### `session close`

Terminates one or more running browser sessions. Sends `SIGTERM`, waits up to 10 seconds, then force-kills with `SIGKILL` if necessary.

```bash
aluvia session close [options]
```

**Options:**

| Flag | Type | Description |
|------|------|-------------|
| `--browser-session <name>` | string | Close a specific session by name. |
| `--all` | boolean | Close all running sessions. |

With no options, auto-selects the session if exactly one is running.

**Success output (single session):**

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

**Success output (force-killed):**

```json
{
  "browserSession": "swift-falcon",
  "pid": 12345,
  "message": "Browser session force-killed.",
  "startUrl": "https://example.com",
  "cdpUrl": "http://127.0.0.1:38209",
  "connectionId": 3449
}
```

**Success output (already dead):**

```json
{
  "browserSession": "swift-falcon",
  "message": "Browser process was not running. Lock file cleaned up."
}
```

**Success output (`--all`):**

```json
{
  "message": "All browser sessions closed.",
  "closed": ["swift-falcon", "bold-tiger"],
  "count": 2
}
```

**Error outputs:**

No sessions running:
```json
{ "error": "No running browser sessions found." }
```

No sessions running (`--all`):
```json
{ "error": "No running browser sessions found.", "closed": [], "count": 0 }
```

Multiple sessions (ambiguous):
```json
{
  "error": "Multiple sessions running. Specify --browser-session <name> or --all.",
  "browserSessions": ["swift-falcon", "bold-tiger"]
}
```

Named session not found:
```json
{ "browserSession": "nonexistent", "error": "No running browser session found." }
```

**Examples:**

```bash
# Close the only running session
aluvia session close

# Close by name
aluvia session close --browser-session swift-falcon

# Close all
aluvia session close --all
```

---

### `session list`

Lists all active browser sessions.

```bash
aluvia session list
```

No options or arguments. Automatically cleans up stale lock files (dead processes) before returning.

**Output:**

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

| Field | Type | Description |
|-------|------|-------------|
| `sessions` | array | Array of active session objects. |
| `count` | number | Number of active sessions. |

Each session object:

| Field | Type | Description |
|-------|------|-------------|
| `browserSession` | string | Session name. |
| `pid` | number | Daemon process ID. |
| `startUrl` | string \| null | URL the browser navigated to. |
| `cdpUrl` | string \| null | CDP endpoint. |
| `connectionId` | number \| null | Aluvia connection ID. |
| `blockDetection` | boolean | Whether block detection is enabled. |
| `autoUnblock` | boolean | Whether auto-unblock is enabled. |

---

### `session get`

Returns full session details, enriched with block detection history and the full connection object from the API.

```bash
aluvia session get [--browser-session <name>]
```

Auto-selects if only one session is running.

**Output:**

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
    "blockStatus": "blocked",
    "score": 0.85,
    "signals": ["http_status_403", "waf_header_cf_mitigated"],
    "pass": "fast",
    "persistentBlock": false,
    "timestamp": 1739290800000
  },
  "connection": {
    "connection_id": "3449",
    "proxy_username": "user123",
    "proxy_password": "pass456",
    "rules": ["example.com"],
    "session_id": "abc-123",
    "target_geo": "us"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `lastDetection` | object \| null | Most recent block detection result, or `null` if no detection has run. |
| `connection` | object \| null | Full connection object from the API. Best-effort: omitted if the API call fails. |

**lastDetection fields:**

| Field | Type | Description |
|-------|------|-------------|
| `hostname` | string | Hostname that was analyzed. |
| `lastUrl` | string | Full URL of the page. |
| `blockStatus` | string | `"blocked"`, `"suspected"`, or `"clear"`. |
| `score` | number | Detection score from 0.0 to 1.0. |
| `signals` | string[] | Names of signals that fired (e.g. `"http_status_403"`, `"challenge_selector"`). |
| `pass` | string | `"fast"` or `"full"` — which analysis pass produced this result. |
| `persistentBlock` | boolean | Whether this hostname is marked as persistently blocked. |
| `timestamp` | number | Unix timestamp (milliseconds) when the detection occurred. |

---

### `session rotate-ip`

Generates a new session ID to rotate the upstream IP address.

```bash
aluvia session rotate-ip [--browser-session <name>]
```

Auto-selects if only one session is running. Requires the session to have a connection ID.

**Output:**

```json
{
  "browserSession": "swift-falcon",
  "connectionId": 3449,
  "sessionId": "550e8400-e29b-41d4-a716-446655440000"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `browserSession` | string | Session name. |
| `connectionId` | number | Aluvia connection ID. |
| `sessionId` | string | Newly generated UUID session ID. |

**Error output (no connection ID):**

```json
{ "error": "Session 'swift-falcon' has no connection ID. It may have been started without API access." }
```

---

### `session set-geo`

Sets or clears geographic targeting for a session's IP allocation.

```bash
aluvia session set-geo <geo> [--browser-session <name>]
aluvia session set-geo --clear [--browser-session <name>]
```

Either `<geo>` or `--clear` must be provided.

**Output:**

```json
{
  "browserSession": "swift-falcon",
  "connectionId": 3449,
  "targetGeo": "us"
}
```

When cleared:

```json
{
  "browserSession": "swift-falcon",
  "connectionId": 3449,
  "targetGeo": null
}
```

**Error outputs:**

```json
{ "error": "Geo code is required. Usage: aluvia session set-geo <geo> [--browser-session <name>]" }
```

```json
{ "error": "Geo code cannot be empty. Provide a valid geo code or use --clear." }
```

**Examples:**

```bash
aluvia session set-geo US
aluvia session set-geo us --browser-session swift-falcon
aluvia session set-geo --clear
```

---

### `session set-rules`

Updates hostname-based routing rules on a running session. By default, appends new rules to the existing set. Use `--remove` to remove specific rules instead.

```bash
aluvia session set-rules <rules> [--browser-session <name>]
aluvia session set-rules --remove <rules> [--browser-session <name>]
```

Rules are comma-separated. Only one mode (append or remove) can be used per invocation.

**Append behavior:** Fetches current rules from the API, adds new rules (deduplicates), and sends the merged list.

**Remove behavior:** Fetches current rules, filters out the specified rules, and sends the remaining list.

**Append output:**

```json
{
  "browserSession": "swift-falcon",
  "connectionId": 3449,
  "rules": ["existing.com", "new-site.com", "api.new-site.com"],
  "count": 3
}
```

**Remove output:**

```json
{
  "browserSession": "swift-falcon",
  "connectionId": 3449,
  "rules": ["existing.com"],
  "count": 1
}
```

**Error outputs:**

```json
{ "error": "Rules are required. Usage: aluvia session set-rules <rules> [--browser-session <name>]" }
```

```json
{ "error": "Cannot both append and remove rules. Use either <rules> or --remove <rules>, not both." }
```

**Examples:**

```bash
# Append rules
aluvia session set-rules "example.com,api.example.com"

# Remove rules
aluvia session set-rules --remove "example.com"

# Target specific session
aluvia session set-rules "*.google.com" --browser-session swift-falcon
```

---

### `account`

Displays account information (balance, connection count, etc.).

```bash
aluvia account
```

**Output:**

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

The exact fields depend on the API response. The account object is returned directly from the API.

---

### `account usage`

Displays usage statistics, optionally filtered by date range.

```bash
aluvia account usage [--start <ISO8601>] [--end <ISO8601>]
```

**Options:**

| Flag | Type | Description |
|------|------|-------------|
| `--start <ISO8601>` | string | Start date filter (e.g. `2025-01-01T00:00:00Z`). |
| `--end <ISO8601>` | string | End date filter (e.g. `2025-02-01T00:00:00Z`). |

Both are optional. Omit both for all-time usage.

**Output:**

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

**Examples:**

```bash
aluvia account usage
aluvia account usage --start 2025-01-01T00:00:00Z --end 2025-02-01T00:00:00Z
```

---

### `geos`

Lists available geographic targeting options.

```bash
aluvia geos
```

**Output:**

```json
{
  "geos": [
    { "code": "us", "label": "United States" },
    { "code": "gb", "label": "United Kingdom" }
  ],
  "count": 2
}
```

---

### `auth`

Logs in via the device-code flow and stores your API key in `~/.aluvia/config.json`. Designed for headless and remote servers: the CLI polls the API while you approve in any browser.

```bash
aluvia auth
```

**stderr (instructions):**

```
Authenticate with Aluvia:

  1. Open: https://dashboard.aluvia.io/...
  2. Confirm this code matches: XXXX-XXXX
```

**stdout on success:**

```json
{
  "status": "authenticated",
  "message": "API key saved successfully. Run `aluvia account` to view account details."
}
```

---

### `auth status`

Checks whether a key is available. Never prints the key.

```bash
aluvia auth status
```

**Output (authenticated via stored config):**

```json
{
  "authenticated": true,
  "source": "config",
  "configFile": "~/.aluvia/config.json"
}
```

**Output (authenticated via env var):**

```json
{ "authenticated": true, "source": "env" }
```

**Output (not authenticated):**

```json
{ "authenticated": false }
```

---

### `auth logout`

Removes the stored API key from `~/.aluvia/config.json`.

```bash
aluvia auth logout
```

**Output:**

```json
{
  "status": "logged_out",
  "configFile": "~/.aluvia/config.json"
}
```

---

### `help`

Displays help text. Plain text by default, or structured JSON with `--json`.

```bash
aluvia help
aluvia help --json
aluvia --help
aluvia -h
```

The `--help` and `-h` flags work at any position (e.g. `aluvia session --help`).

**JSON output (`--json`):**

```json
{
  "commands": [
    {
      "command": "session start <url>",
      "description": "Start a browser session",
      "options": [
        { "flag": "--connection-id <id>", "description": "Use a specific connection ID" },
        { "flag": "--headful", "description": "Run browser in headful mode" },
        { "flag": "--browser-session <name>", "description": "Name for this session (auto-generated if omitted)" },
        { "flag": "--auto-unblock", "description": "Auto-detect blocks and reload through Aluvia" },
        { "flag": "--disable-block-detection", "description": "Disable block detection entirely" },
        { "flag": "--run <script>", "description": "Run a script with page, browser, context injected" }
      ]
    }
  ]
}
```

---

## Connecting to a running browser

There are two ways to run automation code against a browser session started by the CLI.

### Using `--run`

Pass a script path to `session start`. The script runs inside the daemon process with three globals injected:

- `page` — Playwright `Page` object (the first page, already navigated to `<url>`)
- `browser` — Playwright `Browser` instance
- `context` — Playwright `BrowserContext`

```bash
aluvia session start https://example.com --auto-unblock --run scrape.mjs
```

```js
// scrape.mjs — no imports needed
console.log("Title:", await page.title());
await page.click("button.next");

const newPage = await context.newPage();
await newPage.goto("https://another-site.com");
```

**Behavior:**

1. The daemon starts the browser and navigates to `<url>`.
2. The session becomes ready (lock file written with `ready: true`).
3. Globals `page`, `browser`, `context` are injected via `globalThis`.
4. The script is dynamically imported as an ES module.
5. After the script finishes (or throws), the daemon cleans up and exits.
6. Exit code 0 on success, 1 on script error.
7. Script errors are logged to the daemon log file.

**Script path resolution:** The path is resolved relative to the current working directory using `path.resolve()`.

---

### Using `connect()`

For AI agents and long-running processes that need to attach to an existing session from a separate process.

```bash
# Start a background session
aluvia session start https://example.com --auto-unblock
```

```ts
import { connect } from "@aluvia/sdk";

// Auto-discovers the running session
const { page, browser, context, disconnect } = await connect();
console.log("Title:", await page.title());

// For multiple sessions, specify by name
const { page } = await connect("swift-falcon");

// Disconnect when done (the session keeps running)
await disconnect();
```

**ConnectResult type:**

```ts
type ConnectResult = {
  browser: any;           // Playwright Browser (connected via CDP)
  context: any;           // BrowserContext (first existing or new)
  page: any;              // Page (first existing or new)
  sessionName: string;    // Name of the connected session
  cdpUrl: string;         // CDP endpoint URL
  connectionId: number | undefined;  // Aluvia connection ID
  disconnect: () => Promise<void>;   // Close the CDP connection
};
```

**Session resolution:**

- No argument: auto-discovers a single running session. Throws if zero or multiple sessions exist.
- With session name: connects to that specific session.

**Validation steps:**

1. Playwright must be installed (throws `ConnectError` if not).
2. Lock file must exist for the session.
3. Process must be alive (`process.kill(pid, 0)`).
4. Lock must have `ready: true`.
5. Lock must have a `cdpUrl`.
6. CDP connection to `cdpUrl` must succeed.

**Error messages:**

| Scenario | Error |
|----------|-------|
| Playwright not installed | `ConnectError: Playwright is required for connect(). Install it: npm install playwright` |
| No running sessions | `ConnectError: No running Aluvia sessions found. Start one with: npx aluvia-sdk session start <url>` |
| Multiple sessions | `ConnectError: Multiple Aluvia sessions running (swift-falcon, bold-tiger). Specify which one: connect('swift-falcon')` |
| Session not found | `ConnectError: No Aluvia session found named 'nonexistent'. Run 'npx aluvia-sdk session list' to list sessions.` |
| Process dead | `ConnectError: Session 'swift-falcon' is no longer running. Stale lock file removed.` |
| Still starting | `ConnectError: Session 'swift-falcon' is still starting up. Try again shortly.` |
| No CDP URL | `ConnectError: Session 'swift-falcon' has no CDP URL.` |
| CDP connection failed | `ConnectError: Failed to connect to session 'swift-falcon' at http://127.0.0.1:55432: <details>` |
| Page unavailable | `ConnectError: Connected but failed to get page: <details>` |

---

## Session management internals

### Daemon architecture

When you run `aluvia session start`, the CLI does not run the browser directly. Instead:

1. **Parent process** (the CLI command you run):
   - Validates arguments and session name.
   - Checks for an existing session with that name.
   - Spawns a **detached child process** with `--daemon` (internal flag).
   - Polls the lock file every 250ms, waiting for `ready: true`.
   - Times out after 60 seconds (240 polls).
   - Outputs the success JSON and exits.

2. **Child process** (the daemon):
   - Runs in the background with stdout/stderr redirected to the daemon log file.
   - Creates an `AluviaClient` with `startPlaywright: true`.
   - Starts the local proxy and launches Chromium.
   - Navigates to the URL.
   - Writes the lock file with `ready: true`.
   - If `--run` is provided, executes the script and then exits.
   - Otherwise, stays alive indefinitely until killed.
   - Listens for `SIGINT` and `SIGTERM` for graceful shutdown.
   - Detects browser disconnection (e.g. user closes the window).

### Lock files

Each session is tracked via a lock file on disk.

**Directory:** `{os.tmpdir()}/aluvia-sdk/`

For example: `/tmp/aluvia-sdk/` on Linux/macOS.

**Lock file:** `cli-{sessionName}.lock`

Example: `/tmp/aluvia-sdk/cli-swift-falcon.lock`

**Log file:** `cli-{sessionName}.log`

Example: `/tmp/aluvia-sdk/cli-swift-falcon.log`

**Lock file format (JSON):**

```json
{
  "pid": 12345,
  "session": "swift-falcon",
  "connectionId": 3449,
  "cdpUrl": "http://127.0.0.1:38209",
  "proxyUrl": "http://127.0.0.1:54321",
  "url": "https://example.com",
  "ready": true,
  "blockDetection": true,
  "autoUnblock": false,
  "lastDetection": {
    "hostname": "example.com",
    "lastUrl": "https://example.com/page",
    "blockStatus": "clear",
    "score": 0.1,
    "signals": ["waf_header_cloudflare"],
    "pass": "full",
    "persistentBlock": false,
    "timestamp": 1739290800000
  }
}
```

**LockData fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `pid` | number | yes | Process ID of the daemon. |
| `session` | string | no | Session name. |
| `connectionId` | number | no | Aluvia connection ID. |
| `cdpUrl` | string | no | Chrome DevTools Protocol endpoint URL. |
| `proxyUrl` | string | no | Local proxy server URL. |
| `url` | string | no | URL the browser navigated to. |
| `ready` | boolean | no | `true` when the session is fully initialized. |
| `blockDetection` | boolean | no | Whether block detection is enabled. |
| `autoUnblock` | boolean | no | Whether auto-unblock is enabled. |
| `lastDetection` | LockDetection | no | Most recent block detection result. |

**Lock file lifecycle:**

1. **Early write** (before navigation): daemon writes `pid`, `session`, `proxyUrl`, `blockDetection`, `autoUnblock`. No `ready` flag yet.
2. **Final write** (after navigation): adds `connectionId`, `cdpUrl`, `url`, sets `ready: true`. Preserves any `lastDetection` written by the detection callback.
3. **Runtime updates**: `lastDetection` is updated on each block detection event.
4. **Cleanup**: lock file is deleted when the process exits, is killed, or is cleaned up by `session close`.

**Atomic writes:** Lock files are written atomically using a temporary file and `rename()` to prevent partial reads.

**Stale lock cleanup:** `session list`, `session close`, and `connect()` all check whether the lock file's PID is still alive (`process.kill(pid, 0)`). Dead-process lock files are automatically removed.

---

### Session naming

Session names are auto-generated using an `adjective-noun` pattern:

**Adjectives:** swift, bold, calm, keen, warm, bright, silent, rapid, steady, clever, vivid, agile, noble, lucid, crisp, gentle, fierce, nimble, sturdy, witty

**Nouns:** falcon, tiger, river, maple, coral, cedar, orbit, prism, flint, spark, ridge, ember, crane, grove, stone, brook, drift, crest, sage, lynx

**Algorithm:**

1. Pick a random adjective and noun: `swift-falcon`
2. Check if a lock file exists for this name.
3. If the lock file exists and the process is alive, try again with a suffix: `swift-falcon-1`, `swift-falcon-2`, etc.
4. If the lock file exists but the process is dead, clean up the stale lock and reuse the name.
5. After 10 failed attempts, fall back to `session-{timestamp}`.

**Custom names** must match `/^[a-zA-Z0-9_-]+$/` (letters, numbers, hyphens, underscores only).

---

### Process lifecycle

**Startup:**

```
CLI (parent)                                 Daemon (child)
  │                                            │
  ├── Validate args                            │
  ├── Check for existing session               │
  ├── Spawn detached child ──────────────────► │
  │                                            ├── Create AluviaClient
  │                                            ├── Start proxy
  │                                            ├── Launch Chromium
  │                                            ├── Write early lock (no ready)
  ├── Poll lock file (250ms) ◄──────────────── │
  │                                            ├── Navigate to URL
  │                                            ├── Write final lock (ready: true)
  ├── Read lock (ready: true) ◄──────────────── │
  ├── Output JSON                              │
  └── Exit (code 0)                            │  (stays alive)
```

**Shutdown (SIGTERM):**

```
session close                               Daemon
  │                                            │
  ├── Send SIGTERM ──────────────────────────► │
  │                                            ├── Close browser
  │                                            ├── Stop proxy
  │                                            ├── Remove lock file
  ├── Wait up to 10s                           ├── Exit (code 0)
  │   └── Poll isProcessAlive()                │
  ├── (if still alive) Send SIGKILL            │
  ├── Remove lock file                         │
  └── Output JSON                              │
```

**Browser closed by user:**

If the user closes the browser window, the daemon detects the `disconnected` event and performs graceful shutdown: removes the lock file, stops the proxy, and exits.

---

## Block detection in sessions

When block detection is enabled (default), the daemon writes `lastDetection` to the lock file on every detection event. This data is accessible via `session get`.

**Detection flow:**

1. Browser navigates to a page.
2. Fast pass runs at `domcontentloaded` (HTTP status codes, WAF headers).
3. Full pass runs after `networkidle` (page content, challenge selectors, redirects).
4. `lastDetection` in the lock file is updated with the result.
5. If `--auto-unblock` is enabled and a block is detected (score >= 0.7), the hostname is added to proxy routing rules and the page reloads through Aluvia.

**CLI flags and their effect:**

| Flag | Block detection | Auto-unblock |
|------|----------------|--------------|
| (default) | Enabled | Disabled |
| `--auto-unblock` | Enabled | Enabled |
| `--disable-block-detection` | Disabled | Disabled |

For full details on signals, scoring, and auto-unblock behavior, see the [Client Technical Guide](client-technical-guide.md#block-detection).

---

## Error handling

All errors produce JSON output to stdout with exit code 1.

**Common error patterns:**

| Error | When |
|-------|------|
| `No API key found. Run \`aluvia auth\` to log in, or set ALUVIA_API_KEY.` | API key not set (no env var and no stored config). |
| `URL is required. Usage: aluvia session start <url> [options]` | Missing URL argument for `session start`. |
| `Invalid --connection-id: '...' must be a positive integer.` | Bad connection ID value. |
| `Invalid session name. Use only letters, numbers, hyphens, and underscores.` | Invalid characters in `--browser-session`. |
| `A browser session named '...' is already running.` | Session name conflict. |
| `No running browser sessions found.` | No active sessions (for `close`, `list`, targeting). |
| `Multiple sessions running. Specify --browser-session <name> or --all.` | Ambiguous session target. |
| `Multiple sessions running. Specify --browser-session <name>.` | Ambiguous session target (non-close commands). |
| `No session found with name '...'.` | Named session doesn't exist. |
| `Session '...' is no longer running (stale lock cleaned up).` | Daemon process died. |
| `Session '...' has no connection ID. It may have been started without API access.` | Session mutation requires connection ID. |
| `Unknown command: '...'. Run "aluvia help" for usage.` | Unrecognized command. |
| `Unknown session subcommand: '...'. Run "aluvia help" for usage.` | Unrecognized session subcommand. |
| `Unknown account subcommand: '...'.` | Unrecognized account subcommand. |
| `Unknown auth subcommand: '...'.` | Unrecognized auth subcommand. |

API errors from the Aluvia REST API are caught and output as `{ "error": "<message>" }` with the API error message.

---

## Validation rules

### Session names

- Regex: `/^[a-zA-Z0-9_-]+$/`
- Allowed: letters (a-z, A-Z), digits (0-9), hyphens (`-`), underscores (`_`)
- No spaces, dots, or special characters.

### Connection IDs

- Must be a positive integer.
- Validated with `Number.isInteger(parsed) && parsed >= 1`.

### Geo codes

- Non-empty string after trimming.
- Examples: `US`, `GB`, `DE`.
- Actual validation happens server-side via the API.

### Rules

- Comma-separated strings, each trimmed individually.
- Empty values are filtered out.
- Supported patterns: `*`, `example.com`, `*.example.com`, `google.*`, `-example.com`.
- Actual rule validation happens in the routing engine. See [Client Technical Guide: Routing Rules](client-technical-guide.md#routing-rules).

### ISO 8601 dates

- Used by `--start` and `--end` in `account usage`.
- Passed through to the API as-is; validation is server-side.
- Examples: `2025-01-01T00:00:00Z`, `2025-02-01T00:00:00Z`.
