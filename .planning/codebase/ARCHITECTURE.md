<!-- refreshed: 2026-08-30 -->
# Architecture

**Analysis Date:** 2026-08-30

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                   User / computer-use agent                  │
└─────────────────────────────┬──────────────────────────────┘
                             │ `aluvia <command>`
                             ▼
┌────────────────────────────────────────────────────────────┐
│                  Short-lived CLI process                    │
│ `packages/cli/src/cli.ts` → command handlers               │
└─────────────────────────────┬──────────────────────────────┘
                             │ spawn / loopback control HTTP
                             ▼
┌─────────────────────────────────────────────────────────────┐
│             Detached local daemon (`proxyd`)                │
│ `packages/cli/src/proxy-daemon.ts`                           │
├──────────────────────────────┬──────────────────────────────┤
│ Data plane (127.0.0.1:18787)   │ Control (127.0.0.1:18788)    │
│ `src/net/proxy-server.ts`      │ `src/proxy-control-server.ts` │
└────────────────┬──────────────┴──────────────────────────────┘
                 │                     │
       direct VM │                     │ API configuration
       egress    │                     ▼
                 │          ┌───────────────────────────┐
                 └──────────▶│ Aluvia API + gateway      │
 upstream when rules match │ `src/net/config-manager.ts` │
                           │ `src/net/request.ts`        │
                           └───────────────────────────┘
```

The repository contains one product package: the Node.js CLI in `packages/cli/`. The root workspace in `package.json` delegates build, test, lint, and publish operations to `packages/cli/package.json`.

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| CLI entry point | Parse top-level commands, dispatch handlers, serialize one JSON result, and convert payment failures into actionable output | `packages/cli/src/cli.ts` |
| Proxy command orchestrator | Implement setup, lifecycle, Chrome attachment, health probes, egress switching, geo selection, IP rotation, and provider switching | `packages/cli/src/proxy.ts` |
| Proxy daemon | Own the long-running process, assemble the data and control planes, persist runtime state, and shut down cleanly | `packages/cli/src/proxy-daemon.ts` |
| Local data plane | Accept HTTP and HTTPS proxy traffic on loopback, apply routing rules, and open direct or upstream connections | `packages/cli/src/net/proxy-server.ts` |
| Local control plane | Expose loopback-only status and mutation endpoints for the short-lived CLI | `packages/cli/src/proxy-control-server.ts` |
| Control client | Read the current daemon location and send bounded HTTP requests to the local control plane | `packages/cli/src/proxy-control-client.ts` |
| Connection configuration | Create, fetch, update, normalize, and optionally poll an Aluvia account connection; also support a local BYO upstream | `packages/cli/src/net/config-manager.ts` |
| API transport | Build authenticated JSON requests, apply timeouts, and return status/body/ETag without embedding domain behavior | `packages/cli/src/net/request.ts` |
| Public API facade | Provide account, usage, and geo methods over the shared API transport | `packages/cli/src/net/aluvia-api.ts` |
| Durable local configuration | Resolve the Aluvia home and store credentials, install identity, connection identity, auth session, and BYO provider | `packages/cli/src/config.ts` |
| Runtime state snapshot | Define and atomically persist daemon, ports, rules, session, attachment, and last-CONNECT state | `packages/cli/src/proxy-state.ts` |
| Chrome attachment | Write managed-browser proxy policy when possible and detect external CONNECT activity | `packages/cli/src/proxy-attach.ts` |
| Chrome lifecycle | Locate Chrome and build or run platform-specific quit/relaunch commands with proxy flags | `packages/cli/src/chrome-launch.ts` |
| Agent skill installer | Copy the bundled Aluvia skill into detected agent environments | `packages/cli/src/proxy-skill.ts` |
| Authentication | Run API-key verification and the device authorization flow without emitting credentials | `packages/cli/src/auth.ts` |

## Pattern Overview

**Overall:** Local two-process CLI with a loopback control plane and policy-driven proxy data plane.

**Key Characteristics:**
- Keep user commands short-lived in `packages/cli/src/cli.ts`; only the internal `--proxy-daemon` mode remains alive through `packages/cli/src/proxy-daemon.ts`.
- Treat browser aim and network egress as separate state machines in `packages/cli/src/proxy.ts` and `packages/cli/src/proxy-state.ts`.
- Send all runtime mutations through the daemon control API in `packages/cli/src/proxy-control-client.ts` and `packages/cli/src/proxy-control-server.ts` while it is live.
- Let `packages/cli/src/net/config-manager.ts` own connection configuration and let `packages/cli/src/net/proxy-server.ts` consume its current normalized snapshot.
- Bind both local servers to `127.0.0.1` in `packages/cli/src/net/proxy-server.ts` and `packages/cli/src/proxy-daemon.ts`.
- Produce agent-readable JSON through `output()` in `packages/cli/src/cli.ts`; progress that is not final output goes to stderr from `packages/cli/src/proxy.ts`.

## Layers

**Command and Presentation Layer:**
- Purpose: Parse commands, validate flags, coordinate use cases, and return the final JSON contract.
- Location: `packages/cli/src/cli.ts`, `packages/cli/src/proxy.ts`, `packages/cli/src/auth.ts`, `packages/cli/src/account.ts`, `packages/cli/src/geos.ts`
- Contains: Command dispatchers, setup/status flows, user-facing `next` guidance, and error-to-JSON translation.
- Depends on: Local control client, local stores, platform integration, and API facade in `packages/cli/src/`.
- Used by: The `aluvia` executable declared in `packages/cli/package.json`.

**Daemon Composition Layer:**
- Purpose: Assemble and operate the long-lived local proxy service.
- Location: `packages/cli/src/proxy-daemon.ts`, `packages/cli/src/proxy-control-server.ts`, `packages/cli/src/proxy-control-client.ts`
- Contains: Daemon startup, signal handling, loopback control endpoints, runtime mutation handlers, and daemon health calls.
- Depends on: `ConfigManager`, `ProxyServer`, and persistent state in `packages/cli/src/net/config-manager.ts`, `packages/cli/src/net/proxy-server.ts`, and `packages/cli/src/proxy-state.ts`.
- Used by: Proxy lifecycle and egress commands in `packages/cli/src/proxy.ts`.

**Network Domain Layer:**
- Purpose: Model routing rules, remote connection configuration, proxy traffic, API transport, and network-specific failures.
- Location: `packages/cli/src/net/`
- Contains: `ConfigManager`, `ProxyServer`, rule normalization/matching, HTTP transport, API facade, logging, errors, and network types.
- Depends on: Node.js networking primitives and `proxy-chain`, as declared in `packages/cli/package.json`.
- Used by: Daemon and account/auth command modules in `packages/cli/src/`.

**Persistence and Platform Layer:**
- Purpose: Store local state and integrate the CLI with the host browser, shell path, and installed agent tools.
- Location: `packages/cli/src/config.ts`, `packages/cli/src/proxy-state.ts`, `packages/cli/src/chrome-launch.ts`, `packages/cli/src/proxy-attach.ts`, `packages/cli/src/cli-path.ts`, `packages/cli/src/proxy-skill.ts`
- Contains: File-backed state, process and port discovery, Chrome policy/flags, executable resolution, and skill copying.
- Depends on: Node.js filesystem, OS, path, child-process, HTTP, and TCP modules.
- Used by: Setup, start, status, authentication, and provider flows in `packages/cli/src/proxy.ts` and `packages/cli/src/auth.ts`.

## Data Flow

### Primary Setup and Traffic Path

1. The executable selects `setup` in `main()` and delegates to `handleProxy()` (`packages/cli/src/cli.ts:150`, `packages/cli/src/proxy.ts:1509`).
2. `handleSetup()` installs the agent skill, ensures the daemon exists, attaches Chrome, enables `rules: ['*']`, and probes the tunnel (`packages/cli/src/proxy.ts:1058`).
3. `startDaemon()` spawns the same CLI executable in detached `--proxy-daemon` mode and passes credentials only through the child environment (`packages/cli/src/proxy.ts:657`).
4. `runProxyDaemon()` initializes `ConfigManager`, starts `ProxyServer` on the data port, and starts the control server on loopback (`packages/cli/src/proxy-daemon.ts:121`).
5. Chrome sends HTTP or CONNECT traffic to the local proxy; `ProxyServer.handleRequest()` extracts the hostname and evaluates normalized rules (`packages/cli/src/net/proxy-server.ts:154`).
6. A matching host receives an authenticated upstream URL from the current config; a non-matching, loopback, or unconfigured host goes direct (`packages/cli/src/net/proxy-server.ts:170`).
7. Request observers update last-CONNECT and attachment state in the atomic runtime snapshot (`packages/cli/src/proxy-daemon.ts:205`, `packages/cli/src/proxy-state.ts:176`).

### Egress and Geo Mutation

1. `proxy-on`, `proxy-off`, and `rotate-ip` enter their command-specific flows in `packages/cli/src/proxy.ts:1361` and `packages/cli/src/proxy.ts:1422`.
2. The short-lived CLI sends POST requests to the daemon through `controlRequest()` (`packages/cli/src/proxy-control-client.ts:49`).
3. The loopback server validates the route and body, then invokes the handlers supplied by the daemon (`packages/cli/src/proxy-control-server.ts:86`).
4. The daemon calls `ConfigManager.setConfig()` to PATCH remote `rules`, `target_geo`, or `session_id`, or to mutate local BYO rules (`packages/cli/src/proxy-daemon.ts:325`, `packages/cli/src/net/config-manager.ts:322`).
5. The daemon closes existing CONNECT tunnels so the next browser request uses the new decision (`packages/cli/src/proxy-daemon.ts:327`, `packages/cli/src/net/proxy-server.ts:66`).
6. The daemon persists the new state to `proxy.json` through `writeProxyJson()` (`packages/cli/src/proxy-daemon.ts:182`, `packages/cli/src/proxy-state.ts:176`).

### Authentication and Account Reads

1. `auth`, `account`, and `geos` dispatch from `packages/cli/src/cli.ts:163`.
2. Credential selection is centralized in `packages/cli/src/api-helpers.ts`; durable values come from `packages/cli/src/config.ts`.
3. Account and geo operations use `AluviaApi` in `packages/cli/src/net/aluvia-api.ts`; device authorization uses dedicated endpoints in `packages/cli/src/auth.ts`.
4. Shared API requests apply bearer-token or install-ID headers and bounded fetch timeouts in `packages/cli/src/net/request.ts:63`.
5. Domain errors are normalized in `packages/cli/src/net/api-utils.ts` and `packages/cli/src/net/errors.ts`, then rendered as JSON by `packages/cli/src/cli.ts`.

**State Management:**
- Store credentials, install identity, the reusable account connection ID, provider selection, and pending device auth in `$ALUVIA_HOME/config.json` through `packages/cli/src/config.ts`.
- Store live process, port, session, rule, attachment, and last-CONNECT state in `$ALUVIA_HOME/proxy.json` through `packages/cli/src/proxy-state.ts`.
- Keep the authoritative in-process connection snapshot in `ConfigManager.config` and the authoritative live tunnel registry in `ProxyServer` maps in `packages/cli/src/net/config-manager.ts` and `packages/cli/src/net/proxy-server.ts`.
- Use the control server in `packages/cli/src/proxy-control-server.ts` as the mutation boundary while the daemon is running; use disk state for discovery and restart recovery in `packages/cli/src/proxy.ts`.

## Key Abstractions

**`ConfigManager`:**
- Purpose: Convert account-connection API responses or a BYO upstream into one `ConnectionNetworkConfig` consumed by the data plane.
- Examples: `packages/cli/src/net/config-manager.ts`, `packages/cli/test/net-config-manager.test.ts`
- Pattern: Stateful service with explicit `init()`, `getConfig()`, `setConfig()`, and optional polling lifecycle.

**`ProxyServer`:**
- Purpose: Adapt `proxy-chain` to Aluvia's routing rules while tracking active hostname tunnels.
- Examples: `packages/cli/src/net/proxy-server.ts`, `packages/cli/test/net-proxy-server.test.ts`
- Pattern: Adapter around a single runtime dependency with injected `ConfigManager`.

**Control Handler Contract:**
- Purpose: Keep raw HTTP parsing separate from daemon operations.
- Examples: `ControlHandlers` in `packages/cli/src/proxy-control-server.ts`, handler construction in `packages/cli/src/proxy-daemon.ts`
- Pattern: Dependency-injected function table used by a small local HTTP adapter.

**Persistent State Types:**
- Purpose: Keep restart recovery and Chrome attachment decisions explicit and serializable.
- Examples: `ProxyJson` and `ProxyAttachState` in `packages/cli/src/proxy-state.ts`, `AluviaConfig` in `packages/cli/src/config.ts`
- Pattern: Typed file-backed snapshots normalized on read and written with restrictive permissions.

**Structured CLI Termination:**
- Purpose: Guarantee one JSON object on stdout while allowing tests to intercept exits.
- Examples: `output()` in `packages/cli/src/cli.ts`, `OutputCapture` in `packages/cli/src/output-capture.ts`
- Pattern: `never`-returning output boundary that either exits or throws a capture sentinel under test.

## Entry Points

**Published CLI:**
- Location: `packages/cli/src/cli.ts`
- Triggers: The `aluvia` bin maps to `dist/esm/cli.js` in `packages/cli/package.json`.
- Responsibilities: Parse arguments, dispatch public commands, emit JSON, and normalize top-level errors.

**Detached Daemon Mode:**
- Location: `packages/cli/src/proxy-daemon.ts`
- Triggers: `startDaemon()` respawns the CLI with `--proxy-daemon` from `packages/cli/src/proxy.ts`.
- Responsibilities: Own ports 18787 and 18788 by default, maintain remote/local connection config, persist runtime state, and handle SIGINT/SIGTERM.

**Package Lifecycle:**
- Location: `packages/cli/scripts/prepack.mjs`
- Triggers: npm runs the `prepack` script declared in `packages/cli/package.json` before package creation.
- Responsibilities: Synchronize the canonical skill from `skills/aluvia/SKILL.md` and build ESM plus declarations.

**Continuous Integration:**
- Location: `.github/workflows/ci.yml`
- Triggers: Pushes and pull requests targeting `main`.
- Responsibilities: Run install, Prettier check, TypeScript build, and tests on Node.js 18, 20, and 22.

## Architectural Constraints

- **Threading:** Use the Node.js event loop in `packages/cli/src/`; the only process-level concurrency is the detached daemon spawned by `packages/cli/src/proxy.ts`.
- **Global state:** `packages/cli/src/output-capture.ts` uses `AsyncLocalStorage` for test-scoped output capture; process environment values and the file stores in `packages/cli/src/config.ts` and `packages/cli/src/proxy-state.ts` are shared process/system state.
- **Circular imports:** `packages/cli/src/cli.ts` statically imports `packages/cli/src/auth.ts`, while `packages/cli/src/auth.ts` imports `output` from the CLI and dynamically imports `packages/cli/src/proxy.ts`; keep new domain code out of this command-layer cycle.
- **Module system:** Use ESM and `.js` suffixes for relative TypeScript imports, as configured by `packages/cli/package.json` and `packages/cli/tsconfig.esm.json`.
- **Runtime:** Use Node.js 18 or later because `packages/cli/src/net/request.ts` requires native `fetch`, and `package.json` plus `packages/cli/package.json` enforce the same minimum.
- **Local exposure:** Bind proxy and control listeners to loopback only in `packages/cli/src/net/proxy-server.ts` and `packages/cli/src/proxy-daemon.ts`; do not broaden these listeners.
- **Connection identity:** Reuse one persisted account connection in `packages/cli/src/config.ts` and `packages/cli/src/proxy.ts`; rotate `session_id` rather than creating or deleting session resources.
- **Output contract:** Keep final stdout machine-readable through `packages/cli/src/cli.ts`; write diagnostic progress to stderr from `packages/cli/src/proxy.ts` or `packages/cli/src/net/logger.ts`.
- **Public package boundary:** Treat `packages/cli/src/net/` as private implementation, as stated in `CLAUDE.md`; the supported user surface is the executable declared by `packages/cli/package.json`.

## Anti-Patterns

### Mutating Live State by Editing Files

**What happens:** A caller changes `$ALUVIA_HOME/proxy.json` instead of using the local control endpoints in `packages/cli/src/proxy-control-server.ts`.
**Why it's wrong:** The live `ConfigManager` and `ProxyServer` instances in `packages/cli/src/proxy-daemon.ts` keep in-memory state, so a disk-only change does not update routing or close existing tunnels.
**Do this instead:** Add a typed control handler in `packages/cli/src/proxy-control-server.ts`, implement it in `packages/cli/src/proxy-daemon.ts`, and call it through `packages/cli/src/proxy-control-client.ts`.

### Coupling Commands Directly to `proxy-chain`

**What happens:** A command module in `packages/cli/src/` manipulates the third-party proxy server or constructs upstream URLs itself.
**Why it's wrong:** It bypasses rule normalization, loopback bypass, connection tracking, and observer behavior centralized in `packages/cli/src/net/proxy-server.ts`.
**Do this instead:** Extend `ProxyServer` in `packages/cli/src/net/proxy-server.ts` or its `ConfigManager` input in `packages/cli/src/net/config-manager.ts`, then expose the operation through the daemon boundary.

### Printing Ad Hoc Command Output

**What happens:** A command writes human-formatted data to stdout instead of using `output()` in `packages/cli/src/cli.ts`.
**Why it's wrong:** Agents depend on a single JSON result and tests use `OutputCapture` in `packages/cli/src/output-capture.ts` to intercept that boundary.
**Do this instead:** Return one record through `output()` in `packages/cli/src/cli.ts`; send non-final progress to stderr as `attachProgress()` does in `packages/cli/src/proxy.ts`.

### Creating Duplicate Account Connections

**What happens:** Setup creates a new account connection even though one is saved in `config.json` or recoverable from `proxy.json`.
**Why it's wrong:** The lifecycle uses one connection per login, and `packages/cli/src/proxy.ts` defines the required resolution order before `ConfigManager.init()` in `packages/cli/src/net/config-manager.ts` creates anything.
**Do this instead:** Resolve the explicit flag, stored configuration, then runtime snapshot through `resolveConnectionId()` in `packages/cli/src/proxy.ts`.

## Error Handling

**Strategy:** Use typed domain errors in `packages/cli/src/net/errors.ts`, translate transport responses in `packages/cli/src/net/api-utils.ts`, preserve daemon failure state in `packages/cli/src/proxy-state.ts`, and terminate public commands through structured JSON in `packages/cli/src/cli.ts`.

**Patterns:**
- Throw `ApiError`, `InvalidApiKeyError`, `PaymentRequiredError`, or `ProxyStartError` from network internals in `packages/cli/src/net/`.
- Convert HTTP authentication and payment responses at the boundary in `packages/cli/src/net/api-utils.ts` and `packages/cli/src/proxy-control-server.ts`.
- Persist startup failures to the runtime snapshot before rethrowing from `packages/cli/src/proxy-daemon.ts`.
- Convert local control failures into stable `not_running` and `timeout` categories in `packages/cli/src/proxy-control-client.ts` and user actions in `packages/cli/src/proxy.ts`.
- Catch corrupt or absent local state and return empty/null defaults in `packages/cli/src/config.ts` and `packages/cli/src/proxy-state.ts`; retain restrictive write permissions there.

## Cross-Cutting Concerns

**Logging:** Use `Logger` from `packages/cli/src/net/logger.ts` inside long-lived network components; reserve stdout for final JSON through `packages/cli/src/cli.ts` and use stderr for setup progress in `packages/cli/src/proxy.ts`.

**Validation:** Validate CLI flags near their handlers in `packages/cli/src/proxy.ts`, control request bodies in `packages/cli/src/proxy-control-server.ts`, remote response shapes in `packages/cli/src/net/api-utils.ts` and `packages/cli/src/net/config-manager.ts`, and persisted snapshots in `packages/cli/src/proxy-state.ts`.

**Authentication:** Resolve a BYO upstream, API key, or install ID in `packages/cli/src/api-helpers.ts`; persist credentials with restrictive permissions in `packages/cli/src/config.ts`; add auth headers only in `packages/cli/src/net/request.ts`; never return secrets from `packages/cli/src/cli.ts`.

---

*Architecture analysis: 2026-08-30*
