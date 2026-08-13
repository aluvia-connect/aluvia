# Contributing to the Aluvia SDK Monorepo

Thank you for your interest in contributing! This monorepo contains three packages:

- **@aluvia/sdk** — Core SDK (TypeScript/Node.js)
- **aluvia-cli** — Command-line tools (`aluvia` binary)
- **@aluvia/mcp** — MCP server

See **CLAUDE.md** for architecture, workspace layout, and key patterns.

## Requirements

- **Node.js 18+**
- npm (comes with Node.js)

## Local Setup

```bash
# Clone and install
git clone https://github.com/aluvia-connect/sdk-node.git
cd sdk-node
npm ci
```

## Monorepo Structure

- All packages live under `packages/`.
- Root scripts operate on all packages. Use `npm run build`, `npm test`, `npm run lint`, etc.
- To build/test a single package: `npm run build:sdk`, `npm run build:cli`, `npm run build:mcp`.
- Only the SDK package is published to npm. Changelogs are maintained in `packages/sdk/CHANGELOG.md` only.

## Code Style & Formatting

- Use **Prettier** (run `npm run lint:fix` to auto-format).
- 2-space indentation, single quotes, trailing commas.
- TypeScript: prefer explicit types, use `unknown` over `any`, export public types from `src/index.ts`.
- See CLAUDE.md for naming conventions and error handling.

## Testing

- Run all tests: `npm test` (SDK tests only; MCP/CLI have their own test scripts if needed).
- Use Node.js built-in test runner (`node:test`).
- Add/modify tests for any new features or bugfixes.
- Playwright is an **optional peer dependency** for SDK; install it if you need browser automation tests.

## Pull Requests & Commits

- All PRs must pass build and tests.
- Use **Conventional Commits** (see below) for commit messages.
- No secrets or API keys in code or history.
- Document public API changes.

### Commit Message Format

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`

For breaking changes, add `!` after the type/scope and a `BREAKING CHANGE:` footer.

## Branches & Releases

- `main` — stable, release-ready code
- `feature/*`, `fix/*`, `docs/*` — for development
- Releases use [Semantic Versioning](https://semver.org/). Only SDK is published to npm.

## Security

- Never commit secrets (API keys, passwords, tokens).
- Use environment variables for sensitive values.
- Report vulnerabilities privately (see `SECURITY.md`).

## Questions?

Open an issue or reach out to the maintainers. We're happy to help!
| Types/Interfaces | `PascalCase` | `AluviaClientOptions` |


