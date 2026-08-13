# Agent-VM proxy surface

Date: 2026-08-13  
Status: approved design (awaiting implementation plan)

Aluvia becomes opt-in mobile egress for a computer-use VM. The agent browses on the datacenter IP. When a screenshot shows a block, it routes **that hostname** through Aluvia and reloads. Signed-in Gmail / Slack / Salesforce stay direct. Same tab, same origin, same cookies, different egress IP.

This spec is the agent-VM surface: `proxyd`, CLI tools, sticky IP, durable state, safety rails, setup-time attach, and a computer-use skill. It is not a Playwright rewrite and not “Aluvia for Grok Bot.”

---

## 1. Goals

- A model or human can: `auth` → `proxy start` → `proxy route example.com` → traffic for that host through a mobile IP; everything else direct.
- `route` / `unroute` / `rotate-ip` / `set-geo` take effect **before** the CLI prints JSON. No 5s ETag race.
- Catch-all `*` is impossible through this surface. Loopback never goes upstream.
- One sticky upstream `session_id` per daemon lifetime unless the caller asks to rotate.
- A computer-use skill is the unblock trigger: vision of a block → route that host → reload.
- Setup-time `proxy attach` points the already-running GUI browser at the local proxy. Mid-task attach is forbidden.

## 2. Non-goals

- Hosted rewrite (`aluvia.io/https://target.com`) or a remote-browser stream.
- Proxy-layer block detection (no status inside CONNECT; no DOM).
- Auto-rotation, default `*` rules, PAC-as-rules-engine, MITM, nftables, `/etc` Chrome policy.
- New MCP tools. MCP may wrap the same CLI later; not in this slice.
- Changing `aluvia session *` (Playwright product stays).
- Gutting `BlockDetection`, `connect()`, or `startPlaywright`.
- Claiming Grok Bot GUI attach works before a real Agent Computer shows `CONNECT` from the on-screen Chrome.
- Transparent proxy or per-hostname sticky IPs (the API is one `session_id` per connection).

---

## 3. Locked decisions

| Topic | Decision |
|---|---|
| Product | Agent-VM egress, not a launched browser |
| CLI noun | `aluvia proxy <verb>` |
| Home | `ALUVIA_HOME`, default `~/.aluvia` (auth + daemon together) |
| Catch-all | Hard refuse `*` |
| Loopback | Always direct, in `ProxyServer`, for every caller |
| Control plane | Detached proxyd + loopback HTTP |
| Data port | `127.0.0.1:18787` |
| Control port | `127.0.0.1:18788` |
| Sticky IP | Set on first start if `session_id` is null; change only via `rotate-ip` |
| Skill | In-repo computer-use skill; model-driven unblock |
| Attach | `aluvia proxy attach`; gsettings first, then unpacked `chrome.proxy` extension |
| MCP | No new tools |
| Playwright CLI | Unchanged |

---

## 4. Architecture

Two processes, two loopback ports, one home directory, one skill file.

```
screenshot (block?) ──▶ skill ──▶ aluvia proxy route <host>
                                      │
aluvia proxy * ──────────────▶ $ALUVIA_HOME/proxy.json
                                      │
                                   proxyd
                          ┌───────────┴───────────┐
                          │ 127.0.0.1:18787 data  │  existing ProxyServer
                          │ 127.0.0.1:18788 ctrl  │  new JSON control API
                          └───────────┬───────────┘
                                      ▼
                     rule match ──▶ gateway.aluvia.io (sticky session_id)
                     else / loopback ──▶ origin direct
```

`aluvia proxy start` spawns a detached child the same way `session start` does. The child is `AluviaClient` with `startPlaywright: false` and a **fixed** data port. The parent polls `$ALUVIA_HOME/proxy.json` until `ready: true` or the child dies.

**One daemon per `ALUVIA_HOME`.** A live pid makes `start` fail. A stale pid is replaced. `stop` clears pid/ready and keeps `connectionId`, sticky `session_id`, rules, and attach so the next start resumes the same IP and rules.

`session_id` is server-side on the connection (PATCH `/account/connections/:id`). `ProxyServer` only embeds gateway username/password. Sticky-by-default is new **behavior**, not a new protocol.

The existing `session set-rules` path PATCHes the API from the CLI process; the Playwright daemon sees it on the next ETag poll (default 5s). That race is why proxy-mode verbs must call into the running daemon, where `ConfigManager.setConfig` already updates in-memory config from the PATCH response.

---

## 5. Components

### 5.1 `ProxyServer` — loopback bypass

In `handleRequest`, before rule matching, if the hostname is `localhost`, `127.0.0.1`, `::1`, or IPv4-mapped `::ffff:127.0.0.1`, return `undefined` (direct). Case-insensitive. Applies to every Aluvia user, including Playwright sessions.

No other routing change. `*.local` is not excluded in this slice.

### 5.2 `proxyd`

New detached daemon in `@aluvia/cli`.

- `new AluviaClient({ apiKey, startPlaywright: false, localPort: dataPort, connectionId? })`
- Internal flag: `--proxy-daemon` (do not reuse `--daemon`).
- Reuse `connectionId` from `proxy.json` when present; otherwise `POST /account/connections`.
- After `init()`, if `sessionId` is null, `setConfig({ session_id })` with `crypto.randomUUID().replace(/-/g, '')` (same format as `session rotate-ip`).
- If rules contain a catch-all `*` token, strip every `*` entry, PATCH, continue. Start does not fail.
- Bind data `127.0.0.1:18787` and control `127.0.0.1:18788`. Override with `--port` / `--control-port` or `ALUVIA_PROXY_PORT` / `ALUVIA_PROXY_CONTROL_PORT`. If the requested port is in use by something else, **fail**. Do not pick a random free port; attach needs a stable address.
- Log to `$ALUVIA_HOME/proxy.log`.
- After every successful config change (`route`, `unroute`, `rotate-ip`, `set-geo`, sticky-id set, `*` strip), rewrite `proxy.json` atomically so a reader of the file matches in-memory state.
- `GET /status` is served from live `ConfigManager` + current attach fields, not from a stale file snapshot.
- SIGINT/SIGTERM: close proxy, stop polling, clear pid/ready, exit 0.

### 5.3 Control server

`http.createServer` on `127.0.0.1` only. No auth. JSON in/out. Same trust model as the data plane.

| Method | Path | Body | Effect |
|---|---|---|---|
| `GET` | `/status` | — | Snapshot (see §8) |
| `POST` | `/route` | `{ "host": "<hostname>" }` | Append host to rules |
| `POST` | `/unroute` | `{ "host": "<hostname>" }` | Remove matching rule string |
| `POST` | `/rotate-ip` | `{}` | New sticky `session_id` |
| `POST` | `/set-geo` | `{ "geo": "us_ca" }` or `{ "clear": true }` | Set or clear `target_geo` |
| `POST` | `/stop` | `{}` | Graceful shutdown |

`/route` and `/unroute` return **after** `updateRules()` finishes (in-memory config swapped). Same for rotate/geo via `updateSessionId` / `updateTargetGeo`.

Reject with HTTP 400:

- `/route` host missing, empty, `*`, or loopback
- `/unroute` host missing
- `/set-geo` with neither `geo` nor `clear`, or both

Unknown paths: 404. Uncaught handler errors: 500 with `{ "error": "<message>" }`.

### 5.4 CLI `aluvia proxy`

Thin client of the control server. Verbs: `start`, `stop`, `status`, `route`, `unroute`, `rotate-ip`, `set-geo`, `attach`.

`start` and `auth` need an API key (`ALUVIA_API_KEY` or `$ALUVIA_HOME/config.json`). All other proxy verbs only need a live daemon (the daemon holds the key). `attach` starts proxyd if it is down.

`aluvia session *` is unchanged. Help text gains a `proxy` section.

### 5.5 Attach extension

Written by `aluvia proxy attach` to `$ALUVIA_HOME/ext/`.

- Manifest V3, `proxy` permission, background service worker, no UI.
- On load, `chrome.proxy.settings.set({ value: { mode: "fixed_servers", rules: { singleProxy: { scheme: "http", host: "127.0.0.1", port: <dataPort> }, bypassList: ["localhost", "127.0.0.1", "::1", "<local>"] } }, scope: "regular" })`.
- **Bake the data port into the generated files** at attach time. The extension cannot read `ALUVIA_HOME`.

### 5.6 Computer-use skill

In-repo at `skills/aluvia-proxy/SKILL.md`. Generic computer-use skill, not branded as Grok-only. Copyable to a Bot `/` skill or another agent’s skill dir.

---

## 6. Durable state

`ALUVIA_HOME` defaults to `~/.aluvia`. `configDir()` in the CLI must honor `ALUVIA_HOME` so auth and proxyd move together. `ALUVIA_API_KEY` still wins over the file.

```
$ALUVIA_HOME/
  config.json     # existing: { apiKey }  mode 0600
  proxy.json      # daemon runtime + durable connection
  proxy.log
  ext/            # generated unpacked extension
```

Playwright session locks stay in `os.tmpdir()/aluvia-sdk/`. Do not reuse them.

### `proxy.json`

```json
{
  "pid": 12345,
  "ready": true,
  "dataPort": 18787,
  "controlPort": 18788,
  "proxyUrl": "http://127.0.0.1:18787",
  "controlUrl": "http://127.0.0.1:18788",
  "connectionId": 3449,
  "sessionId": "a1b2c3d4e5f60718293a4b5c6d7e8f90",
  "targetGeo": null,
  "rules": ["example.com"],
  "attach": {
    "status": "unverified",
    "method": null,
    "verifiedAt": null,
    "extensionPath": "/home/user/.aluvia/ext"
  }
}
```

`attach.status` is `unverified` | `verified` | `needs_ui`.  
`attach.method` is `gsettings` | `extension` | null.

Writes are atomic (temp file + rename), same as session locks.

Computer-use VMs that wipe `$HOME` on image update set `ALUVIA_HOME=/workspace/.aluvia`. This spec does not auto-detect `/workspace`.

---

## 7. Data flows

### 7.1 Start

1. Resolve API key. Fail if missing.
2. If `proxy.json` has a live pid → exit 1 with running status + `"error": "proxyd already running"`.
3. If pid is stale → ignore the pid, keep `connectionId` / `sessionId`.
4. Spawn detached `node cli.js --proxy-daemon` with `--port`, `--control-port`, `--connection-id` if known. Pass `ALUVIA_API_KEY` and `ALUVIA_HOME` in the child env.
5. Child: `AluviaClient.start()`, sticky id, strip `*`, listen both ports, write `ready: true`.
6. Parent polls `proxy.json` every 250ms for up to 60s (same budget as `session start`). Child death → error + `logFile`.
7. Preserve existing `attach.*` across restart unless the data port changed (the extension bakes the port; a port change requires a new `attach`).
8. Parent prints status JSON and exits 0.

### 7.2 Route then fetch (acceptance path)

1. `aluvia proxy route example.com` → `POST /route`.
2. Daemon rejects `*` and loopback. Otherwise `updateRules([...current, host])` (dedupe, case-normalized).
3. HTTP 200 `{ "rules": [...] }` only after config swap.
4. `curl -x http://127.0.0.1:18787 https://example.com` → CONNECT `example.com:443` → gateway.
5. CONNECT to an unrouted host → direct.
6. CONNECT to loopback → direct even if a `*` rule existed below this CLI.

### 7.3 Model unblock (skill)

1. Screenshot looks like a block (Cloudflare interstitial, Access Denied, CAPTCHA, “unusual traffic”), not a normal login.
2. Read the hostname from the address bar.
3. `aluvia proxy status`. If daemon down → `start`. If `attach.status` is `unverified` → `attach`. If `needs_ui` and the browser is still not on the proxy → stop and say so. Do not invent MITM or a hosted rewrite.
4. `aluvia proxy route <host>` then **reload the tab**.
5. Do not route hosts where a login still works. Do not `route '*'`. Do not `rotate-ip` unless the user asks.

Routing `example.com` does not include `www.example.com` (existing exact-match engine). If the address bar shows `www.`, route that. If a redirect still blocks, route the new host.

### 7.4 Attach

Setup-time only. Never mid-task.

1. Require proxyd (start if needed).
2. Generate `$ALUVIA_HOME/ext` with the live data port baked in.
3. Try gsettings (Linux, ignore errors):

   ```
   mode=manual
   http/https host=127.0.0.1 port=<dataPort>
   ignore-hosts=['localhost','127.0.0.1','::1']
   ```

4. Wait **15s** for a CONNECT on the data port whose hostname is not the control host. **Do not** self-verify with `curl -x` — that would false-positive.
5. CONNECT seen → `attach.status=verified`, `method=gsettings` (or `extension` if the caller already loaded it).
6. Timeout → `attach.status=needs_ui`, exit **0**, JSON includes `extensionPath` and load-unpacked instructions (`chrome://extensions` → Developer mode → Load unpacked).
7. Ranked fallbacks **not** automated in this slice: `chrome://settings/system`, Preferences + restart, `--proxy-server` relaunch. Document them in the skill as last-resort takeover, never as default.

A later pass on a real Agent Computer picks which method actually wins. Until then attach is honest (`unverified` / `needs_ui` / `verified`), not assumed.

### 7.5 Stop / restart / rotate / geo

- `stop` → `POST /stop`; if the control port is dead, SIGTERM the pid; if still alive after 10s, SIGKILL. Always clear pid/ready. Keep connection/sticky/rules/attach.
- Next `start` passes stored `connectionId` so the gateway session and rules resume.
- `rotate-ip` / `set-geo` PATCH inside the daemon, then return.

`rotate-ip` hops **every** currently routed host (one `session_id` per connection). The skill must not rotate as a first response to a block.

---

## 8. CLI contract

All commands print one JSON object to stdout. Exit 0 success, 1 failure. `error` is always a string.

### Hostname parsing (`route` / `unroute`)

Accept a hostname or a URL. Trim. If it parses as a URL, take `.hostname`. Strip a trailing dot. Lowercase. Strip brackets on IPv6. Reject empty. Reject if the remaining string is `*`. Reject loopback names listed in §5.1.

`*.example.com` is allowed (existing suffix rule). Only the exact token `*` is catch-all.

`route` is append + dedupe. `unroute` removes the exact normalized rule string. Unroute of a host that is not in the list succeeds and returns the current rules.

### Success shapes

`start` / `status`:

```json
{
  "pid": 12345,
  "proxyUrl": "http://127.0.0.1:18787",
  "controlUrl": "http://127.0.0.1:18788",
  "connectionId": 3449,
  "sessionId": "a1b2c3d4e5f60718293a4b5c6d7e8f90",
  "targetGeo": null,
  "rules": ["example.com"],
  "count": 1,
  "healthy": true,
  "attach": {
    "status": "unverified",
    "method": null,
    "verifiedAt": null,
    "extensionPath": "/home/user/.aluvia/ext"
  }
}
```

`healthy` is true only when both ports accept a connection.

`route` / `unroute`: `{ "rules": ["example.com"], "count": 1 }`  
`rotate-ip`: `{ "sessionId": "<new>", "connectionId": 3449 }`  
`set-geo`: `{ "targetGeo": "us_ca", "connectionId": 3449 }`  
`stop`: `{ "status": "stopped" }`  
`attach` verified: `{ "status": "verified", "method": "gsettings", "proxyUrl": "http://127.0.0.1:18787" }`  
`attach` needs UI: `{ "status": "needs_ui", "extensionPath": "…", "instructions": "…" }`

### Errors

| Situation | Exit | Notes |
|---|---|---|
| No API key on `start` | 1 | Same message as today |
| `start` and daemon live | 1 | Body = status fields + `"error": "proxyd already running"` |
| Stale pid on `start` | 0 | Replace and start |
| Requested port in use (not us) | 1 | `"error": "port 18787 in use"` — no silent rebind |
| Verb other than `start` and daemon down | 1 | `"error": "proxyd is not running. Run \`aluvia proxy start\`."` |
| `route '*'`, `route localhost`, missing host | 1 | Parse URLs before this check |
| PATCH fails | 1 | In-memory config unchanged (`setConfig` already does this) |
| Control up, data port dead | 1 on `route`; `status` has `healthy: false` | |
| `attach` timeout | 0 | `needs_ui`, not a failure |
| `attach` and proxyd down | — | Start, then attach |
| Control request timeout | 1 | 2s. `"error": "proxyd did not respond. Run \`aluvia proxy status\`."` |
| `stop` and process already dead | 0 | Clean the pidfile |

A reused connection that already has `*` is repaired at start (strip + PATCH), not a start failure.

---

## 9. Skill contents

`skills/aluvia-proxy/SKILL.md` must tell the model:

1. Install/auth: `npm install -g @aluvia/cli` (or `npx aluvia`), then `aluvia auth` (device flow; user approves on their laptop). Set `ALUVIA_HOME=/workspace/.aluvia` when `$HOME` is not durable.
2. `aluvia proxy start` once per VM. One daemon, shared by every agent on the computer.
3. `aluvia proxy attach` at **setup**, never mid-task. If `needs_ui`, ask the human to take over and load the unpacked extension. After that, do not touch Chrome proxy settings again.
4. Unblock: screenshot is a block → hostname from the address bar → `aluvia proxy route <host>` → reload. Parse CLI JSON; exit 1 means stop and report `error`.
5. Do **not** route a host where a login still works. Do **not** `route '*'`. Do **not** `rotate-ip` unless the user explicitly asks. A block after `route` + reload is not a reason to hop IP (that hops every routed host on the shared browser).
6. Routing only affects traffic already sent to `http://127.0.0.1:18787`. If attach is unverified, say so. Do not open `aluvia.io/https://…`. Do not launch a second Chrome.
7. Terminal `curl`/`node` do not use the GUI proxy. For terminal, `export https_proxy=http://127.0.0.1:18787` (and `http_proxy`) in that shell, then `route` the host. Chrome on Linux ignores `HTTP_PROXY`.
8. Never print the API key.

---

## 10. Testing

Prove the CLI loop in this repo. Do not claim harness-owned GUI attach works in CI.

Required:

1. **Loopback bypass** — even with a `*` rule injected below the CLI, CONNECT/`curl -x` to `localhost` / `127.0.0.1` / `::1` never sets `upstreamProxyUrl`.
2. **`route` is synchronous** — proxyd against a mock API; after `proxy route example.com` returns, `curl -x http://127.0.0.1:18787 https://example.com` hits the mock gateway. After `unroute`, it goes direct. If this needs a 5s poll, the test failed.
3. **Refuse `*`** — CLI `route '*'`, and `POST /route { "host": "*" }`, are exit 1 / 400. There is no `--force`.
4. **Sticky id** — first start with `session_id: null` PATCHes a UUID; second start reuses it; only `rotate-ip` changes it.
5. **Singleton** — second `start` fails with the live status; kill the pid, start succeeds.
6. **Fixed ports** — occupier on `18787` → start fails with the port error.
7. **`ALUVIA_HOME`** — temp dir receives `config.json` (if auth writes), `proxy.json`, `proxy.log`, and `ext/`.
8. **Hostname parse** — `route https://Example.COM/path?q=1` adds `example.com`.
9. **`session *`** — existing Playwright CLI tests still pass. No MCP tool changes.

Attach (local only):

- `attach` writes a valid MV3 extension (`manifest.json` + `chrome.proxy` set, bypass loopback, baked port).
- Waiting path: an external CONNECT (test harness may `curl -x`) flips status to `verified`.
- No CONNECT in 15s → `needs_ui`, exit 0.

Out of CI: harness Chrome, screenshot/click survival, gsettings vs extension on the Agent Computer, Update/Recover of `~/.config`. One manual pass on a real VM.

---

## 11. Implementation order

For the follow-on plan. Not work in this spec.

1. Loopback bypass in `ProxyServer` + tests. `ALUVIA_HOME` in `configDir()`.
2. Control protocol + proxyd process + `proxy.json` + `start`/`stop`/`status`.
3. `route` / `unroute` / `rotate-ip` / `set-geo` through the control port; synchronous tests against a mock gateway.
4. `attach` (extension generate + gsettings try + CONNECT wait + `needs_ui`).
5. Skill file + CLI help. No README marketing rewrite beyond a short “computer-use VM” paragraph if needed.

---

## 12. Why not the alternatives

**Poll-and-hope (CLI PATCHes API, daemon ETags):** `route` then reload can still go direct. That is today’s `session set-rules` bug.

**Unix socket control:** no second TCP port, worse to debug, Windows is an afterthought, we already trust loopback.

**`--proxy-server` relaunch as default attach:** existing Chrome ignores the flag; killing it likely detaches computer-use.

**HTML rewrite or remote browser stream:** origin, cookies, passkeys, WebAuthn forwarding, and click coordinates all leave the VM Chrome. Aluvia’s advantage is mobile egress in front of the browser the customer already has.
