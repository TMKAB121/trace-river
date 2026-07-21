# Feature 004 — Phase 4: Error Intelligence

**Status:** Shipped. QA PASS (199/199 tests, 20/20 acceptance criteria, one
low-severity fix-loop iteration), design verification **APPROVED**.

- Spec: [`docs/specs/004-phase-4-error-intelligence.md`](../../specs/004-phase-4-error-intelligence.md)
- Design review: [`docs/design-reviews/004-phase-4-error-intelligence.md`](../../design-reviews/004-phase-4-error-intelligence.md)
- QA test plan: [`docs/qa/test-plans/004-phase-4-error-intelligence.md`](../../qa/test-plans/004-phase-4-error-intelligence.md)
- Defect report filed during the fix loop (fixed and re-verified before ship):
  [`docs/qa/defects/004-phase-4-error-intelligence-1.md`](../../qa/defects/004-phase-4-error-intelligence-1.md)
  (the sparkline tooltip's client-side occurrence-pattern text could word
  itself differently than the AI prompt's server-side text for the same
  histogram, near a rounding boundary)
- Phase doc: [`docs/phases/phase-4-error-intelligence.md`](../../phases/phase-4-error-intelligence.md)
- Rendered evidence: [`docs/qa/evidence/004-phase-4-error-intelligence/`](../../qa/evidence/004-phase-4-error-intelligence/)

## What shipped

Every `ERROR`/`FATAL` `TraceRiverLog` entry is fingerprinted and grouped
server-side, surfaced through the sidebar, a new Errors panel, and one-click
AI-prompt generation. Nothing about phases 1–3's top bar layout, unified
stream rendering/virtualization, row expansion, search/filtering,
Freeze/Clear, or the sidebar's Containers/Files/Environment sections
changed in shape — this phase is additive: two new top-bar controls, one
new filter-row control, one new sidebar-row element, one entirely new
main-panel view (the Errors panel), and the app's first modal.

- **Fingerprinting & grouping** (`src/errors/`, run once, in the same tick
  as ingestion, by `src/server/ingest-entries.ts` — the single choke point
  all three ingest adapters now route through): `normalize-text.ts`
  replaces variable segments (timestamps/dates, UUIDs/hex/long ints, quoted
  values, memory addresses/ports/durations, file-path prefixes) with
  placeholders; `fingerprint.ts` hashes `sha256(source id + normalized
  message + normalized top stack frame)` — the **literal** source id, not
  just its kind, so `docker:mysql` and `docker:nginx` never merge even on
  identical text, and a restarted container reusing the same id naturally
  continues its existing group. 400 occurrences of one exception collapse
  into one `ErrorGroup` with `count: 400`, not 400 stream rows' worth of
  cards.
- **Group storage** (`error-store.ts`): an `ErrorGroupStore` keyed by
  fingerprint, independent of the ring buffer, capped at 500 groups (LRU by
  `lastSeen`). `sampleEntryIds` holds up to 10 ids — the single oldest
  still-resolvable occurrence (pinned, needed for the AI prompt's
  "context before the first occurrence") plus up to 9 most-recent
  (rolling). Group metadata (`count`/`firstSeen`/`lastSeen`) survives raw
  ring-buffer eviction; `rawEntriesEvicted` goes sticky `true` the first
  time any tracked sample ages out, and the store re-pins whatever's now
  the oldest still-resolvable occurrence.
- **Spike detection**: a rolling 30-minute per-minute occurrence histogram
  per group drives `spiking` — current-minute rate `> 5×` trailing average
  **and** `≥ 10/min` absolute — recomputed on every occurrence and at
  least once per broadcast tick, with no hysteresis or cooldown (it clears
  the instant the rate subsides). Constants live in one object,
  `src/errors/config.ts`.
- **AI prompt generation** (`prompt.ts`, `redact.ts`): server-assembles a
  markdown debugging prompt — normalized error summary, the latest
  resolvable sample's full stack trace, environment metadata (Docker image,
  detected frameworks, locked parser name), the 15 ring-buffer entries
  across every source immediately before the group's *first* occurrence,
  and a deterministic occurrence-pattern summary — then redacts it in two
  passes: placeholder re-normalization (`⟨…⟩`) over the stack-trace/context
  blocks, then secret-pattern scrubbing (`Authorization: Bearer`,
  `password=`/`passwd=`/`pwd=`, AWS-style access-key ids, generic
  `api_key`/`secret`/`token` key-values) to `<redacted>` — a visually
  distinct marker from `⟨…⟩`, since the two passes mean different things.
  Falls back to documented placeholder text when a group's samples have
  aged out of the buffer rather than fabricating anything. v1 is
  clipboard-only: no network call to any AI service, no API key stored or
  accepted anywhere.
- **Frontend**: a **Stream / Errors** view switcher (top-bar, leftmost;
  `Errors · <n>` counts groups, not raw occurrences) swaps the main panel
  between the existing unified stream and the new **Errors panel** — a
  sortable (Recency/Count), `<ul>` list of expandable `ErrorGroupCard`s
  (title with `⟨…⟩` placeholder segments, count, a self-scaled 30-point
  sparkline, sources, first/last seen, a `⚡ SPIKING` chip, up to 10
  expandable sample rows reusing the stream row's code-viewport treatment
  verbatim, and a "Generate AI Prompt" button). The sidebar gains a
  per-source error-count badge (bare numeral, click-to-filter into a
  dismissible `"<source> errors ×"` stream scope chip, independent of and
  never touching that source's visibility/subscribe state) and a pulsing
  SPIKING indicator. New stream-view controls: **Errors Only** (AND filter,
  independent of the level chips) and **Latest Error** (button + global
  `e` key, mirrors "Clear filters" then scrolls to the newest visible
  error). The app's first modal, **AI Prompt Preview**
  (`role="dialog" aria-modal"`, focus-trapped, `inert` background), shows
  the redacted markdown in an editable `<textarea>`; Copy sends the
  textarea's *current* (possibly edited) value to the clipboard.

## Endpoints / UI / tests touched

- **REST**: `GET /api/errors` (new) — `{ groups: ErrorGroup[] }`, mirrors
  the WS-pushed value. `GET /api/errors/:fingerprint/prompt` (new) —
  `{ prompt: string }`, `404 { error: "not_found" }` for an untracked/
  evicted fingerprint.
- **WebSocket**: `GET /ws` — new `{ type: "errorGroups", groups:
  ErrorGroup[] }` server→client message, batched into the existing ~75ms
  flush, always the full current group list (≤500), unconditional (no
  config flag — error grouping is always on), sent once as the last step
  of the connect sequence (even as `[]`) and again live on any group
  change. No new client→server message.
- **`TraceRiverLog`**: new `fingerprint: string | null` field, non-null
  only when `level` is `ERROR`/`FATAL`, set in the same tick as ingestion.
- **New shared type**: `ErrorGroup` (`fingerprint`, `title`, `level`,
  `sources`, `count`, `firstSeen`, `lastSeen`, `sampleEntryIds`,
  `perMinute`, `spiking`, `rawEntriesEvicted`).
- **UI**: view switcher, Errors panel (empty/populated/expanded), sidebar
  error badge + SPIKING indicator, Errors Only toggle, Latest Error button,
  source-scope filter chip, Errors-view sort control, AI Prompt Preview
  modal, and the stream row's expanded-panel sparkle-icon entry point.
- **Tests**: `test/errors/` (5 files, 81 tests) —
  `fingerprint-golden.test.ts` (17), `normalize-text.test.ts` (17),
  `error-store.test.ts` (23), `prompt-snapshot.test.ts` (17),
  `occurrence-pattern-client.test.ts` (3, added during the fix loop);
  `test/server/errors-pipeline-criteria.test.ts` (7, real
  upload→pipeline→WS path) and `errors-rest-and-ws-sequence.test.ts` (6,
  auth/404/connect-sequence ordering).

## Changed files

Backend: `src/errors/{config,normalize-text,fingerprint,error-store,redact,
prompt}.ts` (new), `src/server/ingest-entries.ts` (new — centralizes
fingerprint-attach across all three ingest adapters), `src/server/routes/
errors.ts` (new), `src/shared/types.ts` (`fingerprint`, `ErrorGroup`,
`errorGroups` WS message), `src/ingest/{docker,tail,upload}.ts`,
`src/parsers/pipeline.ts`, `src/server/{app-state,broadcaster,index,
ring-buffer,ws}.ts`.

Frontend: `web/src/types.ts`, `web/src/store/store.tsx`, `web/src/api/
rest.ts`, `web/src/App.tsx`, `web/src/components/{ViewSwitcher,
ErrorsPanel,ErrorGroupCard,SampleRow,Sparkline,SpikingBadge,
ErrorsEmptyState,ErrorsSortControl,ErrorsOnlyToggle,LatestErrorButton,
ScopeChip,AIPromptModal}.tsx`+`.css` (new), `web/src/components/
{ExpandedPanel,SourceRow,StreamPanel,TopBar,icons}.tsx`+`.css`,
`web/src/hooks/{useFocusTrap,useLatestErrorShortcut}.ts` (new),
`web/src/utils/{format,occurrencePattern}.ts`, `web/src/styles/tokens.css`
(`IconWarning`/`IconBolt`/`IconSparkle`, `--motion-pulse`,
`--z-modal-overlay`/`--z-modal`, `--sparkline-width`/`-height`,
`--modal-max-width`).

Tests: `test/errors/*` (new directory, 5 files, 81 tests),
`test/server/errors-pipeline-criteria.test.ts` +
`errors-rest-and-ws-sequence.test.ts` (new, 13 tests) — 109 phase-1/2/3
tests → 199 total (39 test files).

## Known deviations / limitations

- **The Errors panel, AI Prompt Preview modal, sort control, and
  scope-chip/source-badge click-through interactions have no rendered
  (screenshot/DOM) evidence** — QA's browser tool supports navigation and
  static capture only, no click/keyboard scripting (same limitation
  documented in phases 1–3's own QA passes). These were verified by static
  code review against the spec's exact requirements instead; only the
  default Stream view (sidebar badges, a live SPIKING indicator) and the
  disabled-empty-state view switcher were captured live. See
  [`docs/qa/test-plans/004-phase-4-error-intelligence.md`](../../qa/test-plans/004-phase-4-error-intelligence.md).
- **Contrast/CVD sign-off for the SPIKING chip and per-source badge, and
  `--motion-pulse`'s suppression under `prefers-reduced-motion: reduce` in
  both motion-preference states, are the design-review stage's own stated
  responsibility per the spec's acceptance criteria** — QA's contribution
  was static token-reuse/CSS confirmation only. Design review's verdict:
  APPROVED (both confirmed correct).
- **The fingerprinting placeholder-normalization rule doesn't match
  nginx's slash-separated error-log timestamp format** (`YYYY/MM/DD
  HH:mm:ss`) — found during QA's fingerprint-corpus authoring, not filed
  as a defect (informational only; see the test plan's § Finding). Rarely
  matters in practice: the CLF parser already strips the leading
  `[timestamp] [level]` before `message` reaches fingerprinting, so this
  can only affect a slash-dated line reaching fingerprinting via the `raw`
  fallback parser — and the resulting failure mode (a false split, two
  occurrences of the same error staying in separate groups) is the
  algorithm's own accepted, lower-severity failure mode, not the false
  merge it's biased against.
- **The sparkline tooltip's client-side occurrence-pattern wording could
  diverge from the AI prompt's server-side wording** near the
  multiplier-threshold rounding boundary — found during QA, filed as
  [defect
  004-phase-4-error-intelligence-1](../../qa/defects/004-phase-4-error-intelligence-1.md),
  fixed (the client now rounds the average before the multiplier
  comparison, matching the server exactly) and re-verified with a
  permanent regression test before ship. Not an open deviation; the
  authoritative server-side `group.spiking` flag and the AI prompt's own
  text were correct throughout — only the decorative tooltip's wording
  could briefly disagree.
- The AI prompt's "Environment" section reads directly from the same
  Docker-inspect and discovery data documented as having known limitations
  in phases 2–3 (Docker daemon-failure states and Windows/Linux socket
  paths code-review-verified only; Homebrew environment detection has no
  fixture-injection seam) — nothing new introduced by this phase, just
  inherited via that shared data source.

## Scope explicitly deferred

Tuning the fingerprinting normalization rules post-launch based on real
false-merge/false-split reports (the phase doc's own stated ongoing
process, not a one-time design task). Full-text search within the Errors
panel (v1's only sort axis is recency/count). Any server→AI network call,
API key storage, or settings UI for either (v1 is clipboard-only by
design). Editing/regenerating a prompt server-side after the user edits it
in the preview modal (edits are local-only, never sent back). A settings
UI for the spike-detection thresholds (a documented heuristic, not
user-tunable in v1). Any change to Docker/file-upload/discovery behavior,
the top bar's pre-existing controls, or the unified stream's visual
grammar.
