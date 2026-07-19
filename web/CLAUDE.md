# web/ — React SPA

Vite project with its own tsconfig; `vite build` outputs to `../dist/web`, which the server ships in the npm tarball. Types come from `../src/shared/types.ts` — the SPA only ever renders `TraceRiverLog` objects; it never parses log text.

Dev: `npm run dev` (repo root) runs this Vite server on 5173 proxying `/api` + `/ws` to the backend on 7580. The backend prints the session token; open `http://localhost:5173/?token=<token>` — without it every request 401s.

## Design system — binding

`src/styles/tokens.css` mirrors `docs/design-system.md` (terminal-chic: near-black, all-monospace, neon level accents). Rules that are enforced, not stylistic suggestions:

- **No raw color/spacing/type/radius value in any component.** If a design needs a new value, add it to `docs/design-system.md` first (with a reason), then to `tokens.css`, then reference the token.
- Level color is the **only** saturated color, and appears only on the row left-edge bar, the level word, and level filter chips. Icons are always neutral (`currentColor` inheriting text tokens). FATAL shares ERROR's hue deliberately — distinguished by filled chip vs. colored text, not color.
- The entire UI is monospace (JetBrains Mono via `@fontsource`, weights 400/700 only) — chrome included, not just log content. No CDN fonts; must work offline.
- **No icon library** (not on the dependency allowlist): all icons are hand-authored inline SVG in `components/icons.tsx`, 16–20 px, single-color `currentColor`.
- highlight.js registers **only the `json` and `plaintext` grammars** — never the full bundle.
- Desktop-only by product decision; no responsive breakpoints.

## Stream behavior (the parts that are easy to break)

- `store/store.tsx` holds entries, filtering, freeze/pin state. The backing array is **bounded to the same cap as the server ring buffer** — a week-long session must not balloon the tab.
- TanStack Virtual: fixed 40 px (`--row-height-collapsed`) estimate for collapsed rows, dynamic measurement for expanded ones. Expansion state is keyed by entry `id` so virtualization doesn't lose it.
- Auto-follow: pinned to bottom while at bottom; any upward scroll unpins and shows the "↓ Live" jump-back button.
- **Freeze freezes rendering only** — incoming batches keep landing in the store (badge shows "n new"); unfreezing scrolls to live tail. Nothing is ever dropped by freezing.
- On `{type:"dropped"}` from the WS, re-sync via `GET /api/replay?after=<lastSeenId>` — the server buffer is authoritative.
- Search/filtering is client-side: plain-text substring over `message`, `body`, *and* `raw` (so text a parser discarded still matches), debounced 250 ms, plus level chips and per-source visibility toggles. `visible` is client-local; `subscribed` is the server-side flag.

## Auth plumbing

`api/auth.ts` takes the token from `?token=` on first load and stores it; `api/rest.ts` sends `Authorization: Bearer`, `api/ws.ts` appends `?token=` to the upgrade URL. A 401 on the WS upgrade means invalid/expired session — show that state, don't retry-loop.
