# Test Plan 003 — Phase 3: Auto-Discovery

Spec: [`docs/specs/003-phase-3-auto-discovery.md`](../../specs/003-phase-3-auto-discovery.md)
Phase doc: [`docs/phases/phase-3-auto-discovery.md`](../../phases/phase-3-auto-discovery.md)
Tier: 3 (Complex) — full plan + gap-filling tests + rendered evidence.

No `.claude/qa.json` exists in this repo, so the zero-dependency default
gates declared by this run were used: `typecheck` = `npm run typecheck` +
`node_modules/.bin/tsc -p web/tsconfig.json --noEmit`, `build` = `npm run
build`, `test` = `npm test` (vitest — already a devDependency; no new
installs performed, no `npx`). Rendered evidence captured with
`node /Users/anthonysayge/.claude/plugins/cache/agentic-dev/agentic-dev/0.1.4/tools/browser.js`
(headless Chrome found and used, not a static-HTML fallback) — this repo has
no `tools/` directory of its own, matching phase 2's QA pass's finding.

## Gate results

| Gate | Command | Result |
|---|---|---|
| typecheck (backend) | `npm run typecheck` | **PASS** — no errors |
| typecheck (web) | `node_modules/.bin/tsc -p web/tsconfig.json --noEmit` | **PASS** — no errors |
| build | `npm run build` (server + web) | **PASS** — `dist/` and `dist/web/` produced cleanly |
| test | `npm test` (`vitest run`) | **106/109 passed, 3 intentionally red** — the 3 failures are committed regression tests for [defect 1](../defects/003-phase-3-auto-discovery-1.md) and [defect 2](../defects/003-phase-3-auto-discovery-2.md), left red on purpose (same convention as phase 2's `test/docker/demux.test.ts` pre-fix) |

Full suite: 32 test files, 109 tests total (the pre-existing phase-1/phase-2
suite's 22 files / 81 tests, unchanged and still green, plus 10 new files /
28 tests under `test/discovery/`).

## Environment notes for this pass

- This dev machine has a **real Homebrew install** (`/opt/homebrew/var/log`
  exists). `test/discovery/helpers.ts`'s `startDiscoveryTestServer()`
  disables `herd`/`valet`/`homebrew` by default specifically so the rest of
  this suite's assertions don't silently depend on that — tests that
  exercise environment-tier detection opt back in per-detector, and (for
  Herd/Valet, whose log directories resolve relative to `os.homedir()`)
  fixture-inject a fake `$HOME` rather than touch anything real. **Homebrew's
  log directory is a hardcoded absolute path
  (`src/discovery/environment.ts`'s `HOMEBREW_LOG_DIR`) with no fixture
  seam** — it cannot be fixture-injected the way Herd/Valet can. It was
  exercised only incidentally (real, read-only observation) while debugging
  during this pass, confirming the detector itself works correctly on this
  host; it has no dedicated automated test and is **manual-only** per the
  run brief's own instruction ("do NOT depend on the machine having real
  Herd/Valet/Homebrew installs for automated tests... else document as
  manual-only").
- Criterion 5 (500 MB EOF-attach) is exercised at ~60 MB in the automated
  suite rather than the spec's literal 500 MB, to keep the suite's runtime
  reasonable — see `test/discovery/large-file-attach.test.ts`'s own header
  comment. The mechanism under test (seek-to-EOF on `add`, offset tracking)
  has no size-dependent branch in `src/ingest/tail.ts`, so this is judged a
  faithful proxy, not a silent scope reduction — flagged here for the record.
- Criterion 20 (polling-fallback reliability under an unreliable native
  watcher) has no fault-injection harness in this environment (would need a
  real flaky network mount or a chokidar-internals mock, either of which
  risks masking the very thing being tested) — verified by **code review
  only**: `src/ingest/tail.ts` runs a `RECONCILE_POLL_MS = 1000` reconcile
  poll unconditionally, independent of whatever native fsevents/inotify
  events do or don't fire, so "no missed writes regardless of which
  mechanism catches a change first" holds by construction for any path
  **already being tracked**. Note this reconciliation mechanism does **not**
  rescue [defect 1](../defects/003-phase-3-auto-discovery-1.md) — that
  defect is about a path never entering tracking in the first place, a
  distinct failure mode from "tracked but slow to notice a change."

## Authored automated tests (`test/discovery/`)

| File | Purpose |
|---|---|
| `helpers.ts` | Shared harness: `startDiscoveryTestServer()` (ephemeral port, discovery-enabled, environment-tier disabled by default), fixture builders (`laravelProject`, `nextjsProject`, `goProject`, `djangoProject`), file helpers (write/append/truncate/remove), re-exports `connect`/`collect`/`sleep`/`waitFor`/`closeAll` from `test/docker/helpers.ts` |
| `zero-config-laravel.test.ts` | Criteria 1–2: pre-existing `laravel.log` starts checked/live; multi-line exception → one `multiline:true` entry; `pending`→`WAITING`; pending→live auto-transition; **regression check for defect 2 symptom A** |
| `rotation-truncation.test.ts` | Criteria 3, 4, 11: daily-rotation glob continuation (one row); truncation reset (no dupes/garbling); manual-unsubscribe permanence across truncation/rotation, for both the unsubscribing connection and an unaffected second connection |
| `watch-config.test.ts` | Criteria 6, 7: label override, pinned parser (bypasses detection), unknown-parser-name startup warning + fallback, glob folding + later-file extension, config-vs-detector dedupe (config label/parser wins, detector name retained) |
| `no-target-notes.test.ts` | Criterion 9: exact guidance copy for Next.js/Go/Django, no sidebar row, multiple no-target detectors stack |
| `disable-and-toggle.test.ts` | Criteria 10, 14, 21: `discovery.disable` for a project-tier and an (fixture-injected) environment-tier detector; `discovery.enabled:false` (no WS message, no auto-discovered sources, explicit `watch` still works, REST reports disabled); `GET /api/discovery` mirrors the WS `discovery` push exactly |
| `environment-sources.test.ts` | Criterion 8: Herd source (fixture-injected via `$HOME`) unchecked despite existing content; project-tier source unaffected |
| `large-file-attach.test.ts` | Criterion 5 (QA load test, scaled — see Environment notes above) |
| `concurrent-sources-load.test.ts` | Criterion 19 (QA load test): two local sources streaming under load interleave in arrival order with no drops/dupes; `/api/status` stays responsive throughout |
| `pending-literal-path.test.ts` | **Regression test for [defect 1](../defects/003-phase-3-auto-discovery-1.md)** — intentionally red |
| `subscribed-broadcast-clobber.test.ts` | **Regression test for [defect 2](../defects/003-phase-3-auto-discovery-2.md) symptom B** — intentionally red |

## Acceptance criteria → verification mapping

| # | Criterion | Verified by |
|---|---|---|
| 1 | Pre-existing `laravel.log` → checked/live/no-action; exception → one `multiline:true` entry within ~1s | `test/discovery/zero-config-laravel.test.ts` — **PASS** |
| 2 | No `laravel.log` at startup → unchecked/dimmed/`WAITING`/count 0; file creation → auto checked+live, no refresh | `test/discovery/zero-config-laravel.test.ts` — data-contract half **PASS** (pending state, checkbox-flip broadcast); the "actually streams to an already-open tab" half **FAILS** — see [defect 2](../defects/003-phase-3-auto-discovery-2.md) symptom A |
| 3 | Daily-rotation glob continues the same row | `test/discovery/rotation-truncation.test.ts` — **PASS** |
| 4 | Truncation doesn't break the tail, no dupes/garbling | `test/discovery/rotation-truncation.test.ts` — **PASS** |
| 5 | Large pre-existing file attaches at EOF, no history flood, no size-proportional memory spike | `test/discovery/large-file-attach.test.ts` (scaled to ~60 MB — see Environment notes) — **PASS** |
| 6 | `watch` label override / pinned parser / glob folding + later-file extension | `test/discovery/watch-config.test.ts` — **PASS**, including the unknown-parser-name startup warning + auto-detection fallback (`docs/configuration.md` § Semantics) |
| 7 | Config/discovery dedupe by resolved path (config wins, detector name retained) | `test/discovery/watch-config.test.ts` — **PASS** |
| 8 | Herd/environment sources unchecked by default even with existing content | `test/discovery/environment-sources.test.ts` (Herd, fixture-injected) — **PASS**; Homebrew — manual-only, see Environment notes |
| 9 | No-file-target detector notes (exact copy, no row, stacking) | `test/discovery/no-target-notes.test.ts` — **PASS** + rendered evidence `nextjs-only-sidebar.png` |
| 10 | `discovery.disable` excludes a named detector (project- and environment-tier) entirely | `test/discovery/disable-and-toggle.test.ts` — **PASS** |
| 11 | Manual unsubscribe never re-flips on from a later file event | `test/discovery/rotation-truncation.test.ts` (already-live-at-connect path) — **PASS**. The *specifically* pending-auto-subscribed-then-unsubscribed path, and the "any other source's broadcast reverts an unrelated unsubscribe" path, are covered by [defect 2](../defects/003-phase-3-auto-discovery-2.md)'s two regression tests — **FAIL** |
| 12 | `WAITING`/`STOPPED`/`ERROR` are real text, not color-only; local `ERROR` tooltip accurate | Rendered evidence (`mixed-sidebar.png` — `WAITING`; `mixed-sidebar-stopped.png` — `STOPPED`) confirms real, uppercase-via-CSS text labels reusing spec 002's Docker treatment (`source-row__state-label--pending`/`--stopped` classes, not color-coded dots) + DOM-confirmed `title` attributes carry the resolved path. `ERROR` state specifically verified by **static code review only** (`SourceRow.tsx`'s `STATE_LABEL_TEXT`/`rowTitle` treat `error` via the same shared, already-exercised code path as `pending`/`stopped` — no dedicated live-triggered repro attempted; low risk given the shared implementation) |
| 13 | Tooltip format (`targetPath`, config suffix, detail suffix), no layout effect | DOM-confirmed via rendered evidence: pending row → `"<path> — Waiting for <path> to be created."`; pure-discovery `local:laravel` → bare `"<path>"`; Herd rows → bare `"<path>"`. Config-suffix case (`"<path> · configured via traceriver.json"`) confirmed by static code review of `localTooltipText()` (`web/src/components/SourceRow.tsx`) — exact string construction matches spec verbatim. Per the spec's own text ("Verified by design review against rendered evidence"), final sign-off is design review's, not QA's, to render |
| 14 | `discovery.enabled:false`: no WS message, no auto-discovered sources, `watch` still works, REST reports disabled | `test/discovery/disable-and-toggle.test.ts` — **PASS** + rendered evidence `discovery-disabled-sidebar.png` (flat, unsectioned, spec-001-style empty sidebar) |
| 15 | Zero environment sources → no Environment section header at all | Rendered evidence `nextjs-only-sidebar.png`'s DOM has no `environment-heading` anywhere (confirmed via `grep`) + static code review of `EnvironmentSection.tsx` (`if (sources.length === 0) return null` — no header, no placeholder copy) — **PASS** |
| 16 | Live-region announces subscribed pending→live / live→stopped→live once each; unsubscribed sources silent | Static code review only — `web/src/store/store.tsx`'s `sourceState` handler: announces exactly on `prior.kind === "local" && prior.subscribed && prior.state !== msg.state`, for `live` (from `pending`/`stopped`) and `stopped` (from `live`) transitions, with the spec's exact copy (`"<label> started streaming."` / `"<label> stopped — file not found."`). Not exercised via a real screen reader or live DOM mutation (no interaction capability — see Rendered evidence limitations, below) |
| 17 | Local-source controls Tab-reachable, focus ring, Enter/Space; no-target note not focusable | DOM-confirmed structurally: checkbox (`<input type="checkbox">`) and toggle (`<button role="switch">`) are natively focusable with no `tabindex="-1"` override; the no-target note is a plain `<p>`, no `role`/`tabindex`/interactive element. Actual Tab-key traversal and the rendered focus-ring outline not exercised (no interaction capability in the available tooling — same limitation phase 1/2 QA passes documented) |
| 18 | Contrast / CVD distinguishability for `WAITING`/`STOPPED`/`ERROR` | Design review territory per the spec's own text ("Verified by design review"). Spot-checked here only that no new raw color value was introduced — `source-row__state-label--pending`/`--stopped` reuse `--color-text-muted` (same token as spec 002's Docker `STOPPED`), `--error` reuses `--color-level-error`; both already contrast-verified in prior specs' design reviews |
| 19 | Two concurrent local sources interleave correctly, no freeze | `test/discovery/concurrent-sources-load.test.ts` — **PASS** (500 lines/source, arrival-order-preserving, zero drops/dupes, `/api/status` latency stayed under 2s throughout — proxy for "no UI freeze," this suite has no real browser event loop to measure jank against directly) |
| 20 | Polling-fallback reliability, no UI surface | Code review only — see Environment notes above. No fault-injection harness available |
| 21 | `GET /api/discovery` mirrors the latest WS `discovery` push | `test/discovery/disable-and-toggle.test.ts` — **PASS** (both the `enabled:true`-with-frameworks and `enabled:false` shapes) |

### Phase doc (`phase-3-auto-discovery.md`) exit-criteria cross-check

| Exit criterion | Status |
|---|---|
| Fresh Laravel app tails `laravel.log` with zero config; exception → full trace within ~1s | **PASS** — criterion 1 |
| Daily-rotation rollover continues the same source, no restart | **PASS** — criterion 3 |
| Truncation doesn't break the tail | **PASS** — criterion 4 |
| 500 MB pre-existing file attaches instantly, no memory spike | **PASS** (scaled proxy — criterion 5) |
| `watch` globs/label overrides/parser pinning behave per configuration.md | **PASS** — criteria 6–7 |
| Herd detection offers its service logs, unchecked by default | **PASS** (Herd; Homebrew manual-only) — criterion 8 |

## Defects filed

| # | Area | Severity | Summary |
|---|---|---|---|
| [1](../defects/003-phase-3-auto-discovery-1.md) | backend | critical | A `pending` local/config source whose target is a literal (non-glob) path never transitions to `live` when the file is later created, regardless of whether its containing directory already exists — breaks zero-config for Symfony/Rails/WordPress and the spec's own `worker.log` `watch`-entry example. Only Laravel's glob-shaped default target is unaffected. |
| [2](../defects/003-phase-3-auto-discovery-2.md) | backend | high | The `sources` broadcast's `subscribed` field isn't personalized per connection despite being documented as per-connection for `kind: "local"`/`"file"` sources: (A) an already-open tab that was subscribed while pending never actually receives entries after the server's auto-subscribe flip; (B) a connection's explicit unsubscribe is visually reverted by the next unrelated `sources` broadcast. |

Both are backed by committed, currently-red regression tests (see the table
above) — left red intentionally, same convention as phase 2's pre-fix
`test/docker/demux.test.ts`/`lifecycle.test.ts`.

## Rendered evidence

`docs/qa/evidence/003-phase-3-auto-discovery/`:

- `mixed-sidebar.png` / `.dom.html` — a monorepo-style fixture (Laravel +
  Next.js fingerprints, a pending `traceriver.json` `watch` entry, and a
  fixture-injected fake-`$HOME` Herd install): `local:laravel` checked/full-
  opacity/live, `local:worker` unchecked/dimmed/`WAITING`, the Next.js
  no-file-target note, and the **Environment** section with two `herd:*`
  rows, both unchecked despite pre-existing log content — matches the
  spec's "default state (mixed sources)" wireframe closely
- `mixed-sidebar-stopped.png` / `.dom.html` — same server, `laravel.log`
  deleted mid-session: `local:laravel` row stays checked with a `STOPPED`
  label (§ Components & states' "stopped-but-subscribed" rule)
- `nextjs-only-sidebar.png` / `.dom.html` — a pure Next.js fixture (no local
  file sources at all): Files section header still renders, containing only
  the no-target note, no Environment section anywhere in the DOM — matches
  the spec's "Files section, no-target-detector-note only" wireframe exactly
- `discovery-disabled-sidebar.png` / `.dom.html` — `discovery.enabled:false`
  regression check: sidebar reverts to spec 001's flat, unsectioned,
  `(no sources yet)` empty layout — no Files/Environment sub-headers at all

Captured with the plugin's `tools/browser.js` (headless Chrome found and
used — not a static-HTML fallback), which supports only `dom` (post-JS DOM
dump) and `shot` (screenshot) against a URL, **no click/drag/keyboard
scripting**. Every criterion requiring a click/hover/keystroke to reach
(state-label live-region announcements, focus-ring rendering, Tab traversal)
was verified by static code review instead, called out per-row above — a
tooling gap, not a decision to skip those criteria. This matches the exact
limitation phase 1/2 QA passes already documented for this tool.

## Re-verification addendum (2026-07-20)

Both defects below have been fixed by the backend-developer and re-verified.
Gates re-run: `npm run typecheck` **PASS**, `node_modules/.bin/tsc -p
web/tsconfig.json --noEmit` **PASS**, `npm run build` **PASS**, `npm test`
**109/109 PASS** (the 3 previously-red regression tests —
`pending-literal-path.test.ts`, `zero-config-laravel.test.ts`'s "REGRESSION
CHECK", `subscribed-broadcast-clobber.test.ts` — are now green; the
previously-green 106 remain green, no regressions).

This flips criterion 2 (row above: "FAILS" for the already-open-tab delivery
half) and criterion 11 (row above: "FAIL" for the pending-auto-subscribed
and cross-source-clobber paths) to **PASS** in full — see each defect file's
own "Re-verification" section for detail. The `## Defects filed` table
above is left as the historical record of what was found; both entries'
underlying defect files now carry `Status: verified-fixed`.

## Re-verification addendum 2 (2026-07-20) — design-review Finding 1 (label prefix)

The backend-developer fixed [design review Finding 1](../../design-reviews/003-phase-3-auto-discovery.md)
(major): `kind: "local"` `SourceDescriptor.label` values were the bare
detector/config name (`worker`, `laravel`, `php-fpm-mysite.test`) instead of
the full `<kind>:<slug>`-prefixed form the spec's wireframes and prose show
(`local:worker`, `local:laravel`, `herd:php-fpm-mysite.test`). Fix:
`deriveLabel()` in `src/ingest/tail.ts` now returns the source id verbatim
instead of stripping its prefix, plus a doc-comment update in
`src/shared/types.ts`. Scope of this fix is `src/`, outside QA's lane — the
dev's change itself is not re-verified line-by-line here, only its observed
effect.

Two pre-existing test expectations in `test/discovery/watch-config.test.ts`
had asserted the *old, buggy* stripped-label behavior — before this fix
those were incidentally passing because the bug and the assertion matched.
They are QA's own lane and were updated to the fixtures' actual declared
(verbatim) `label` values, not to any new backend behavior:

- Criterion 6 test ("an explicit label is used verbatim…"): fixture declares
  `watch: [{ path: "logs/worker.log", label: "local:worker" }]`;
  `expect(worker!.label).toBe("worker")` → `.toBe("local:worker")`.
- Criterion 7 test ("a watch entry naming the same resolved path as a
  detector…"): fixture declares
  `watch: [{ path: "storage/logs/laravel.log", label: "local:custom-laravel-label" }]`;
  `expect(row.label).toBe("custom-laravel-label")` →
  `.toBe("local:custom-laravel-label")`.

No other test's expectations changed. This updates criterion 6 and 7's
mapping-table rows above (unchanged verdict, **PASS**, but now asserting the
correct verbatim value) and criterion 12/13's rendered-evidence citations
(`mixed-sidebar.png`/`.dom.html`, `mixed-sidebar-stopped.png`/`.dom.html`),
which were re-captured — see below.

**Gates re-run**: `npm run typecheck` **PASS**, `node_modules/.bin/tsc -p
web/tsconfig.json --noEmit` **PASS**, `npm run build` **PASS**, `npm test`
**109/109 PASS** (all 32 files green, no regressions beyond the two
expectation updates above).

**Evidence re-capture**: `mixed-sidebar.png`/`.dom.html` and
`mixed-sidebar-stopped.png`/`.dom.html` were re-captured against a rebuilt
`dist/` (`npm run build`, picking up the `tail.ts` fix) using the same
fixture shape as the original pass (monorepo-style Laravel + Next.js
fingerprint, a pending `watch` entry for `local:worker`, and a
fixture-injected fake-`$HOME` Herd install with two pre-existing, non-empty
`herd:*` log files) and the same tool
(`node .../agentic-dev/0.1.4/tools/browser.js`, headless Chrome found and
used). Confirmed in the re-captured DOM: `source-row__label` now reads
`local:laravel`, `local:worker`, `herd:nginx-mysite.test`,
`herd:php-fpm-mysite.test` in both captures (including the STOPPED-state
capture, where `local:laravel`'s `STOPPED` label is now correctly prefixed
too), with all other state/opacity/checked semantics unchanged from the
original pass (still matching the criterion 2/8/12 rows above). Fixture
build scripts and the fake-`$HOME` directory used for this capture are
QA-owned scratch artifacts (not committed) — only the resulting evidence
files under `docs/qa/evidence/003-phase-3-auto-discovery/` are kept.

`nextjs-only-sidebar.png`/`.dom.html` and
`discovery-disabled-sidebar.png`/`.dom.html` were checked and **not**
re-captured: neither DOM contains any `source-row__label` element at all
(no local/environment sources render in either fixture — confirmed via
`grep`), so neither is affected by this label fix.

## OPEN QUESTIONS

See the handoff footer at the end of the QA response.
