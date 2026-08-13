---
name: aluvia
description: Install Aluvia, attach the GUI Chrome, and send a blocked hostname through a US mobile IP. Use when setting up Aluvia, or when a screenshot shows Cloudflare, Access Denied, CAPTCHA, or unusual traffic.
---

# Aluvia

Local daemon on `127.0.0.1:18787`. `aluvia route <host>` sends that host through Aluvia. Everything else stays on the VM IP. Same tab, same cookies.

Do this on **this** computer. Do not run `aluvia session *`. Do not launch a second Chrome. Never print the API key.

## Install

```bash
npm i -g aluvia-cli
aluvia setup                # trial via install id; no human
# if {"code":"payment_required"}: tell the human to run `aluvia auth`
#    (they open the printed link, sign up, buy data) OR `aluvia upstream <url>`
```

If `aluvia` is already on PATH (you just ran `npx aluvia-cli setup`), still run `npm i -g aluvia-cli` so later commands do not need npx. Skip setup if stdout already has `ready: true`. Home is `/workspace/.aluvia` when `/workspace` exists, else `~/.aluvia`.

## Attach Chrome

Read the setup JSON. Branch on it:

- `ready: true` → done. Do not rewrite policy.
- `policyCommand` is set → run that exact command in your shell (not as a Node child), then continue below.
- otherwise continue below.

Then:

1. `chrome://policy` → Reload policies.
2. If `QuicAllowed` says **Restart required**, quit the on-screen Chrome and open it again from the dock (same profile). Skip the restart if Status is OK.
3. Open one new tab to any site.
4. `aluvia setup` again until `ready: true`.

Do not load an unpacked extension. Do not use `chrome://settings/system`.

## Identify a block

Cloudflare, Access Denied, CAPTCHA, or unusual traffic. Not a login. Do not route a host where a login still works. Use the address-bar hostname (`www.example.com` ≠ `example.com`).

## Route

```bash
aluvia route <host>
```

Then reload that tab. `route` drops that host's live CONNECT tunnels.

Exit 1 → stop. Do not `route '*'`. After `unroute`, reload again.

Do not `rotate-ip` unless asked. Do not invent MITM, PAC, nftables, or a hosted rewrite.
