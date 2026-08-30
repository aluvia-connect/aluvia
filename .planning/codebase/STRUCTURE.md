# Codebase Structure

**Analysis Date:** 2026-08-30

## Directory Layout

```text
aluvia/
├── .github/
│   └── workflows/ci.yml             # Node.js build, format, and test matrix
├── .planning/codebase/            # Generated GSD codebase reference documents
├── packages/
│   └── cli/                       # The only npm workspace and released product
│       ├── scripts/               # Prepack build and skill synchronization
│       ├── skills/aluvia/         # Package copy of the agent skill
│       ├── src/                   # TypeScript CLI and daemon implementation
│       │   └── net/               # Private network-domain implementation
│       ├── test/                  # Node test suites and test helpers
│       ├── package.json           # Package build, test, and publish contract
│       ├── tsconfig.esm.json      # Release ESM/declaration build
│       └── tsconfig.json          # Package editor/type-check configuration
├── skills/
│   └── aluvia/SKILL.md            # Canonical agent instruction source
├── package.json                    # Private npm workspace facade
├── package-lock.json               # Locked workspace dependency graph
├── tsconfig.json                   # Shared TypeScript defaults
├── README.md                       # Product behavior and operator guide
├── CONTRIBUTING.md                 # Contributor workflow
├── SECURITY.md                     # Security reporting and package scope
└── CLAUDE.md                       # Compact repository architecture guidance
```

Generated `packages/cli/dist/` output can exist in a local checkout after a build, but `.gitignore` excludes `dist/` and `packages/cli/package.json` creates it for npm publication during `prepack`.

## Directory Purposes

**`packages/cli/src/`:**
- Purpose: Contains the product's command layer, daemon composition, local state, host integration, and API-facing modules.
- Contains: One TypeScript module per capability, with the larger proxy workflow in `packages/cli/src/proxy.ts` and the daemon in `packages/cli/src/proxy-daemon.ts`.
- Key files: `packages/cli/src/cli.ts`, `packages/cli/src/proxy.ts`, `packages/cli/src/proxy-daemon.ts`, `packages/cli/src/config.ts`, `packages/cli/src/proxy-state.ts`

**`packages/cli/src/net/`:**
- Purpose: Encapsulates private network-domain behavior behind the command and daemon layers.
- Contains: API transport, API facade, connection configuration, proxy-chain adapter, rule matching, network errors, logging, and shared network types.
- Key files: `packages/cli/src/net/config-manager.ts`, `packages/cli/src/net/proxy-server.ts`, `packages/cli/src/net/request.ts`, `packages/cli/src/net/aluvia-api.ts`, `packages/cli/src/net/rules.ts`

**`packages/cli/test/`:**
- Purpose: Verifies source modules directly through the `tsx` loader and Node.js built-in test runner.
- Contains: Capability-focused `*.test.ts` files and reusable network/process helpers under `packages/cli/test/helpers/`.
- Key files: `packages/cli/test/proxy-lifecycle.test.ts`, `packages/cli/test/net-proxy-server.test.ts`, `packages/cli/test/net-config-manager.test.ts`, `packages/cli/test/helpers/mock-aluvia-api.ts`

**`packages/cli/scripts/`:**
- Purpose: Prepare the npm artifact without adding runtime build logic to source modules.
- Contains: `packages/cli/scripts/prepack.mjs` to sync and build, plus `packages/cli/scripts/sync-skill.mjs` to copy the canonical skill.
- Key files: `packages/cli/scripts/prepack.mjs`, `packages/cli/scripts/sync-skill.mjs`

**`skills/aluvia/`:**
- Purpose: Holds the canonical computer-use agent instructions installed by setup and shipped with the npm package.
- Contains: `skills/aluvia/SKILL.md` only.
- Key files: `skills/aluvia/SKILL.md`, mirrored at `packages/cli/skills/aluvia/SKILL.md`

**`.github/workflows/`:**
- Purpose: Defines repository automation for supported Node.js versions.
- Contains: `.github/workflows/ci.yml`, which runs install, lint, build, and tests on pushes and pull requests to `main`.
- Key files: `.github/workflows/ci.yml`

**`.planning/codebase/`:**
- Purpose: Stores generated, current-state reference documents used by GSD planning and execution.
- Contains: Architecture, structure, stack, integrations, conventions, testing, and concerns maps under `.planning/codebase/`.
- Key files: `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/STRUCTURE.md`

## Key File Locations

**Entry Points:**
- `packages/cli/src/cli.ts`: Source entry for the published `aluvia` executable and top-level command dispatcher.
- `packages/cli/src/proxy-daemon.ts`: Internal long-lived `--proxy-daemon` entry and composition root.
- `packages/cli/scripts/prepack.mjs`: npm packaging entry that synchronizes assets and builds output.
- `.github/workflows/ci.yml`: CI entry for repository verification.

**Configuration:**
- `package.json`: Root workspace membership and delegated scripts.
- `packages/cli/package.json`: Package entry points, files whitelist, scripts, dependency lists, and Node.js requirement.
- `tsconfig.json`: Shared strict TypeScript and Node16 ESM resolution defaults.
- `packages/cli/tsconfig.esm.json`: Release build from `src/` to `dist/esm/` with declarations in `dist/types/`.
- `packages/cli/tsconfig.json`: Package-level source inclusion and general build paths.
- `.prettierrc.json`: Repository formatting settings.
- `.gitignore`: Excludes dependencies, build output, local environments, IDE files, worktrees, and transfer staging.

**Core Logic:**
- `packages/cli/src/proxy.ts`: Public proxy workflow orchestration and the primary location for command use cases.
- `packages/cli/src/proxy-daemon.ts`: Runtime service composition and live control handlers.
- `packages/cli/src/net/config-manager.ts`: Account connection and BYO network configuration.
- `packages/cli/src/net/proxy-server.ts`: Per-request direct/upstream routing and connection tracking.
- `packages/cli/src/net/rules.ts`: Host pattern normalization and matching.
- `packages/cli/src/auth.ts`: API-key and device authorization workflows.
- `packages/cli/src/config.ts`: Durable local configuration and credential storage.
- `packages/cli/src/proxy-state.ts`: Durable daemon and Chrome-aim state.

**Testing:**
- `packages/cli/test/*.test.ts`: Coarse and fine-grained tests grouped by source capability.
- `packages/cli/test/helpers/mock-aluvia-api.ts`: In-process fake control-plane API for integration-style tests.
- `packages/cli/test/helpers/mock-gateway.ts`: Fake proxy gateway for data-plane tests.
- `packages/cli/test/helpers/connect-via-proxy.ts`: Test client for local HTTP/CONNECT behavior.
- `packages/cli/test/helpers/ports.ts`: Isolated port allocation support.

**Documentation:**
- `README.md`: Canonical user/operator model, commands, status fields, and local files.
- `packages/cli/README.md`: npm-package-specific installation and command reference.
- `CLAUDE.md`: Compact architecture, conventions, and repository gotchas.
- `CONTRIBUTING.md`: Development, test, style, branch, and commit rules.
- `SECURITY.md`: Vulnerability reporting channel and supported package scope.

## Naming Conventions

**Files:**
- Use lowercase kebab-case for multiword source modules, such as `packages/cli/src/proxy-control-server.ts` and `packages/cli/src/api-helpers.ts`.
- Name command modules by public capability, such as `packages/cli/src/auth.ts`, `packages/cli/src/account.ts`, and `packages/cli/src/geos.ts`.
- Prefix private network test names with `net-` when they correspond to modules under `packages/cli/src/net/`, such as `packages/cli/test/net-request.test.ts`.
- Use the `*.test.ts` suffix for test suites, as in `packages/cli/test/proxy-state.test.ts`.
- Use `mock-<system>.ts` or a concrete behavior name for helpers, as in `packages/cli/test/helpers/mock-gateway.ts` and `packages/cli/test/helpers/connect-via-proxy.ts`.
- Use uppercase conventional repository document names such as `README.md`, `CONTRIBUTING.md`, and `SECURITY.md`.

**Directories:**
- Keep the one published workspace under `packages/cli/`, matching the `workspaces` declaration in `package.json`.
- Keep private network infrastructure under `packages/cli/src/net/`, not beside public command handlers.
- Keep reusable test infrastructure under `packages/cli/test/helpers/` and test files directly under `packages/cli/test/`.
- Keep the canonical agent skill at `skills/<skill-name>/SKILL.md`, as shown by `skills/aluvia/SKILL.md`.
- Keep the npm package's synchronized skill copy at `packages/cli/skills/<skill-name>/SKILL.md`, as implemented by `packages/cli/scripts/sync-skill.mjs`.

## Where to Add New Code

**New CLI Command:**
- Primary code: Add a focused handler under `packages/cli/src/<command>.ts`; register it in `packages/cli/src/cli.ts` and update the machine-readable help there.
- Proxy lifecycle code: Add the use-case flow to `packages/cli/src/proxy.ts` when it operates on setup, daemon health, egress, geo, rotation, or provider state.
- Tests: Add `packages/cli/test/<command>.test.ts` and use `packages/cli/src/output-capture.ts` when the handler terminates through `output()`.
- Documentation: Update both `README.md` and `packages/cli/README.md` when the public command contract changes.

**New Daemon Operation:**
- Control contract: Add the handler type and loopback route in `packages/cli/src/proxy-control-server.ts`.
- Runtime implementation: Supply the handler from `packages/cli/src/proxy-daemon.ts`.
- CLI client: Call it through `packages/cli/src/proxy-control-client.ts` from the relevant flow in `packages/cli/src/proxy.ts`.
- Tests: Cover HTTP validation in `packages/cli/test/proxy-control-server.test.ts` and lifecycle behavior in `packages/cli/test/proxy-lifecycle.test.ts` or a focused new suite.

**New Network Behavior:**
- API endpoint facade: Add account/geo-style methods to `packages/cli/src/net/aluvia-api.ts` and keep transport primitives in `packages/cli/src/net/request.ts`.
- Connection state behavior: Add API connection mutations or normalization to `packages/cli/src/net/config-manager.ts`.
- Routing behavior: Add hostname decisions to `packages/cli/src/net/rules.ts`; keep third-party proxy adaptation in `packages/cli/src/net/proxy-server.ts`.
- Errors and types: Add shared network errors to `packages/cli/src/net/errors.ts` and transport/domain types to `packages/cli/src/net/types.ts`.
- Tests: Mirror each module with `packages/cli/test/net-<module>.test.ts`.

**New Persistent State:**
- User/account/provider configuration: Extend `AluviaConfig` and its accessors in `packages/cli/src/config.ts`; do not expose secret values through command JSON.
- Live daemon/attachment state: Extend `ProxyJson` plus read normalization and atomic writes in `packages/cli/src/proxy-state.ts`.
- Tests: Extend `packages/cli/test/config-home.test.ts`, `packages/cli/test/credentials.test.ts`, or `packages/cli/test/proxy-state.test.ts` according to ownership.

**New Host Integration:**
- Chrome process behavior: Add platform logic to `packages/cli/src/chrome-launch.ts`.
- Chrome policy and aim detection: Add it to `packages/cli/src/proxy-attach.ts`.
- Executable/path installation: Add it to `packages/cli/src/cli-path.ts`.
- Agent skill installation: Add it to `packages/cli/src/proxy-skill.ts` and keep the canonical asset in `skills/aluvia/SKILL.md`.
- Tests: Use focused suites such as `packages/cli/test/chrome-launch.test.ts`, `packages/cli/test/proxy-attach.test.ts`, and `packages/cli/test/proxy-skill.test.ts`.

**Utilities:**
- Network-only helpers: Place them in a narrowly named module under `packages/cli/src/net/`, following `packages/cli/src/net/loopback.ts` and `packages/cli/src/net/process.ts`.
- Cross-command helpers: Place them directly under `packages/cli/src/` only when they serve more than one command, following `packages/cli/src/api-helpers.ts` and `packages/cli/src/output-capture.ts`.
- Test-only helpers: Place them under `packages/cli/test/helpers/`; do not ship them from `packages/cli/src/`.

## Special Directories

**`packages/cli/dist/`:**
- Purpose: Holds generated ESM JavaScript in `packages/cli/dist/esm/` and declarations in `packages/cli/dist/types/`.
- Generated: Yes, by `packages/cli/tsconfig.esm.json` through `packages/cli/scripts/prepack.mjs` or `npm run build`.
- Committed: No; `.gitignore` excludes `dist/`, while `packages/cli/package.json` includes it in the npm artifact.

**`packages/cli/skills/`:**
- Purpose: Holds assets shipped inside the `aluvia-cli` npm package.
- Generated: Partly; `packages/cli/skills/aluvia/SKILL.md` is synchronized from `skills/aluvia/SKILL.md` by `packages/cli/scripts/sync-skill.mjs`.
- Committed: Yes; `packages/cli/skills/aluvia/SKILL.md` is tracked and is also included by `packages/cli/package.json`.

**`.planning/codebase/`:**
- Purpose: Holds GSD's generated codebase analysis for future planning and execution.
- Generated: Yes, by the codebase mapping workflow.
- Committed: Intended to be committed by the GSD orchestrator; `.gitignore` does not exclude `.planning/`.

**`.worktrees/`:**
- Purpose: Provides a local location for isolated Git worktrees.
- Generated: Yes, by development tooling when used.
- Committed: No; `.gitignore` explicitly excludes `.worktrees/`.

**`node_modules/`:**
- Purpose: Contains npm-installed dependencies for the root workspace and `packages/cli/`.
- Generated: Yes, by `npm ci` or `npm install` using `package-lock.json`.
- Committed: No; `.gitignore` excludes `node_modules/`.

---

*Structure analysis: 2026-08-30*
