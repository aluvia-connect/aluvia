# API internals

This is not a public library. Do not `npm install` a Node SDK.

The CLI talks to `https://api.aluvia.io/v1` from `packages/cli/src/net/aluvia-api.ts` for:

- `GET /account`
- `GET /account/usage`
- `GET /geos`

Connection create/get/patch for the daemon lives in `packages/cli/src/net/config-manager.ts`.

The product surface is the [CLI](../README.md).
