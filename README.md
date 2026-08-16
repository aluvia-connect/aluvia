# Aluvia

**Stop getting blocked.** Aluvia sends a computer-use agent's existing Chrome through residential and mobile carrier IPs — the same IPs real people use on their phones. Websites trust them, so the agent stops hitting 403s, CAPTCHAs, and “unusual traffic.” Any country by default; pin one with `--geo US` only when the site requires it.

The product is a local CLI. The human does not SSH into the VM or edit environment variables. They talk to the agent. The agent runs `aluvia`.

```
Chrome  ──aim──▶  127.0.0.1:18787  ──egress──▶  Aluvia mobile IP
   ▲                     │                         or
   │                     │                      this VM's
   │                     ▼                      datacenter IP
one restart         proxyd (18788)
if needed
```

**Aim** and **egress** are separate. Aim is “is Chrome talking to the local proxy?” Egress is “does that proxy send traffic through Aluvia, or straight out of the VM?” `proxy-on` / `proxy-off` flip egress. They do not restart Chrome.

Local proxy: `http://127.0.0.1:18787`. Control: `http://127.0.0.1:18788`. Every command prints JSON on stdout. Read `next`. Never print API keys.

---

## Install

Node.js 18+. If `aluvia` is not on PATH, prefix every command with `npx aluvia-cli`.

```bash
npx aluvia-cli setup --url https://www.example.com/checkout
```

That starts the daemon, aims Chrome at `127.0.0.1:18787`, and installs the [agent skill](./skills/aluvia/SKILL.md) into `~/.agents/skills` (and other agent skill dirs if they exist).

A first setup starts a free trial. No API key.

---

## First setup

Copy the blocked page's address-bar URL, then:

```bash
aluvia setup --url https://www.example.com/checkout
```

Read the JSON. **`next` is the next action.**

| Field | Meaning |
| --- | --- |
| `ready: true` | Chrome is aimed and the daemon is up. Reload the blocked tab. Do not run setup again. |
| `needsChromeRestart: true` | Quit **this** Chrome. Run `chromeCommand` exactly. Open or reload the blocked URL. Do not run setup again. The daemon marks `aimed` when Chrome CONNECTs. |
| `code: "payment_required"` | Trial data is used up. Show the human `claim_url`, then run `aluvia auth login`. |

If the page is still blocked after Chrome is aimed: `aluvia status`. If `aimed` is false, the platform replaced Chrome — run `setup --url <page>` and `chromeCommand` once more.

---

## Day to day

| Goal | Command |
| --- | --- |
| Use Aluvia (all tabs through a mobile IP) | `aluvia proxy-on` then reload. Any country. `--geo US` only if the site requires it. |
| Back to the VM datacenter IP | `aluvia proxy-off` then reload. Do not quit Chrome. |
| New exit IP | `aluvia rotate-ip` then reload. Any country. `--geo US` only if required. |
| Check | `aluvia status` — follow `next`. `what` explains every field. |
| Stop the daemon | `aluvia stop` — Chrome aimed at 18787 will break. Prefer `proxy-off`. |

`proxy-on` and `proxy-off` do not restart Chrome.

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
{ "authenticated": true, "source": "config", "provider": "aluvia", "configFile": "~/.aluvia/config.json" }
```

```json
{ "authenticated": false, "provider": "custom" }
```

The status payload never includes the key.

---

## Commands

```
aluvia setup --url <page>          Start proxyd and aim the GUI browser
aluvia start                       Start the local egress daemon
aluvia stop                        Stop the local egress daemon
aluvia status                      Show daemon status
aluvia proxy-on [--geo <geo>]      All browser traffic through Aluvia (any geo unless --geo)
aluvia proxy-off                   Browser traffic direct (daemon stays up)
aluvia rotate-ip [--geo <geo>]     New exit IP from any geo (or --geo US)
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

`aluvia status` (and a successful `setup`) include:

| Field | Meaning |
| --- | --- |
| `next` | The next action. Follow it. |
| `aimed` | Is Chrome sending traffic to `http://127.0.0.1:18787`? |
| `egress` | `aluvia` = mobile/residential IP. `direct` = this VM datacenter IP. |
| `ready` | Aimed and the daemon is up. Reload the tab. |
| `healthy` | The local proxy process is accepting connections. |
| `needsChromeRestart` | `true` means quit Chrome and run `chromeCommand`. After that it stays false. |
| `rules` | `["*"]` = all hosts through Aluvia. `[]` = all hosts direct. |
| `targetGeo` | Pinned country code, or `null` for all geos. |
| `what` | One-line explanation of each of the fields above. |

---

## How the local proxy works

```
┌─────────────────┐     ┌──────────────────────────┐     ┌─────────────────────┐
│                 │     │                          │     │                     │
│  GUI Chrome     │────▶│  proxyd                  │────▶│  gateway.aluvia.io  │
│  (already on    │     │  127.0.0.1:18787         │     │  (mobile IPs)       │
│   the machine)  │     │                          │     │                     │
└─────────────────┘     │  egress = aluvia  ──────────────────┘
                        │  egress = direct  ──────────▶ VM datacenter
                        └──────────────────────────┘
```

Chrome always talks to the loopback proxy once it is aimed. The daemon decides per-request whether to send that traffic through Aluvia (or a BYO proxy) or out of the VM directly.

State lives under `ALUVIA_HOME`: `/workspace/.aluvia` when `/workspace` exists, otherwise `~/.aluvia`. That directory holds `config.json`, `install_id`, `proxy.json`, and logs.

Optional overrides (not the agent path — agents run `aluvia auth` / `aluvia proxy-provider`):

| Variable | Role |
| --- | --- |
| `ALUVIA_API_KEY` | API key override |
| `ALUVIA_UPSTREAM` | BYO proxy URL override |
| `ALUVIA_HOME` | Config directory |

Do not point a BYO URL at the local daemon — that loops.

---

## Agent skill

[`skills/aluvia/SKILL.md`](./skills/aluvia/SKILL.md) is the instruction file computer-use agents follow. `aluvia setup` copies it into the agent skill dirs on the machine.

Use Aluvia when a GUI workflow hits Cloudflare, Access Denied, CAPTCHA, unusual traffic, or a hard 403 on a page that should load — not a normal login wall.

Do not guess hostnames, write PAC/nftables, load an unpacked extension, or use `chrome://settings/system`. Do not `stop` to turn the proxy off.

---

## This repository

A private workspace. The CLI is the product. Internals live in `packages/cli/src/net`.

| Package | Role |
| --- | --- |
| [`packages/cli`](./packages/cli) | `aluvia` / `aluvia-cli` — daemon, setup, auth, skill |

```bash
npm ci
npm run build
npm test
npm run lint
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [Claude.md](./Claude.md).

---

## License

MIT — see [LICENSE](./LICENSE)
