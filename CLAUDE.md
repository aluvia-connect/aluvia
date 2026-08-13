# Aluvia SDK for Node.js

## Monorepo Structure

This repository is organized as a monorepo with three packages:

- **packages/sdk/** - Core SDK (`@aluvia/sdk`)
- **packages/cli/** - Command-line tools (`aluvia`)
- **packages/mcp/** - MCP server (`@aluvia/mcp`)

## Commands

- `npm run build` — Build all packages
- `npm run build:sdk` — Build SDK package only
- `npm run build:cli` — Build CLI package only
- `npm run build:mcp` — Build MCP package only
- `npm test` — Run SDK tests
- `npm run lint` — Check formatting (Prettier)
- `npm run lint:fix` — Auto-fix formatting

## Architecture

```
packages/
  sdk/
    src/
      index.ts          — Public API exports
      connect.ts        — CDP connect helper (requires Playwright peer dep)
      errors.ts         — Custom error hierarchy
      api/              — REST API client (AluviaApi, account, geos)
      client/           — Core proxy client (AluviaClient, ProxyServer, ConfigManager, BlockDetection, adapters)
      session/          — Session lock file management
    test/               — Integration tests (node:test + node:assert)
  cli/
    src/
      cli.ts            — CLI entrypoint
      open.ts           — Session start command with daemon mode
      close.ts          — Session close command
      session.ts        — Session management commands
      account.ts        — Account commands
      geos.ts           — Geo listing
      api-helpers.ts    — CLI helpers
      cli-adapter.ts    — Re-exports for programmatic use
      mcp-helpers.ts    — MCP output capture
  mcp/
    src/
      mcp-server.ts     — MCP server implementation
      mcp-tools.ts      — MCP tool handlers
docs/                   — Technical guides (API, CLI, client)
```

## Key Patterns

- **Workspace structure**: Root is a private workspace, packages are published independently
- **Dual-build output**: ESM to `dist/esm/`, CJS to `dist/cjs/`, types to `dist/types/` (SDK and CLI only)
- **ESM-first**: Source uses `.js` extensions in imports (required for ESM resolution). All packages are `"type": "module"`.
- **Node.js native test runner**: Tests use `node:test` and `node:assert`, NOT Jest/Mocha. Run via tsx loader.
- **Adapters pattern**: `packages/sdk/src/client/adapters.ts` provides framework-specific proxy configs (`asPlaywright()`, `asPuppeteer()`, `asAxiosConfig()`, etc.).
- **Error classes use `Object.setPrototypeOf`**: Required for proper `instanceof` checks with TypeScript class inheritance.
- **Cross-package dependencies**: CLI imports from `@aluvia/sdk`, MCP imports from both `@aluvia/sdk` and `aluvia`.

## Gotchas

- **Playwright is an optional peer dep** — not installed by default. `connect()` and `startPlaywright` throw helpful errors if missing.
- **Tests import from `packages/sdk/src/` directly** (not `dist/`) — `tsx` loader compiles on the fly. No build step needed before testing.
- **The base `tsconfig.json` uses project references** — it references all three packages. Each package has its own build configs.
- **CLI outputs JSON to stdout** — all commands use the `output()` helper. Human-readable help goes to stderr/stdout but structured data is always JSON.
- **`.env` contains `ALUVIA_API_KEY`** — never commit `.env`, only `.env.example`.
