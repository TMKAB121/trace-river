# Feature 003 — Phase 3: Auto-Discovery

**Status:** Shipped. QA PASS (109/109 tests, 21/21 acceptance criteria after
one fix-loop iteration), design verification **APPROVED** (re-review, after
one finding fixed).

- Spec: [`docs/specs/003-phase-3-auto-discovery.md`](../../specs/003-phase-3-auto-discovery.md)
- Design review: [`docs/design-reviews/003-phase-3-auto-discovery.md`](../../design-reviews/003-phase-3-auto-discovery.md)
- QA test plan: [`docs/qa/test-plans/003-phase-3-auto-discovery.md`](../../qa/test-plans/003-phase-3-auto-discovery.md)
- Defect reports filed during the fix loop (both fixed and re-verified before
  design review's re-review pass):
  [`docs/qa/defects/003-phase-3-auto-discovery-1.md`](../../qa/defects/003-phase-3-auto-discovery-1.md)
  (tailer never detected creation of a literal, non-glob watch target),
  [`-2.md`](../../qa/defects/003-phase-3-auto-discovery-2.md) (`subscribed`
  not personalized per connection in `sources`/`sourceState` broadcasts,
  breaking both the auto-subscribe data flow and unsubscribe permanence)
- Phase doc: [`docs/phases/phase-3-auto-discovery.md`](../../phases/phase-3-auto-discovery.md)
- Rendered evidence: [`docs/qa/evidence/003-phase-3-auto-discovery/`](../../qa/evidence/003-phase-3-auto-discovery/)

## What shipped

A third, previously-reserved source kind — `kind: "local"`, tailed project
and environment log files — attaches into the same Uniform Parser Pipeline
and unified stream phases 1–2 already built. Nothing about the top bar,
unified stream, row expansion, search/filtering, Freeze/Clear, file-upload
behavior, or the Docker sidebar section changed; this phase is additive to
the sidebar and to the WS/REST contract.

- **Fingerprinting**: at server startup, before any WS connection is
  accepted, seven project-root detectors (`src/discovery/detectors.ts`) —
  Laravel, Symfony, Next.js, Go, Rails, Django, WordPress — check the
  working directory (never subdirectories) for their fingerprint files.
  Detectors with a default file target (Laravel, Symfony, Rails, WordPress)
  produce a `local:<detector>` sidebar row; detectors with none (Next.js,
  Go, Django — stdout-only output) instead produce a static guidance note
  in the Files section, no checkbox, no row.
- **Environment-level detection** (`src/discovery/environment.ts`,
  macOS-only, no-op elsewhere): Laravel Herd (per-site nginx/PHP-FPM logs
  under `~/Library/Application Support/Herd/Log/`), Valet
  (`~/.config/valet/Log/nginx-error.log`), and Homebrew nginx/PHP-FPM
  (`/opt/homebrew/var/log/...`) — offered as `<detector>:<slug>` rows in a
  new **Environment** sidebar section, unconditionally unchecked (opted in
  per session, never auto-subscribed, regardless of whether the file
  already has content). The section renders only when it finds at least one
  source; otherwise it's omitted entirely, not shown empty (product-owner
  decision, spec § Open Questions #1).
- **Dynamic tailing** (`src/ingest/tail.ts`, `TailManager`/`TailedSource`,
  one `chokidar`-backed watcher per target): start-at-EOF for any
  pre-existing file (never floods the ring buffer with history);
  offset-tracked incremental reads on every native change event, backstopped
  by an always-on 1 s reconciliation poll; truncation/replacement detected
  by `size < storedOffset` and reset to 0; a glob target's multiple matching
  files (Laravel's daily rotation) share one sidebar row; a deleted file's
  source goes `stopped` (checkbox stays checked) and resumes at offset 0 the
  moment the path reappears.
- **`"pending"` state** (new `SourceState` value): a project/config source
  whose target doesn't exist yet at discovery time starts unchecked, dimmed,
  `WAITING`, and flips — automatically, once, with no user action — to
  checked/`live` the instant the file is created. This is a **one-time**
  courtesy tied to a source's first-ever `pending`→`live` transition; a
  later `stopped`→`live` reappearance never touches `subscribed`, and an
  explicit manual unsubscribe (even while still pending) is never overridden.
  Environment-origin sources never auto-subscribe on any transition.
- **`traceriver.json` `watch` fallback**: bespoke paths declared as
  `{ path, label, parser? }` always tail regardless of `discovery.enabled`,
  dedupe with auto-discovered targets by resolved absolute path (config
  wins the label/parser, detector name retained for the tooltip), and a
  `parser` pinning an unrecognized name logs a startup warning and falls
  back to normal per-source auto-detection instead of failing to start.
- **Frontend**: the sidebar gains a third `<section aria-labelledby>`,
  **Environment**, below Containers/Files; Files gains no-file-target
  framework notes (`IconInfo` + exact guidance copy, static `<p>`, never
  interactive); `SourceRow`'s existing Docker `STOPPED`/`ERROR` state-label
  treatment is generalized to `kind: "local"` and extended with `WAITING`
  for `"pending"`; the row's tooltip carries the resolved target path plus
  a `"· configured via traceriver.json"` or `WAITING`/`STOPPED` detail
  suffix. The three-section-vs-flat-list rule extends spec 002's: the
  sidebar reverts to phase 1's flat list only when Docker is disabled *and*
  discovery is disabled (or found nothing and no environment sources exist).

## Endpoints / UI / tests touched

- **REST**: `GET /api/discovery` (new) — `{ enabled, frameworks }`, mirrors
  the WS-pushed value.
- **WebSocket**: `GET /ws` — new `{ type: "discovery", frameworks:
  DetectedFramework[] }` server→client message, sent once after `sources`
  (and after `dockerStatus` when Docker is enabled) on connect, only when
  `discovery.enabled`; never rebroadcast mid-session (fingerprinting runs
  once, at startup). No new client→server message — `subscribe`/
  `unsubscribe` generalize to `local:<name>`/`<detector>:<slug>` ids,
  per-connection like file sources (one carve-out: environment-origin
  sources start unsubscribed for every connection, at every state).
- **`SourceDescriptor`**: `SourceState` gains `"pending"`; new optional
  `local: { origin: "project" | "environment" | "config", detector: string
  | null, targetPath: string }` field, present only for `kind: "local"`.
- **UI**: Environment sidebar section, Files-section no-file-target notes,
  `WAITING` state label, extended local-row tooltip, live-region
  announcements for a subscribed local source's `pending`→`live` and
  `live`→`stopped`→`live` transitions.
- **Tests**: `test/discovery/` (10 files, 28 tests) —
  `zero-config-laravel`, `rotation-truncation`, `watch-config`,
  `no-target-notes`, `disable-and-toggle`, `environment-sources`,
  `large-file-attach` (scaled load test), `concurrent-sources-load` (load
  test), plus two regression tests for the two defects below
  (`pending-literal-path`, `subscribed-broadcast-clobber`) and shared
  `helpers.ts`.

## Changed files

Backend: `src/discovery/{detectors,environment,pattern,index}.ts` (new),
`src/ingest/tail.ts` (new), `src/server/routes/discovery.ts` (new),
`src/shared/{types,config}.ts`, `src/server/{app-state,index,ws,
broadcaster,sources}.ts`, `src/parsers/{pipeline,formats/index}.ts`,
`package.json` (+`chokidar@^3.6.0`).

Frontend: `web/src/types.ts`, `web/src/store/store.tsx`, `web/src/
components/{Sidebar,SourceRow}.tsx`+`.css`, `FilesSection.tsx`+`.css`,
`EnvironmentSection.tsx`+`.css` (new), `icons.tsx` (`IconInfo`).

Tests: `test/discovery/*` (new directory, 10 files, 28 tests added to the
suite: 81 phase-1/2 tests → 109 total).

## Known deviations / limitations

- **Tailer misses file creation when a watch target's parent directory is
  absent at server startup** — backlog item
  [B3](../../backlog.md), product-owner-accepted: chokidar's fsevents
  backend on macOS doesn't reliably fire a creation event when the watched
  pattern's containing directory tree doesn't exist yet, for both literal
  and glob patterns. The realistic zero-config case is unaffected (a fresh
  Laravel app already ships `storage/logs/`; only `laravel.log` itself is
  ever absent). Recorded in full in
  [`docs/project/overview.md`](../overview.md) § Known deviations.
- **A `watch` entry's `parser` field pins only the four built-in parser
  names** (`monolog`/`clf`/`jsonl`/`raw`) — it does not consume the
  config's separate `parsers` array (still unimplemented scaffolding, see
  [`docs/project/overview.md`](../overview.md) § Known deviations).
  An unrecognized `parser` value logs a startup warning and falls back to
  auto-detection rather than failing to start.
- **A literal (non-glob) target's fsevents "add" event never fires** was
  found as a critical defect during QA
  ([defect 1](../../qa/defects/003-phase-3-auto-discovery-1.md)) and fixed
  by rewriting such a target into a single-character bracket-class glob
  before it reaches `chokidar.watch()` — verified fixed, not an open
  deviation, but worth knowing if `src/ingest/tail.ts` is touched again.
- **`subscribed` was not personalized per WebSocket connection** for
  `kind: "local"`/`"file"` sources, despite being documented as
  per-connection — found as a high-severity defect
  ([defect 2](../../qa/defects/003-phase-3-auto-discovery-2.md)) and fixed
  by computing `subscribed` per connection in every `sources`/`sourceState`
  broadcast. Verified fixed, not an open deviation.
- Homebrew environment-tier detection has no fixture-injection seam (its log
  directory is a hardcoded absolute path,
  `/opt/homebrew/var/log`) — exercised only incidentally, read-only, against
  the QA host's real install; it has no dedicated automated test and is
  manual-only, per the run brief's own instruction.
- Criterion 5 (500 MB EOF-attach) was exercised at ~60 MB in the automated
  suite, not the spec's literal 500 MB, to keep the suite's runtime
  reasonable — judged a faithful proxy since the tailer's EOF-seek/offset
  mechanism has no size-dependent branch.
- Criterion 20 (polling-fallback reliability under an unreliable native
  watcher) has no fault-injection harness in this environment — verified by
  code review only (the 1 s reconciliation poll runs unconditionally,
  independent of whichever native-watcher mechanism fires first).
- Several accessibility/interaction criteria (live-region announcement
  wording, focus-ring rendering, Tab traversal, the `ERROR` state label) have
  no dedicated fixture and were verified by static code review only — the
  rendered-evidence tool used for this pass supports DOM/screenshot capture
  against a URL but no click/drag/keyboard scripting (same limitation
  documented for phases 1–2).

## Scope explicitly deferred

Linux environment-level detectors (`/var/log/nginx/` etc. — permission
handling differs, noted as future work in the phase doc). A manual "rescan
project" button (fingerprinting runs once, at startup, over the fixed
working directory — the project root doesn't change without a restart). A
"load last N KB of history" affordance for EOF-started tails. Phase 4's
AI-prompt metadata consumption of the `discovery` payload (this phase only
defines the data shape). Any change to Docker/file-upload behavior, the top
bar, or the unified stream's visual grammar.
