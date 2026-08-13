---
name: aluvia-proxy
description: Install Aluvia, attach the GUI Chrome, and send a blocked hostname through a US mobile IP. Use when setting up Aluvia, or when a screenshot shows Cloudflare, Access Denied, CAPTCHA, or unusual traffic.
---

# Aluvia proxy

Local daemon on `127.0.0.1:18787`. Chrome sends all sites there. `aluvia proxy route <host>` sends **that host** through Aluvia. Everything else stays on the VM IP. Same tab, same cookies.

Do this on **this** computer (the Grok Bot VM). Do not run `aluvia session *`. Do not launch a second Chrome. Never print the API key.

## Install

```bash
npm install -g @aluvia/cli@1.2.0
# if global npm is blocked: npx -y @aluvia/cli@1.2.0
```

`aluvia help --json` must list `proxy setup`. If it does not, the CLI is too old — install `@aluvia/cli@1.2.0` again, do not clone this repo to compile.

```bash
if [ -d /workspace ]; then export ALUVIA_HOME=/workspace/.aluvia; fi
aluvia auth status
# if not authenticated: aluvia auth  (human approves on their laptop)
aluvia proxy setup
```

`setup` starts proxyd and writes this skill to `~/.agents/skills/aluvia-proxy` (and `/workspace/.agents/skills` when that tree exists).

## Attach Chrome

Start proxyd **before** writing `ProxyServer`, or Chrome cannot load pages.

`setup` cannot sudo from Node. Write the policy yourself:

```bash
sudo -n mkdir -p /etc/opt/chrome/policies/managed
sudo -n tee /etc/opt/chrome/policies/managed/aluvia-proxy.json <<'EOF'
{
  "ProxyMode": "fixed_servers",
  "ProxyServer": "127.0.0.1:18787",
  "ProxyBypassList": "localhost,127.0.0.1,::1,<local>",
  "QuicAllowed": false
}
EOF
```

If the data port is not `18787`, put that port in `ProxyServer`.

`chrome://policy` → Reload policies. Require `ProxyMode`, `ProxyServer`, `QuicAllowed=false`. Then a **new tab** to a site. `curl -sS http://127.0.0.1:18788/last-connect` must show a non-loopback hostname. Run `aluvia proxy setup` again until `ready: true`.

Do not load an unpacked extension. Do not use `chrome://settings/system` (no host/port fields). Home-dir Chrome policy is ignored. Remove a leftover Aluvia extension so policy owns proxy.

## Identify a block

A screenshot is a **block** only if it is Cloudflare, Access Denied, CAPTCHA, or unusual traffic. A normal login is not a block. Do not route a host where a login still works.

Read the hostname from the address bar. `www.example.com` is not `example.com`.

## Route

```bash
aluvia proxy status          # daemon down → setup again
aluvia proxy route <host>
```

Then `chrome://net-internals/#sockets` → **Flush socket pools**, then a **new tab** to that host. F5 and a new tab alone reuse the process-wide CONNECT/QUIC pool.

```bash
curl -sS http://127.0.0.1:18788/last-connect
```

`hostname` must be the host you routed before you trust the page IP. If it is not, flush again and open another new tab.

Parse CLI JSON. Exit 1 → stop and report `error`. Do not `route '*'`. After `unroute`, flush, then a new tab.

If a redirect lands on a new host that is still blocked, route that host too, then flush + new tab.

Terminal `curl`/`node` do not use the GUI proxy. For a shell: `export https_proxy=http://127.0.0.1:18787 http_proxy=http://127.0.0.1:18787`, then `route` the host.

Do not `rotate-ip` unless the human asks. Do not invent MITM, PAC, nftables, or `https://aluvia.io/https://…`. Do not kill the harness Chrome.
