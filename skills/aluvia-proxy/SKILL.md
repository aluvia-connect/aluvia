---
name: aluvia-proxy
description: Use when a computer-use screenshot shows a block page, Cloudflare interstitial, Access Denied, CAPTCHA, or unusual-traffic warning in a GUI browser, or when setting up Aluvia egress on an agent VM.
---

# Aluvia proxy (computer-use VM)

Opt-in mobile egress in front of the browser that is already on screen. Same tab, same origin, same cookies. Route only the hostname that is blocked.

## Setup (once per VM)

On **Grok Bot**, follow `skills/aluvia-grok-bot-install/SKILL.md` in this repo (policy under `/etc/opt/chrome/policies/managed`, not an extension).

Elsewhere:

1. `npm install -g @aluvia/cli` (or `npx aluvia`). If `aluvia proxy setup` is missing, build this repo — the published package may be old.
2. `aluvia auth` (device flow; human approves on their laptop). Never print the API key.
3. If `$HOME` is not durable, `export ALUVIA_HOME=/workspace/.aluvia`.
4. `aluvia proxy setup` once (starts the daemon and attaches). One daemon per machine; every agent shares it.
   - `ready: true` → do not change Chrome proxy settings again.
   - `needs_ui` → follow `instructions`. Prefer `/etc` Chrome policy. Home-dir policy is ignored on branded Linux Chrome. Do not load the unpacked extension unless asked.
   - If attach stays `unverified` / `needs_ui` and the browser is still not on the proxy, stop. Do not invent MITM, PAC, nftables, or `https://aluvia.io/https://…`. Do not launch a second Chrome.

`aluvia proxy start` + `aluvia proxy attach` is the same work split into two commands.

## Unblock

A screenshot is a **block** (Cloudflare, Access Denied, CAPTCHA, unusual traffic), not a normal login.

1. Read the hostname from the address bar. `www.example.com` is not `example.com` — route what the bar shows.
2. `aluvia proxy status`. Daemon down → `setup` (or `start`). Attach `unverified` → `attach` / `setup`. `needs_ui` and still direct → stop and say so.
3. `aluvia proxy route <host>`. Then `chrome://net-internals/#sockets` → Flush socket pools, then a **new tab** to that host. F5 and a new tab alone reuse the process-wide CONNECT/QUIC pool.
4. `curl -sS http://127.0.0.1:18788/last-connect` — `hostname` must be the host you routed before you trust the page IP.
5. Parse the CLI JSON. Exit 1 → stop and report `error`. Do not retry with `*`.

If a redirect lands on a new host that is still blocked, route that host too, then flush + new tab again.

## Do not

- Do not route a host where a login still works (Gmail, Slack, Salesforce, or any session that is already fine).
- Do not `aluvia proxy route '*'`. There is no `--force`.
- Do not `aluvia proxy rotate-ip` unless the human explicitly asks. A block after route + flush + new tab is not a reason to hop IP (that hops every routed host on the shared browser).
- Do not open a hosted rewrite URL. Do not start `aluvia session *` for this job.
- Chrome on Linux ignores `HTTP_PROXY`. Terminal `curl`/`node` do not use the GUI proxy. For a shell: `export https_proxy=http://127.0.0.1:18787 http_proxy=http://127.0.0.1:18787`, then `aluvia proxy route <host>`.

## Last-resort attach (human takeover only)

Only if `/etc` Chrome policy cannot be written and the human asks: unpacked extension at `extensionPath`, or a setup-only `--proxy-server=127.0.0.1:18787` relaunch. Never kill the harness Chrome as the default. `chrome://settings/system` has no host/port fields on branded Linux Chrome.
