---
name: aluvia
description: 'Use Aluvia when a cloud agent is in the wrong country for a site; when a page says not available in your region, this content is not available in your country, we don’t ship to your location, or other geo-restriction; when you need the browser to use an IP in a specific country (`aluvia proxy-on --geo US`; run `aluvia geos` for the list); when you suspect the datacenter IP is why a page is blocked (CAPTCHA, Cloudflare, Access Denied, unusual traffic, or a hard 403); or for first install of Aluvia on this machine. Run aluvia and follow next.'
---

# Aluvia

A cloud agent's browser uses the datacenter's country. Sites treat that country as the agent's location, then show that country's prices, catalog, and language, or say the content is not available there. Set a country. Aluvia sends **this** Chrome through a residential or mobile IP there. The site sees that country's IP and returns the matching page. A residential IP in the right country sometimes also clears a 403, CAPTCHA, or Cloudflare block. Aluvia does not set GPS, timezone, or Accept-Language, and does not change fingerprint, TLS, or canvas.

Local proxy: `http://127.0.0.1:18787`. All JSON on stdout. Follow `next`. Never print API keys. One Chrome restart is expected. Do not launch a second Chrome.

If `aluvia` is not on PATH, prefix with `npx aluvia-cli`.

## When the country is wrong

Wrong prices, catalog, or language; or the page says not available in your region, this content is not available in your country, we don’t ship to your location, or other geo-restriction. Country only — not city. Not a human VPN. Not streaming or live video.

1. Copy the address-bar URL.
2. First time, or `aimed` is false → **First install** (`aluvia setup`). Pass `--url <page>` only if you have the address-bar URL.
3. `aluvia geos` for the country list.
4. `aluvia proxy-on --geo US` (or another country from that list), then reload.

`{"code":"payment_required"}` always includes `claim_url` and `next` → show the human `claim_url`. Then `aluvia auth login` to wait. **Paid** below.

## When a workflow is blocked

Cloudflare, CAPTCHA, Access Denied, unusual traffic, or a hard 403 on a page that should load. Not a normal login wall. A residential IP in the right country sometimes clears the block. Fingerprint, TLS, and canvas stay the same.

1. Copy the address-bar URL.
2. `aluvia status` if you already ran setup on this machine. Follow `next`. `what` explains every field.
3. `{"code":"payment_required"}` always includes `claim_url` and `next` → show the human `claim_url`. Then `aluvia auth login` to wait. **Paid** below.
4. First time, or `aimed` is false → **First install** (`aluvia setup --url <https-page>`). Pass the address-bar URL. `--url` is required unless Chrome is already aimed.

## First install (once per machine)

```bash
npx aluvia-cli setup --url <https-page>
```

`--url <page>` is required when Chrome is not already aimed, so the restart opens a real HTTPS page that CONNECTs. Do not omit it. Do not invent a URL.

Read the JSON. **`next` is the next action.**

One restart is expected. `setup` tries to quit this Chrome and relaunch it with proxy flags. If you launch Chrome without quitting first, the flags are ignored.

- `ready: true` → a real CONNECT landed. Reload the blocked tab. Idle tabs stay aimed. Re-running setup while aimed is a no-op.
- `needsChromeRestart: true` → run `chromeCommand` **exactly** (it quits first, then launches). Then run `aluvia setup` again.

If still not aimed after that, run `aluvia setup` again. Follow `next`.

Idle is fine. If the page is still blocked after Chrome is aimed, reload the tab, then `aluvia status`. If that status says `aimed` is false, run setup again.

## Day to day

| Goal                                    | Command                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------ |
| Pick a country                          | `aluvia geos`, then `aluvia proxy-on --geo US`, then reload              |
| Use Aluvia (every geo)                  | `aluvia proxy-on` then reload. Omit `--geo` to use every geo             |
| Back to the VM datacenter IP            | `aluvia proxy-off` then reload. Do not quit Chrome.                      |
| New exit IP                             | `aluvia rotate-ip` then reload. `--geo US` to pin a country              |
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
