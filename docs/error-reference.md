# Error Reference

A complete reference for all error classes, error codes, and troubleshooting guidance in the Aluvia SDK.

## Table of Contents

- [Error class hierarchy](#error-class-hierarchy)
- [Error classes](#error-classes)
  - [MissingApiKeyError](#missingapikeyerror)
  - [InvalidApiKeyError](#invalidapikeyerror)
  - [ApiError](#apierror)
  - [ProxyStartError](#proxystarterror)
  - [ConnectError](#connecterror)
- [Error handling patterns](#error-handling-patterns)
- [CLI error format](#cli-error-format)
- [Common errors and troubleshooting](#common-errors-and-troubleshooting)

---

## Error class hierarchy

```
Error
├── MissingApiKeyError    — API key not provided or empty
├── InvalidApiKeyError    — API key rejected by server (401/403)
├── ApiError              — General API failures (non-auth)
│   └── statusCode?       — HTTP status code (if available)
├── ProxyStartError       — Local proxy failed to start
└── ConnectError          — CDP connection to browser session failed
```

All error classes use `Object.setPrototypeOf(this, ClassName.prototype)` to ensure correct `instanceof` behavior with TypeScript class inheritance.

---

## Error classes

### MissingApiKeyError

Thrown when the `apiKey` is not provided, is empty, or contains only whitespace.

**Thrown by:** `AluviaClient` constructor, `AluviaApi` constructor

**Default message:** `"Aluvia connection apiKey is required"`

**When it happens:**

```ts
// All of these throw MissingApiKeyError:
new AluviaClient({ apiKey: "" });
new AluviaClient({ apiKey: "   " });
new AluviaApi({ apiKey: "" });
```

**Fix:** Provide a valid API key. Check that your `ALUVIA_API_KEY` environment variable is set.

---

### InvalidApiKeyError

Thrown when the Aluvia API returns HTTP 401 (Unauthorized) or 403 (Forbidden), indicating the API key is invalid or expired.

**Thrown by:** `AluviaApi` methods, `AluviaClient.start()`, `ConfigManager.init()`, `ConfigManager.setConfig()`

**Default message:** `"Invalid or expired Aluvia connection apiKey"`

**Properties:** None (inherits `message` and `name` from `Error`)

**When it happens:**

```ts
const api = new AluviaApi({ apiKey: "invalid-key" });
await api.account.get(); // throws InvalidApiKeyError
```

**Fix:**
- Verify your API key is correct at [dashboard.aluvia.io](https://dashboard.aluvia.io/?utm_source=npmjs.com&utm_medium=referral)
- Account endpoints (`/account/...`) require an **account API token**, not a connection token
- Check if the key has expired

---

### ApiError

Thrown for general API errors — non-2xx responses (other than 401/403), malformed responses, timeouts, and network failures.

**Thrown by:** All API operations, config updates, proxy operations

**Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `message` | `string` | Human-readable error description |
| `statusCode` | `number \| undefined` | HTTP status code (if available) |

**Common status codes:**

| Status Code | Meaning |
|-------------|---------|
| `400` | Bad request — invalid parameters |
| `404` | Resource not found |
| `408` | Request timed out (from `AbortController`) |
| `422` | Validation error — check the message for field-level details |
| `500` | Server error |

**When it happens:**

```ts
// Timeout
const api = new AluviaApi({ apiKey: "valid-key", timeoutMs: 100 });
await api.account.get(); // ApiError with statusCode: 408

// Validation error
await api.account.connections.create({ rules: "invalid" });
// ApiError with statusCode: 422

// Network error
// ApiError without statusCode
```

**Fix:** Check `error.statusCode` and `error.message` for specific guidance. For 422 errors, the message includes validation details.

---

### ProxyStartError

Thrown when the local proxy server fails to bind or listen.

**Thrown by:** `ProxyServer.start()`

**Default message:** `"Failed to start local proxy server"`

**When it happens:**

```ts
const client = new AluviaClient({
  apiKey: "valid-key",
  localPort: 80, // Privileged port — may fail without root
});
await client.start(); // throws ProxyStartError
```

**Common causes:**
- Port already in use (`EADDRINUSE`)
- Privileged port without permission (`EACCES`)
- System-level binding restrictions

**Fix:**
- Omit `localPort` to let the OS assign a free port (recommended)
- Choose a different port if you need a specific one
- Check for other processes using the port: `lsof -i :<port>`

---

### ConnectError

Thrown by `connect()` when it cannot establish a CDP (Chrome DevTools Protocol) connection to a running browser session.

**Thrown by:** `connect()` function

**Properties:** None (inherits `message` and `name` from `Error`)

**Error messages and causes:**

| Error Message | Cause | Fix |
|--------------|-------|-----|
| `Playwright is required for connect()...` | Playwright not installed | `npm install playwright` |
| `No running Aluvia sessions found...` | No active sessions | Start a session first: `aluvia session start <url>` |
| `Multiple Aluvia sessions running (...)...` | More than one session, can't auto-select | Specify session name: `connect("session-name")` |
| `No Aluvia session found named '...'` | Named session doesn't exist | Check names: `aluvia session list` |
| `Session '...' is no longer running...` | Daemon process died (stale lock cleaned up) | Start a new session |
| `Session '...' is still starting up...` | Session not ready yet | Retry after a short delay |
| `Session '...' has no CDP URL.` | Session started without CDP support | Start a new session |
| `Failed to connect to session '...' at ...` | CDP connection failed | Check if the daemon is healthy |
| `Connected but failed to get page: ...` | Browser context/page unavailable | The browser may be in a bad state; restart the session |

---

## Error handling patterns

### Comprehensive catch pattern

```ts
import {
  AluviaClient,
  MissingApiKeyError,
  InvalidApiKeyError,
  ApiError,
  ProxyStartError,
  ConnectError,
} from "@aluvia/sdk";

try {
  const client = new AluviaClient({ apiKey: process.env.ALUVIA_API_KEY! });
  const connection = await client.start();
  // ... use connection ...
} catch (error) {
  if (error instanceof MissingApiKeyError) {
    // Configuration error — apiKey not set
    console.error("API key is required. Set ALUVIA_API_KEY.");
  } else if (error instanceof InvalidApiKeyError) {
    // Authentication failed
    console.error("Invalid API key. Check your credentials.");
  } else if (error instanceof ProxyStartError) {
    // Local proxy failed to start
    console.error("Proxy failed:", error.message);
  } else if (error instanceof ApiError) {
    // API call failed
    if (error.statusCode === 408) {
      console.error("Request timed out. Retry with backoff.");
    } else if (error.statusCode === 422) {
      console.error("Validation error:", error.message);
    } else {
      console.error(`API error (${error.statusCode}):`, error.message);
    }
  } else {
    // Unexpected error (network, etc.)
    throw error;
  }
}
```

### Connect error handling

```ts
import { connect, ConnectError } from "@aluvia/sdk";

try {
  const { page, disconnect } = await connect();
  // ... use page ...
  await disconnect();
} catch (error) {
  if (error instanceof ConnectError) {
    console.error("Connection failed:", error.message);
    // Message is specific enough to diagnose the issue
  } else {
    throw error;
  }
}
```

### API-only error handling

```ts
import { AluviaApi, InvalidApiKeyError, ApiError } from "@aluvia/sdk";

const api = new AluviaApi({ apiKey: process.env.ALUVIA_API_KEY! });

try {
  const account = await api.account.get();
} catch (error) {
  if (error instanceof InvalidApiKeyError) {
    console.error("Bad API key. Use an account API token.");
  } else if (error instanceof ApiError) {
    console.error(`API error (${error.statusCode}):`, error.message);
  }
}
```

---

## CLI error format

All CLI errors produce JSON output to stdout with exit code 1:

```json
{ "error": "Human-readable error message" }
```

Some errors include additional context:

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

---

## Common errors and troubleshooting

### `No API key found. Run \`aluvia auth\` to log in, or set ALUVIA_API_KEY.`

**Context:** CLI commands (and MCP tools that wrap the CLI)

**Fix:** Run `aluvia auth` on the machine running the CLI, or set the environment variable:

```bash
export ALUVIA_API_KEY="your-api-key"
```

---

### `Authentication failed (HTTP 401)...`

**Context:** Any API call

**Fix:**
- Verify your API key at [dashboard.aluvia.io](https://dashboard.aluvia.io/?utm_source=npmjs.com&utm_medium=referral)
- Account endpoints require an **account API token**
- Connection endpoints can use either account or connection tokens

---

### `Account connection response missing proxy credentials`

**Context:** `AluviaClient.start()`

**Fix:** The API returned a connection without `proxy_username` and `proxy_password`. This usually means the connection is in an incomplete state. Create a new connection or contact support.

---

### `Failed to start proxy server: listen EADDRINUSE`

**Context:** `AluviaClient.start()` with `localPort` specified

**Fix:** The port is already in use. Either:
- Omit `localPort` to auto-assign a free port
- Use a different port
- Find and stop the process using the port

---

### `No running Aluvia sessions found.`

**Context:** `connect()`, `session close`, `session get`, etc.

**Fix:** Start a session first:
```bash
aluvia session start https://example.com
```

---

### `Browser process exited unexpectedly.`

**Context:** `session start`

**Fix:**
- Check the daemon log file (path shown in the error)
- Ensure Playwright and its browser binaries are installed: `npx playwright install chromium`
- Try running with `--headful` to see the browser window

---

### `Request timed out after 30000ms`

**Context:** Any API call

**Fix:**
- Check your network connection
- Increase the timeout: `new AluviaApi({ apiKey, timeoutMs: 60000 })`
- The Aluvia API may be experiencing issues

---

### `Cannot update config: no account connection ID`

**Context:** `client.updateRules()`, `client.updateSessionId()`, `client.updateTargetGeo()`

**Fix:** Runtime updates require a connection ID. Either:
- Provide `connectionId` in `AluviaClient` options
- Ensure `client.start()` completed successfully (it creates a connection automatically)
