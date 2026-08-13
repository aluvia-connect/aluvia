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
if [ -d /workspace ]; then export ALUVIA_HOME=/workspace/.aluvia; fi
ROOT="${HOME}/aluvia"
if [ ! -d "$ROOT/.git" ]; then
  git clone --branch feat/grok-bot-proxy-setup --depth 1 https://github.com/aluvia-connect/aluvia.git "$ROOT"
fi
cd "$ROOT" && git fetch origin feat/grok-bot-proxy-setup && git checkout feat/grok-bot-proxy-setup && git merge --ff-only origin/feat/grok-bot-proxy-setup
if [ ! -d node_modules ]; then npm ci; fi
npm run build:sdk && npm run build:cli
ALU="$ROOT/packages/cli/dist/esm/cli.js"
```

Use `node "$ALU"` if `aluvia` is not on PATH. `help --json` must list `proxy setup`.

```bash
aluvia auth status          # else: aluvia auth  (human approves on their laptop)
aluvia proxy setup          # starts proxyd; writes this skill to ~/.agents/skills
```

## Attach Chrome

`setup` cannot sudo from Node. Write policy yourself, then reload policies:

```bash
sudo -n tee /etc/opt/chrome/policies/managed/aluvia-proxy.json <<'EOF'
{
  "ProxySettings": {
    "ProxyMode": "fixed_servers",
    "ProxyServer": "127.0.0.1:18787",
    "ProxyBypassList": "localhost,127.0.0.1,::1,<local>"
  },
  "QuicAllowed": false
}
EOF
```

`chrome://policy` → Reload policies. Confirm `ProxySettings` and `QuicAllowed=false`. Open a new tab. `curl -sS http://127.0.0.1:18788/last-connect` must show a hostname. Run `setup` again until `ready: true`.

`QuicAllowed` needs **one Chrome restart** (dock / same profile) or HTTP/3 can skip the proxy. Do that at setup, not mid-task.

Do not load an unpacked extension. Do not use `chrome://settings/system`.

## Identify a block

Cloudflare, Access Denied, CAPTCHA, or unusual traffic. Not a login. Do not route a host where a login still works. Use the address-bar hostname (`www.example.com` ≠ `example.com`).

## Route

```bash
aluvia proxy route <host>
```

Then reload the tab (or a new tab to the same host). `route` drops that host's live CONNECT tunnels; you do not need `chrome://net-internals`.

If last-connect is not that host after reload, open one new tab. Exit 1 → stop. Do not `route '*'`. After `unroute`, reload again.

Do not `rotate-ip` unless asked. Do not invent MITM, PAC, nftables, or a hosted rewrite.
