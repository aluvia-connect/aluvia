# Testing Patterns

**Analysis Date:** 2026-08-30

## Test Framework

**Runner:**
- Node.js built-in `node:test`, run through the `tsx` loader; the command is defined in `packages/cli/package.json`.
- Config: no separate test configuration file. `packages/cli/package.json` supplies `node --import tsx --test test/*.test.ts`.
- CI runs the suite on Node.js 18, 20, and 22 in `.github/workflows/ci.yml`.

**Assertion Library:**
- Node.js built-in `node:assert`, normally imported as `assert`, as in `packages/cli/test/net-errors.test.ts` and `packages/cli/test/proxy-state.test.ts`.

**Run Commands:**
```bash
npm test                                               # Run all tests from the repository root
npm test -w aluvia-cli                                 # Run the package suite directly
node --import tsx --test packages/cli/test/net-rules.test.ts  # Run one test file
```

The root aliases are defined in `package.json`; the package command is defined in `packages/cli/package.json`. No watch or coverage script is configured.

## Test File Organization

**Location:**
- Keep tests in the separate `packages/cli/test/` tree, parallel to production modules in `packages/cli/src/`.
- Put shared network, port, and API support in `packages/cli/test/helpers/`, including `packages/cli/test/helpers/mock-aluvia-api.ts`, `packages/cli/test/helpers/mock-gateway.ts`, and `packages/cli/test/helpers/ports.ts`.
- Import source directly from `packages/cli/src/` through `tsx`; do not test generated files in `packages/cli/dist/`. This rule is documented in `CONTRIBUTING.md` and `CLAUDE.md`.

**Naming:**
- Use `<behavior-or-module>.test.ts`, such as `packages/cli/test/net-request.test.ts`, `packages/cli/test/proxy-lifecycle.test.ts`, and `packages/cli/test/proxy-policy-windows.test.ts`.
- Use `mock-<service>.ts` for reusable fake servers and descriptive utility names for helpers, as in `packages/cli/test/helpers/mock-aluvia-api.ts` and `packages/cli/test/helpers/connect-via-proxy.ts`.

**Structure:**
```text
packages/cli/
├── src/
│   ├── proxy-state.ts
│   └── net/request.ts
└── test/
    ├── proxy-state.test.ts
    ├── net-request.test.ts
    └── helpers/
        ├── mock-aluvia-api.ts
        ├── mock-gateway.ts
        └── ports.ts
```

The repository has 22 top-level `*.test.ts` files and four TypeScript helper files under `packages/cli/test/helpers/`.

## Test Structure

**Suite Organization:**
```typescript
import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert';

describe('requestCore', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('requestCore sends If-None-Match when provided', async () => {
    const result = await requestCore(options);
    assert.strictEqual(result.status, 200);
  });
});
```

This is the pattern used in `packages/cli/test/net-request.test.ts`: import hooks and assertions, group by exported behavior with `describe()`, and give each `test()` a behavior statement.

**Patterns:**
- Use `beforeEach()` to create isolated state and `afterEach()` to restore globals, environment variables, servers, processes, and temporary directories. See `packages/cli/test/proxy-state.test.ts` and `packages/cli/test/proxy-control-server.test.ts`.
- Keep setup local to the suite. For large lifecycle suites, group related scenarios with nested `describe()` blocks, as in `packages/cli/test/proxy-attach.test.ts`.
- Prefer observable outcomes: assert response status and body in `packages/cli/test/proxy-control-server.test.ts`, persisted state in `packages/cli/test/proxy-state.test.ts`, and recorded HTTP requests in `packages/cli/test/net-config-manager.test.ts`.
- Use `assert.strictEqual()` for scalars, `assert.deepStrictEqual()` for records and arrays, `assert.ok()` for predicates, and `assert.rejects()` for asynchronous errors, as shown in `packages/cli/test/net-errors.test.ts`, `packages/cli/test/proxy-state.test.ts`, and `packages/cli/test/net-request.test.ts`.
- Make platform-only cases explicit with test skips. Windows-specific cases in `packages/cli/test/chrome-launch.test.ts` and `packages/cli/test/proxy-policy-windows.test.ts` skip on non-Windows hosts.

## Mocking

**Framework:** No mocking library. Use dependency injection, temporary replacement of platform globals, local HTTP/TLS servers, and command-process harnesses in `packages/cli/test/`.

**Patterns:**
```typescript
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('returns the response status', async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ data: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;

  const result = await requestCore(options);
  assert.strictEqual(result.status, 200);
});
```

This replacement-and-restore pattern comes from `packages/cli/test/net-request.test.ts` and `packages/cli/test/net-config-manager.test.ts`.

**What to Mock:**
- Replace `globalThis.fetch` for focused request, response-envelope, timeout, and polling tests in `packages/cli/test/net-request.test.ts` and `packages/cli/test/net-config-manager.test.ts`.
- Use `createMockAluviaApi()` from `packages/cli/test/helpers/mock-aluvia-api.ts` when a test needs stateful POST, GET, PATCH, ETag, or payment responses.
- Use `createMockGateway()` from `packages/cli/test/helpers/mock-gateway.ts` when a test needs real proxy CONNECT behavior without external network access.
- Use temporary environment values and restore the originals, as in `packages/cli/test/config-home.test.ts` and `packages/cli/test/proxy-state.test.ts`.
- Use `captureOutput()` from `packages/cli/src/output-capture.ts` when testing CLI handlers in-process without allowing `process.exit()`.

**What NOT to Mock:**
- Do not mock pure domain logic. Call functions directly in tests such as `packages/cli/test/net-rules.test.ts`, `packages/cli/test/loopback.test.ts`, and `packages/cli/test/proxy-state.test.ts`.
- Do not replace local socket behavior with call-count-only mocks when routing behavior matters. Use real ephemeral loopback servers in `packages/cli/test/net-proxy-server.test.ts`, `packages/cli/test/proxy-control-server.test.ts`, and `packages/cli/test/proxy-route.test.ts`.
- Do not call live Aluvia or third-party endpoints from the suite; keep HTTP behavior inside the local fixtures under `packages/cli/test/helpers/`.

## Fixtures and Factories

**Test Data:**
```typescript
const api = await createMockAluviaApi({
  id: 3449,
  session_id: null,
  target_geo: null,
  rules: ['*'],
});

try {
  // Exercise code against api.url and inspect api.state or api.requests.
} finally {
  await api.close();
}
```

`createMockAluviaApi()` in `packages/cli/test/helpers/mock-aluvia-api.ts` accepts a `Partial<MockConnection>`, exposes mutable state and recorded requests, and returns an asynchronous `close()` function.

**Location:**
- Store reusable service and transport fixtures in `packages/cli/test/helpers/`.
- Keep small object fixtures inline when they belong to one behavior, such as the `ProxyJson` value in `packages/cli/test/proxy-state.test.ts` and handler overrides in `packages/cli/test/proxy-control-server.test.ts`.
- Allocate ports through the operating system or through `findFreePort()` in `packages/cli/test/helpers/ports.ts`; do not hard-code test-only listener ports.
- Create temporary homes with `fs.mkdtempSync()` under `os.tmpdir()` and remove them in teardown, as in `packages/cli/test/proxy-state.test.ts` and `packages/cli/test/config-home.test.ts`.

## Coverage

**Requirements:** No coverage threshold or coverage provider is configured in `package.json`, `packages/cli/package.json`, or `.github/workflows/ci.yml`.

**View Coverage:**
```bash
# Not configured. Add a supported Node.js coverage command and CI threshold before relying on a report.
```

Behavioral coverage is enforced through contributor guidance in `CONTRIBUTING.md`: add or update tests for each feature or bug fix. The current CI gate in `.github/workflows/ci.yml` checks formatting, compilation, and test success, not line or branch percentages.

## Test Types

**Unit Tests:**
- Test pure matching, normalization, and error behavior directly in `packages/cli/test/net-rules.test.ts`, `packages/cli/test/loopback.test.ts`, `packages/cli/test/net-errors.test.ts`, and `packages/cli/test/proxy-state.test.ts`.
- Test HTTP request construction with a replaced `fetch` in `packages/cli/test/net-request.test.ts` and `packages/cli/test/request-auth.test.ts`.
- Validate shipped static artifacts directly, including YAML frontmatter uniqueness and required skill guidance in `packages/cli/test/proxy-skill.test.ts`.

**Integration Tests:**
- Test local control HTTP routes against a real ephemeral server in `packages/cli/test/proxy-control-server.test.ts`.
- Test proxy routing, CONNECT handling, and state changes with local API and gateway fixtures in `packages/cli/test/net-proxy-server.test.ts`, `packages/cli/test/proxy-route.test.ts`, and `packages/cli/test/proxy-probe.test.ts`.
- Test daemon and CLI process behavior, persisted files, stale process state, and fixed ports in `packages/cli/test/proxy-lifecycle.test.ts` and `packages/cli/test/proxy-attach.test.ts`.

**E2E Tests:**
- No external-browser or deployed-service E2E framework is used. `packages/cli/test/proxy-attach.test.ts` and `packages/cli/test/proxy-lifecycle.test.ts` provide local system-level coverage with spawned CLI processes and loopback fixtures.

## Common Patterns

**Async Testing:**
```typescript
test('handler PaymentRequiredError becomes 402', async () => {
  server = createControlServer(handlers);
  const port = await listen(server);
  const response = await fetch(`http://127.0.0.1:${port}/rotate-ip`, { method: 'POST' });
  assert.strictEqual(response.status, 402);
});
```

Use an `async` test callback, await every operation, and close the server in `afterEach()` or `finally`. This pattern is used in `packages/cli/test/proxy-control-server.test.ts` and the helpers in `packages/cli/test/helpers/`.

**Error Testing:**
```typescript
await assert.rejects(
  () => manager.init(),
  (error: unknown) => error instanceof ApiError && error.statusCode === 500,
);
```

Use `assert.rejects()` with an error class or a narrowing predicate for asynchronous failures, following `packages/cli/test/net-config-manager.test.ts` and `packages/cli/test/net-request.test.ts`. For synchronous domain errors, instantiate or invoke directly and assert the error name, status, and metadata as in `packages/cli/test/net-errors.test.ts`.

## Verification Baseline

- `npm run lint` passes against all source and test files through the scripts in `package.json` and `packages/cli/package.json`.
- `npm test` reports 176 tests: 173 pass, 3 platform-specific tests are skipped, and 0 fail. The executed command is the root script from `package.json`.
- Keep the CI order from `.github/workflows/ci.yml`: lint, build, then tests across the supported Node.js matrix.

---

*Testing analysis: 2026-08-30*
