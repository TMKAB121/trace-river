# Phase 0 — Foundation

**Objective:** Claim the name, stand up the repo, and settle the legal/account groundwork — everything that should exist *before* the first line of product code. All of this is an afternoon of work; none of it should be retrofitted later.

## 0.1 npm account & name claim

- Create an npm account (or use an existing one) and **enable 2FA** — set the account-level 2FA mode to "Authorization and writes." Publishing without 2FA is asking for a supply-chain incident under your name.
- Publish `traceriver@0.0.1` as a **legitimate placeholder**, not a bare squat. npm's dispute policy allows others to challenge empty name-squatting packages; a placeholder that states intent, links the repo, and shows ongoing development is fine. Concretely, the placeholder ships:
  - a real README: what TraceRiver will be, link to the GitHub repo, "under active development" status;
  - a working `bin` so `npx traceriver` prints a friendly "TraceRiver is under development — follow along at <repo url>" instead of erroring;
  - correct `description`, `keywords`, `repository`, `license` fields — this metadata is what the npm search page shows from day one.
- Optionally also publish `trace-river@0.0.1` and immediately `npm deprecate` it with a pointer to `traceriver` — cheap insurance against confusing lookalikes.
- Version discipline: placeholder is `0.0.1`; real phase-1 releases start at `0.1.0`; `1.0.0` is reserved for "phases 1–3 complete and stable."

## 0.2 Repository & hosting

- `git init` + initial commit of the docs tree (the repo predates this phase as a plain directory).
- Create the GitHub repository, push, and set it as `repository` in the placeholder's package.json **before** publishing — the npm page should link somewhere real from the first minute.
- Baseline hygiene files: `.gitignore` (node_modules, dist, .DS_Store), `.editorconfig`, `.nvmrc` (`20`).

## 0.3 License

- **MIT** — the conventional choice for npm dev tooling, maximizes adoption and contribution, matches every dependency in the planned stack. Add `LICENSE` to the repo and `"license": "MIT"` to package.json.
- If copyleft matters to you more than adoption, decide *now* — relicensing after outside contributions requires every contributor's consent.

## 0.4 Name & identity checks (done / optional)

- ✅ `traceriver` and `trace-river` unclaimed on npm (verified 2026-07-19).
- ✅ No existing software product named "TraceRiver" found in a web search (2026-07-19) — nearby names are all unrelated "Tracer" tools.
- Optional, time-permitting: grab the GitHub repo name you want long-term, and a domain (`traceriver.dev`) if a docs site is ever in the cards. Neither blocks anything.

## 0.5 Publish-pipeline decisions (recorded now, implemented in phase 1)

- Publishes will eventually run from CI (GitHub Actions) with **npm provenance** (`npm publish --provenance`) once the repo is public — gives consumers a verifiable build attestation.
- Until then, publishes are manual from a 2FA-protected account; no automation tokens are created in phase 0 (fewer credentials = smaller attack surface).

## Exit criteria

- [ ] `npm view traceriver` shows 0.0.1 with real description, repo link, and MIT license.
- [ ] `npx traceriver` prints the under-development notice.
- [ ] GitHub repo is live with the docs tree, LICENSE, .gitignore, .nvmrc committed.
- [ ] npm account has 2FA on "authorization and writes."
