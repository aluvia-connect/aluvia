---
name: aluvia-grok-bot-install
description: Install Aluvia mobile egress on a Grok Bot cloud computer and attach the on-screen Chrome. Use when setting up Aluvia on Grok Bot, or when the user says to install Aluvia.
---

# Aluvia — Grok Bot install

Do this on **your** computer (the Grok Bot VM: your terminal, your on-screen Chrome). Not the human's Mac. Do not launch a second Chrome. Do not run `aluvia session *`.

## 1. Home

```bash
if [ -d /workspace ]; then export ALUVIA_HOME=/workspace/.aluvia; else export ALUVIA_HOME="$HOME/.aluvia"; fi
mkdir -p "$ALUVIA_HOME"
```

Need Node 18+ (`node -v`).

## 2. CLI

```bash
npm install -g @aluvia/cli
aluvia help --json
```

You must see `proxy setup`, `proxy attach`, `proxy route <host>`. If those are missing, the npm package is old — install this repo branch instead:

```bash
git clone --branch feat/grok-bot-proxy-setup --depth 1 https://github.com/aluvia-connect/aluvia.git "$HOME/aluvia"
cd "$HOME/aluvia" && npm ci && npm run build:sdk && npm run build:cli
# invoke as:
node "$HOME/aluvia/packages/cli/dist/esm/cli.js"
```

If git cannot reach GitHub but you can read the human's Mac, copy `/Users/blue/aluvia` to `$HOME/aluvia` and run the same `npm ci` + build. Never `npm install -g` a tarball unless asked.

Use whichever binary has `proxy setup` for every command below (`aluvia` or `node …/cli.js`).

## 3. Auth

```bash
aluvia auth status
```

If not authenticated: `aluvia auth`. The human approves the link on their laptop. Never print the API key.

## 4. Setup

```bash
aluvia proxy setup
```

Parse the JSON.

- `ready: true` → done. Do not change Chrome proxy settings again.
- `ready: false` / `status: needs_ui` → follow `instructions`:
  1. If `policyPath` is set: open `chrome://policy` → Reload policies.
  2. Else: `chrome://extensions` → Developer mode → Load unpacked → `extensionPath`.
  3. Open a **new tab** to a non-localhost site (not F5).
  4. Run `aluvia proxy setup` again.

If still not ready and Chrome is still direct: stop. Do not invent MITM, PAC, nftables, `--proxy-server` relaunch, or `https://aluvia.io/https://…`.

`aluvia proxy status` + `curl -sS http://127.0.0.1:18788/last-connect` — a non-loopback `hostname` with a recent `at` means Chrome is on the proxy even if `attach.status` looks stale.

## 5. Unblock (after setup)

A screenshot is a **block** (Cloudflare, Access Denied, CAPTCHA, unusual traffic), not a login.

1. Hostname from the address bar. `www.example.com` is not `example.com`.
2. `aluvia proxy route <host>`
3. Open a **new tab** to that host (or close the tab and reopen). Do **not** trust F5 — Chrome reuses CONNECT tunnels and the old IP will stick.
4. Parse CLI JSON. Exit 1 → stop and report `error`.

After `unroute`, same rule: new tab, not F5.

Do not route a host where a login still works. Do not `route '*'`. Do not `rotate-ip` unless the human asks.
