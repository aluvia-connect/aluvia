# CLI Technical Guide

The Aluvia CLI aims the existing GUI Chrome at a local proxy (`127.0.0.1:18787`) and sends that traffic through Aluvia or out of the VM directly. Binary: `aluvia` (or `npx aluvia-cli`).

Every command prints JSON to stdout. Exit `0` on success, `1` on error. Follow `next`. Never print API keys.

Product overview: [repository README](../README.md). Agent skill: [skills/aluvia/SKILL.md](../skills/aluvia/SKILL.md).

## Install

```bash
npx aluvia-cli setup --url https://www.example.com/checkout
```

Or `npm i -g aluvia-cli`. Node.js 18+. A first setup starts a free trial (install id). No API key.

`--url` is required and must be an `http`/`https` page.

## Credentials

Order: BYO URL the human pasted, then an Aluvia API key, then the 64-hex install id (trial).

The human cannot edit this VM. Ask them in chat, then run:

| They give you | You run |
| --- | --- |
| An Aluvia API key | `aluvia auth <that key>` |
| Their own proxy URL | `aluvia proxy-provider <url>` |
| Aluvia again after BYO | `aluvia proxy-provider aluvia` |

Do not set `ALUVIA_API_KEY` or `ALUVIA_UPSTREAM` for the human. Agents should not export those.

| Variable | Role |
| --- | --- |
| `ALUVIA_HOME` | Config directory. Default `/workspace/.aluvia` when `/workspace` exists, else `~/.aluvia`. |
| `ALUVIA_API_KEY` | Optional override. Prefer `aluvia auth <key>`. |
| `ALUVIA_UPSTREAM` | Optional override. Prefer `aluvia proxy-provider <url>`. After `auth <key>` or `proxy-provider aluvia`, leftover env BYO is ignored. |

## Output

```json
{ "next": "…", "aimed": true, "egress": "aluvia" }
```

`aluvia help` is JSON too (including `next`). `--json` is accepted and does nothing extra.

`{"code":"payment_required"}` includes a minted `claim_url` (`/cli-auth?cli_code=…`) and `next` telling you to show that URL, then run `aluvia auth login`. Do not print a second URL.

## Commands

### `setup --url <page>`

Start the daemon, aim Chrome, turn egress on, install the skill to disk.

| Field | Meaning |
| --- | --- |
| `ready` | Aimed and the daemon is healthy. Reload the tab. Do not restart Chrome. |
| `needsChromeRestart` | Quit this Chrome and run `chromeCommand`. Omitted `chromeCommand` when this is false. |
| `skillPath` / `skillPaths` | Where `SKILL.md` was written. The skill body is not dumped on stdout. |

### `start` / `stop` / `status`

`start` starts proxyd only. `stop` kills it (Chrome aimed at 18787 will break; prefer `proxy-off`). `status` always returns structured fields plus `next` / `what`, including when the daemon is dead.

- Aimed + dead → `aluvia start`. Do not quit Chrome.
- Not aimed + dead → `aluvia setup --url <page>`.

### `proxy-on [--geo <geo>]` / `proxy-off` / `rotate-ip [--geo <geo>]`

Flip egress. Do not restart Chrome. Omit `--geo` to use every geo. `--geo US` only when a site requires a country. `--geo all`, `--geo any`, and `--geo *` are errors.

`rotate-ip` turns egress on if it was direct.

### `proxy-provider aluvia` / `proxy-provider <url>`

Choose the Aluvia network or a URL the human pasted.

### `auth <key>` / `auth login` / `auth status`

- `auth <key>` — verify, then save. Never echo the key.
- `auth login` — wait for the pending `claim_url`. Prints the URL on stderr only when none is pending.
- `auth status` — whether you are authenticated. Does not print the key.

There is no logout subcommand. Reserved words that are not `login` / `status` are usage errors.

### `account` / `account usage` / `geos`

Need the Aluvia network (not BYO).

### `help`

JSON command list plus `next`.

## Aim vs egress

**Aim** is “is Chrome talking to `127.0.0.1:18787`?” (`aimed`, `ready`). **Egress** is “does that proxy send traffic through Aluvia, or straight out of the VM?” (`proxy-on` / `proxy-off`).

Aim is `policy` (Chrome managed policy file) or `flags` (`chromeCommand` with `--proxy-server`). Setup does not change the GNOME system proxy.
