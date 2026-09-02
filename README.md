# Aluvia

Global proxy IPs for AI agents.

A cloud agent's browser uses the datacenter's country. Sites treat that country as the agent's location, then show that country's prices, catalog, and language, or say the content is not available there. Aluvia lets the agent pick a country. Traffic leaves through a residential or mobile IP in that country, so the site serves that country's page.

The agent's country is the datacenter's country. That is often the wrong country for the site. Set a country (`aluvia proxy-on --geo US`; run `aluvia geos` for the list). Aluvia sends the browser through a residential or mobile IP there. The site sees that country's IP and returns the matching page.

A residential IP in the right country sometimes also clears a 403, CAPTCHA, or Cloudflare block.

The product is a local CLI. The human does not SSH into the VM or edit environment variables. They talk to the agent. The agent runs `aluvia`.

```
Chrome  ──aim──▶  127.0.0.1:18787  ──egress──▶  Aluvia residential or mobile IP
   ▲                     │                         or
   │                     │                      this VM's
   │                     ▼                      datacenter IP
one restart         proxyd (18788)
if needed
```

**Aim** and **egress** are separate. Aim is “is Chrome talking to the local proxy?” Egress is “does that proxy send traffic through Aluvia, or straight out of the VM?” `proxy-on` / `proxy-off` flip egress. They do not restart Chrome.

Local proxy: `http://127.0.0.1:18787`. Control: `http://127.0.0.1:18788`. Every command prints JSON on stdout. Read `next`. Never print API keys.

---

## Wrong country / geo

The agent's country is the datacenter's country. Pick a country (`aluvia geos`, then `aluvia proxy-on --geo US`). Traffic leaves through a residential or mobile IP there. Country only, not city. Not a human VPN.

Live pages: [https://aluvia.io/geo](https://aluvia.io/geo)

- [https://aluvia.io/geo/grok-bot](https://aluvia.io/geo/grok-bot)
- [https://aluvia.io/geo/cursor](https://aluvia.io/geo/cursor)
- [https://aluvia.io/geo/codex](https://aluvia.io/geo/codex)
- [https://aluvia.io/geo/playwright](https://aluvia.io/geo/playwright)
- [https://aluvia.io/geo/claude](https://aluvia.io/geo/claude)
- [https://aluvia.io/geo/openclaw](https://aluvia.io/geo/openclaw)
- [https://aluvia.io/geo/hermes](https://aluvia.io/geo/hermes)
- [https://aluvia.io/geo/without-a-vpn](https://aluvia.io/geo/without-a-vpn)

---

## Install

Node.js 18+. If `aluvia` is not on PATH, prefix every command with `npx aluvia-cli`.

```bash
npx aluvia-cli setup
```

`--url <page>` is optional. If you have the blocked page, pass it so Chrome opens that tab after the restart.

That starts the daemon, aims Chrome at `127.0.0.1:18787`, and copies the [agent skill](./skills/aluvia/SKILL.md) into the skill dirs on this machine.

First 10 MB free, no account, no API key. Paid $2/GB. Docs: https://aluvia.io/docs

---

## First setup

```bash
aluvia setup
```

Or `aluvia setup --url https://www.example.com/checkout` if you copied the blocked page.

Read the JSON. **`next` is the next action.**

| Field | Meaning |
| --- | --- |
| `aimed: true` | Chrome CONNECTed to the local proxy. Idle tabs stay aimed. |
| `ready: true` | Aimed, healthy, daemon live, and the Aluvia tunnel CONNECT returned 200 with an egress IP that is not this VM datacenter. Distinct from `aimed`. Reload the blocked tab. |
| `needsChromeRestart: true` | Run `chromeCommand` (quits Chrome first, then launches with flags). Then run `aluvia setup` again. Launching without quitting ignores flags. |
| `code: "payment_required"` | Trial data is used up. Show the human `claim_url`, then run `aluvia auth login`. |

One restart is expected. `setup` tries to do it. If it cannot, run `chromeCommand`, then `aluvia setup` again. Do not launch a second Chrome.

Re-running setup while aimed is a no-op if the tunnel is live.

Idle is fine. If the page is still blocked after Chrome is aimed, reload the tab, then `aluvia status`. If that status says `aimed` is false, run setup again. If `aimed` is true but `ready` is false, follow `next` — do not assume the website is down.

---

## Day to day

| Goal | Command |
| --- | --- |
| Pick a country | `aluvia geos`, then `aluvia proxy-on --geo US`, then reload. Country only. Omit `--geo` to use every geo. |
| Back to the VM datacenter IP | `aluvia proxy-off` then reload. Do not quit Chrome. |
| New exit IP | `aluvia rotate-ip` then reload. `--geo US` to pin a country. |
| Check | `aluvia status` — follow `next`. `what` explains every field. |
| Stop the daemon | `aluvia stop` — Chrome aimed at 18787 will break. Prefer `proxy-off`. |

`proxy-on` and `proxy-off` do not restart Chrome.

---

## 503 and 590

A 503 from `gateway.aluvia.io` is a flake, not “the website is down.” Local proxy-chain shows **590 UPSTREAM503** so it is not mistaken for the website’s own 503.

Retry the same session before rotating. The CLI already retries 503/590 on that session (short gaps, a few attempts). A 590 on one echo host is not dead if another host is live. Chrome background CONNECTs also 590 and must not poison status.

`rotate-ip` is the explicit new-IP command. Do not rotate on the first miss. After retries stay dead, the CLI error looks like `Upstream gateway returned 503 (590 UPSTREAM503)` with `code: "upstream_unavailable"` and `next` saying run `aluvia rotate-ip` then reload.

---

## Connection and session

One connection per login. `connectionId` is saved with the login in `config.json` and reused. Setup must not POST a second account connection.

The CLI resolves that id in this order: `--connection-id` flag, then `config.json`, then `proxy.json`.

Session ID is a field on that connection, not its own object. `rotate-ip` PATCHes a new `session_id` on the same connection to get a new IP. There is no session-close or delete-session API. The old session ID is not a leftover reservation. If a session IP is gone, the same session ID can get a new IP.

---

## Trial, paid, and your own proxy

Credentials resolve in this order: a proxy URL the human pasted, then an Aluvia API key, then a 64-hex install id (the trial).

The human cannot edit this VM. Ask them in chat. Then **you** run the command. Never set env vars. Never print the key.

| They give you | You run |
| --- | --- |
| An Aluvia API key | `aluvia auth <that key>` |
| Their own proxy URL | `aluvia proxy-provider <url>` |
| They want Aluvia again after a BYO proxy | `aluvia proxy-provider aluvia` |

### When the trial is used up

A command that needs the Aluvia network returns:

```json
{
  "code": "payment_required",
  "claim_url": "https://dashboard.aluvia.io/cli-auth?cli_code=ABCD",
  "next": "Show claim_url to the human. Then run `aluvia auth login` to wait until they finish. When that succeeds, retry."
}
```

1. Show the human `claim_url`. They open it on **their** machine (not the VM).
2. They enter email, type the 6-digit code from the email (same tab), Authorize, then Buy data if asked.
3. You run `aluvia auth login` to wait. Do not show a second URL — login reuses the pending session.
4. When login succeeds, `aluvia proxy-on` and reload the tab.

`aluvia auth login` is the wait. It is not how you start a first trial.

### Auth status

```bash
aluvia auth status
```

```json
{ "authenticated": false, "provider": "aluvia", "trial": true }
```

```json
{ "authenticated": true, "source": "config", "provider": "aluvia", "configFile": "/workspace/.aluvia/config.json" }
```

```json
{ "authenticated": false, "provider": "custom" }
```

The status payload never includes the key.

---

## Commands

```
aluvia setup [--url <page>]        Start the daemon and aim the GUI browser
aluvia start                       Start the local egress daemon
aluvia stop                        Stop the local egress daemon
aluvia status                      Show daemon status
aluvia proxy-on [--geo <geo>]      All browser traffic through Aluvia (any geo unless --geo)
aluvia proxy-off                   Browser traffic direct (daemon stays up)
aluvia rotate-ip [--geo <geo>]     New exit IP (turns proxy on if needed)
aluvia proxy-provider aluvia       Use the Aluvia network (default)
aluvia proxy-provider <url>        Use a proxy URL the human pasted

aluvia account                     Account info
aluvia account usage [--start --end]
aluvia geos                        List available geos

aluvia auth <key>                  Save an API key the human pasted
aluvia auth login                  Wait until the human finishes claim_url
aluvia auth status                 Whether you are authenticated
aluvia help [--json]               This list (JSON with --json)
```

`--geo` takes a country code such as `US`. Omit it to use every geo. There is no `--geo all` or `--geo any`.

`aluvia help --json` is the machine-readable command list.

### Status fields

`aluvia status` includes:

| Field | Meaning |
| --- | --- |
| `next` | The next action. Follow it. |
| `aimed` | Has Chrome CONNECTed to the local proxy? Idle tabs stay aimed. After next asks you to reload, the following status/setup checks for a CONNECT since that ask. |
| `egress` | aluvia = mobile/residential IP. direct = this VM datacenter IP. |
| `ready` | Aluvia tunnel CONNECT returned 200 and the egress IP is not this VM datacenter IP. Distinct from aimed. |
| `healthy` | The local proxy process is accepting connections. |
| `needsChromeRestart` | true means run chromeCommand (quit then launch). Then run aluvia setup again. |
| `rules` | ["*"] = all hosts through Aluvia. [] = all hosts direct. |
| `targetGeo` | Pinned country code, or null for all geos. |
| `what` | One-line explanation of each of the fields above. |

`ready` is `aimed` AND `healthy` AND the daemon is live AND that tunnel probe succeeded. Aimed is not enough.

---

## Files

Aluvia home is `/workspace/.aluvia` when `/workspace` exists, else `~/.aluvia`.

- `config.json` — login plus saved `connectionId`
- `proxy.json` — the running daemon (ports, current `sessionId`)

Never print API keys. Persist credentials with `aluvia auth` and `aluvia proxy-provider`. Do not point a BYO URL at the local daemon — that loops.

---

## Agent skill

[`skills/aluvia/SKILL.md`](./skills/aluvia/SKILL.md) is the instruction file computer-use agents follow.

Use Aluvia when a cloud agent is in the wrong country for a site — not available in your region, wrong catalog or prices, or `aluvia proxy-on --geo US` — and when a GUI workflow hits Cloudflare, Access Denied, CAPTCHA, unusual traffic, or a hard 403. Not a normal login wall.

`aluvia setup` copies that file into the Aluvia home `skills/` directory and `~/.agents/skills`. If `/workspace` exists, also `/workspace/.agents/skills`. If `~/.grok`, `~/.claude`, `~/.cursor`, `~/.codex`, `~/.hermes`, `~/.openclaw`, or `~/.openclaw/workspace` already exists, it copies into that app’s `skills/` directory. It does not create folders for agents that are not installed. `skillPath` is the first successful copy. `skillPaths` is the full list.

---

## Cursor / Grok Bot plugin

This repository is also a skill-only Agent Plugin (`plugin.json` and [`skills/aluvia/SKILL.md`](./skills/aluvia/SKILL.md)) for Cursor and Grok Bot Settings → Plugins. The plugin is not an MCP. Install the product with `npx aluvia-cli setup`, then `aluvia proxy-on --geo US`.

To test locally, symlink this repo to `~/.cursor/plugins/local/aluvia`, reload, and confirm the Aluvia skill in Customize.

---

## This repository

A private workspace. The released package is **aluvia-cli** (`aluvia` bin) in [`packages/cli`](./packages/cli). Internals live in `packages/cli/src/net`.

```bash
npm ci
npm run build
npm test
npm run lint
```

See [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## License

MIT — see [LICENSE](./LICENSE)
