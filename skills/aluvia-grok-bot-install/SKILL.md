---
name: aluvia-grok-bot-install
description: Install Aluvia on a Grok Bot cloud computer and attach the on-screen Chrome. Use when the user points you at the aluvia repo or branch, says to install Aluvia, or asks to route the GUI browser through a mobile IP.
---

# Aluvia — Grok Bot

Do this on **your** computer (this Linux VM: your terminal, the Chrome on **this** `$DISPLAY`). Not the human's Mac.

Published `npm install -g @aluvia/cli` is the wrong package (no `proxy` verbs). Build this repo. Do not run `aluvia session *`. Do not launch a second Chrome. Never print the API key.

## What “installed” means

Chrome CONNECTs to `http://127.0.0.1:18787`. `aluvia proxy route <host>` then sends **that host** through Aluvia. Everything else stays on the VM IP. Same tab, same cookies.

Attach is a Chrome **managed policy** under `/etc/opt/chrome/policies/managed`. That is the only path that works here without a Chrome relaunch:

| Do | Do not |
|---|---|
| `sudo tee` `/etc/opt/chrome/policies/managed/aluvia-proxy.json` | Home-dir `~/.config/.../policies` (branded Chrome ignores it) |
| `chrome://policy` → Reload policies | `chrome://settings/system` (no host/port fields) |
| Start proxyd **before** writing `ProxyServer` | Load an unpacked Aluvia extension |
| After `route`/`unroute`: flush sockets, then a new tab | Trust F5 or a new tab alone |

`aluvia proxy setup` often cannot `sudo` (Auto-review blocks the child). **You** write the policy with `sudo -n tee`.

## 1. Home + CLI

```bash
if [ -d /workspace ]; then export ALUVIA_HOME=/workspace/.aluvia; else export ALUVIA_HOME="$HOME/.aluvia"; fi
mkdir -p "$ALUVIA_HOME"

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ ! -f "$ROOT/packages/cli/package.json" ]; then
  git clone --branch feat/grok-bot-proxy-setup --depth 1 https://github.com/aluvia-connect/aluvia.git "$HOME/aluvia"
  ROOT="$HOME/aluvia"
fi
cd "$ROOT"
git fetch --depth 1 origin feat/grok-bot-proxy-setup 2>/dev/null || true
git checkout feat/grok-bot-proxy-setup 2>/dev/null || true
git merge --ff-only origin/feat/grok-bot-proxy-setup 2>/dev/null || true

if [ ! -d node_modules ]; then npm ci; fi
npm run build:sdk && npm run build:cli
ALU="$ROOT/packages/cli/dist/esm/cli.js"
node "$ALU" help --json | grep -q 'proxy setup' || { echo "CLI missing proxy setup"; exit 1; }
```

If `npm ci` is blocked and `node_modules` is missing, stop. Do not `npm install -g` a tarball.

Use `node "$ALU"` for every `aluvia` command below.

## 2. Auth

```bash
node "$ALU" auth status
```

If not authenticated: `node "$ALU" auth`. The human approves on their laptop.

## 3. Start proxyd first

```bash
node "$ALU" proxy setup
node "$ALU" proxy status
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18788/status
```

`ready: false` / `needs_ui` is expected until step 4. If `18787`/`18788` are down, stop.

Do not write `ProxyServer` while proxyd is down — Chrome will fail every page.

## 4. Attach (policy)

```bash
sudo -n true || { echo "need passwordless sudo for /etc Chrome policy"; exit 1; }
sudo -n mkdir -p /etc/opt/chrome/policies/managed
sudo -n tee /etc/opt/chrome/policies/managed/aluvia-proxy.json <<'EOF'
{
  "ProxyMode": "fixed_servers",
  "ProxyServer": "127.0.0.1:18787",
  "ProxyBypassList": "localhost,127.0.0.1,::1,<local>",
  "QuicAllowed": false
}
EOF
sudo -n chmod 644 /etc/opt/chrome/policies/managed/aluvia-proxy.json
```

If the data port is not `18787`, put that port in `ProxyServer`.

Open `chrome://policy` → **Reload policies**. Require `ProxyMode=fixed_servers`, `ProxyServer=127.0.0.1:18787`, `QuicAllowed=false`. If they are missing, stop. Do not load an extension.

If an Aluvia unpacked extension is already loaded from an earlier run, remove it. Policy owns proxy.

Open a **new tab** to `https://example.com` (not F5).

```bash
curl -sS http://127.0.0.1:18788/last-connect
node "$ALU" proxy setup
```

Need a non-loopback `hostname` in last-connect, then `ready: true`. Prefer `method: policy`. If last-connect is still empty after the new tab, stop.

`last-connect` on **any** host only means some Chrome traffic hit `18787`. It is not proof the next hostname will.

## 5. Unblock (after install)

A screenshot is a **block** (Cloudflare, Access Denied, CAPTCHA, unusual traffic), not a login.

1. Hostname from the address bar. `www.example.com` is not `example.com`.
2. `node "$ALU" proxy status` — daemon down → step 3. Attach not verified → step 4.
3. `node "$ALU" proxy route <host>`
4. Open `chrome://net-internals/#sockets` → **Flush socket pools**. A new tab reuses the process-wide CONNECT/QUIC pool; F5 does too.
5. Open a **new tab** to that host.
6. `curl -sS http://127.0.0.1:18788/last-connect` — `hostname` must be the host you routed. If it is not, flush again and open another new tab. Do not claim the GUI flipped until this matches.
7. Parse CLI JSON. Exit 1 → stop and report `error`. Do not retry with `*`.

After `unroute`, flush sockets, then a new tab. Same last-connect check.

If a redirect lands on a new host that is still blocked, route that host too, then flush + new tab.

## Do not

- Do not load the unpacked Aluvia extension unless the human explicitly asks. Policy is the install.
- Do not use `chrome://settings/system` or `gsettings` / `HTTP_PROXY` to attach this Chrome.
- Do not kill or relaunch the harness Chrome. Do not create `/tmp/sand-egress-proxy` or edit `/usr/local/bin/box-chrome` unless the human asks.
- Do not invent MITM, PAC, nftables, or `https://aluvia.io/https://…`.
- Do not route a host where a login still works.
- Do not `route '*'`. There is no `--force`.
- Do not `rotate-ip` unless the human asks (that hops every routed host).
- Terminal `curl`/`node` do not use the GUI proxy. For a shell: `export https_proxy=http://127.0.0.1:18787 http_proxy=http://127.0.0.1:18787`, then `route` the host.
