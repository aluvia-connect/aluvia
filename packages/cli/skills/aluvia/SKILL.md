---
name: aluvia
description: 'Use Aluvia when you suspect your datacenter IP is why websites are not loading or why you are having trouble completing your web workflow; when you see CAPTCHA, Cloudflare, Access Denied, unusual traffic, or a hard 403; a page will not load, is blocked, or shows a blank or error interstitial; or for first install or setup of Aluvia on this machine. Run aluvia and follow next.'
---

# Aluvia

Aluvia sends **this** Chrome through a residential/mobile IP so blocked sites treat the agent like a normal user. Local proxy: `http://127.0.0.1:18787`. All JSON on stdout. Follow `next`. Never print API keys. One Chrome restart is expected. Do not launch a second Chrome.

If `aluvia` is not on PATH, prefix with `npx aluvia-cli`.

## When a workflow is blocked

Cloudflare, CAPTCHA, Access Denied, unusual traffic, or a hard 403 on a page that should load. Not a normal login wall.

1. Copy the address-bar URL.
2. `aluvia status` if you already ran setup on this machine. Follow `next`. `what` explains every field.
3. `{"code":"payment_required"}` always includes `claim_url` and `next` → show the human `claim_url`. Then `aluvia auth login` to wait. **Paid** below.
4. First time, or `aimed` is false → **First install** (`aluvia setup`). Pass `--url <page>` only if you have the address-bar URL.

## First install (once per machine)

```bash
npx aluvia-cli setup
```

`--url <page>` is optional. If you have the blocked page, pass it so Chrome opens that tab after the restart.

Read the JSON. **`next` is the next action.**

One restart is expected. `setup` tries to quit this Chrome and relaunch it with proxy flags. If you launch Chrome without quitting first, the flags are ignored.

- `ready: true` → a real CONNECT landed. Reload the blocked tab. Idle tabs stay aimed. Re-running setup while aimed is a no-op.
- `needsChromeRestart: true` → run `chromeCommand` **exactly** (it quits first, then launches). Then run `aluvia setup` again.

If still not aimed after that, run `aluvia setup` again. Follow `next`.

Idle is fine. If the page is still blocked after Chrome is aimed, reload the tab, then `aluvia status`. If that status says `aimed` is false, run setup again.

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
