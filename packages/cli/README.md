# aluvia-cli

The Aluvia CLI. A local proxy that sends a computer-use agent's existing Chrome through residential and mobile IPs.

Chrome aims at `http://127.0.0.1:18787`. The daemon (control `18788`) either sends that traffic through Aluvia or out of the VM directly. All commands print JSON. Follow `next`. Never print API keys.

The full product write-up is in the [repository README](../../README.md). The agent instruction file is [skills/aluvia/SKILL.md](./skills/aluvia/SKILL.md).

## Install

```bash
npx aluvia-cli setup
```

Run the command on the machine where the agent's browser runs. Node.js 18+.

No target page URL is required. Setup installs the command launcher and skill, starts the local proxy, and configures Chrome. Initial configuration can restart Chrome and opens `https://example.com/`, a small HTTPS test page. Use optional `--url <page>` to open a specific page instead.

Setup enables proxy traffic. `ready: true` requires the browser to reach the local proxy and the upstream connection check to pass. Rerunning setup enables proxy traffic again, checks the connection and keeps a working browser and session. If setup needs recovery, follow the JSON `next` field.

To choose a country, run `aluvia geos`, then `aluvia proxy-on --geo US` (replace `US`), reload the target page, and run `aluvia status`. A working proxy does not guarantee access to every site.

If `aluvia` is not on PATH, replace `aluvia` with `npx aluvia-cli`. For example: `npx aluvia-cli status`.

Or install globally with `npm i -g aluvia-cli`.

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

## Optional acquisition attribution

A consented website install command can include `ALUVIA_ATTRIBUTION_TOKEN`, a short-lived opaque token. Setup saves a valid token before work starts so an incomplete invocation can resume. The token binds only to an existing install through `https://api.aluvia.io/v1/growth/install-attribution`. It cannot start a trial or grant account access. Binding uses the existing install credential in the first-party header, without a Bearer token. Custom API endpoint settings do not change this destination.

Two internal CLI reports can follow a confirmed binding:

- `setup_ready` (`aluvia_setup_ready_v1`): the browser is aimed, the proxy is healthy, and the session probe succeeds with Aluvia credentials.
- `first_proxy_request` (`aluvia_connect_established_v1`): an Aluvia CONNECT returns 200 for a non-loopback, non-probe host. The automatic setup test host, HTTP preparation, direct traffic, BYO proxies, and failed CONNECTs do not qualify.

Both have evidence source `cli_reported`. A CONNECT receipt does not prove a page loaded or a task succeeded. The CLI sends no Meta Pixel or CAPI request. It sends no browser identifiers, destination hosts, IP addresses, or install credential in report bodies.

State lives separately from credentials under `$ALUVIA_HOME/growth-attribution` (or the default config directory), with directory mode 0700 and file mode 0600. Complete files are published atomically and exclusively. The original event ID, occurrence time, and connection ID remain pending across retries, restarts, and lost acknowledgements until a valid versioned receipt arrives. The first accepted token remains sticky; a conflicting or expired/revoked binding stops reports without changing install IDs.

Each drain makes at most one binding request and one request per pending event, each with a 750 ms deadline. JSON output prints before the bounded drain finishes; proxy traffic never awaits it. Setup and the running daemon retry pending work, with daemon retries every minute. A disabled bridge (404), unavailable service, or an install not yet known to the service (401) leaves work pending. Terminal validation failures stop the affected report. No token means no attribution requests. The backend accepts new events only within seven days of occurrence; older offline reports can be rejected without changing their timestamps.

## License

MIT

### Website visit reference

A setup command copied from Aluvia can include `--ref <visit-token>`:

```sh
npx aluvia-cli setup --ref <visit-token>
```

This optional reference connects the visit to the trial for ad measurement.
It does not grant account access or contain Meta click IDs. Use the reference
as shown, or run plain `npx aluvia-cli setup`. The first accepted reference
remains linked to that installation. `--ref=value` is also accepted; the flag
takes precedence over the legacy `ALUVIA_ATTRIBUTION_TOKEN` environment variable.

## Older SDK and MCP instructions

The current Aluvia product is this local CLI. Older `@aluvia/sdk`, `@aluvia/mcp` and `aluvia-sdk` instructions describe a different integration. The CLI is not a drop-in replacement for those APIs. See the [current quickstart](https://aluvia.io/docs) and [migration guide](https://aluvia.io/legacy) before changing a working integration.
