# Grok Bot skill catalog

Verified on this box (2026-08-29) against Grok CLI docs and the live catalog paths.

## Grok CLI / Grok Build

`grok inspect --json` and `~/.grok/docs/user-guide/08-skills.md` list skills from:

- `~/.grok/skills/` (user)
- `~/.agents/skills/`
- project `.grok/skills/`, `.agents/skills/`
- bundled skills under `~/.grok/bundled/skills/`

This machine already lists `aluvia` from `/home/box/.grok/skills/aluvia/SKILL.md`. Copying `SKILL.md` into those dirs is enough for Grok CLI.

## Grok Bot

Grok Bot does **not** use `grok inspect`. On this box `~/agent-data` is a symlink to `~/sand-data`. The host-assembled catalog is:

| Path | Role | CLI writes? |
| --- | --- | --- |
| `~/agent-data/managed-skills/` | Platform cache (`cache.json` + `skills/`) | No |
| `~/agent-data/plugin-skills/` | Platform plugin cache | No |
| `~/agent-data/workflows/` | User skills on disk (`<name>/SKILL.md`) | Yes, when this tree already exists |

`setup` already wrote `~/.grok/skills` and `~/.agents/skills`. Those files were on disk and **not** listed in the Grok Bot conversation catalog.

The CLI now also writes `~/agent-data/workflows/aluvia/SKILL.md` when `~/agent-data/workflows` already exists. It does not create `agent-data` itself. It does not write `managed-skills` or `plugin-skills`.

Grok Bot still injects the conversation catalog from the managed/plugin caches. Listing a user workflow in that catalog is host ingest of `~/agent-data/workflows`, not something this CLI can register. If a Grok Bot session still omits `aluvia` after setup, the remaining fix is platform ingest of that workflows tree.
