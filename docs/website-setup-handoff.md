# Website update prompt: bare CLI setup

Use the prompt below in a task for `/Users/blue/aluvia-website`.

---

Update the Aluvia website to match the new CLI setup flow. Preserve unrelated work and keep the edit focused on setup, quickstart instructions, and claims about setup.

First verify the released CLI version. Version 1.4.12 is prepared in `/Users/blue/aluvia/.worktrees/frictionless-setup`; it has not been published as part of this task. Do not publish website claims that depend on the new behavior until a released npm package contains this change. You can prepare and test the website changes before that release.

Read the CLI README, bundled skill, and `docs/testing/bare-setup.md` in that worktree. Check the current repository instructions and website facts before editing. The website already has unrelated work in progress; preserve it.

The new behavior:

- The initial command remains exactly `npx aluvia-cli setup`. A target page URL is no longer required.
- Run it on the machine where the agent's Chrome or Chromium browser runs. Node.js 18 or later and a usable local browser runtime are required.
- Setup installs the command launcher and agent skill, starts the local proxy, configures the browser, enables proxy traffic, and checks the upstream connection.
- Initial configuration can restart Chrome. When a restart is needed and no URL was supplied, setup opens the small HTTPS test page `https://example.com/`. Optional `--url <page>` opens a specific page instead. Do not add it to the primary setup command or imply that users need to find a page URL.
- A working setup can be run again without restarting the browser or changing a live proxy session. It checks the connection again and enables proxy traffic.
- On Linux, the CLI retains the discovered browser's launch settings, including its profile and TCP debugging port. It asks Chrome to close cleanly through an existing debugging connection when available. Do not promise lossless state preservation across every browser platform or automation runtime.
- `ready: true` means the browser reached the local proxy and the upstream connection check passed. It is not proof that a target website will allow access or that an agent task succeeded.
- If setup cannot finish, its JSON output includes the next recovery action. Do not guarantee that setup always completes without intervention.

Make these website changes:

1. Keep the visible command and clipboard contents byte-for-byte equal to `npx aluvia-cli setup`. No attribution token, hidden suffix, shortened token, or extra shell command. Keep copy events classified as install intent, not confirmed installs.
2. Beside the main workflow, explain where to run setup and that initial browser configuration can restart Chrome. State that no target page URL is required. Keep optional flags in detailed docs.
3. Show the full path: run setup and check its result → choose a country or your own proxy → reload the target page → check the page and `aluvia status`. Successful setup already enables proxy traffic; the later command selects the desired configuration.
4. Correct all PATH fallback wording: **replace `aluvia` with `npx aluvia-cli`**. Example: `npx aluvia-cli status`.
5. Remove the claim “in seconds” unless a clean production first-run measurement supports it. The real-browser tests used local API and gateway fixtures; their timings do not support a public speed claim.
6. Update the homepage workflow, setup FAQ, `/docs`, `/setup`, related setup instructions, and generated agent-readable documents consistently. Likely sources include `src/site/sections/HowItWorks.tsx`, `Hero.tsx`, `src/content/docs.ts`, `setup.ts`, `product.ts`, and `resources.ts`. Check other setup references rather than making unrelated copy changes.
7. Update relevant tests and regenerate agent documents through the repository's existing script. Verify clipboard equality even when attribution data exists, complete quickstart steps, optional URL wording, and consistency between HTML and agent-readable output. Run relevant tests, type checks, the document consistency check, and a production build. Inspect the affected page at desktop and mobile widths.

Report changed files, checks performed, any remaining release dependency, and any claim you could not verify. Do not change pricing, trial size, navigation, or unrelated design.
