---
name: aluvia-proxy
description: Install Aluvia, attach the GUI Chrome, and send a blocked hostname through a US mobile IP. Use when setting up Aluvia, or when a screenshot shows Cloudflare, Access Denied, CAPTCHA, or unusual traffic.
---

# Aluvia proxy

Local daemon on `127.0.0.1:18787`. `aluvia proxy route <host>` sends that host through Aluvia. Everything else stays on the VM IP. Same tab, same cookies.

Do this on **this** computer. Do not run `aluvia session *`. Do not launch a second Chrome. Never print the API key.

## Install

Published `@aluvia/cli` may still be old. On this VM, build the branch:

```bash
ROOT="${HOME}/aluvia"
if [ ! -d "$ROOT/.git" ]; then
  git clone --branch feat/grok-bot-proxy-setup --depth 1 https://github.com/aluvia-connect/aluvia.git "$ROOT"
fi
cd "$ROOT" && git fetch origin feat/grok-bot-proxy-setup && git checkout feat/grok-bot-proxy-setup && git merge --ff-only origin/feat/grok-bot-proxy-setup
if [ ! -d node_modules ]; then npm ci; fi
npm run build:sdk && npm run build:cli
ALU="$ROOT/packages/cli/dist/esm/cli.js"
```

Use `node "$ALU"` if `aluvia` is not on PATH. `help --json` must list `proxy setup`. Home is `/workspace/.aluvia` when `/workspace` exists, else `~/.aluvia`. Do not export `ALUVIA_HOME` unless you need a different directory.

```bash
aluvia auth status          # else: aluvia auth  (human approves on their laptop)
aluvia proxy setup
```

## Attach Chrome

Read the setup JSON. Branch on it:

- `ready: true` → done. Do not rewrite policy.
- `policyCommand` is set → run that exact command in your shell (not as a Node child), then continue below.
- otherwise continue below.

Then:

1. `chrome://policy` → Reload policies.
2. If `QuicAllowed` says **Restart required**, quit the on-screen Chrome and open it again from the dock (same profile). Skip the restart if Status is OK.
3. Open one new tab to any site.
4. `aluvia proxy setup` again until `ready: true`.

Do not load an unpacked extension. Do not use `chrome://settings/system`.

## Identify a block

Cloudflare, Access Denied, CAPTCHA, or unusual traffic. Not a login. Do not route a host where a login still works. Use the address-bar hostname (`www.example.com` ≠ `example.com`).

## Route

```bash
aluvia proxy route <host>
```

Then reload that tab. `route` drops that host's live CONNECT tunnels.

Exit 1 → stop. Do not `route '*'`. After `unroute`, reload again.

Do not `rotate-ip` unless asked. Do not invent MITM, PAC, nftables, or a hosted rewrite.
