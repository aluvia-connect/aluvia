# Architecture

This is not a public library. The product is [`aluvia-cli`](../README.md) (`aluvia setup --url`, `status`, `proxy-on`).

The CLI does two jobs:

1. HTTP to `api.aluvia.io` (`packages/cli/src/net/aluvia-api.ts`, `request.ts`) for `account`, `usage`, `geos`, and auth.
2. A long-lived local proxy on `127.0.0.1:18787` (`proxy-daemon.ts` composes `ConfigManager` + `ProxyServer`).

See the [repository README](../README.md) and [CLAUDE.md](../CLAUDE.md).
