# Coding Conventions

**Analysis Date:** 2026-08-30

## Naming Patterns

**Files:**
- Use lowercase kebab-case for source modules: `packages/cli/src/proxy-control-server.ts`, `packages/cli/src/api-helpers.ts`, and `packages/cli/src/net/config-manager.ts`.
- Name tests after the behavior or module and end them with `.test.ts`: `packages/cli/test/proxy-state.test.ts` and `packages/cli/test/net-request.test.ts`.
- Put shared test support in purpose-named files under `packages/cli/test/helpers/`, such as `packages/cli/test/helpers/ports.ts` and `packages/cli/test/helpers/mock-aluvia-api.ts`.

**Functions:**
- Use lower camelCase for functions and methods: `requestCore()` in `packages/cli/src/net/request.ts`, `resolveAimProbe()` in `packages/cli/src/proxy-state.ts`, and `createControlServer()` in `packages/cli/src/proxy-control-server.ts`.
- Prefix CLI dispatch functions with `handle`, as in `handleAuth()` in `packages/cli/src/auth.ts`, `handleProxy()` in `packages/cli/src/proxy.ts`, and `handleProxyDaemon()` in `packages/cli/src/proxy-daemon.ts`.
- Prefix conversion and validation helpers with their action: `normalizeAttach()` and `readProxyJson()` in `packages/cli/src/proxy-state.ts`, plus `throwForNon2xx()` in `packages/cli/src/net/api-utils.ts`.
- Keep implementation-only helpers unexported. Examples include `joinUrl()` in `packages/cli/src/net/request.ts` and `toAccountConnectionApiResponse()` in `packages/cli/src/net/config-manager.ts`.

**Variables:**
- Use lower camelCase for local values, parameters, and object properties: `timeoutMs`, `fetchImpl`, and `hasJsonBody` in `packages/cli/src/net/request.ts`.
- Give Boolean state predicate-style names such as `isCapturing` in `packages/cli/src/output-capture.ts`, `paymentRequired` in `packages/cli/test/helpers/mock-aluvia-api.ts`, and `pollInFlight` in `packages/cli/src/net/config-manager.ts`.
- Use uppercase snake case for module constants: `DEFAULT_TIMEOUT_MS` in `packages/cli/src/net/request.ts`, `DEFAULT_DATA_PORT` in `packages/cli/src/proxy-state.ts`, and `DEFAULT_ATTACH_WAIT_MS` in `packages/cli/src/proxy-attach.ts`.

**Types:**
- Use PascalCase for type aliases, interfaces represented as object types, and classes: `RequestCoreOptions` in `packages/cli/src/net/request.ts`, `ProxyAttachState` in `packages/cli/src/proxy-state.ts`, and `ConfigManager` in `packages/cli/src/net/config-manager.ts`.
- Use descriptive `Error` suffixes for domain errors: `ApiError`, `PaymentRequiredError`, and `ProxyStartError` in `packages/cli/src/net/errors.ts`.
- Model closed value sets with string-literal unions, such as `HttpMethod` in `packages/cli/src/net/request.ts`, `ProxyEgress` in `packages/cli/src/proxy-state.ts`, and `LogLevel` in `packages/cli/src/net/types.ts`.
- Use `unknown` at input and network boundaries, then narrow it before access. Examples are `normalizeAttach(raw: unknown)` in `packages/cli/src/proxy-state.ts` and `isRecord(value: unknown)` in `packages/cli/src/net/api-utils.ts`.

## Code Style

**Formatting:**
- Run Prettier 3 through `npm run lint` or `npm run lint:fix`; the scripts are defined in `package.json` and `packages/cli/package.json`.
- Use single quotes and a 110-column print width from `.prettierrc.json`.
- Use Prettier defaults for the remaining layout: 2-space indentation, semicolons, and trailing commas in multiline constructs. Representative formatted code is in `packages/cli/src/net/request.ts` and `packages/cli/test/proxy-control-server.test.ts`.
- Keep numeric magnitudes readable with separators, as in `30_000` in `packages/cli/src/net/request.ts` and `35_000` in `packages/cli/src/proxy-control-client.ts`.

**Linting:**
- Treat Prettier as the current lint gate. `packages/cli/package.json` maps `lint` to `prettier --check src test`; no ESLint or Biome project configuration is present.
- Preserve strict TypeScript settings from `tsconfig.json` and `packages/cli/tsconfig.esm.json`, including `strict`, `forceConsistentCasingInFileNames`, and Node16 module resolution.
- Prefer explicit types and `unknown` over `any`, as required by `CONTRIBUTING.md`. Test adapters sometimes use `any` at mock boundaries in `packages/cli/test/net-request.test.ts`; keep that exception confined to test doubles.
- Ensure every change passes format, build, and tests because `.github/workflows/ci.yml` runs `npm run lint`, `npm run build`, and `npm test` on Node.js 18, 20, and 22.

## Import Organization

**Order:**
1. Import Node built-ins with the `node:` prefix, as in `packages/cli/src/cli.ts` and `packages/cli/test/proxy-state.test.ts`.
2. Import external packages after built-ins when present, as with `proxy-chain` in `packages/cli/src/net/proxy-server.ts`.
3. Import local modules through relative paths, as in `packages/cli/src/proxy-control-client.ts` and `packages/cli/test/net-errors.test.ts`.
4. Use `import type` for type-only dependencies, as in `packages/cli/src/net/logger.ts` and `packages/cli/src/proxy-control-server.ts`.

**Path Aliases:**
- No path aliases are configured in `tsconfig.json` or `packages/cli/tsconfig.esm.json`; use relative imports.
- Include `.js` in relative TypeScript import specifiers for ESM output, for example `./errors.js` in `packages/cli/src/net/request.ts` and `../src/net/request.js` in `packages/cli/test/net-request.test.ts`.
- Import tests directly from `packages/cli/src/`, not from `packages/cli/dist/`; this pattern is documented in `CLAUDE.md` and implemented throughout `packages/cli/test/`.

## Error Handling

**Patterns:**
- Throw domain-specific error classes from `packages/cli/src/net/errors.ts` when callers must distinguish authentication, payment, API, or startup failures.
- Set `name` and repair the prototype with `Object.setPrototypeOf()` in custom `Error` subclasses; follow `packages/cli/src/net/errors.ts` so `instanceof` remains reliable after TypeScript compilation.
- Catch values as `unknown` and derive messages with `err instanceof Error ? err.message : String(err)`, as in `packages/cli/src/net/request.ts` and `packages/cli/src/output-capture.ts`.
- Convert transport and response failures at the boundary. `packages/cli/src/net/request.ts` maps timeouts and network failures to `ApiError`; `packages/cli/src/net/api-utils.ts` maps HTTP envelopes to domain errors.
- Use `finally` for resource cleanup, including request timers in `packages/cli/src/net/request.ts`, temporary files in `packages/cli/src/proxy-state.ts`, and control-request timers in `packages/cli/src/proxy-control-client.ts`.
- Return `null` only for explicitly recoverable absence or invalid persisted state, as `readProxyJson()` does in `packages/cli/src/proxy-state.ts`; do not silently suppress API failures handled in `packages/cli/src/net/config-manager.ts`.
- Produce final CLI failures as structured JSON through `output()` in `packages/cli/src/cli.ts`, with a nonzero exit code and actionable `next` text where the command handlers in `packages/cli/src/proxy.ts` require it.

## Logging

**Framework:** Custom `Logger` over `console` in `packages/cli/src/net/logger.ts`; direct structured CLI output in `packages/cli/src/cli.ts`.

**Patterns:**
- Use `Logger.info()`, `debug()`, `warn()`, and `error()` for network-layer diagnostics. Respect the `silent`, `info`, and `debug` levels defined in `packages/cli/src/net/types.ts`.
- Keep the command result on stdout as one JSON object through `output()` in `packages/cli/src/cli.ts`.
- Send non-final progress to stderr, as `attachProgress()` does in `packages/cli/src/proxy.ts`, because agents parse stdout.
- Redact secrets before diagnostic logging. `ConfigManager.redactConfig()` in `packages/cli/src/net/config-manager.ts` reports whether username and password fields exist without printing their values.
- Do not print stored authentication material. This rule is stated in `CONTRIBUTING.md` and is exercised by authentication tests under `packages/cli/test/`.

## Comments

**When to Comment:**
- Comment on constraints and non-obvious state rules, not routine syntax. Examples include ESM direct-entry behavior in `packages/cli/src/cli.ts` and CONNECT timing rules in `packages/cli/src/proxy-state.ts`.
- Explain platform-specific exception handling next to the code, such as the Windows overwrite fallback in `packages/cli/src/proxy-state.ts`.
- Use short inline comments to preserve protocol intent, as in `packages/cli/src/net/config-manager.ts` for ETag polling and strict-mode behavior.

**JSDoc/TSDoc:**
- Add JSDoc to exported abstractions whose contract is not clear from the signature, such as error classes in `packages/cli/src/net/errors.ts`, output capture in `packages/cli/src/output-capture.ts`, and `ConfigManager` in `packages/cli/src/net/config-manager.ts`.
- Document important option semantics at the property level, as `ConfigManagerOptions` does in `packages/cli/src/net/config-manager.ts` and `ProxyAttachState` does in `packages/cli/src/proxy-state.ts`.
- Do not require JSDoc for self-explanatory small helpers such as `isProcessAlive()` in `packages/cli/src/net/process.ts` or `isLoopbackHostname()` in `packages/cli/src/net/loopback.ts`.

## Function Design

**Size:** Keep parsing, normalization, I/O, and orchestration in separate helpers. `packages/cli/src/net/request.ts` splits URL, query, response-type, and request concerns; `packages/cli/src/proxy.ts` uses private helpers around its larger command orchestration.

**Parameters:**
- Use one typed options object when a function has several related inputs, as in `requestCore(options)` in `packages/cli/src/net/request.ts` and `createMockGateway(opts)` in `packages/cli/test/helpers/mock-gateway.ts`.
- Provide defaults for optional behavior at the boundary, as in `unusedHandlers(overrides = {})` in `packages/cli/test/proxy-control-server.test.ts` and `applyLocalUpstream(raw, rules = [])` in `packages/cli/src/net/config-manager.ts`.
- Type public return values explicitly. Examples include `Promise<RequestCoreResult>` in `packages/cli/src/net/request.ts` and `ProxyAttachState` in `packages/cli/src/proxy-state.ts`.

**Return Values:**
- Return typed object records for multi-field results, as in `RequestCoreResult` in `packages/cli/src/net/request.ts` and `TunnelProbe` in `packages/cli/src/proxy.ts`.
- Use discriminating properties or error classes for state distinctions instead of magic values, as in `AttachStatus` in `packages/cli/src/proxy-state.ts` and `ControlClientError.code` in `packages/cli/src/proxy-control-client.ts`.
- Use `never` for functions that always exit or throw, such as `output()` and `handleHelp()` in `packages/cli/src/cli.ts`.

## Module Design

**Exports:**
- Export only functions, types, constants, and classes used across modules or by tests. Keep low-level helpers private in files such as `packages/cli/src/net/request.ts` and `packages/cli/src/net/config-manager.ts`.
- Keep private network internals under `packages/cli/src/net/`; `CLAUDE.md` states that this directory is not a public API.
- Keep runtime code in `packages/cli/src/`, tests in `packages/cli/test/`, and reusable test support in `packages/cli/test/helpers/`, as configured by `packages/cli/package.json`.

**Barrel Files:**
- Barrel files are not used. Import from the defining module, such as `packages/cli/src/net/errors.ts` or `packages/cli/src/proxy-state.ts`, rather than adding an `index.ts` aggregator.
- The package entry point is the executable `packages/cli/src/cli.ts`, compiled to the path declared in `packages/cli/package.json`; it is not a general-purpose API barrel.

---

*Convention analysis: 2026-08-30*
