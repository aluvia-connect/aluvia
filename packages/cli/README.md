# aluvia-cli

The Aluvia CLI. A local proxy that sends a computer-use agent's existing Chrome through residential and mobile IPs.

Chrome aims at `http://127.0.0.1:18787`. The daemon (control `18788`) either sends that traffic through Aluvia or out of the VM directly. All commands print JSON. Follow `next`. Never print API keys.

The full product write-up is in the [repository README](../../README.md). The agent instruction file is [skills/aluvia/SKILL.md](./skills/aluvia/SKILL.md).

## Install

```bash
npx aluvia-cli setup
```

Or `npm i -g aluvia-cli` and run `aluvia`. Node.js 18+.

First 10 MB free, no account, no API key. Paid $2/GB. Docs: https://aluvia.io/docs. The human does not SSH or edit env vars — they paste a key or proxy URL in chat, and the agent runs the command.

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

## Commands

```
aluvia setup [--url <page>]        Start proxyd and aim the GUI browser
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
aluvia help [--json]               Command list as JSON
```

`proxy-on` / `proxy-off` do not restart Chrome. Prefer `proxy-off` over `stop`. `--geo US` only when a site requires a country; omit it to use every geo.

## Trial used up

`{"code":"payment_required"}` — show the human `claim_url`. They open it on their machine, enter email, type the 6-digit code, Authorize, then Buy data if asked. Run `aluvia auth login` to wait. Do not show a second URL.

They can also paste a key (`aluvia auth <key>`) or their own proxy (`aluvia proxy-provider <url>`).

## License

MIT
