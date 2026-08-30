# Codebase Concerns

**Analysis Date:** 2026-08-30

## Tech Debt

**Oversized proxy orchestration module:**
- Issue: `packages/cli/src/proxy.ts` contains 1,542 lines and about 143 function-like declarations. It combines CLI routing, process lifecycle, Chrome attachment, tunnel probing, state interpretation, session rotation, and status payload construction.
- Files: `packages/cli/src/proxy.ts`, `packages/cli/src/proxy-daemon.ts`, `packages/cli/src/proxy-attach.ts`, `packages/cli/src/chrome-launch.ts`
- Impact: A change to one lifecycle path can affect unrelated setup, status, attach, or rotation behavior. The large integration tests reduce risk but make ownership and review difficult.
- Fix approach: Split `packages/cli/src/proxy.ts` by existing responsibilities: command handlers, daemon client/lifecycle, tunnel probes, attach workflow, and status presentation. Keep `packages/cli/src/proxy-state.ts` as the state boundary and preserve the current integration tests during extraction.

**Non-atomic credential configuration writes:**
- Issue: `writeConfig()` writes directly to `config.json`. A crash, full disk, or interrupted write can truncate the file. `readConfig()` silently treats malformed JSON as an empty configuration.
- Files: `packages/cli/src/config.ts`
- Impact: Authentication, provider choice, install identity, and saved connection state can disappear together. A corrupt file can cause new trial identity or connection creation without explaining the root cause.
- Fix approach: Use the temp-file, mode, rename, and cleanup pattern already implemented by `writeProxyJson()` in `packages/cli/src/proxy-state.ts`. Distinguish missing configuration from corrupt configuration and return a repair-oriented error.

**Duplicated agent skill source:**
- Issue: The same skill is tracked at two paths. `packages/cli/scripts/sync-skill.mjs` copies one over the other only during packaging; the current copies are byte-identical, but ordinary edits can leave them inconsistent before prepack runs.
- Files: `skills/aluvia/SKILL.md`, `packages/cli/skills/aluvia/SKILL.md`, `packages/cli/scripts/sync-skill.mjs`, `packages/cli/scripts/prepack.mjs`
- Impact: Repository readers and npm users can receive different agent instructions. A stale bundled copy can ship if a nonstandard release path skips prepack.
- Fix approach: Treat `skills/aluvia/SKILL.md` as the sole source. Add a CI check that runs the sync script and fails on a resulting diff, or generate the packaged copy in a staging directory instead of tracking it.

**Version sources are inconsistent:**
- Issue: The private workspace manifest reports `1.4.2`, while the published package manifest reports `1.4.5`; the only visible repository tag is `v1.4.2`.
- Files: `package.json`, `packages/cli/package.json`, `package-lock.json`
- Impact: Release automation, support reports, and repository checkouts can identify the same code with different versions.
- Fix approach: Define whether the root version is intentionally independent. If not, update all version sources and create matching release tags through one release command. If it is independent, remove the root version or document its meaning in `CONTRIBUTING.md`.

**Tracked operating-system artifact:**
- Issue: `.DS_Store` is tracked even though both root and nested `.DS_Store` files are ignored.
- Files: `.DS_Store`, `.gitignore`
- Impact: The public repository contains machine-generated metadata and can continue to show it in history after deletion.
- Fix approach: Remove `.DS_Store` from the Git index and keep `.gitignore` lines 11-12. Rewrite history only if the file contains data that must be removed; normal deletion is enough for housekeeping.

**Manual release path:**
- Issue: The repository provides direct `npm publish` scripts, while the only GitHub Actions workflow performs lint, build, and tests. There is no tracked release workflow, provenance step, package-content assertion, or version/tag consistency check.
- Files: `package.json`, `packages/cli/package.json`, `.github/workflows/ci.yml`, `packages/cli/scripts/prepack.mjs`
- Impact: A release depends on a maintainer's local environment and npm credentials. Package contents and Git tags can diverge from the tested commit.
- Fix approach: Add a protected release workflow that runs `npm ci`, lint, test, build, `npm pack --dry-run`, version validation, and npm provenance before publishing from an immutable tag.

## Known Bugs

**Public repository described as private:**
- Symptoms: GitHub reports `aluvia-connect/aluvia` as `PUBLIC`, but the repository README says “A private workspace.”
- Files: `README.md`, `package.json`
- Trigger: Open the repository page or read `README.md` under “This repository.”
- Workaround: Treat every tracked file and reachable commit as public regardless of the README wording.

**Health probe accepts unverified TLS:**
- Symptoms: The tunnel readiness probe sets `rejectUnauthorized: false`, so a TLS interception endpoint can return a forged IP response that is accepted as evidence of a ready non-datacenter tunnel.
- Files: `packages/cli/src/proxy.ts`
- Trigger: Intercept or replace the TLS certificate/response for a configured probe target while the CLI runs `setup`, `status`, `proxy-on`, or `rotate-ip`.
- Workaround: Do not use untrusted `ALUVIA_PROBE_URL` values. Readiness remains an operational signal, not proof of the authenticated destination or country.

**IP validation accepts out-of-range IPv4 text:**
- Symptoms: `extractIp()` accepts four decimal groups without checking that each octet is in the range 0-255.
- Files: `packages/cli/src/proxy.ts`
- Trigger: A probe target returns a value such as four out-of-range numeric groups.
- Workaround: Use only the built-in probe services. Replace the regular expression with `net.isIP()` before using the response as readiness evidence.

## Security Considerations

**Public Git and wiki visibility:**
- Risk: The repository is public and GitHub Wiki is enabled. Every committed file is public, including dot-directories such as `.planning/`, a proposed `wiki/` directory, CI files, tests, and documentation. Deleting a file later does not remove it from existing commits, forks, caches, or clones. A wiki attached to a public repository is also public.
- Files: `.git/config`, `.gitignore`, `.planning/codebase/CONCERNS.md`, `.github/workflows/ci.yml`
- Current mitigation: `.gitignore` excludes `.env`, local worktrees, transfer files, dependency trees, build output, IDE directories, and `.DS_Store`. The current tracked-filename scan found no environment file, certificate, private key, package-auth file, or credential file; `packages/cli/test/credentials.test.ts` is test code, not a credential store.
- Recommendations: Keep private product notes in a separate private repository or an access-controlled documentation service. A local-only `wiki/` directory can be added to `.gitignore`, but it is hidden only while it remains untracked. Check `git status` and `git check-ignore -v wiki/<file>` before every commit. If private data is committed, rotate affected secrets first and then use a coordinated history purge; adding an ignore rule is not remediation.

**Secrets passed in command-line arguments:**
- Risk: `aluvia auth <key>` and `aluvia proxy-provider <url>` place API keys or proxy credentials in `process.argv`. Command arguments can enter shell history, agent transcripts, process inspection, terminal capture, and diagnostic logs even though JSON output correctly avoids echoing the key.
- Files: `packages/cli/src/cli.ts`, `packages/cli/src/auth.ts`, `packages/cli/src/proxy.ts`, `README.md`, `SECURITY.md`, `packages/cli/test/credentials.test.ts`
- Current mitigation: Stored credentials use `config.json` mode `0600`, the directory is created with mode `0700`, auth status omits secret values, and tests assert that auth output does not contain the key.
- Recommendations: Make device login the normal authentication path. For direct keys and BYO proxy URLs, accept data through an interactive hidden prompt, standard input, or a short-lived file descriptor. Deprecate positional secrets and warn users that old shell history can contain them.

**Plaintext local credential store:**
- Risk: API keys, device authorization data, install identity, and BYO proxy URLs with embedded usernames/passwords are stored as plaintext JSON. POSIX permissions do not protect against the same user, privileged processes, backups, VM snapshots, or platforms where `chmod` is only best-effort.
- Files: `packages/cli/src/config.ts`, `README.md`
- Current mitigation: `packages/cli/src/config.ts` creates the directory with mode `0700`, writes `config.json` and `install_id` with mode `0600`, and reapplies `0600` after writes.
- Recommendations: Document the plaintext threat model. Use the operating-system credential store when available, avoid persisting short-lived device codes after expiry, and add a supported command that clears all local credentials and provider secrets.

**Unauthenticated local data and control ports:**
- Risk: The data proxy and control server bind to loopback, but neither authenticates callers. Any process on the same host can use the proxy, consume account quota, observe coarse daemon state, change geo/egress, rotate the IP, alter attach state, or stop the daemon. Loopback is host-wide rather than user-specific on shared systems.
- Files: `packages/cli/src/net/proxy-server.ts`, `packages/cli/src/proxy-control-server.ts`, `packages/cli/src/proxy-daemon.ts`, `packages/cli/src/proxy-control-client.ts`
- Current mitigation: Both servers explicitly bind to `127.0.0.1`; the proxy bypasses loopback destinations; no service listens on all network interfaces.
- Recommendations: Generate a per-daemon control token in `proxy.json`, require it on mutating control requests, and configure local proxy authentication when shared-host use is possible. At minimum, document that the daemon assumes a single-user trusted host.

**Unbounded control request body:**
- Risk: `readJsonBody()` buffers every request chunk without a content-length or streaming size limit. A local process can force unnecessary memory consumption.
- Files: `packages/cli/src/proxy-control-server.ts`
- Current mitigation: The control server binds to `127.0.0.1` and is not remotely reachable through a normal network interface.
- Recommendations: Reject bodies above a small fixed limit, return HTTP 413, and destroy the request stream after the limit is crossed. The current endpoints need only tiny JSON payloads.

**Credential-bearing API endpoint override:**
- Risk: `ALUVIA_API_BASE_URL` can redirect authenticated API requests to an arbitrary URL, including plain HTTP, and `requestCore()` attaches the bearer key to that destination.
- Files: `packages/cli/src/auth.ts`, `packages/cli/src/net/aluvia-api.ts`, `packages/cli/src/net/request.ts`, `packages/cli/src/proxy-daemon.ts`
- Current mitigation: Production defaults use `https://api.aluvia.io`; the override requires control of the daemon environment.
- Recommendations: Require HTTPS for non-loopback overrides, label the variable as a development-only option, and require an explicit unsafe-development flag before sending credentials to another origin.

**CI supply-chain controls:**
- Risk: GitHub Actions use mutable major-version tags, and CI does not run dependency audit or secret scanning. A vulnerable dependency or accidentally committed secret can pass the current checks.
- Files: `.github/workflows/ci.yml`, `package-lock.json`, `SECURITY.md`
- Current mitigation: `npm ci` uses the committed lockfile, CI runs on pushes and pull requests to `main`, and the security policy tells contributors not to commit API keys.
- Recommendations: Pin actions by full commit SHA, enable dependency review and secret scanning, run a production dependency audit with a defined severity threshold, and protect `main` with required checks.

## Performance Bottlenecks

**Sequential multi-host tunnel probes:**
- Problem: A probe can wait up to five seconds per host. `probeSessionOnce()` checks probe hosts serially, and `probeUntilReady()` repeats the full pass up to three times with delays. Setup can repeat that sequence after rotating a dead saved session.
- Files: `packages/cli/src/proxy.ts`
- Cause: The implementation favors deterministic failover and same-session retry over latency.
- Improvement path: Use an overall deadline and race a small number of trusted probe hosts after the first failure. Preserve the rule that one failed echo host must not mark the tunnel dead.

**Unbounded response buffering in probes:**
- Problem: The readiness probe appends all response chunks before parsing the IP address.
- Files: `packages/cli/src/proxy.ts`
- Cause: `probeAluviaTunnel()` uses `Buffer.concat(chunks)` only after the remote endpoint closes the stream.
- Improvement path: Cap probe response bytes to a few kilobytes and stop reading after the first complete line or valid small JSON document.

## Fragile Areas

**Chrome attachment and policy mutation:**
- Files: `packages/cli/src/chrome-launch.ts`, `packages/cli/src/proxy-attach.ts`, `packages/cli/src/proxy.ts`, `packages/cli/test/chrome-launch.test.ts`, `packages/cli/test/proxy-attach.test.ts`, `packages/cli/test/proxy-policy-windows.test.ts`
- Why fragile: Setup can terminate Chrome, construct platform-specific shell commands, write managed-browser policy, and infer attachment from CONNECT timing. The behavior depends on OS paths, permissions, browser process state, and timing.
- Safe modification: Keep command construction pure, pass arguments directly to child-process APIs, use temporary policy directories in tests, and validate actual CONNECT evidence after any lifecycle change.
- Test coverage: CI runs only on Ubuntu. Three platform-dependent tests are skipped on the current host, and no Windows or macOS runner verifies real platform paths and process behavior.

**Daemon state spread across memory and files:**
- Files: `packages/cli/src/proxy-daemon.ts`, `packages/cli/src/proxy-state.ts`, `packages/cli/src/proxy.ts`, `packages/cli/src/config.ts`, `packages/cli/test/proxy-lifecycle.test.ts`, `packages/cli/test/proxy-state.test.ts`
- Why fragile: PID, ports, readiness, connection/session identity, rules, attach timestamps, and last CONNECT state cross `config.json`, `proxy.json`, in-memory state, and server responses. Stale or partial state changes command behavior.
- Safe modification: Define one versioned persisted-state schema, validate it on read, update state through one persistence boundary, and keep the stale PID/port and restart integration tests intact.
- Test coverage: Lifecycle coverage is broad, but there is no fault-injection test for truncated `config.json`, interrupted writes, disk-full behavior, or concurrent config writers.

**Direct-routing fallback:**
- Files: `packages/cli/src/net/config-manager.ts`, `packages/cli/src/net/proxy-server.ts`, `packages/cli/src/proxy-daemon.ts`, `packages/cli/test/net-config-manager.test.ts`
- Why fragile: `ConfigManager` supports non-strict operation that continues without configuration, and `ProxyServer` routes direct when configuration or a hostname is unavailable. This can silently violate a caller's location or privacy expectation if non-strict mode reaches production use.
- Safe modification: Use strict mode for Aluvia-backed operation, expose fallback state clearly in status, and fail closed when the requested egress must be Aluvia.
- Test coverage: Tests verify strict initialization failures and direct fallback behavior, but there is no end-to-end assertion that every production startup path selects strict mode.

## Scaling Limits

**Single local daemon and fixed default ports:**
- Current capacity: One daemon instance uses data port `18787` and control port `18788`, with a singleton-oriented lifecycle.
- Limit: Multiple users, browser profiles, isolated agents, or concurrent Aluvia sessions on one host contend for the same ports and shared state.
- Scaling path: Namespace state and ports by profile, support explicit instance IDs, and authenticate per-instance control and data traffic before supporting multi-tenant hosts.

**In-memory connection indexes:**
- Current capacity: Every active proxy connection is indexed in maps by host and connection ID.
- Limit: Capacity depends on the number and cleanup behavior of long-lived browser connections; no explicit connection or per-host bound is enforced by Aluvia code.
- Scaling path: Add metrics and upper bounds, confirm `connectionClosed` fires on all proxy-chain failure paths, and remove stale connection IDs defensively.

## Dependencies at Risk

**`ip-address` transitive production dependency:**
- Risk: The installed `ip-address@10.1.0` is covered by a high-severity SSRF/trust-boundary advisory and a moderate XSS advisory. `npm audit --omit=dev` reports one high-severity vulnerability with a fix available.
- Impact: `ip-address` arrives through `proxy-chain` -> `socks` and `socks-proxy-agent`. Exposure depends on whether those dependencies invoke the affected parsing or HTML methods, but the vulnerable code ships in the public CLI package.
- Migration plan: Update `proxy-chain` and the lockfile to a chain that resolves `ip-address` above the affected range. If upstream resolution is delayed, evaluate a lockfile override, run the full proxy suite, and keep `npm audit --omit=dev` in CI.
- Files: `packages/cli/package.json`, `package-lock.json`

**`proxy-chain` as a security-critical single dependency:**
- Risk: `proxy-chain` owns listener behavior, proxy authentication hooks, CONNECT handling, and connection lifecycle. The application depends on semver range `^2.6.1` while the lockfile controls the installed build.
- Impact: A regression can expose the listener, misroute traffic, leak upstream credentials, or break connection cleanup.
- Migration plan: Pin and review upgrades deliberately, verify bind-host and authentication behavior, run CONNECT and routing integration tests, and add a package-level threat model around upgrades.
- Files: `packages/cli/package.json`, `package-lock.json`, `packages/cli/src/net/proxy-server.ts`, `packages/cli/test/net-proxy-server.test.ts`, `packages/cli/test/proxy-route.test.ts`

## Missing Critical Features

**Private documentation boundary:**
- Problem: The public repository has no tracked mechanism that makes a committed folder private. `.gitignore` can keep a local folder untracked, but cannot hide a tracked folder or remove it from history. The repository's enabled GitHub Wiki is public with the repository.
- Blocks: Confidential product plans, internal runbooks, customer data, credentials, and private research cannot safely live in a committed `wiki/` or `.planning/` folder here.
- Files: `.gitignore`, `README.md`, `.planning/codebase/CONCERNS.md`

**Automated secret and package-content gates:**
- Problem: CI has no secret scanner, dependency review, production audit, or `npm pack` allowlist verification.
- Blocks: The project cannot automatically prevent common public-repository leaks or prove that a release contains only the intended `dist`, skill, README, and license files.
- Files: `.github/workflows/ci.yml`, `packages/cli/package.json`, `SECURITY.md`

**Credential revocation command:**
- Problem: `auth logout` is rejected as usage, and there is no documented command that clears all stored API keys, pending device data, install identity, connection identity, and BYO proxy credentials.
- Blocks: Users cannot reliably decommission a VM or revoke local CLI state through the supported CLI interface.
- Files: `packages/cli/src/auth.ts`, `packages/cli/src/config.ts`, `packages/cli/src/cli.ts`, `README.md`

## Test Coverage Gaps

**Native Windows and macOS behavior:**
- What's not tested: Real Chrome discovery, process termination/relaunch, quoting, policy paths, file permissions, and daemon lifecycle on Windows and macOS runners.
- Files: `.github/workflows/ci.yml`, `packages/cli/src/chrome-launch.ts`, `packages/cli/src/proxy-attach.ts`, `packages/cli/test/chrome-launch.test.ts`, `packages/cli/test/proxy-policy-windows.test.ts`
- Risk: Platform-specific installation or command injection regressions can pass the Ubuntu-only matrix. The current local run reports 172 passing and 3 skipped tests.
- Priority: High

**Control-plane abuse cases:**
- What's not tested: Authentication is absent by design, and tests do not cover oversized bodies, slow bodies, malformed URLs at scale, cross-origin browser attempts, or request-rate exhaustion.
- Files: `packages/cli/src/proxy-control-server.ts`, `packages/cli/test/proxy-control-server.test.ts`
- Risk: A local hostile process can consume memory or mutate daemon state without a regression test defining safe limits.
- Priority: High

**Credential exposure outside JSON output:**
- What's not tested: Shell history, process listings, detached child environments, crash reports, and debug-log redaction for positional keys and proxy URLs.
- Files: `packages/cli/src/cli.ts`, `packages/cli/src/auth.ts`, `packages/cli/src/proxy.ts`, `packages/cli/src/net/logger.ts`, `packages/cli/test/credentials.test.ts`
- Risk: The test “does not echo it” can pass while secrets remain visible through other operating-system and agent surfaces.
- Priority: High

**Configuration corruption and concurrency:**
- What's not tested: Partial `config.json` writes, concurrent writers, permission failures, disk-full errors, and recovery from valid JSON with invalid field types.
- Files: `packages/cli/src/config.ts`, `packages/cli/test/config-home.test.ts`, `packages/cli/test/credentials.test.ts`
- Risk: Credentials and persistent identity can be lost or replaced without a useful error.
- Priority: Medium

**Coverage thresholds:**
- What's not tested: There is no configured line, branch, or function coverage report or minimum threshold.
- Files: `packages/cli/package.json`, `.github/workflows/ci.yml`, `packages/cli/test/`
- Risk: The test count can remain high while newly added branches in the large orchestration modules remain unexecuted.
- Priority: Medium

---

*Concerns audit: 2026-08-30*
