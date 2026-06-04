# Configuration Reference

A complete reference for all configuration options across the Aluvia SDK — constructor options, environment variables, and runtime settings.

## Table of Contents

- [Environment variables](#environment-variables)
- [AluviaClient options](#aluviaclient-options)
- [AluviaApi options](#aluviaapi-options)
- [BlockDetectionConfig](#blockdetectionconfig)
- [AluviaClientConnection](#aluviaclientconnection)
- [ConnectResult](#connectresult)
- [Type exports](#type-exports)

---

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ALUVIA_API_KEY` | No (CLI) | — | Optional override for your account API key. The CLI falls back to the key stored by `aluvia auth` in `~/.aluvia/config.json`. For programmatic usage, pass `apiKey` directly to the constructor. |

---

## AluviaClient options

```ts
import { AluviaClient } from "@aluvia/sdk";

const client = new AluviaClient({
  // Required
  apiKey: string;

  // Connection
  connectionId?: number;
  apiBaseUrl?: string;

  // Proxy
  localPort?: number;
  gatewayProtocol?: "http" | "https";
  gatewayPort?: number;

  // Polling
  pollIntervalMs?: number;
  timeoutMs?: number;

  // Browser
  startPlaywright?: boolean;
  headless?: boolean;

  // Block detection
  blockDetection?: BlockDetectionConfig;

  // Behavior
  strict?: boolean;
  logLevel?: "silent" | "info" | "debug";
});
```

### Option details

#### `apiKey` (required)

Your Aluvia account API key. Used as a `Bearer` token for API authentication.

```ts
apiKey: process.env.ALUVIA_API_KEY!
```

Throws `MissingApiKeyError` if empty or whitespace.

---

#### `connectionId`

Type: `number` | Default: `undefined`

An existing connection ID to reuse. If provided, the client fetches config via `GET /account/connections/:id`. If omitted, creates a new connection via `POST /account/connections`.

```ts
connectionId: 3449
```

Must be a finite number.

---

#### `apiBaseUrl`

Type: `string` | Default: `"https://api.aluvia.io/v1"`

Base URL for the Aluvia REST API. Override for testing or custom deployments.

---

#### `localPort`

Type: `number` | Default: OS-assigned (port 0)

Port for the local proxy server (`127.0.0.1:<localPort>`). If omitted, the OS assigns a free port automatically (recommended).

---

#### `gatewayProtocol`

Type: `"http" | "https"` | Default: `"http"`

Protocol for connecting to the Aluvia gateway.

---

#### `gatewayPort`

Type: `number` | Default: `8080` (http) / `8443` (https)

Port for the Aluvia gateway. Defaults depend on `gatewayProtocol`.

---

#### `pollIntervalMs`

Type: `number` | Default: `5000` | Minimum: `1000`

Interval in milliseconds for polling the API for configuration updates. Values below 1000 are capped to 1000.

---

#### `timeoutMs`

Type: `number` | Default: `30000`

Request timeout for API calls made via `client.api` (the `AluviaApi` instance).

---

#### `startPlaywright`

Type: `boolean` | Default: `false`

When `true`, the SDK auto-imports Playwright and launches a Chromium browser configured with the Aluvia proxy. The browser, context, and CDP URL are available on the returned connection object.

Requires `playwright` to be installed.

---

#### `headless`

Type: `boolean` | Default: `true`

Browser visibility mode. Only applies when `startPlaywright: true`.

- `true` — headless (no visible window)
- `false` — headed (visible window, useful for debugging)

---

#### `blockDetection`

Type: `BlockDetectionConfig` | Default: `undefined`

Configuration for the block detection engine. When `startPlaywright` is `true` and `blockDetection` is not explicitly provided, detection is enabled with default settings.

See [BlockDetectionConfig](#blockdetectionconfig) below.

---

#### `strict`

Type: `boolean` | Default: `true`

Startup behavior when config cannot be loaded:

- `true` — `start()` throws if the SDK cannot fetch or create a connection config. This prevents silent direct routing.
- `false` — the proxy may start and route all traffic direct until config becomes available. Polling won't self-heal without an initial config.

---

#### `logLevel`

Type: `"silent" | "info" | "debug"` | Default: `"info"`

Logging verbosity:

- `"silent"` — no output
- `"info"` — startup, shutdown, and important events
- `"debug"` — per-request routing decisions, config updates, detection results

---

## AluviaApi options

```ts
import { AluviaApi } from "@aluvia/sdk";

const api = new AluviaApi({
  apiKey: string;       // Required
  apiBaseUrl?: string;  // Default: "https://api.aluvia.io/v1"
  timeoutMs?: number;   // Default: 30000
  fetch?: typeof fetch; // Default: globalThis.fetch
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | **required** | Account API token |
| `apiBaseUrl` | `string` | `"https://api.aluvia.io/v1"` | API base URL |
| `timeoutMs` | `number` | `30000` | Request timeout (ms) |
| `fetch` | `typeof fetch` | `globalThis.fetch` | Custom fetch implementation |

---

## BlockDetectionConfig

```ts
blockDetection: {
  enabled?: boolean;
  autoUnblock?: boolean;
  autoUnblockOnSuspected?: boolean;
  challengeSelectors?: string[];
  extraKeywords?: string[];
  extraStatusCodes?: number[];
  networkIdleTimeoutMs?: number;
  onDetection?: (result: BlockDetectionResult, page: any) => void | Promise<void>;
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable/disable block detection |
| `autoUnblock` | `boolean` | `false` | Automatically add blocked hostnames to proxy rules and reload the page |
| `autoUnblockOnSuspected` | `boolean` | `false` | Also auto-unblock on `"suspected"` status (requires `autoUnblock: true`) |
| `challengeSelectors` | `string[]` | 8 built-in selectors | CSS selectors for WAF/CAPTCHA detection. **Replaces** defaults when provided |
| `extraKeywords` | `string[]` | `[]` | Additional keywords for text analysis. **Appended** to built-in keywords |
| `extraStatusCodes` | `number[]` | `[]` | Additional HTTP status codes to treat as blocks. **Appended** to built-in codes (403, 429) |
| `networkIdleTimeoutMs` | `number` | `3000` | Max ms to wait for `networkidle` before full-pass analysis |
| `onDetection` | `function` | `undefined` | Callback fired on every detection result (including `clear`). Receives `(result, page)` |

### Default challenge selectors

When `challengeSelectors` is not provided:

- `#challenge-form` — Cloudflare challenge form
- `#challenge-running` — Cloudflare active challenge
- `.cf-browser-verification` — Cloudflare browser verification
- `iframe[src*="recaptcha"]` — Google reCAPTCHA
- `.g-recaptcha` — Google reCAPTCHA container
- `#px-captcha` — PerimeterX CAPTCHA
- `iframe[src*="hcaptcha"]` — hCaptcha
- `.h-captcha` — hCaptcha container

### BlockDetectionResult

```ts
type BlockDetectionResult = {
  url: string;                        // Page URL
  hostname: string;                   // Extracted hostname
  blockStatus: "blocked" | "suspected" | "clear";
  score: number;                      // 0.0 to 1.0
  signals: DetectionSignal[];         // Fired signals
  pass: "fast" | "full";             // Which pass produced this result
  persistentBlock: boolean;           // Hostname marked as persistently blocked
  redirectChain: RedirectHop[];       // Redirect chain (if any)
};
```

### DetectionSignal

```ts
type DetectionSignal = {
  name: string;              // Signal identifier (e.g., "http_status_403")
  weight: number;            // Probability weight (0.0 to 1.0)
  details: string;           // Human-readable description
  source: "fast" | "full";  // Which pass detected this signal
};
```

### RedirectHop

```ts
type RedirectHop = {
  url: string;         // Redirect URL
  statusCode: number;  // HTTP status code of the redirect
};
```

---

## AluviaClientConnection

The connection object returned by `client.start()`:

```ts
type AluviaClientConnection = {
  // Proxy details
  host: string;                     // "127.0.0.1"
  port: number;                     // Local proxy port
  url: string;                      // "http://127.0.0.1:<port>"

  // Adapter methods
  asPlaywright(): PlaywrightProxySettings;
  asPuppeteer(): string[];
  asSelenium(): string;
  asNodeAgents(): { http: Agent; https: Agent };
  asAxiosConfig(): { proxy: false; httpAgent: Agent; httpsAgent: Agent };
  asGotOptions(): { agent: { http: Agent; https: Agent } };
  asUndiciDispatcher(): Dispatcher;
  asUndiciFetch(): typeof fetch;

  // Browser (only with startPlaywright: true)
  browser?: any;                    // Playwright Browser
  browserContext?: any;             // Playwright BrowserContext
  cdpUrl?: string;                  // CDP HTTP endpoint

  // Lifecycle
  close(): Promise<void>;          // Stop proxy, browser, polling
  stop(): Promise<void>;           // Deprecated alias for close()
};
```

### Adapter return types

| Method | Returns |
|--------|---------|
| `asPlaywright()` | `{ server: "http://127.0.0.1:<port>" }` |
| `asPuppeteer()` | `["--proxy-server=http://127.0.0.1:<port>"]` |
| `asSelenium()` | `"--proxy-server=http://127.0.0.1:<port>"` |
| `asNodeAgents()` | `{ http: HttpProxyAgent, https: HttpsProxyAgent }` |
| `asAxiosConfig()` | `{ proxy: false, httpAgent, httpsAgent }` |
| `asGotOptions()` | `{ agent: { http, https } }` |
| `asUndiciDispatcher()` | `undici.ProxyAgent` |
| `asUndiciFetch()` | Wrapped `fetch` using undici proxy dispatcher |

---

## ConnectResult

Returned by `connect()`:

```ts
type ConnectResult = {
  browser: any;                        // Playwright Browser (CDP connection)
  context: any;                        // BrowserContext (first or new)
  page: any;                           // Page (first or new)
  sessionName: string;                 // Name of connected session
  cdpUrl: string;                      // CDP endpoint URL
  connectionId: number | undefined;    // Aluvia connection ID
  disconnect: () => Promise<void>;     // Close CDP connection
};
```

---

## Type exports

All public types are exported from the main package:

```ts
import type {
  // Client types
  GatewayProtocol,
  LogLevel,
  AluviaClientOptions,
  AluviaClientConnection,
  PlaywrightProxySettings,

  // Block detection types
  BlockDetectionConfig,
  BlockDetectionResult,
  DetectionBlockStatus,
  DetectionSignal,
  RedirectHop,

  // API response types
  Account,
  AccountUsage,
  AccountPayment,
  AccountConnection,
  AccountConnectionDeleteResult,
  Geo,

  // Envelope types
  SuccessEnvelope,
  ErrorEnvelope,
  Envelope,
} from "@aluvia/sdk";

// Connect result
import type { ConnectResult } from "@aluvia/sdk";
```
