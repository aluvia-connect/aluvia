# Client internals

This is not a public library. There is no published Node client.

The agent product is the [CLI](../README.md) (`aluvia setup --url`, `status`, `proxy-on`). Local proxy internals live in `packages/cli/src/net/` (`config-manager.ts`, `proxy-server.ts`).
