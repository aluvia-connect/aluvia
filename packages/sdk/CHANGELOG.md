# Changelog

## [2.1.0] - 2026-08-13

### Added
- Optional `installId` on `AluviaApi` / `AluviaClient` (sent as `X-Aluvia-Install-Id` when no API key is set).
- `PaymentRequiredError` for HTTP 402 (`code: payment_required`, `claimUrl`).
- Optional `upstream` on `AluviaClient` for bring-your-own proxy (skips the Aluvia API).

### Changed
- `apiKey` is no longer required when `installId` or `upstream` is set.

## [2.0.1] - 2026-03-16

### Changed
- Updated all geo-targeting documentation and examples to use country codes (e.g., `us`, `gb`, `de`) instead of subregion codes (e.g., `us_ca`, `us_ny`).
- Clarified that geo codes are now country-level only; subregion codes are no longer shown in docs or examples.

All notable changes to `@aluvia/sdk` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-02-20

### Removed
- CLI extracted to separate package `@aluvia/cli`. Subpath `@aluvia/sdk/cli` has been removed. For CLI commands use `npm install -g @aluvia/cli` (run `aluvia session start`, etc.). For programmatic use (e.g. MCP), import from `@aluvia/cli`.

## [1.4.1] - 2026-02-17

### Fixed
- Fix CLI hanging indefinitely on `session start` due to unresolved Promise in `handleOpen`.
- Fix reliability issue when spawning daemon process by resolving CLI path absolutely (replaces brittle `process.argv[1]` usage).

## [1.3.0] - 2026-02-13

### Added
- `--auto-unblock` CLI flag to enable automatic block detection and page reload through Aluvia proxy.
- Multi-session CLI support. Multiple browser sessions can now run in parallel, each with an auto-generated name (e.g. `swift-falcon`, `calm-river`). Use `--browser-session <name>` to specify a custom name.
- Full CLI command surface for agent workflows: `session start`, `session close`, `session list`, `session get`, `session rotate-ip`, `session set-geo`, `session set-rules`, `account`, `account usage`, `geos`, `help`.
- `--all` flag on `session close` command to stop all sessions at once.
- `--run <script>` option on `session start` to execute a script with `page`, `browser`, `context` injected as globals.
- `connect()` helper for AI agents to attach to running browser sessions via CDP.
- `--help` / `-h` flag support at all command levels.

### Changed
- Overhaul website block detection with weighted scoring system. Replaces binary keyword/status matching with probabilistic signal combination across 8 detector types (HTTP status, WAF headers, title keywords, challenge selectors, visible text, text-to-HTML ratio, redirect chains, meta refresh). Adds two-pass analysis (fast pass at `domcontentloaded`, full pass after `networkidle`), SPA navigation detection, word-boundary matching to prevent false positives, and hostname-level persistent block escalation. Detection results now include `blockStatus` (`blocked`/`suspected`/`clear`), `score`, and `signals` array.
- `onDetection` callback now fires on every page analysis, including `clear` results. Previously only fired for `blocked` and `suspected` results.
- Add `autoUnblock` option to `BlockDetectionConfig` (default: `false`). Set to `true` to automatically add blocked hostnames to routing rules and reload the page. When `false` (the default), detection-only mode lets agents receive scores via `onDetection` and decide how to respond.
- Rename `pageLoadDetection` option to `blockDetection` and `PageLoadDetectionConfig`/`PageLoadDetectionResult` types to `BlockDetectionConfig`/`BlockDetectionResult` for clarity.
- Restructure CLI: replace `open`/`close`/`status` with `session start`/`session close`/`session list`/`session get` and add `session rotate-ip`, `session set-geo`, `session set-rules` subcommands.
- Lock files are now per-session (`cli-<name>.lock`) instead of a single `cli.lock`.
- `session close` now returns exit code 1 when no sessions are found.
- `session set-rules` now deduplicates rules on append and errors when both positional rules and `--remove` are specified.

### Fixed
- Fix control-flow bug in `close` command where missing `return` before `output()` calls caused fall-through execution, potentially sending SIGTERM to undefined PIDs.
- Fix `handleOpen` crash when `spawn` throws (e.g. invalid executable path).
- Fix invalid session names causing a 60-second timeout instead of an immediate error.
- Fix `connect()` error messages referencing removed `open` and `status` commands.
- Fix `--connection-id` validation missing in daemon argument parser.

### Removed
- Remove gateway mode (`localProxy: false`). The SDK now always runs a local proxy on `127.0.0.1`. The `localProxy` option has been removed from `AluviaClientOptions`.

## [1.2.0] - 2026-02-11

### Added
- Auto reload a page on block detection. See [docs](https://docs.aluvia.io/aluvia-client/auto-unblock) for details.
- CLI for managing browser sessions: `npx @aluvia/sdk session start <url>` and `npx @aluvia/sdk session close`.
- Daemon mode: browser runs as a detached background process that survives terminal close.
- CDP (Chrome DevTools Protocol) endpoint exposed via `--remote-debugging-port`, enabling external tools to connect with `connectOverCDP()` and share browser contexts/pages.
- `cdpUrl` field on `AluviaClientConnection` for programmatic CDP access.
- `headless` option on `AluviaClientOptions` (default: `true`). CLI flag `--headful` to launch a visible browser.
- `--connection-id <id>` flag on CLI `session start` command to reuse an existing connection.
- Lock file (`/tmp/aluvia-sdk/cli-<name>.lock`) for per-session state persistence with full session metadata.
- JSON output by default on all CLI commands for AI agent consumption.
- `help` command with plain-text output.

### Changed
- Playwright browser launch uses `chromium.launch()` with `--remote-debugging-port` instead of `chromium.launchServer()` + `connect()`, enabling shared browser state across CDP connections.


## [1.1.0] - 2026-01-26

### Added
- Option for the client to launch Playwright browser instances directly with built-in proxy settings.


## [1.0.0] - 2025-01-12

### Added
- Initial release of `@aluvia/sdk`
- `AluviaClient` — main entry point for SDK
- Client proxy mode (default) — local proxy on `127.0.0.1`
- Gateway mode — direct gateway proxy settings
- `connection.asPlaywright()` — Playwright proxy configuration
- `connection.asPuppeteer()` — Puppeteer proxy arguments
- `connection.asSelenium()` — Selenium proxy arguments
- `connection.asAxiosConfig()` — Axios HTTP client configuration
- `connection.asGotOptions()` — Got HTTP client configuration
- `connection.asNodeAgents()` — Node.js HTTP/HTTPS agents
- `connection.asUndiciDispatcher()` — Undici dispatcher
- `connection.asUndiciFetch()` — Fetch function via Undici
- `client.updateRules()` — update routing rules at runtime
- `client.updateSessionId()` — update upstream session
- `client.updateTargetGeo()` — update geo targeting
- `AluviaApi` — typed wrapper for Aluvia REST API
- Hostname-based routing rules with wildcard support
- ETag-based config polling for live updates
- Error classes: `MissingApiKeyError`, `InvalidApiKeyError`, `ApiError`, `ProxyStartError`

---

## Changelog Policy

### When to Update

Update this changelog for **every release**. Add entries to `[Unreleased]` during development.

### Categories

Use these categories (in order):

| Category | Description |
|----------|-------------|
| **Added** | New features |
| **Changed** | Changes to existing functionality |
| **Deprecated** | Features that will be removed |
| **Removed** | Features that were removed |
| **Fixed** | Bug fixes |
| **Security** | Security vulnerability fixes |

### Entry Format

Each entry should:
- Start with a verb (Add, Fix, Change, Remove, etc.)
- Be concise but descriptive
- Reference issues/PRs when relevant

**Good:**
```markdown
- Add `updateTargetGeo()` method for geo targeting (#42)
- Fix hostname extraction for origin-form URLs
- Change default poll interval from 10s to 5s
```

**Bad:**
```markdown
- updateTargetGeo
- Fixed bug
- Changes
```

### Release Process

1. Move entries from `[Unreleased]` to new version section
2. Add release date
3. Commit changelog with version bump
4. Tag release

### Conventional Commits

We use Conventional Commits for commit messages. The changelog can be auto-generated from commits:

```bash
# Install standard-version (optional)
npm install -D standard-version

# Generate changelog from commits
npx standard-version
```

Commit types map to changelog categories:

| Commit Type | Changelog Category |
|-------------|-------------------|
| `feat:` | Added |
| `fix:` | Fixed |
| `perf:` | Changed |
| `refactor:` | Changed |
| `docs:` | (usually not included) |
| `chore:` | (usually not included) |
| `BREAKING CHANGE:` | Changed (major version) |

### Version Links

At the bottom of the file, add comparison links:

```markdown
[Unreleased]: https://github.com/aluvia-connect/sdk-node/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/aluvia-connect/sdk-node/releases/tag/v1.0.0
```

---

[Unreleased]: https://github.com/aluvia-connect/sdk-node/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/aluvia-connect/sdk-node/compare/v1.4.1...v2.0.0
[1.4.1]: https://github.com/aluvia-connect/sdk-node/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/aluvia-connect/sdk-node/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/aluvia-connect/sdk-node/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/aluvia-connect/sdk-node/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/aluvia-connect/sdk-node/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/aluvia-connect/sdk-node/releases/tag/v1.0.0
