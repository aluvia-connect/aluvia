# Contributing to Aluvia

Thank you for your interest in contributing! This repository contains one package:

- **aluvia-cli** — Command-line tool (`aluvia` binary)

See **CLAUDE.md** for architecture, workspace layout, and key patterns.

## Requirements

- **Node.js 18+**
- npm (comes with Node.js)

## Local Setup

```bash
# Clone and install
git clone https://github.com/aluvia-connect/aluvia.git
cd aluvia
npm ci
```

## Structure

- The product lives under `packages/cli`.
- Root scripts operate on that package: `npm run build`, `npm test`, `npm run lint`.
- Do not publish unless a maintainer asks. The CLI is unpublished until the backend trial ships.

## Code Style & Formatting

- Use **Prettier** (run `npm run lint:fix` to auto-format).
- 2-space indentation, single quotes, trailing commas.
- TypeScript: prefer explicit types, use `unknown` over `any`.
- See CLAUDE.md for naming conventions and error handling.

## Testing

- Run tests: `npm test`
- Use Node.js built-in test runner (`node:test`).
- Add/modify tests for any new features or bugfixes.
- Tests import from `packages/cli/src/` via the `tsx` loader. No build step needed.

## Pull Requests & Commits

- All PRs must pass build and tests.
- Use **Conventional Commits** (see below) for commit messages.
- No secrets or API keys in code or history.

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
- Releases use [Semantic Versioning](https://semver.org/).

## Security

- Never commit secrets (API keys, passwords, tokens).
- Persist keys with `aluvia auth <key>`. Never print them.
- Report vulnerabilities privately (see `SECURITY.md`).

## Questions?

Open an issue or reach out to the maintainers. We're happy to help!
