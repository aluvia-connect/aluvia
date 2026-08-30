# Technology Stack

**Analysis Date:** 2026-08-30

## Languages

**Primary:**
- TypeScript 5.9.3 - All CLI, proxy daemon, API client, local control server, and test code lives in `packages/cli/src/**/*.ts` and `packages/cli/test/**/*.test.ts`; the pinned compiler version is recorded in `package-lock.json`.

**Secondary:**
- JavaScript (ECMAScript modules) - Package lifecycle scripts use `.mjs` in `packages/cli/scripts/prepack.mjs` and `packages/cli/scripts/sync-skill.mjs`.
- YAML - GitHub Actions CI is defined in `.github/workflows/ci.yml`.
- Markdown - User, contributor, security, and bundled agent instructions live in `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, and `skills/aluvia/SKILL.md`.

## Runtime

**Environment:**
- Node.js 18 or newer - Both `package.json` and `packages/cli/package.json` require `node >=18`; `packages/cli/src/net/request.ts` depends on Node's global `fetch`.
- ECMAScript module runtime - Both `package.json` and `packages/cli/package.json` set `"type": "module"`; TypeScript emits Node16-compatible ESM from `packages/cli/tsconfig.esm.json`.
- Cross-platform command-line process - Chrome discovery and restart paths explicitly support Linux, macOS, and Windows in `packages/cli/src/chrome-launch.ts`; Windows policy support is implemented in `packages/cli/src/proxy-attach.ts`.

**Package Manager:**
- npm (version not pinned) - Root workspace delegation is declared in `package.json`; CI installs with `npm ci` in `.github/workflows/ci.yml`.
- Lockfile: present at `package-lock.json` using lockfile version 3.
- Workspace: one package, `packages/cli`, declared by the root `package.json`.

## Frameworks

**Core:**
- No application framework - The CLI uses Node built-ins directly for HTTP, TLS, TCP, processes, filesystem access, cryptography, and URL handling throughout `packages/cli/src/`.
- `proxy-chain` 2.6.1 - Provides the local HTTP/HTTPS forward proxy in `packages/cli/src/net/proxy-server.ts`; it is the only runtime npm dependency in `packages/cli/package.json`.

**Testing:**
- Node.js built-in test runner (`node:test`) - Test suites in `packages/cli/test/*.test.ts` run without Jest, Vitest, or Mocha.
- Node.js strict assertion API (`node:assert`) - Assertions are imported directly by test files such as `packages/cli/test/proxy-lifecycle.test.ts`.
- `tsx` 4.21.0 - Loads TypeScript test files for `node --test`; configured in `packages/cli/package.json`.

**Build/Dev:**
- TypeScript 5.9.3 - `npm run build` compiles `packages/cli/src/` to ESM JavaScript and declarations using `packages/cli/tsconfig.esm.json`.
- Prettier 3.7.4 from `package-lock.json` - Formatting and lint checks use `.prettierrc.json` and the `lint` scripts in `packages/cli/package.json`.
- GitHub Actions - `.github/workflows/ci.yml` runs install, formatting checks, build, and tests on Node.js 18, 20, and 22.

## Key Dependencies

**Critical:**
- `proxy-chain` 2.6.1 - Accepts local Chrome proxy traffic, handles CONNECT tunnels, and chooses direct or upstream egress per request in `packages/cli/src/net/proxy-server.ts`.
- Node global `fetch` - Sends authenticated JSON requests to Aluvia services and public IP probes in `packages/cli/src/net/request.ts`, `packages/cli/src/auth.ts`, `packages/cli/src/proxy-control-client.ts`, and `packages/cli/src/proxy.ts`.
- Node core networking - `node:http`, `node:net`, and `node:tls` implement the loopback control plane and tunnel probes in `packages/cli/src/proxy-control-server.ts`, `packages/cli/src/proxy-control-client.ts`, and `packages/cli/src/proxy.ts`.

**Infrastructure:**
- Aluvia API client - `packages/cli/src/net/aluvia-api.ts` wraps account, usage, and geo endpoints; `packages/cli/src/net/config-manager.ts` owns account-connection creation and updates.
- Local proxy daemon - `packages/cli/src/proxy-daemon.ts` composes `ConfigManager`, `ProxyServer`, and the loopback control server and persists process state through `packages/cli/src/proxy-state.ts`.
- Chrome/Chromium process integration - `packages/cli/src/chrome-launch.ts` discovers, stops, and relaunches Chrome with the local proxy; `packages/cli/src/proxy-attach.ts` provides platform-specific attachment support.

## Configuration

**Environment:**
- Normal use does not require environment variables. Credentials and provider choice are persisted through CLI commands to `config.json` by `packages/cli/src/config.ts`.
- Runtime override variables are read directly from `process.env`: `ALUVIA_HOME`, `ALUVIA_API_KEY`, `ALUVIA_INSTALL_ID`, `ALUVIA_UPSTREAM`, `ALUVIA_API_BASE_URL`, `ALUVIA_GATEWAY_HOST`, `ALUVIA_GATEWAY_PORT`, `ALUVIA_PROXY_PORT`, and `ALUVIA_PROXY_CONTROL_PORT` in `packages/cli/src/config.ts`, `packages/cli/src/api-helpers.ts`, and `packages/cli/src/proxy-daemon.ts`.
- Browser and diagnostic overrides include `ALUVIA_CHROME`, `ALUVIA_SKIP_CHROME_RESTART`, `ALUVIA_CHROME_POLICY_DIR`, `ALUVIA_ATTACH_WAIT_MS`, `ALUVIA_CONTROL_TIMEOUT_MS`, `ALUVIA_DATACENTER_IP`, `ALUVIA_PROBE_URL`, `ALUVIA_PROBE_RETRY_DELAY_MS`, `ALUVIA_PROBE_RETRY_ATTEMPTS`, and `ALUVIA_SKILL_DIRS` in `packages/cli/src/chrome-launch.ts`, `packages/cli/src/proxy-attach.ts`, `packages/cli/src/proxy-control-client.ts`, `packages/cli/src/proxy.ts`, and `packages/cli/src/proxy-skill.ts`.
- `.env` is ignored by `.gitignore`; no `.env` file is present in the repository scan. Never add credentials to repository configuration; follow `SECURITY.md`.

**Build:**
- Root compiler defaults are in `tsconfig.json`.
- Package source-build settings are in `packages/cli/tsconfig.esm.json`; output goes to `packages/cli/dist/esm/` and `packages/cli/dist/types/`.
- Package-level development compiler settings are in `packages/cli/tsconfig.json`.
- Formatting settings are in `.prettierrc.json`: single quotes and 110-character print width.
- `packages/cli/scripts/prepack.mjs` synchronizes the agent skill and rebuilds before package creation; `packages/cli/scripts/sync-skill.mjs` copies `skills/aluvia/SKILL.md` into the package.

## Platform Requirements

**Development:**
- Install Node.js 18+ and npm, then run `npm ci` from the repository root as documented in `CONTRIBUTING.md`.
- Run `npm run lint`, `npm run build`, and `npm test`; the same commands are CI gates in `.github/workflows/ci.yml`.
- Use the root npm workspace commands from `package.json`; implementation work belongs under `packages/cli/`.

**Production:**
- Distribution target is the public `aluvia-cli` npm package described by `packages/cli/package.json`; the `aluvia` executable resolves to `packages/cli/dist/esm/cli.js`.
- The published artifact includes compiled output, type declarations, the bundled skill, `packages/cli/README.md`, and `packages/cli/LICENSE` according to `packages/cli/package.json`.
- A Chrome or Chromium installation is needed for automatic browser attachment; binary detection and supported paths are in `packages/cli/src/chrome-launch.ts`.
- Runtime state must be writable under `/workspace/.aluvia` when `/workspace` exists, otherwise under the user's `~/.aluvia`; this is implemented in `packages/cli/src/config.ts`.
- The machine must allow loopback listeners on ports 18787 and 18788 by default and outbound HTTPS/API plus proxy-gateway traffic; defaults are defined in `packages/cli/src/proxy-state.ts` and `packages/cli/src/proxy-daemon.ts`.

---

*Stack analysis: 2026-08-30*
