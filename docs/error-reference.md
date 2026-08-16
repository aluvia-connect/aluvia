# Errors

This is not a public library. Agents should follow CLI JSON (`error`, `code`, `claim_url`, `next`), not import error classes.

The product is the [CLI](../README.md). HTTP 402 is `payment_required` with the same `claim_url` as `aluvia auth login` (`/cli-auth?cli_code=...`).
