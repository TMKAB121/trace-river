# Test Plan 004 — Phase 4: Error Intelligence

Spec: [`docs/specs/004-phase-4-error-intelligence.md`](../../specs/004-phase-4-error-intelligence.md)
Phase doc: [`docs/phases/phase-4-error-intelligence.md`](../../phases/phase-4-error-intelligence.md)
Tier: 3 (Complex) — full plan + gap-filling tests + rendered evidence.

No `.claude/qa.json` exists in this repo (confirmed again this pass), so the
zero-dependency default gates were used, matching specs 001–003's own
precedent: `typecheck` = `npm run typecheck` + `node_modules/.bin/tsc -p
web/tsconfig.json --noEmit`, `build` = `npm run build`, `test` = `npm test`
(vitest). No `contract`/`e2e` gate tool was declared, so API-contract and
browser-rendered checks were authored directly under `test/` and via
`tools/browser.js` (found at
`/Users/anthonysayge/.claude/plugins/cache/agentic-dev/agentic-dev/0.1.4/tools/browser.js`
— this repo still has no `tools/` directory of its own, matching phases
2–3's own finding) per the Mode 1 instructions' fallback.

## Gate results

| Gate | Command | Result |
|---|---|---|
| typecheck (backend) | `npm run typecheck` | **PASS** — no errors |
| typecheck (web) | `node_modules/.bin/tsc -p web/tsconfig.json --noEmit` | **PASS** — no errors |
| build | `npm run build` (server + web) | **PASS** — `dist/` and `dist/web/` produced cleanly, bundle 289 KB / 90 KB gzip |
| test | `npm test` (`vitest run`) | **PASS — 196/196 tests, 38/38 files** |

Full suite: 38 test files, 196 tests — the pre-existing phase-1/2/3 suite's
109 tests, unchanged and still green, plus **87 new tests across 6 files**
authored this pass under `test/errors/` and `test/server/`. Confirmed with
**three** independent full-suite runs, all 196/196, plus one isolated re-run
of `test/e2e/memory.test.ts`; one of the three full-suite runs saw that
single pre-existing (phase-1, unrelated to this feature) memory test measure
309.6 MB against its owner-accepted 300 MB ceiling, under the transient
system load of a 38-file/~150s full run — every other measurement that run
and the isolated re-run (260.8 MB, 266.7 MB, 273.7 MB) landed comfortably
inside the already-documented 263–292 MB accepted range (`test/CLAUDE.md`).
Not treated as a phase-4 regression: no code touched by this feature sits on
that test's upload/parse path, and the measurement is not reproducible in
isolation. Noted here rather than silently discarded.

## Authored automated tests

| File | Purpose |
|---|---|
| `test/errors/fingerprint-golden.test.ts` (17 tests) | Fingerprint golden corpus per § 4.4: Laravel exceptions (400-rep identical-fingerprint + different-stack-top-split), mysql errors, nginx 5xx, Node unhandled rejections — each section asserts both "same bug, varying only rule-covered variable content merges" and "distinct bug/source never merges." Cross-ecosystem pairwise-distinct check. `entry.fingerprint` non-null only for ERROR/FATAL (criterion 7, unit level). `extractTopStackFrame` per-language frame detection. |
| `test/errors/normalize-text.test.ts` (17 tests) | Per-rule unit coverage of every documented placeholder rule (timestamp, date, UUID, hex≥8/hex<8, long/short int, quoted, memory address, duration, port, keyword-number, path collapse) plus "doesn't over-normalize ordinary prose" conservative-bias checks. |
| `test/errors/error-store.test.ts` (23 tests) | `ErrorGroupStore` unit coverage via a fake `SampleResolver`: 400-rep grouping (criterion 1), 500-cap LRU eviction + revival-from-scratch, `sampleEntryIds` pinned-oldest+9-recent composition (Decision 2), full eviction-survival matrix (metadata survives, sticky `rawEntriesEvicted`, re-pinning, `getContextAnchor` fallback) (criterion 6), `computeSpiking` per-condition unit tests + live spike-then-clear via `tick()`/`get()` (criterion 4). |
| `test/errors/prompt-snapshot.test.ts` (17 tests) | `assemblePrompt` snapshot tests against a real (not re-implemented) `RingBuffer`/`SourceRegistry`/`ErrorGroupStore`: full template structure/field-mapping, Environment section (docker-image annotation, framework comma-join, omitted-when-empty), 4-backtick fence widening, cross-source context (nginx-500-caused-by-mysql-down, criterion 5), 15-line context cap, all four documented redaction patterns (Bearer/password/AWS key/generic secret) + a combined redaction+cross-source scenario, eviction fallback text for stack-trace/context/both (criterion 6), deterministic occurrence-pattern text. |
| `test/server/errors-pipeline-criteria.test.ts` (7 tests) | Criteria exercised through the **real HTTP upload → parser pipeline → ingestion** path (not a direct store call), matching criterion 1's own "through the pipeline" wording: 400-rep Laravel fixture -> 1 group/count 400; two-distinct-stack-tops fixture -> 2 groups; mixed-level fixture -> fingerprint non-null only on ERROR/FATAL entries over the wire; live `errorGroups` WS growth during an open connection; Errors-panel data unaffected by a client's own unsubscribe (criterion 13); `GET /api/errors` mirrors the latest WS payload (criterion 15); small-`--buffer` eviction-survival harness end-to-end, including a successful (200, graceful-fallback-text) prompt request afterward (criterion 6). |
| `test/server/errors-rest-and-ws-sequence.test.ts` (6 tests) | `GET /api/errors` auth (401 no/wrong token, 200 `{groups:[]}`); `GET /api/errors/:fingerprint/prompt` auth + 404 `{error:"not_found"}` for a never-tracked fingerprint (criterion 14); WS connect-sequence ordering — `errorGroups` strictly follows `sources` and is the last connect-sequence message, sent even as `[]` (criterion 3's wire half). |

## Acceptance criteria → verification mapping

| # | Criterion | Verified by |
|---|---|---|
| 1 | 400 reps -> one group, count 400 | `error-store.test.ts` (unit) + `errors-pipeline-criteria.test.ts` (full pipeline, real upload) — **PASS** |
| 2 | Same message, different stack top -> separate groups | `fingerprint-golden.test.ts` (unit) + `errors-pipeline-criteria.test.ts` (full pipeline) — **PASS** |
| 3 | Live badges/panel/tab-count/toggle/jump-to-latest all work live | `errors-pipeline-criteria.test.ts` (live WS `errorGroups` growth) + `errors-rest-and-ws-sequence.test.ts` (connect-sequence ordering) for the wire half; rendered evidence `01-stream-default-badges-spiking.png`/`.dom.html` (sidebar badges "12"/"45" with correct `aria-label`s, `Errors · 7` tab count reflecting *group* count not occurrence sum) for the render half; `ErrorsOnlyToggle.tsx`/`store.tsx`'s `useVisibleEntries` AND-filter, and `useLatestErrorShortcut.ts`/`jumpToLatestError` action, verified by **static code review** (interaction — toggling/pressing `e` — is outside the available browser tool's navigation-only capability, same limitation documented in specs 001–003's own test plans) |
| 4 | Spike badge triggers on burst, clears on subsidence | `error-store.test.ts` (`computeSpiking` unit matrix + live trigger-then-clear via `tick()`) — **PASS**; rendered evidence `01-stream-default-badges-spiking.png` captures a **live, real** spike (seeded via real wall-clock-timed uploads, confirmed via `GET /api/errors` immediately before capture, timed to a fresh minute boundary so the ~2–4s browser-tool overhead didn't cross into the next histogram bucket) showing both the ErrorGroup-card-family `⚡ SPIKING` chip and the sidebar source row's pulsing indicator simultaneously |
| 5 | nginx-500-caused-by-mysql-down: context includes the mysql failure, secrets redacted | `prompt-snapshot.test.ts` ("cross-source context" + "redaction" describe blocks, including one test combining both in a single seeded scenario) — **PASS** |
| 6 | Groups survive eviction; samples marked evicted; prompt falls back gracefully (still 200) | `error-store.test.ts` (unit eviction-survival matrix) + `prompt-snapshot.test.ts` (fallback text for stack-trace/context) + `errors-pipeline-criteria.test.ts` (end-to-end small-`--buffer` harness, including a real 200 prompt response with fallback text) — **PASS** |
| 7 | `fingerprint` non-null only ERROR/FATAL | `fingerprint-golden.test.ts` (unit) + `errors-pipeline-criteria.test.ts` (mixed-level fixture over the wire) — **PASS** |
| 8 | Source badge click -> Stream tab + scope chip + Errors Only on, without touching visibility/checkbox; `×` clears scope only | **Static code review**: `SourceRow.tsx`'s error-badge `onClick={() => actions.setScopeSource(source.id)}`, `store.tsx`'s `SET_SCOPE_SOURCE` reducer (`errorsOnly: true, view: "stream"`, no touch to `sources`/`visible`/`subscribed`), `CLEAR_SCOPE_SOURCE` (only clears `scopeSourceId`, leaves `errorsOnly` alone), `ScopeChip.tsx`'s `×` button, `useVisibleEntries`'s independent `scopeSourceId` AND-filter — all match the spec's exact wording. Badge `aria-label` format (`"<n> errors from <source id> — filter stream to these"`) confirmed live in rendered evidence's DOM dump. Not exercised via an actual click (tool limitation, as above) |
| 9 | Recency/Count sort, `aria-checked` exclusivity | **Static code review**: `ErrorsSortControl.tsx` (`role="radiogroup"`/`role="radio"`, `aria-checked={state.errorsSort === "..."}` on both, mutually exclusive by construction), `useSortedErrorGroups` (`lastSeen`/`count` descending) — matches exactly. Not click-reachable for rendered evidence |
| 10 | Expand -> up to 10 samples, each independently expandable, Generate button | **Static code review**: `ErrorGroupCard.tsx` (renders exactly `group.sampleEntryIds.length` rows, newest-first), `SampleRow.tsx` (reuses `ExpandedPanel` verbatim per-sample). Server-side 10-sample cap covered by `error-store.test.ts`. Not click-reachable for rendered evidence |
| 11 | Generate AI Prompt (both entry points) -> same modal, editable, Copy confirms + copies current text, Escape/×  returns focus | **Static code review**: `AIPromptModal.tsx` (loading/error/loaded states match spec copy verbatim, `useFocusTrap` hook, `handleCopy` copies `promptText` state — i.e. the *current*, possibly-edited value — shows "Copied" for 1.5s, announces "Prompt copied to clipboard."), `ErrorGroupCard.tsx`'s Generate button and `ExpandedPanel.tsx`'s sparkle button both call the same `actions.openPrompt(fingerprint)`, `store.tsx`'s `openPrompt`/`closePrompt` (return-focus-to-opener via `promptReturnFocusRef`). REST 404 path covered by `errors-rest-and-ws-sequence.test.ts`. Not click-reachable for rendered evidence |
| 12 | Sparkle icon only on ERROR/FATAL rows with non-null fingerprint | **Static code review**: `ExpandedPanel.tsx`'s `promptFingerprint = (level ERROR/FATAL) ? entry.fingerprint : null`, gating `{promptFingerprint && <button ...>}` — matches exactly. Design review's own pixel-identical-for-non-error-rows sign-off is out of QA's scope per the criterion's own text ("Verified by design review against rendered evidence") |
| 13 | Errors panel ignores source visibility/subscription | `errors-pipeline-criteria.test.ts` ("unsubscribe still receives full errorGroups") + `ErrorsPanel.tsx`/`useSortedErrorGroups` static review (no visibility/subscription read anywhere in the group-list path) — **PASS** |
| 14 | Unknown/evicted fingerprint prompt -> 404, modal shows documented message | `errors-rest-and-ws-sequence.test.ts` (404 `{error:"not_found"}`) + `AIPromptModal.tsx` static review (exact copy match for the 404 branch) — **PASS** |
| 15 | `GET /api/errors` mirrors latest WS `errorGroups` | `errors-pipeline-criteria.test.ts` — **PASS** |
| 16 | Fingerprint golden + prompt snapshot tests pass | `fingerprint-golden.test.ts` + `prompt-snapshot.test.ts` — **PASS** (QA/backend-owned, satisfied here) |
| 17 | Full keyboard reachability, focus ring, modal Tab-trap, `e` never hijacks editable/modal focus | **Static code review**: every new control is a native `<button>`/`role="radio"`/`role="tab"`; global `:focus-visible` rule (unscoped, confirmed in spec 001's own QA pass) applies unchanged; `useFocusTrap.ts` implements a correct roving Tab/Shift+Tab wrap within the modal; `useLatestErrorShortcut.ts` bails on `INPUT`/`TEXTAREA`/`contentEditable`/modal-open exactly per spec. Not exercised via actual Tab-key traversal (tool limitation, as above) |
| 18 | Contrast; SPIKING/badge legible without color | Token reuse verified: no new color tokens introduced (`docs/design-system.md` § Design tokens used confirms this explicitly); `SpikingBadge`/error-badge both carry required text/numeral content per spec, not color-only. Full contrast math and CVD-simulation sign-off is this criterion's own stated **design-review** responsibility, not QA's — flagged, not independently re-derived |
| 19 | `--motion-pulse` suppressed under reduced motion | `web/src/components/SpikingBadge.css` (`@media (prefers-reduced-motion: reduce) { animation: none; }`) + `docs/design-system.md`/`tokens.css` token definitions cross-checked and consistent. **Not captured as rendered evidence in both motion-preference states** — `tools/browser.js` exposes no flag to force `prefers-reduced-motion`, so this criterion's "verified by design review against rendered evidence in both motion-preference states" instruction falls to the design-review stage, which may have separate tooling; QA's contribution here is the static CSS confirmation only |
| 20 | No third-party/AI-service network calls anywhere | **Code review**: `grep` across `src/errors/`, `src/server/routes/errors.ts`, `src/server/ingest-entries.ts`, `web/src/api/rest.ts`, `web/src/components/AIPromptModal.tsx` for `fetch`/`http(s).request`/`axios`/known AI-service hostnames — the only `fetch` call found is `web/src/api/rest.ts`'s existing same-origin REST helper (relative `path`, same one used by every other endpoint); no external hostname anywhere. **PASS** |

## Rendered evidence

`docs/qa/evidence/004-phase-4-error-intelligence/`:

- `01-stream-default-badges-spiking.png` / `.dom.html` — default Stream view
  after seeding a 12-occurrence Laravel exception and a live-timed mysql
  connection-refused burst: sidebar `FILES` section shows per-source error
  badges (`12`, `45`×N) with the documented `aria-label` text, one source
  row showing the pulsing `⚡ SPIKING` indicator (captured **while the spike
  condition was genuinely true**, confirmed via `GET /api/errors`
  immediately beforehand — not a static/frozen mock), `FATAL` rows rendered
  as the filled inverse-text chip (unchanged from spec 001, still correct
  post-phase-4), the top bar's `Errors · 7` tab badge (7 distinct *groups*,
  not the ~300+ raw occurrences behind them — direct visual confirmation of
  the "counts the same unit the panel is built from" requirement), and
  `CONTAINERS: No containers found in this project.` / `ENVIRONMENT:
  homebrew:php-fpm WAITING` (this dev machine's real, incidental Homebrew
  PHP-FPM install, auto-discovered per phase 3 — unrelated to phase 4,
  included only because it was genuinely present).
- `02-empty-no-sources-view-switcher-disabled.png` / `.dom.html` — a
  **genuinely empty** project (temporary `traceriver.json` with
  `docker.enabled: false` and `discovery.enabled: false`, run from a scratch
  directory, to rule out this same machine's real Homebrew/Docker
  environment tripping `hasSources`): DOM-confirmed `disabled=""` on both
  `#view-tab-stream` and `#view-tab-errors`, alongside Freeze/Clear/Latest
  Error — the view switcher's `!hasSources` gating matches spec exactly.
  (An earlier capture attempt against the *real* dev-machine environment
  incorrectly looked like a "tabs not disabled" defect at first glance —
  investigated and resolved: that instance had already auto-discovered the
  real `homebrew:php-fpm` source per phase 3, so `hasSources` was genuinely
  `true` there; not a phase-4 bug. Recorded here so the false start isn't
  silently lost.)

Captured with `tools/browser.js` (headless Chrome found and used, not a
static-HTML fallback) via `node dist/cli.js start --port <spare> --no-open`
+ seeding through the real `/api/upload` endpoint (crafted monolog fixtures,
built to real current wall-clock timestamps for the spike scenario so the
server's wall-clock-bucketed histogram would genuinely trigger `spiking`
live, not just in a unit test). Same hard cap as specs 001–003's own QA
passes: `tools/browser.js` supports only `dom`/`shot`/`check` (navigation +
static capture, **no click/drag/keyboard scripting**) — every criterion
requiring a click to reach (Errors tab content, card expansion, scope-chip
application, sort-control toggling, the AI Prompt Preview modal, the stream
row's sparkle-icon-triggered modal) was verified by static code review
instead, called out per-row in the mapping table above. This is a tooling
gap carried forward from every prior phase's QA pass, not a decision to skip
those criteria.

## Finding (not filed as a defect — informational)

While building the fingerprint golden corpus, the ISO-timestamp/date
normalization rule (`src/errors/normalize-text.ts`'s `ISO_TIMESTAMP_SRC`/
`DATE_ONLY_SRC`) only matches dash-separated `YYYY-MM-DD` dates — it does
**not** match nginx's own default slash-separated error-log timestamp format
(`2026/07/19 15:31:15`). In practice this rarely matters: `src/parsers/
formats/clf.ts`'s error-log branch (`ERROR_RE`) already strips the leading
`[timestamp] [level]` (and any further bracketed `[client x]`-style groups)
before `message` ever reaches fingerprinting, so a CLF-parsed nginx error
line's `message` field never contains the raw timestamp text to begin with.
It could only matter for a slash-dated line that reaches fingerprinting
through the `raw` fallback parser (message = the whole first line,
untouched) — a real but narrower scenario than "every nginx log." No
acceptance criterion tests this specific format, and the spec's own stated
bias treats the resulting failure mode (a false split — two occurrences that
should merge, don't) as the *acceptable* one, not the worse "false merge"
failure — so this isn't filed as a defect, just recorded for the corpus's
own stated "grows the same way, per new false-negative reports" process
(§ Interaction specs — Fingerprinting & grouping).

## Defects filed

- [`004-phase-4-error-intelligence-1`](../defects/004-phase-4-error-intelligence-1.md)
  (Area: frontend, Severity: low, Status: open) — the sparkline tooltip's
  client-side occurrence-pattern text
  (`web/src/utils/occurrencePattern.ts`) can diverge from the AI prompt's
  server-side occurrence-pattern text (`src/errors/prompt.ts`) for the same
  histogram, because the two independent implementations compare
  `peakValue` against a rounded vs. an unrounded average respectively —
  contradicting the spec's explicit "summarizing the *same*... text the
  prompt itself generates" requirement. Reproduced with a concrete
  `perMinute` input; does not affect the authoritative server-side
  `group.spiking` flag or the AI prompt's own text, both of which remain
  correct.

## OPEN QUESTIONS

See the handoff footer at the end of the QA response.
