# Bare setup verification — CLI 1.4.12

Date: 2026-09-07. Base: `origin/main` at `e95ed6d5f582135d8f8a5d67f9cee9dfd27b211d`.

Version 1.4.12 is prepared locally. It has not been published to npm by this task. The npm latest version checked during this work was 1.4.11.

## Behavior

`npx aluvia-cli setup` no longer requires a target page URL. Setup opens `https://example.com/` when it needs to configure the browser. An explicit `--url` takes the place of that default. A configured browser is reused; a successful setup response no longer invalidates its own browser verification just because its next-action text recommends reloading a target page.

On Linux, restart discovery reads the existing browser's exact argument list from `/proc`. It retains the profile and browser-control settings and replaces conflicting proxy settings. When the browser exposes a local TCP debugging port, setup sends `Browser.close` before relaunching so Chrome can save the profile. A fallback restart remains available when graceful shutdown is unavailable. No new debugging port is enabled by Aluvia.

The default setup test host is excluded from the `first_proxy_request` attribution trigger. The setup command contains no added attribution token.

## Automated checks

| Check | Result |
| --- | --- |
| Prettier (`npm run lint`) | Passed |
| TypeScript (`npm run build`) | Passed |
| Full suite, Node 18.20.8 | 202 passed, 3 Windows-only tests skipped, 0 failed |
| Full suite, Node 20.20.2 | 202 passed, 3 Windows-only tests skipped, 0 failed |
| Full suite, Node 22.23.2 | 202 passed, 3 Windows-only tests skipped, 0 failed |
| npm pack | Passed; 1.4.12 package built with synchronized skill and runtime dependencies |
| Installed tarball, real browser smoke test | Passed |

Tests cover omitted/explicit/invalid URLs, fresh setup, missing browser verification, fallback instructions, repeat setup and session reuse, live/dead upstream probes, preservation of browser launch arguments, graceful shutdown, and exclusion of automatic setup traffic from the attribution trigger.

## Real browser evidence

See `bare-setup-smoke.json`. The smoke test runs the packed package through the exact command `npx aluvia-cli setup` in an isolated Debian 12 container with Node 22.23.2 and Chromium 152.0.7977.82 on Xvfb. It uses a fresh Aluvia state directory, a fresh npm cache, no API key, and local API/TLS gateway fixtures. System policy writing is deliberately unavailable, so Chrome must be configured through its launch flags.

Verified:

- Setup automatically restarts an unconfigured browser and reports `ready: true`.
- The original tab, custom profile path containing a space, and persistent cookie survive.
- Browser control reconnects on the same debugging port.
- Chromium opens the default HTTPS page, and a browser reload retrieves the fixture response through the local proxy and upstream gateway.
- A second setup run retains the browser process, connection, and session.
- The CLI launcher and agent skill are installed.
- A separate fresh setup starts and configures Chromium when no browser is open. The test launcher supplies the container's runtime flags, with no proxy settings or target URL.

An earlier smoke run caught a lost cookie with the old signal-only restart. Adding graceful `Browser.close` resolved the failure, and the completed smoke test passed with cookie and original-tab assertions.

## Limits

This verifies real Linux browser configuration and the packed CLI against controlled network services. It is not a live Aluvia production trial, cross-platform browser certification, or evidence for an “in seconds” website claim. Windows and macOS browser restarts were not tested end to end. Linux profile discovery does not add support for a remotely hosted browser or automatically reconnect a pipe-based browser controller.

The test browser uses a certificate override solely for the local TLS gateway fixture. Aluvia does not add that override. Its normal requirement remains a usable local Chrome/Chromium runtime.

## Reproduce

Run from the CLI repository in a disposable Linux container. The smoke script refuses to run outside a Linux Docker container because it restarts Chromium.

```sh
docker run --rm -it --shm-size=1g -v "$PWD:/src:ro" node:22-bookworm bash
```

Inside the container:

```sh
apt-get update
apt-get install -y --no-install-recommends chromium xvfb xauth
mkdir -p /test/repo
tar -C /src --exclude=node_modules --exclude=.git --exclude=.worktrees -cf - . | tar -C /test/repo -xf -
cd /test/repo
npm ci
npm run lint
npm run build
npm test
npm pack -w aluvia-cli --pack-destination /tmp
cd packages/cli
node --import tsx scripts/smoke-browser-setup.ts /tmp/aluvia-cli-1.4.12.tgz
```

Run the unit suite before the browser smoke test; the existing browser-launch tests intentionally quit Chrome inside this disposable environment.
