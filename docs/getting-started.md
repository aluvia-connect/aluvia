# Getting Started

Aluvia sends a computer-use agent's existing Chrome through residential and mobile carrier IPs. The human does not SSH or edit environment variables. They talk to the agent. The agent runs `aluvia`.

Local proxy: `http://127.0.0.1:18787`. Control: `http://127.0.0.1:18788`. Every command prints JSON on stdout. Follow `next`. Never print API keys.

The full product write-up is the [repository README](../README.md). Agent instructions: [skills/aluvia/SKILL.md](../skills/aluvia/SKILL.md).

## Prerequisites

- Node.js 18+
- The GUI Chrome on this machine (the one the agent already uses)

## Install

If `aluvia` is not on PATH, prefix every command with `npx aluvia-cli`.

```bash
npx aluvia-cli setup --url https://www.example.com/checkout
```

A first setup starts a free trial. No API key.

`--url` is required. Pass the blocked page from the address bar.

## First setup

Read the JSON. **`next` is the next action.**

| Field | Meaning |
| --- | --- |
| `ready: true` | Chrome is aimed and the daemon is up. Reload the blocked tab. Do not run setup again. Do not restart Chrome. |
| `needsChromeRestart: true` | Quit **this** Chrome. Run `chromeCommand` exactly. Open or reload the blocked URL. Do not run setup again. |
| `code: "payment_required"` | Trial data is used up. Show the human `claim_url`, then run `aluvia auth login`. |

`chromeCommand` is only present when Chrome must restart.

## Day to day

| Goal | Command |
| --- | --- |
| Use Aluvia (all tabs through a mobile IP) | `aluvia proxy-on` then reload. Any country. `--geo US` only if the site requires it. |
| Back to the VM datacenter IP | `aluvia proxy-off` then reload. Do not quit Chrome. |
| New exit IP | `aluvia rotate-ip` then reload. Any country. `--geo US` only if required. |
| Check | `aluvia status` — follow `next`. `what` explains every field. |
| Stop the daemon | `aluvia stop` — Chrome aimed at 18787 will break. Prefer `proxy-off`. |

`proxy-on` and `proxy-off` do not restart Chrome. Omit `--geo` to use every geo. Do not pass `--geo all` or `--geo any`.

## Trial, paid, and your own proxy

Credentials resolve in this order: a proxy URL the human pasted, then an Aluvia API key, then a 64-hex install id (the trial).

Ask the human in chat. Then **you** run the command. Never set env vars. Never print the key.

| They give you | You run |
| --- | --- |
| An Aluvia API key | `aluvia auth <that key>` |
| Their own proxy URL | `aluvia proxy-provider <url>` |
| They want Aluvia again after a BYO proxy | `aluvia proxy-provider aluvia` |

When stdout is `{"code":"payment_required"}`, show them `claim_url`. They open it on their machine, enter email, type the 6-digit code, Authorize, then Buy data if asked. Run `aluvia auth login` to wait. Do not show a second URL.

```bash
aluvia auth status
aluvia help
```

## Commands

```
aluvia setup --url <page>          Start proxyd and aim the GUI browser
aluvia start                       Start the local egress daemon
aluvia stop                        Stop the local egress daemon
aluvia status                      Show daemon status
aluvia proxy-on [--geo <geo>]      All browser traffic through Aluvia
aluvia proxy-off                   Browser traffic direct (daemon stays up)
aluvia rotate-ip [--geo <geo>]     New exit IP
aluvia proxy-provider aluvia       Use the Aluvia network (default)
aluvia proxy-provider <url>        Use a proxy URL the human pasted
aluvia account                     Account info
aluvia account usage [--start --end]
aluvia geos                        List available geos
aluvia auth <key>                  Save an API key the human pasted
aluvia auth login                  Wait until the human finishes claim_url
aluvia auth status                 Whether you are authenticated
aluvia help                        Command list as JSON
```
