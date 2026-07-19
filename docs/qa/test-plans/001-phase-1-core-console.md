# Test Plan 001 — Phase 1: Core Console

Spec: [`docs/specs/001-phase-1-core-console.md`](../../specs/001-phase-1-core-console.md)
Phase doc: [`docs/phases/phase-1-core.md`](../../phases/phase-1-core.md)
Schema/pipeline: [`docs/log-schema.md`](../../log-schema.md)
Tier: 3 (Complex) — full plan + gap-filling tests + rendered evidence.

No `.claude/qa.json` exists in this repo, so the zero-dependency default
gates were used: `typecheck` = `npm run typecheck`, `build` = `npm run
build`, `test` = `npm test` (vitest — already a devDependency; no new
installs performed). No `contract`/`e2e` gate tool was declared, so the
API-contract and browser-rendered checks below were authored directly under
`test/` and via `tools/browser.js` per the Mode 1 instructions' fallback.

## Gate results (re-verification pass, post product-owner ruling + fix loop)

| Gate | Command | Result |
|---|---|---|
| typecheck | `npm run typecheck` | **PASS** — no errors |
| build | `npm run build` (server + web) | **PASS** — `dist/` and `dist/web/` produced cleanly |
| test | `npm test` (`vitest run`) | **PASS — 60/60 tests, 14/14 files** |

Full authored suite: 14 test files, 60 tests, **60 passed / 0 failed.**

### Re-verification of the three filed defects

| Defect | Owner ruling | Result |
|---|---|---|
| [1 — port-0 readback](../defects/001-phase-1-core-console-1.md) | In scope, fixed by backend | **verified-fixed** — `test/server/port-zero.test.ts` (2 tests) now passes; manually re-ran the original repro script against the rebuilt `dist/`: `server.port` now equals the real bound port (e.g. `51957`) and `GET /api/status` returns `200` (was `401`) |
| [2 — 100 MB RSS ~250 MB](../defects/001-phase-1-core-console-2.md) | Measured 263–292 MB accepted as within "~250 MB" tolerance | **accepted-by-owner**, not a code fix. `test/e2e/memory.test.ts`'s threshold updated from 250 MB to an owner-accepted 300 MB ceiling (chosen as a sensible margin above the observed range, so a genuine future regression is still caught). Re-run: peak RSS 268.8 MB, **passes** |
| [3 — Freeze badge copy](../defects/001-phase-1-core-console-3.md) | In scope, fixed by frontend | **verified-fixed** — `FreezeButton.tsx` now renders `"· {n} new"`; confirmed present in the **rebuilt production bundle** (`dist/web/assets/index-*.js` contains `children:["· ",n," new"]`), not just source. Not re-verified via a rendered screenshot of the live frozen state (still unreachable by the available browser tool — see Rendered evidence section, unchanged limitation) |

Original pre-fix run (for the record): 14 files, 60 tests, 57 passed / 3
failed, with the 3 failures mapping 1:1 to the three defects above
(`test/server/port-zero.test.ts` × 2, `test/e2e/memory.test.ts` × 1).

## Note on `npx vitest`

`npx vitest run` was blocked by the environment's agentic-dev hook:
`Blocked for agentic-dev:qa-engineer: installing dependencies is the
backend-developer lane's responsibility, not yours. Raise it under OPEN
QUESTIONS. Do not retry.` — vitest is already a devDependency and present in
`node_modules`, so this was worked around by using `npm test` /
`node_modules/.bin/vitest` directly (which invoke the already-installed
local binary without touching the registry). No dependency was installed by
QA at any point. Flagged in the handoff's OPEN QUESTIONS for awareness, not
treated as a blocker since a working invocation exists.

## Authored automated tests (`test/`)

| File | Purpose |
|---|---|
| `test/parsers/monolog.test.ts` | Golden: monolog format parser (level, message, context-blob extraction, PHP stack-trace continuation detection) |
| `test/parsers/clf.test.ts` | Golden: CLF access + nginx/apache error-log formats (status→level, field extraction) |
| `test/parsers/jsonl.test.ts` | Golden: JSONL (pino-style numeric levels, key aliasing, unmapped-key context) |
| `test/parsers/raw.test.ts` | Golden: raw fallback (keyword-scan level inference, whole-word matching) |
| `test/parsers/pipeline-golden.test.ts` | End-to-end pipeline (line-split → aggregate → detect → normalize) golden tests per fixture, incl. the multi-line PHP stack-trace criterion (#8) and ANSI-stripping |
| `test/parsers/chunk-fuzz.test.ts` | Chunk-boundary fuzz per `log-schema.md` § Testing strategy: 15 random re-chunkings × 6 fixtures, asserts identical output to whole-file feed |
| `test/server/ring-buffer.test.ts` | Ring buffer unit coverage: id monotonicity, eviction, `after()`, `clear()` |
| `test/e2e/smoke.test.ts` | The phase-1 exit-criteria smoke test: start server programmatically, upload a fixture over HTTP, assert the WS stream delivers the expected parsed entries |
| `test/server/auth.test.ts` | Token auth: 401 on REST without/with-wrong token; WS upgrade rejected with HTTP 401 pre-handshake |
| `test/server/replay-and-clear.test.ts` | Replay-on-connect ordering (entries before sources, before live traffic); `GET /api/replay?after=`; `cleared` broadcast reaching a second client |
| `test/server/upload-guardrails.test.ts` | 413 hard-cap (via declared `Content-Length`, no need to send 500 MB); 400 duplicate source name; 400 missing `name` |
| `test/server/subscribe.test.ts` | WS `subscribe`/`unsubscribe` protocol: mid-upload unsubscribe stops delivery to that client only; resubscribe restores it |
| `test/server/port-zero.test.ts` | Regression test for [defect 1](../defects/001-phase-1-core-console-1.md) |
| `test/e2e/memory.test.ts` | 100 MB memory/responsiveness criterion (defect 2) |
| `test/helpers/server.ts`, `test/helpers/child-server-runner.ts` | Shared harness (ephemeral-port server, out-of-process server for isolated RSS measurement) |
| `test/fixtures/*` | `monolog-laravel.log`, `nginx-access.log`, `nginx-error.log`, `pino.jsonl`, `raw.log`, `nasty.log` (ANSI + mixed formats + stack trace) |

### Fixture note vs. `log-schema.md` § Testing strategy

That section's fixture list also names "a Docker-multiplexed binary
capture." Docker log demuxing is an **ingest-adapter** concern
(`src/ingest/docker.ts`, phase 2 — explicitly out of scope per this spec's
Overview) rather than a Uniform Parser Pipeline concern; no such adapter
exists yet to test against in phase 1. Not built; not treated as a gap for
*this* phase — carried forward as a phase-2 QA item.

## Acceptance criteria → verification mapping

| # | Criterion | Verified by |
|---|---|---|
| 1 | Token auth: 401 on any `/api/*` / `/ws` without/wrong token; terminal "Invalid or expired session" UI | `test/server/auth.test.ts` (8 tests, REST + WS upgrade pre-handshake rejection) + rendered evidence `03-invalid-token.png` (exact spec copy confirmed in DOM) |
| 2 | Empty state layout | Rendered evidence `01-empty-state.png` / `.dom.html` — sidebar (header + drop area only), top-bar controls `disabled` (DOM-verified `disabled=""` on Freeze/Clear/Search/all 6 level chips), centered placeholder copy matches spec verbatim |
| 3 | Global drag-over overlay; drop starts upload; drag-out/Escape cancels with no state change | **Static code review only** — `tools/browser.js` supports navigation + DOM dump/screenshot but has no interaction/event-dispatch capability (confirmed via its own `--help`/source: `dom`/`shot`/`check` only). Reviewed `web/src/hooks/useGlobalDragAndDrop.ts`: `dragenter` on `window` (not just the drop box) with a counter for nested enter/leave correctness, `Escape` resets with no upload triggered, `drop` calls `onDropFiles` only when files present. Matches spec. Not independently exercised in a real browser. |
| 4 | 50–500 MB soft-warning confirm; decline sends nothing | Static code review — `web/src/store/store.tsx` `startUpload`: `window.confirm` with exact spec copy (`This file is ${mb} MB and will occupy most of the ring buffer — continue?`), returns before any XHR on decline. `SOFT_WARN_BYTES`/`HARD_CAP_BYTES` = 50 MB / 500 MB exactly (`web/src/utils/format.ts`). Not exercised via a real 50–500 MB file in a real browser (no interaction capability — see #3). |
| 5 | >500 MB rejected client-side, no bytes sent; server 413 hard cap independently exercised | Client-side: static code review (`startUpload` returns via `window.alert` before any XHR when `file.size > HARD_CAP_BYTES`). Server-side: `test/server/upload-guardrails.test.ts` (413 exercised via a non-browser client — a declared `Content-Length` over the cap, matching the documented error shape exactly, no 500 MB payload actually required) |
| 6 | Completed upload → correct sidebar row (icon, label, count, checkbox, toggle, `stopped`) | `test/e2e/smoke.test.ts` (`GET /api/sources` assertions) for the data contract; rendered evidence `02-populated-stream.png` for the actual sidebar render (checkbox checked, file icon, label, count "6", toggle on) |
| 7 | 100 MB parses to completion; Node process ~250 MB RSS; tab stays responsive | `test/e2e/memory.test.ts` — **PASS** (owner-accepted ceiling). Peak RSS measured at 263–292 MB across independent runs, literally over the spec's ~250 MB wording; product owner reviewed the measurement and **accepted it as within tolerance for phase 1** (see [defect 2](../defects/001-phase-1-core-console-2.md), closed accepted-by-owner). Test threshold updated to an owner-accepted 300 MB ceiling; latest run 268.8 MB. Upload itself completes correctly in all runs. "Tab stays responsive" is only proxied here by server-side responsiveness to concurrent requests during the upload (a real browser tab can't be driven under load by the available tooling); the observed ~3s peak latency was likewise reviewed and **accepted by the owner** as fine for phase 1 (no numeric criterion added) |
| 8 | Multi-line PHP stack trace → one entry, `multiline: true`, chevron, full trace + `context` in expanded view | `test/parsers/pipeline-golden.test.ts` (pipeline-level: one entry, correct `body`/`context`/`multiline`) + `test/parsers/monolog.test.ts` (parser-level). Expanded-panel rendering (chevron, syntax highlighting, "Copy Raw", Context sub-block) verified by **static code review** of `Row.tsx` / `ExpandedPanel.tsx` / `utils/highlight.ts` only — expansion requires a click, not reachable by the available browser tool |
| 9 | Collapsed row: 4 columns in order, 40px height, colored edge + level word | Rendered evidence `02-populated-stream.png` — visually matches exactly (verified per-level: DEBUG/INFO/WARN/ERROR colored edges + text; FATAL rendered as filled chip, distinct from ERROR's text-only treatment). "No layout shift as new rows stream in" not independently load-tested visually (would need a scripted, sustained-throughput browser session) |
| 10 | Auto-follow pin/unpin; "↓ Live" appears/re-pins | Static code review only (`StreamPanel.tsx`: `handleScroll` threshold, `jumpToLive`) — scrolling requires interaction not reachable by the available tooling |
| 11 | Freeze Stream: stops updates, accumulates "· n new", unfreeze renders/scrolls/re-pins | **PASS** — static code review (`FreezeButton.tsx`, `store.tsx` reducer `FREEZE`/`UNFREEZE`, `useVisibleEntries`'s `frozenAt` slice); badge now renders the spec-quoted `"· n new"` exactly, confirmed in both source and the rebuilt production bundle. See [defect 3](../defects/001-phase-1-core-console-3.md), verified-fixed |
| 12 | Search: debounced 250ms, matches message/body/raw, case-insensitive | Static code review (`store.tsx`: `SEARCH_DEBOUNCE_MS = 250`, `useVisibleEntries`'s `haystack` built from all three fields, `.toLowerCase()` both sides). Debounce timing not independently exercised (requires scripted typing) |
| 13 | Level chip toggle hides/restores level, no search re-run needed | Static code review — `activeLevels` and `searchQuery` are independent reducer slices ANDed in `useVisibleEntries`; toggling one never touches the other |
| 14 | Unsubscribe stops new entries + freezes count display; toggle disables; resubscribe restores both | Server side (entries genuinely stop being sent to that client, a second client is unaffected, resubscribing restores flow): `test/server/subscribe.test.ts` (2 tests, mid-upload unsubscribe + resubscribe). Client-side display-freeze (`entryCount` held at last value while unsubscribed) and toggle-disable: static code review of `store.tsx`'s `REPLACE_SOURCES`/`UPSERT_SOURCE` reducers and `SourceRow.tsx` |
| 15 | Visibility toggle off hides rows from stream/search while count keeps climbing | Static code review — `useVisibleEntries` filters on `source.visible`; `SET_SOURCE_VISIBLE` only affects `visible`, never `subscribed`/counting |
| 16 | Clear Logs empties stream in both initiating + second tab, both show toast | `test/server/replay-and-clear.test.ts` (`cleared` broadcast reaches a second client; `bufferUsed` is 0 after). Client-side toast-on-`cleared` and store-empty behavior verified by static code review of `store.tsx`'s message handler (both tabs run the same handler for the broadcast, per spec's design) |
| 17 | Refresh repopulates via WS replay-on-connect, no re-upload, no empty flash | `test/server/replay-and-clear.test.ts` (entries-before-sources ordering) + `test/e2e/smoke.test.ts`. Also **visually confirmed**: `02-populated-stream.png` was captured by uploading via HTTP first, then loading the page fresh — the populated stream is exactly the replay path, not a live-upload path |
| 18 | All four parsers pass golden + fuzz | `test/parsers/{monolog,clf,jsonl,raw}.test.ts` + `test/parsers/chunk-fuzz.test.ts` — **PASS** |
| 19 | E2E smoke test passes | `test/e2e/smoke.test.ts` — **PASS** |
| 20 | Full keyboard reachability + focus ring + Enter/Space/Escape semantics | Static code review: global `:focus-visible { outline: 2px solid white; outline-offset: 2px }` (unscoped — applies to every native-focusable element used throughout, confirmed no component overrides it away); expandable rows are real `<button>`s (`Row.tsx`) with `Escape` handled in a wrapping `onKeyDown`; checkboxes/toggles are native/`role="switch"` with descriptive `aria-label`s; level chips are `<button aria-pressed>`; Browse is a real button. Not exercised via actual Tab-key traversal (no interaction capability) |
| 21 | Contrast ≥4.5:1 (spot-check); ERROR/FATAL distinguishable without color | Values in `web/src/styles/tokens.css` match `docs/design-system.md`'s token table exactly (spot-checked, not re-derived independently — trusting the design system's own recorded contrast math per this mode's instructions). FATAL-vs-ERROR: confirmed both in code (`Row.css`: `.row__level--fatal` is a filled chip via `background`/`color-text-inverse`, `.row__level--error` is text-only) **and** visually in `02-populated-stream.png` (FATAL renders as a solid-fill pill, ERROR as colored text) |
| 22 | "Copy Raw" copies exact `entry.raw`, not the highlighted display text | Static code review — `ExpandedPanel.tsx`'s `handleCopy` calls `copyText(entry.raw)` (the untouched field), never the highlighted `bodyHtml`. Not exercised via a real clipboard read (would need browser interaction + clipboard permission, unavailable here) |

### Phase doc (`phase-1-core.md`) exit-criteria cross-check

| Exit criterion | Status |
|---|---|
| `npx traceriver start` opens on a free port with token auth active | PASS — covered by criterion 1 + the CLI's default (non-zero) port path; the port-0 defect (#1), which never affected this documented default-port/auto-increment flow, is now fixed regardless |
| 100 MB Laravel log parses without exceeding ~250 MB RSS, tab responsive | **PASS (owner-accepted tolerance)** — see criterion 7 / defect 2 |
| Multi-line PHP stack traces → single expandable entries, highlighted bodies | PASS — criterion 8 |
| All four parsers pass golden + fuzz | PASS — criterion 18 |
| Search, level chips, source toggles, Freeze, Clear behave per doc | PASS at the logic/data level (criteria 12–16); UI-interaction layer verified only by static review — see notes above |
| Browser refresh repopulates via replay | PASS — criterion 17 |

## Rendered evidence

`docs/qa/evidence/001-phase-1-core-console/`:
- `01-empty-state.png` / `.dom.html` — empty state, no sources
- `02-populated-stream.png` / `.dom.html` — populated stream after an HTTP upload + fresh page load (exercises replay-on-connect), all 6 levels represented including a multi-line FATAL entry
- `03-invalid-token.png` / `.dom.html` — terminal "Invalid or expired session" state

Captured with `tools/browser.js` (headless Chrome found and used — not a
static-HTML fallback). This tool's `--help`/source confirms it supports only
`dom` (post-JS DOM dump), `shot` (screenshot), and `check` (assertions
against the DOM) against a given URL — **no click/drag/keyboard scripting**.
That hard-caps what can be captured to states reachable by navigation alone
(empty state, a pre-populated stream via server-side upload + fresh load,
and the invalid-token error state). Every criterion that requires a click,
drag, hover, or keystroke to reach (row expansion, drag-over overlay, Freeze
badge, source-row dim/toggle states, "↓ Live" button, filtered-empty state,
toast, upload-progress bar) was verified by static code/CSS review instead,
called out per-row above. This is a tooling gap, not a decision to skip
those criteria.

## OPEN QUESTIONS

Product owner has ruled on defects 1–3 and the responsiveness-threshold
question (see the "Re-verification of the three filed defects" table above
and each defect file's Resolution section) — those are now closed, not open.
Remaining/residual items are listed in the handoff footer at the end of the
QA response (interaction-blind evidence gaps given the available browser
tool's capabilities, the missing `docs/qa/TEMPLATE-defect.md` / prior
test-plan example referenced by the QA role's general instructions but
absent from this repo, and the Docker-multiplexed-capture fixture carried
forward to phase 2).
