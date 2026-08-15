---
name: aluvia
description: Use when a GUI computer-use workflow hits Cloudflare, Access Denied, CAPTCHA, unusual traffic, 403, or any block that looks like the datacenter IP is rejected. Also use when first installing Aluvia on this machine.
---

# Aluvia

Aluvia sends **this** Chrome through a residential/mobile IP so blocked sites treat the agent like a normal user. Local proxy: `http://127.0.0.1:18787`. All JSON on stdout. Follow `next`. Never print API keys. Do not launch a second Chrome except the one restart `chromeCommand` asks for.

If `aluvia` is not on PATH, prefix with `npx aluvia-cli`.

## When a workflow is blocked

Cloudflare, CAPTCHA, Access Denied, unusual traffic, or a hard 403 on a page that should load. Not a normal login wall.

1. Copy the address-bar URL.
2. `aluvia status` if you already ran setup on this machine. Follow `next`. `what` explains every field.
3. `{"code":"payment_required"}` → show the human `claim_url`. Then `aluvia auth login` to wait. **Paid** below.
4. First time, or `aimed` is false → **First install** (`setup --url <that URL>`).

## First install (once per machine)

```bash
npx aluvia-cli setup --url https://www.example.com/checkout
```

Read the JSON. **`next` is the next action.**

- `ready: true` → reload the blocked tab. Do not run setup again.
- `needsChromeRestart: true` → quit **this** Chrome, run `chromeCommand` **exactly** (not the dock unless `aim` is `policy`), open or reload the blocked URL. **Do not run setup again.** The daemon marks `aimed` when Chrome CONNECTs.

If the page is still blocked after that: `aluvia status`. If `aimed` is false, the platform replaced Chrome — run `setup --url <page>` and `chromeCommand` once more.

## Day to day

| Goal                                    | Command                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------ |
| Use Aluvia (all tabs through the proxy) | `aluvia proxy-on` then reload. Any country. `--geo US` only if required  |
| Back to the VM datacenter IP            | `aluvia proxy-off` then reload. Do not quit Chrome.                      |
| New exit IP                             | `aluvia rotate-ip` then reload. Any country. `--geo US` only if required |
| Check                                   | `aluvia status` — follow `next`                                          |
| Stop the daemon                         | `aluvia stop` — Chrome aimed at 18787 will break. Prefer `proxy-off`.    |

`proxy-on` / `proxy-off` do not restart Chrome.

## Paid / own proxy

The human cannot edit this VM. Ask them in chat. Then **you** run the command. Never set env vars. Never print the key.

- They paste an Aluvia API key → `aluvia auth <that key>`
- They paste their own proxy URL → `aluvia proxy-provider <url>`
- They want Aluvia again after a BYO proxy → `aluvia proxy-provider aluvia`
- Trial used up / `payment_required` → show them `claim_url`. They open it on their machine, enter email, type the 6-digit code from the email, Authorize, then Buy data if asked. You run `aluvia auth login` to wait — do not show a second URL.

Then `aluvia proxy-on` and reload the tab.

## Do not

Guess hostnames, write PAC/nftables, load an unpacked extension, use `chrome://settings/system`, or `chrome://policy`. Do not `stop` to turn the proxy off.
