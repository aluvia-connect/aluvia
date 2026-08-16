# Aluvia CLI

## Structure

This repository is a private workspace with one package:

- **packages/cli/** — `aluvia-cli` (bin `aluvia`)

Private network internals live in `packages/cli/src/net/` (not a public API).

## Commands

- `npm run build` — Build the CLI (ESM)
- `npm test` — Run CLI tests
- `npm run lint` — Check formatting (Prettier)
- `npm run lint:fix` — Auto-fix formatting

## Architecture

```
packages/
  cli/
    src/
      cli.ts              — CLI entrypoint
      proxy.ts            — setup / start / status / proxy-on / rotate-ip
      proxy-daemon.ts     — long-lived local proxy (ConfigManager + ProxyServer)
      account.ts          — Account commands
      geos.ts             — Geo listing
      auth.ts             — auth <key> | login | status
      api-helpers.ts      — Credential resolver
      mcp-helpers.ts      — Test output capture
      net/                — private internals (not a public API)
        aluvia-api.ts     — account.get / usage.get / geos.list
        config-manager.ts — connection POST/GET/PATCH, BYO upstream
        proxy-server.ts   — local HTTP proxy via proxy-chain
        request.ts        — HTTP to api.aluvia.io
        errors.ts         — PaymentRequiredError and related
    test/                 — node:test + node:assert (tsx)
docs/                     — Technical guides
```

## Key Patterns

- **Workspace structure**: Root is a private workspace; `packages/cli` is the only published package.
- **One ESM build**: `tsc -p tsconfig.esm.json` → `dist/esm/`. Types in `dist/types/`.
- **ESM-first**: Source uses `.js` extensions in imports (required for ESM resolution). `"type": "module"`.
- **Node.js native test runner**: Tests use `node:test` and `node:assert`, NOT Jest/Mocha. Run via tsx loader.
- **Error classes use `Object.setPrototypeOf`**: Required for proper `instanceof` checks with TypeScript class inheritance.
- **Runtime dependency**: `proxy-chain` only.

## Gotchas

- **Tests import from `packages/cli/src/` directly** (not `dist/`) — `tsx` loader compiles on the fly. No build step needed before testing.
- **CLI outputs JSON to stdout** — all commands use the `output()` helper. Structured data is always JSON.
- **`.env` contains `ALUVIA_API_KEY`** — never commit `.env`, only `.env.example`.
