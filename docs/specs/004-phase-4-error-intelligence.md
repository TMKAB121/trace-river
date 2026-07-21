# 004 — Phase 4: Error Intelligence

Status: ready-for-dev
Depth: Tier 3 (full spec)
Source: [`docs/phases/phase-4-error-intelligence.md`](../phases/phase-4-error-intelligence.md)
Extends: [`docs/specs/001-phase-1-core-console.md`](001-phase-1-core-console.md),
[`docs/specs/002-phase-2-docker.md`](002-phase-2-docker.md),
[`docs/specs/003-phase-3-auto-discovery.md`](003-phase-3-auto-discovery.md)

## Overview

Phases 1–3 make every log visible. Phase 4 makes the *errors* impossible to
miss: every `ERROR`/`FATAL` entry is fingerprinted server-side into an
**error group** (the same exception logged 400 times collapses into one
group with `count: 400`), surfaced through four coordinated UI paths — a
live per-source badge in the sidebar, a dedicated **Errors panel**, an
**Errors Only** stream filter, and a **jump-to-latest-error** shortcut — plus
lightweight, heuristic **spike detection** and one-click, redacted, **AI
debugging prompt** generation (clipboard-only, D9: no network calls, no API
keys).

This spec extends, and does not replace, specs 001–003: the top bar's
existing controls, the unified stream's rendering/virtualization, row
expansion, search/filtering, Freeze/Clear, and the sidebar's
Containers/Files/Environment sections are all unchanged in shape. Everything
below is additive: two new top-bar controls, one new filter-row control, one
new element in the source row, one entirely new main-panel view (the Errors
panel), and one new modal (the app's first).

**Explicitly out of scope for this spec** (do not build):
- Any change to fingerprinting behavior once shipped (this spec defines the
  algorithm; tuning it post-launch based on real false-merge/false-split
  reports is the phase doc's own stated ongoing process, not a one-time
  design task).
- Full-text search *within* the Errors panel — the panel's only sort axis is
  recency/count (§ Layout); finding a specific group is a scroll/scan
  operation in v1. A future spec may add search if the group count in
  practice makes that necessary.
- Any server→AI network call, API key storage, or settings UI for either —
  v1 is clipboard-only by design (D9). BYO-key integration and an MCP server
  mode are explicitly future work, not this spec's concern.
- Editing/regenerating a prompt server-side after the user edits it in the
  preview modal — edits are local-only, never sent back to the server; the
  server's role ends the moment it returns the initial markdown.
- A settings UI for the spike-detection thresholds — they're a documented
  heuristic, not a user-tunable feature, in v1 (phase doc: "constants in one
  config object").

## User flow

1. A Laravel app subscribed as `docker:app` throws the same unhandled
   exception on every request to a broken route. The first occurrence
   creates a new error group; every later occurrence increments its `count`
   and `perMinute` histogram rather than creating a new group or a new
   stream row's worth of sidebar noise — the sidebar's `docker:app` row
   grows a red badge, `1`, then climbing.
2. The user notices the badge, clicks it: the main panel switches to the
   **Stream** view (if it wasn't already showing), a dismissible "`docker:app`
   errors" filter chip appears in the filter row, and the stream now shows
   only that source's `ERROR`/`FATAL` entries — the full 400 repetitions
   collapse visually into one problem, still individually visible as rows
   (grouping doesn't hide raw entries from the stream — only the Errors
   panel groups them into cards).
3. The user clicks the **Errors** tab instead. The main panel swaps to the
   Errors panel: a list of `ErrorGroup` cards, most-recent-first, one for
   this exception showing its title (normalized, e.g. `Undefined array key
   ⟨val⟩ in UserController.php`), a count of 400, a small sparkline of its
   occurrence rate over the last 30 minutes, its source, and first/last-seen
   timestamps.
4. The user clicks the card. It expands to show up to 10 sample
   occurrences (full stack traces, individually expandable) and a
   **Generate AI Prompt** button. They click it: a modal opens showing a
   server-assembled, redacted, copy-ready markdown prompt — the normalized
   error, the latest occurrence's full stack trace, the 15 log lines
   immediately before the *first* occurrence across every source (so a
   downstream `mysql: Connection refused` that happened moments before this
   exception's very first occurrence is visible, even though it's from a
   different source), and a plain-language summary of the occurrence
   pattern. Any bearer token, `password=`, or AWS-style key text in that
   context is already replaced with `<redacted>` — the user sees exactly
   what they're about to copy, can edit it inline, then clicks **Copy** and
   pastes it into whatever AI assistant they already use.
5. Meanwhile, a different error — a Docker `mysql` container going down —
   starts firing 40 times/minute against a trailing 30-minute average of
   under 2/minute. Its card gains a "⚡ SPIKING" badge and the `docker:mysql`
   sidebar row gets a pulsing "SPIKING" indicator alongside its error badge.
   Ten minutes later, once mysql is restarted and the rate drops back under
   threshold, both disappear on their own — no acknowledgment needed, no
   sticky/cooldown state.
6. The user, mid-investigation in the Stream view, wants to jump straight to
   the newest error without hunting for it. They press **`e`** (or click the
   top bar's **Latest Error** button): any active search text and level
   filters are cleared (mirroring the existing "Clear filters" behavior) and
   the stream scrolls to the most recent visible `ERROR`/`FATAL` row.
7. An hour later, the app's been running long enough that the ring buffer
   has evicted the raw entries behind an old, low-frequency error group. Its
   card in the Errors panel still shows its correct historical `count` and
   `firstSeen` — group metadata survives eviction — but a small note reads
   "Some sample occurrences have aged out of the buffer," and its "Generate
   AI Prompt" flow gracefully falls back to whatever samples/context are
   still resolvable, saying so in the assembled prompt rather than silently
   fabricating anything.

## Layout

The sidebar's structure is unchanged (still Containers/Files/Environment
per specs 002–003, now with one addition per source row — see § Components
& states). The top bar and main panel gain a **view switcher**: two tabs,
**Stream** and **Errors**, as the leftmost element of the toolbar row. The
rest of the toolbar row and the filter row swap contents depending on which
tab is active; overall header height (`--topbar-height` + `--filter-row-height`
= 92px) stays constant across both, so switching tabs never reflows the main
panel's vertical position.

### Wireframe — Stream view (default, unchanged tab active)

```
┌ Sidebar ──────────────────┬ Top bar (56px) ───────────────────────────────────────────────────────┐
│ LOG SOURCES                │ (Stream)(Errors·2)  [⏸ Freeze Stream] [🗑 Clear] [⚠ Latest Error]  [🔍 Search…] │
│                             ├ Filter row (36px) ──────────────────────────────────────────────────┤
│ ☑ 🐳 docker:mysql  142 ⬤─  │(DEBUG)(INFO)(WARN)(ERROR)(FATAL)(UNKNOWN)  [⚠ Errors Only]            │
│    ⚠3 ⚡SPIKING             ├ Unified stream (virtualized) ───────────────────────────────────────┤
│ ☑ 🐳 docker:nginx  980 ⬤─  │▐2026-07-19 15:31:01 [docker:nginx]  | INFO  | GET /api/users - …     │
│ ☑ 📄 local:laravel  12 ⬤─  │▐2026-07-19 15:31:15 [docker:nginx]  | ERROR | 500 INTERNAL SERV…  ⌄  │
│    ⚠1                      │ …                                                                     │
└─────────────────────────────┴───────────────────────────────────────────────────────────────────────┘
```

`⚠3` = the per-source error-count badge (§ Components & states). `⚡SPIKING`
only renders on a source with at least one currently-spiking group.

### Wireframe — Stream view, with a source's error badge clicked

```
│ Top bar ──────────────────────────────────────────────────────────────────────────────────────────┐
│ (Stream)(Errors·2)  [⏸ Freeze Stream] [🗑 Clear] [⚠ Latest Error]  [🔍 Search…]                    │
├ Filter row ─────────────────────────────────────────────────────────────────────────────────────────┤
│(DEBUG)(INFO)(WARN)(ERROR)(FATAL)(UNKNOWN)  [⚠ Errors Only ●]  [docker:mysql errors ×]              │
├ Unified stream ────────────────────────────────────────────────────────────────────────────────────┤
│▐2026-07-19 15:29:40 [docker:mysql] | FATAL | Connection refused: mysql:3306                    ⌄   │
│▐2026-07-19 15:29:41 [docker:mysql] | FATAL | Connection refused: mysql:3306                    ⌄   │
│ …                                                                                                    │
```

`[docker:mysql errors ×]` is the dismissible scope chip (§ Interaction
specs); `[⚠ Errors Only ●]` shows pressed/active alongside it, since setting
the scope chip always also turns Errors Only on.

### Wireframe — Errors view

```
┌ Sidebar (unchanged) ───────┬ Top bar ────────────────────────────────────────────────────────────┐
│                             │ (Stream)(Errors·2)                                                   │
│                             ├ Filter row ──────────────────────────────────────────────────────────┤
│                             │ Sort: (Recency)(Count)                                                │
│                             ├ Errors panel ────────────────────────────────────────────────────────┤
│                             │ ┌──────────────────────────────────────────────────────────────────┐│
│                             │ │ ERROR  Undefined array key ⟨val⟩ in UserController        ⚡SPIKING││
│                             │ │ × 412 occurrences          ▂▃▅█▇▄▂▁▂▃                              ││
│                             │ │ docker:app                                                      ⌄ ││
│                             │ │ First 14:58:02 · Last 15:31:15 (12s ago)                           ││
│                             │ └──────────────────────────────────────────────────────────────────┘│
│                             │ ┌──────────────────────────────────────────────────────────────────┐│
│                             │ │ FATAL  Connection refused: mysql:3306                              ││
│                             │ │ × 3 occurrences            ▁▁▁▁▁▂▁▁▁▁                              ││
│                             │ │ docker:mysql                                                    ⌄ ││
│                             │ │ First 09:12:40 · Last 09:14:02 (3h ago)                            ││
│                             │ └──────────────────────────────────────────────────────────────────┘│
└─────────────────────────────┴───────────────────────────────────────────────────────────────────────┘
```

### Wireframe — Errors view, card expanded

```
│ ┌────────────────────────────────────────────────────────────────────────────────────────────────┐│
│ │ ERROR  Undefined array key ⟨val⟩ in UserController                                    ⚡SPIKING  ││
│ │ × 412 occurrences            ▂▃▅█▇▄▂▁▂▃                                                          ││
│ │ docker:app                                                                                    ^  ││
│ │ First 14:58:02 · Last 15:31:15 (12s ago)                                                         ││
│ │ ┌ Sample occurrences (10 of 412 — some samples evicted) ─────────────────────────────────────┐ ││
│ │ │ 15:31:15  [docker:app]  Undefined array key "id" in UserController.php:42               ⌄  │ ││
│ │ │ 15:30:58  [docker:app]  Undefined array key "id" in UserController.php:42               ⌄  │ ││
│ │ │ …                                                                                             │ ││
│ │ └───────────────────────────────────────────────────────────────────────────────────────────┘ ││
│ │                                                                        [✦ Generate AI Prompt]   ││
│ └────────────────────────────────────────────────────────────────────────────────────────────────┘│
```

Each sample row's own `⌄` expands it in place, reusing the exact
syntax-highlighted code-viewport + "Copy Raw" treatment spec 001 already
defines for a stream row's expanded panel (`--color-surface-row-expanded-panel`,
`--row-expanded-max-height`, `highlightBody`) — no new visual pattern, just
reused inside the card.

### Wireframe — Errors panel, empty (sources exist, zero groups yet)

```
│                          ⚠                                        │
│           No errors yet — grouped error/fatal entries              │
│                will appear here as they occur.                     │
```

Same centered, muted-copy treatment as spec 001's stream `EmptyState`,
`IconWarning` in place of the cloud-upload icon.

### Wireframe — stream row's expanded panel, with the AI-prompt affordance

Per the concept art (`assets/traceriver_ui_concept.png`) that
[spec 001](001-phase-1-core-console.md)'s Overview explicitly deferred here —
the sparkle glyph in the expanded row's bottom-right corner is this phase's
second entry point into prompt generation (§ Interaction specs), alongside
the Errors panel card's own button:

```
│▐2026-07-19 15:31:15 [docker:nginx]  | ERROR | 500 INTERNAL SERVER ERROR      ^ (chevron, expanded)│
│┌ expanded panel ───────────────────────────────────────────────────────────────────────────────┐│
││ {                                                          [Copy Raw]                            ││
││   "stack_trace": { ... }                                                                         ││
││ }                                                                                     [✦]        ││
│└────────────────────────────────────────────────────────────────────────────────────────────────┘│
```

`[✦]` (icon-only, `IconSparkle`, `aria-label="Generate AI debugging prompt for
this error"`) renders bottom-right, absolutely positioned, **only** when
`entry.level` is `ERROR`/`FATAL` **and** `entry.fingerprint` is non-null
(§ API contract). It never renders on non-error rows — this is strictly
additive to spec 001's expanded panel, which otherwise renders exactly as
before (spec 001's "no other controls render in this panel" language is
superseded only for this one icon, only under this one condition).

### Wireframe — AI Prompt Preview modal

```
                    ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
                    ░░ ┌ AI Debugging Prompt Preview ──────────── × ░░
                    ░░ │ Redacted values are already replaced with   ░░
                    ░░ │ <redacted> below. Edit freely, then copy.   ░░
                    ░░ │ ┌──────────────────────────────────────┐   ░░
                    ░░ │ │ I'm debugging an error in my local    │   ░░
                    ░░ │ │ development environment. Help me find │   ░░
                    ░░ │ │ the root cause and suggest a fix.     │   ░░
                    ░░ │ │                                        │   ░░
                    ░░ │ │ ## Error                               │   ░░
                    ░░ │ │ `Undefined array key ⟨val⟩ ...`        │   ░░
                    ░░ │ │ ...                                     │   ░░
                    ░░ │ │ Authorization: Bearer <redacted>       │   ░░
                    ░░ │ │ ...                                     │   ░░
                    ░░ │ └──────────────────────────────────────┘   ░░
                    ░░ │                          [Cancel]  [Copy]  ░░
                    ░░ └──────────────────────────────────────────── ░░
                    ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
```

Backdrop: `color-mix(in srgb, var(--color-bg) 85%, transparent)`, the exact
pattern spec 001's drag-over overlay already uses (`--z-modal-overlay`, no
new opacity value). Dialog: `--color-surface-row-expanded-panel` background,
`--color-border-interactive` 1px border, `--radius-lg`, `--modal-max-width`
(640px), centered, `--z-modal`. Body is a real, focusable, `<textarea>`
(monospace, `--font-size-base`, `--line-height-relaxed`) pre-filled with the
server-assembled markdown and freely editable — not read-only, not a `<pre>`.

## Components & states

### View switcher (top bar, leftmost)

Two tab buttons, `role="tab"` inside `role="tablist" aria-label="Console view"`,
`aria-selected`. **Stream** (default/initial) and **Errors · `<n>`** where
`<n>` is the current count of tracked error *groups* (not raw occurrences —
"400 repetitions... one group, not 400 cards" is the whole point, so the
tab's own badge counts the same unit the panel it opens is built from).
Visually: same `--topbar-btn`-family pill treatment already used for Freeze/
Clear, with the active tab getting the `aria-pressed`-style
`--color-accent-interactive` border+text treatment already established
(no new visual pattern). Both tabs disabled together, matching Freeze/Clear/
Search's existing `!hasSources` disabled gating — there is nothing to show
in either view before any source exists.

### Stream-view toolbar additions

- **Latest Error** button: `IconWarning` + "Latest Error" label, same
  `topbar-btn` treatment as Freeze/Clear. Disabled when `!hasSources` (same
  gate) **or** when there is no currently-eligible target entry (§
  Interaction specs — jump to latest error). `aria-label="Jump to the most
  recent error entry (press E)"`.
- **Errors Only** toggle: `IconWarning` + "Errors Only" label, filter-row
  placement (grouped with level chips, since it's a filter, not an action),
  `aria-pressed`. Active-state visual: the existing 18%-tint-over-transparent
  pattern already implemented for active level chips
  (`color-mix(in srgb, var(--color-level-error) 18%, transparent)`
  background + `--color-level-error` border/text) — reused, not a new value.
  Disabled when `!hasSources`.
- **Source-scope filter chip** (`"<source id> errors ×"`): renders only while
  a per-source error badge's click-to-filter is active (§ Interaction
  specs). Same filter-row placement, immediately after Errors Only. `×` is a
  real button, `aria-label="Clear <source id> errors filter"`. Not present
  by default.

### Errors-view toolbar/filter-row

- Toolbar row: view switcher only (Freeze/Clear/Latest-Error/Search all
  apply to the *stream*, not the group list, and are hidden — not
  disabled-and-shown — while on this tab, since they have literally nothing
  to act on here).
- Filter row: **Sort:** label + a two-button `role="radiogroup"` (`role="radio"`
  each, exactly one `aria-checked="true"`) — **Recency** (default; sorts by
  `lastSeen` descending) and **Count** (sorts by `count` descending). Same
  pill-button visual family as Errors Only, one always active.

### ErrorGroup card

- **Header row**: level word (`ERROR`/`FATAL`, same in-row treatment as the
  stream — colored text for ERROR, filled inverse-text chip for FATAL,
  `--color-level-error`/`--color-level-fatal`) + title. Title renders
  `⟨…⟩` placeholder segments in `--color-text-muted`, the rest of the text
  in `--color-text-primary` (a small, optional legibility aid — the
  placeholder markers are visually quieter than the literal, meaningful
  parts of the message).
- **SPIKING badge**: top-right of the header row, only when `group.spiking`
  is true. `IconBolt` + "SPIKING" text, filled chip (`--color-level-error`
  background, `--color-text-inverse` text, `--radius-pill`,
  `--font-size-xs`, `--font-weight-bold`, `--letter-spacing-label`,
  uppercase) — same filled-chip pattern FATAL's row treatment already
  established, applied here instead of to a level word. Pulses via
  `--motion-pulse` (opacity 1 ↔ 0.55); static (no animation, still fully
  legible/present) under `prefers-reduced-motion: reduce`.
- **Count**: "× `<count>` occurrence(s)", `--font-size-base`,
  `--font-weight-bold`, `--color-text-primary`.
- **Sparkline**: inline SVG polyline, `--sparkline-width` × `--sparkline-height`,
  stroke `--color-level-error` (or `--color-level-fatal` for a FATAL group),
  `fill: none`, no axes/labels (a pure trend glance, not a readable chart).
  Self-scaled to the group's own `perMinute` min/max within its own 30-point
  window (not normalized across cards) — a flat/empty group (all-zero
  window, e.g. a group with only its first occurrence so far) renders a flat
  baseline rather than an empty box. `aria-hidden="true"` — the count and
  "Occurrence pattern" text (available inside the AI prompt, and via the
  sparkline's `title` attribute tooltip summarizing the same "steady ~X/min…"
  text the prompt itself generates, § API contract) carry the same
  information in text form, so the chart itself is decorative.
- **Sources**: comma-separated list of `group.sources`, `--font-size-sm`,
  `--color-text-muted`, matching the existing `[source]` bracket-free plain
  presentation used elsewhere for source lists (e.g. spec 002's tooltip
  text).
- **First/last seen**: `"First <formatted> · Last <formatted> (<relative>
  ago)"`, `--font-size-sm`, `--color-text-muted`. `<formatted>` uses the
  existing `formatTimestamp` presentation (`YYYY-MM-DD HH:mm:ss`, or just
  `HH:mm:ss` when the date is today — matching the existing timestamp
  convention's intent of "when did this happen for me," extended minimally
  for the card's denser layout). `<relative>` uses the following fixed
  breakpoints: `< 60s` → `"<n>s ago"`; `< 60min` → `"<n>m ago"`; `< 24h` →
  `"<n>h ago"`; else → `"<n>d ago"`.
- **Expand affordance**: chevron (`IconChevronDown`, same rotate-on-expand
  treatment as a stream row), right edge of the header row. Whole card is a
  real `<button>`-wrapped expandable region (same "real focusable control,
  not a div with a click handler" rule as spec 001's stream rows).
- **Expanded state**: "Sample occurrences (`<n>` of `<count>``<evicted
  note>`)" label, then up to 10 sample rows (timestamp, `[source]`, message,
  own expand chevron reusing the stream row's code-viewport treatment),
  then the **Generate AI Prompt** button (§ AI Prompt Preview modal),
  bottom-right, filled `--color-accent-interactive` background /
  `--color-text-inverse` text / `--radius-md` — visually the "primary
  action" of the card, matching how `--color-accent-interactive` is already
  reserved for actionable chrome elsewhere (the "↓ Live" button, links).
  `<evicted note>` reads `" — some samples evicted"` only when
  `group.rawEntriesEvicted` is true; omitted otherwise.
- **Unresolvable sample fallback**: if a sample id in `sampleEntryIds` can't
  be matched against the client's local entry store (§ Interaction specs —
  Sample resolution), that row renders "This occurrence is no longer
  available (evicted from the buffer)." in place of its message/expand
  affordance — muted text, not a button, not focusable.

### Sidebar source row addition

Extends spec 001/002/003's `SourceRow` (checkbox — kind icon — label — entry
count — visibility toggle, plus the existing docker/local state label) with
one more element, rendered inline after the entry count:

- **Error badge**: a real `<button>`, `--font-size-xs`, `--font-weight-bold`,
  `--radius-pill`, the same 18%-tint pattern as the Errors Only toggle
  (`color-mix(in srgb, var(--color-level-error) 18%, transparent)`
  background, `--color-level-error` text), containing the numeral count only
  (e.g. `3`) — the numeral itself is the required text signal (never color
  alone), so no icon is needed here (unlike the toolbar controls, where an
  icon accompanies a text *label*; a bare count next to the existing entry
  count already reads clearly as "of those, N are errors"). `aria-label="<n>
  errors from <source id> — filter stream to these"`. Rendered only when the
  source's live error count (§ Interaction specs — badge count) is `> 0`;
  absent otherwise (no `0` badge clutter). Clicking triggers the click-to-filter
  interaction (§ Interaction specs).
- **SPIKING indicator**: immediately after the error badge, only when at
  least one of the source's groups has `spiking: true`. Same `IconBolt` +
  "SPIKING" filled-chip treatment as the ErrorGroup card's badge, same
  `--motion-pulse` animation/reduced-motion handling. Not a button (purely a
  status indicator at the source-row level; per-group spike state is only
  actionable from the Errors panel, where each group is distinct).

## Interaction specs

### Fingerprinting & grouping (server-side, client never computes this)

Every `ERROR`/`FATAL` `TraceRiverLog` entry is fingerprinted at ingestion
time, before broadcast:

1. Start from `message`, plus the first frame of the parsed stack trace
   (from `body`) when present.
2. Normalize by replacing variable segments with placeholders (regex rules
   live server-side, tested against a real-world fixture corpus per § 4.4):
   - timestamps/dates → `<ts>`
   - UUIDs, hex strings ≥ 8 chars, long integers → `<id>`
   - quoted strings/numbers in common positions (`user 12345`, `id = 'abc'`)
     → `<val>`
   - memory addresses, ports, durations (`took 342ms`) → `<n>`
   - file paths: strip the user-specific prefix, keep the static tail
     (`/Users/x/project/app/Foo.php` → `app/Foo.php`)
   - Rules err conservative (§ phase doc): a false split (two cards for one
     real bug) is an acceptable cost; a false merge (two real bugs
     collapsed into one card) is not.
3. **Fingerprint namespace — decided by this spec** (the phase doc's
   wording left this genuinely underspecified; see § Decisions #1 for the
   reasoning): `fingerprint = hash(source-id + normalized-message +
   top-stack-frame)`, where `source-id` is the **literal**
   `TraceRiverLog.source` value (e.g. `"docker:mysql"`), not just its kind.
   Consequence: in normal operation a group's `sources` array holds exactly
   one id — the schema still allows more (forward-compatible with a future,
   deliberately coarser namespace, should product direction want
   cross-source merging later), it just won't happen under this spec's
   algorithm. A restarted container reusing the same source id (spec 002)
   naturally continues the same group; two different services (`docker:mysql`
   vs `docker:nginx`) never merge even on coincidentally identical message
   text.
4. `title` is the normalized message with placeholders rendered as `⟨…⟩`
   (distinct bracket style from the AI-prompt's `<redacted>` — these mean
   different things: `⟨…⟩` marks "this was a variable, generalized for
   grouping," `<redacted>` marks "this looked like a secret, scrubbed for
   safety." The two passes are unrelated even though they can touch
   overlapping text.)

### Group storage, cap, and eviction survival

- Groups live server-side, keyed by fingerprint, independent of the ring
  buffer. Capped at **500** groups, LRU by `lastSeen` — when a genuinely new
  fingerprint would exceed the cap, the group with the oldest `lastSeen` is
  evicted outright (not zombied/kept-partial; it simply stops existing —
  the next time that exact error recurs, if ever, it starts a fresh group
  from `count: 1`).
- `sampleEntryIds` (up to 10) is maintained as: the single **oldest**
  still-resolvable occurrence id (pinned — needed for the AI prompt's
  "context before the first occurrence" section, § API contract) **plus**
  up to **9 most-recent** occurrence ids (rolling FIFO as new occurrences
  arrive). This split is this spec's own resolution of an implementation
  need the phase doc's "up to 10 raw occurrences" wording didn't itself
  specify (§ Decisions #2).
- `rawEntriesEvicted` becomes `true` the first time any id tracked by the
  group (including the pinned oldest) ages out of the ring buffer, and
  **stays true** for that group's remaining lifetime (count/`firstSeen`
  survive; some underlying raw text is now genuinely gone — that fact
  doesn't un-happen). When it happens, the server prunes the now-unresolvable
  id(s) out of `sampleEntryIds` (the array always reflects only currently-
  resolvable ids) and, if the pinned-oldest id itself was pruned, re-pins
  whatever is now the oldest still-resolvable occurrence in its place.

### Spike detection

Server-computed, using one constants object (phase doc: "constants live in
one config object"):

```
groupCap: 500
sampleCap: 10
histogramWindowMinutes: 30
spike.multiplierThreshold: 5      // current rate must exceed 5× trailing average
spike.minAbsoluteRatePerMin: 10   // AND at least this many/min, absolute
promptContextLines: 15
```

`spiking` is recomputed on every occurrence (and at minimum once per
broadcast tick) from the group's own `perMinute` histogram: `current` = the
most recent minute bucket; `trailingAverage` = mean of the preceding
(up to 30) buckets. `spiking = current > multiplierThreshold *
trailingAverage AND current >= minAbsoluteRatePerMin`. **No hysteresis or
cooldown** (§ Decisions #5) — the flag is a direct, honest function of the
current histogram state each time it's evaluated, per the phase doc's own
"lightweight, no ML" framing; it can flip back off the moment the rate
subsides, with no minimum on-duration.

### Errors panel scope — not filtered by sidebar visibility (§ Decisions #4)

The Errors panel always shows the complete, current, server-side group list
(subject only to the 500-cap), regardless of any source's `visible` toggle
or (for local/file sources, which are always fully ingested — specs
001/003) `subscribed` state. The one case where a source's errors are
genuinely absent from the panel is a Docker source that has never been
subscribed at all (spec 002: unsubscribed containers produce no ring-buffer
entries, so nothing to fingerprint in the first place) — that's not this
panel filtering anything, it's simply that no data exists yet.

### Per-source error badge — count and click-to-filter

- **Badge count** (client-derived, no new wire field): sum of `group.count`
  across every currently-known `ErrorGroup` whose `sources` array includes
  this source's id. Recomputes live as `errorGroups` messages arrive.
- **Click**: switches the main panel to the Stream tab (if not already
  active), sets the source-scope filter chip to this source's id, and turns
  **Errors Only** on. The scope chip is a filter fully independent of the
  sidebar's own `visible`/`subscribed` toggles — clicking a badge **never**
  changes any source's checkbox or visibility state (this mirrors spec
  001's existing "Clear filters... source toggles are left untouched"
  precedent exactly — see § Decisions #3). While active, the visible
  stream is: `entry.level ∈ {ERROR, FATAL} AND entry.source === scopeSourceId`,
  ANDed with whatever search text/level chips/other-source-visibility
  filters were already in effect (search text and level chips are not
  reset by this action, only Errors Only is force-enabled).
- **Clearing**: clicking the chip's `×` removes only the source-scope
  restriction; **Errors Only** stays on (the user can turn it off separately
  if desired). Manually turning **Errors Only** off while a scope chip is
  active also clears the scope chip (a source-scoped *non-error* view isn't
  a state this feature produces — "that source's errors" is the whole
  point of having clicked the badge).

### Errors Only toggle

An independent fourth filter (AND) alongside spec 001's existing three
(search text ∩ active levels ∩ visible sources): when on, entries must
additionally have `level ∈ {ERROR, FATAL}`. Does **not** alter the level
chips' own pressed/unpressed state — a user can have Errors Only on and
still further narrow to just `FATAL` via the chips; turning Errors Only back
off restores whatever the chips already say, unmodified throughout.

### Jump to latest error (`e` key + Latest Error button)

- **Eligibility / enabled state**: enabled when at least one entry in the
  client's local entry store has `level ∈ {ERROR, FATAL}` **and** belongs to
  a currently-visible source (`source.visible === true`); disabled
  otherwise (mirrors Freeze/Clear's existing disabled-when-nothing-to-act-on
  convention — a source hidden by its own visibility toggle is treated as a
  deliberate user choice, not silently overridden here either).
- **Action**: resets search text/query to empty and all level chips back to
  active — i.e., performs exactly spec 001's existing "Clear filters" action
  — then, among the now-recomputed visible entries, finds the one with the
  highest `id` whose `level ∈ {ERROR, FATAL}`, and scrolls it into view
  (`align: "center"`, consistent with wanting surrounding context visible,
  not just the row's own edge). Does **not** touch any source's
  `visible`/`subscribed` state (only text/levels, exactly like "Clear
  filters").
- Does **not** reach into groups' sample data or make any network call —
  this operates purely over the client's already-loaded local entry store,
  same as every other stream filter/scroll action.
- **Keyboard**: bound globally, fires only on a bare `e` keydown (no
  `ctrlKey`/`metaKey`/`altKey`/`shiftKey`) and only when focus is not inside
  an `<input>`, `<textarea>`, any `contenteditable`, or while the AI Prompt
  Preview modal is open (its own focus trap owns the keyboard while open).
  Also switches the main panel to the Stream tab first, if the Errors tab
  was active.

### AI Prompt Preview modal

- **Entry points**: the Errors panel card's "Generate AI Prompt" button, and
  the stream row's sparkle icon (§ Layout wireframes) — both call
  `GET /api/errors/:fingerprint/prompt` for the same fingerprint and open
  the identical modal.
- **Loading**: while the request is in flight, the modal shows centered text
  "Assembling prompt…" in place of the textarea (no new spinner
  icon/animation — kept deliberately simple).
- **Error**: a `404` (fingerprint no longer tracked — evicted from the
  500-cap since the button was rendered) shows "This error group is no
  longer tracked and the prompt can't be regenerated." in place of the
  textarea, with only a "Close" action available.
- **Body**: an editable `<textarea>`, pre-filled with the response's
  `prompt` string verbatim (already redacted server-side — "the user sees
  exactly what they're copying" per the phase doc, satisfied by literally
  showing the post-redaction text, not a separate diff/preview view).
- **Copy**: copies the textarea's *current* value (including any user
  edits) via the existing clipboard utility (same fallback-for-non-secure-context
  behavior spec 001's "Copy Raw" already implements), then shows an inline
  "Copied" confirmation on the button itself for ~1.5s (same pattern as
  "Copy Raw"). Does not close the modal (the user may want to copy again,
  or copy a further-edited version).
- **Cancel/close**: `×` icon top-right (`aria-label="Close prompt preview"`),
  or Escape. Discards any in-progress edits (nothing was ever sent back to
  the server, so "discard" just means "close").
- **Focus trap**: while open, Tab/Shift+Tab cycle only among the modal's
  focusable elements (`×`, textarea, Cancel, Copy); Escape closes and
  returns focus to whichever button opened it (mirrors spec 001's existing
  expanded-row Escape-returns-focus rule). Background content
  (`inert`/`aria-hidden`) is not reachable by Tab or announced by a screen
  reader while the modal is open.

## API contract

All shapes align with the existing `TraceRiverLog`/`SourceDescriptor`/WS
message contract from specs 001–003 and `src/shared/types.ts`. This section
is additive: one new field on `TraceRiverLog`, one new shared type
(`ErrorGroup`), one new WS message, and two new REST endpoints.

### `TraceRiverLog` — new field

```ts
export interface TraceRiverLog {
  // ...all existing fields unchanged (id, timestamp, rawTimestamp, source,
  // level, message, body, context, raw, multiline)...

  /** This entry's ErrorGroup fingerprint. Non-null only when level is ERROR
   *  or FATAL and grouping has run (same tick as ingestion — never a later,
   *  separate update to an already-broadcast entry). null for every other
   *  level, always. Lets the stream row offer "Generate AI Prompt" directly
   *  (docs/specs/004-phase-4-error-intelligence.md) without a lookup round
   *  trip to resolve which group a given row belongs to. */
  fingerprint: string | null;
}
```

### `ErrorGroup` — new shared type

```ts
export interface ErrorGroup {
  fingerprint: string;
  /** Normalized message; placeholder segments rendered as literal "⟨…⟩". */
  title: string;
  level: "ERROR" | "FATAL";
  /** Every distinct TraceRiverLog.source that has emitted this fingerprint.
   *  In practice, under this spec's fingerprint namespace (§ Interaction
   *  specs), exactly one entry — see § Decisions #1. */
  sources: string[];
  count: number;
  firstSeen: number;   // epoch ms
  lastSeen: number;    // epoch ms
  /** Up to 10 ring-buffer ids: the oldest still-resolvable occurrence
   *  (pinned) plus up to 9 most-recent occurrences (rolling). */
  sampleEntryIds: number[];
  /** Rolling 30-minute occurrence histogram, oldest → newest, one bucket
   *  per minute. */
  perMinute: number[];
  /** Server-computed heuristic (§ Interaction specs — Spike detection).
   *  Addition beyond the phase doc's bare model — needed on the wire since
   *  the client never computes fingerprints or spike math itself. */
  spiking: boolean;
  /** True once any occurrence this group has ever recorded has aged out of
   *  the ring buffer. Sticky — never reverts to false. Addition beyond the
   *  phase doc's bare model, for the same reason as `spiking`. */
  rawEntriesEvicted: boolean;
}
```

### WS message — new type, added to the server→client union

```ts
export type ServerToClientMessage =
  | { type: "entries"; entries: TraceRiverLog[] }
  | { type: "sources"; sources: SourceDescriptor[] }
  | { type: "sourceState"; id: string; state: SourceState; detail?: string | null }
  | { type: "dropped"; count: number }
  | { type: "cleared" }
  | { type: "dockerStatus"; status: DockerStatus; detail: string | null }
  | { type: "discovery"; frameworks: DetectedFramework[] }
  | { type: "errorGroups"; groups: ErrorGroup[] };   // NEW
```

- **Cadence**: batched into the same ~75ms flush as `entries` (never a
  separate per-occurrence frame) — decisions.md's D3 already anticipated
  this exact message when it was written ("server pushes entries,
  source-state changes, and error groups").
- **Payload shape**: always the **full current group list** (≤500) on any
  change, mirroring `sources`' existing full-replace-on-change convention —
  simpler than incremental diffing at this cardinality, and the client
  needs the whole list anyway to render the Errors panel and recompute
  sidebar badge sums.
- **Connection sequence**: sent once, right after `discovery` (or right
  after `dockerStatus` if `discovery.enabled` is false, or right after
  `sources` if both are off — i.e., appended as the new last step of specs
  002/003's already-established sequence), with the current full group list
  (sent even when `[]` — same "presence signals the feature ran"
  convention `discovery` already established, though unlike `discovery`
  this message is **not** conditional on any enable flag: error grouping is
  always on, per this spec — see § Decisions #6). Live updates thereafter
  whenever any group is created or changes.

No new client→server message — nothing about this feature needs the client
to tell the server anything (fingerprinting, spike math, and prompt
assembly are all unconditional/server-initiated or read-only REST calls).

### REST endpoints — additions

**`GET /api/errors`** → `{ "groups": ErrorGroup[] }` — convenience mirror
of the WS-pushed value, matching the existing precedent
(`GET /api/docker/status`, `GET /api/discovery`).

**`GET /api/errors/:fingerprint/prompt`** → `{ "prompt": string }` —
server-assembles and redacts the markdown prompt (below) for the given
fingerprint. `404 { "error": "not_found" }` if the fingerprint isn't
currently tracked (never existed, or evicted from the 500-cap LRU since the
button was rendered).

### Prompt assembly (server-side; this section is this spec's concrete
### definition of the phase doc's template, filling in what it left as example prose)

Template (verbatim from the phase doc, field mapping below it):

````markdown
I'm debugging an error in my local development environment. Help me find the
root cause and suggest a fix.

## Error
`<normalized title>` — occurred <count> times between <firstSeen> and <lastSeen>,
from source(s): <sources>.

## Stack trace (most recent occurrence)
```
<full raw body of the latest sample entry>
```

## Environment
- Source: <one line per distinct entry in `sources`>
- Project stack detected: <DetectedFramework labels, comma-joined>
- Log format: <parser name>

## Surrounding log context
The 15 entries immediately before the first occurrence, across all subscribed
sources (interleaved, timestamped):
```
<context lines>
```

## Occurrence pattern
<per-minute histogram summary>

Please: 1) identify the most likely root cause, 2) explain the reasoning,
3) suggest a concrete fix, 4) note what additional info would confirm it.
````

Field mapping:

- `<normalized title>` = `group.title`; `<count>` = `group.count`;
  `<firstSeen>`/`<lastSeen>` = `formatTimestamp`-style rendering (same
  format the UI already uses); `<sources>` = `group.sources.join(", ")`.
- **Stack trace block** = `entry.body ?? entry.message` of the most-recent
  resolvable sample (the highest-id entry in `sampleEntryIds`). If every
  sample for this group has been evicted (the group's metadata survived,
  but literally no raw text remains anywhere), this section instead reads:
  `"(original stack trace no longer available — this group's occurrences
  have all aged out of the buffer.)"`.
- **Environment → Source line(s)**: one bullet per entry in `group.sources`:
  a `docker`-kind source renders `"<id> (image <SourceDescriptor.docker.image>)"`;
  any other kind renders just `"<id>"`.
- **Environment → Project stack detected**: the labels of every entry in the
  most recent `discovery` payload's `frameworks` array (project-wide
  context, not scoped to this error's own source — matches the template's
  own example, which lists two unrelated frameworks together), comma-joined;
  omitted (whole bullet dropped) if discovery is disabled or found nothing.
- **Environment → Log format**: the parser name (`monolog`/`clf`/`jsonl`/
  `raw`, or a custom parser's configured name) currently locked for this
  error's source — read directly from the pipeline's own per-source
  state server-side; **no wire-contract change needed**, since prompt
  assembly happens entirely server-side and this value never needs to reach
  the browser for any other purpose.
- **Surrounding log context**: the 15 ring-buffer entries with the highest
  `id` that is still less than the **oldest (first-occurrence) sample's**
  id, drawn from the full ring buffer regardless of source or any client's
  current visibility/level filters (this is a complete, server-side
  reconstruction — client-side filters never constrain prompt assembly).
  Rendered interleaved in id order, one line each:
  `"<formatted timestamp> [<source>] <message>"`. If the pinned
  oldest-occurrence sample has itself been evicted
  (`group.rawEntriesEvicted` true and no oldest sample resolvable), fall
  back to the oldest **still-resolvable** sample instead, and prefix the
  section with: `"(first-occurrence context unavailable — showing context
  around the oldest retained occurrence instead.)"`.
- **Occurrence pattern**: computed deterministically (this spec's own
  algorithm, needed for the snapshot tests § 4.4 to be reproducible) from
  `group.perMinute`:
  1. `avg` = mean of all buckets (rounded to nearest integer; `"<1/min"` if
     the rounded value is 0 but the true mean is > 0).
  2. `peakValue`/`peakIndex` = the maximum bucket and its index.
  3. If `peakValue >= spike.multiplierThreshold * avg AND peakValue >=
     spike.minAbsoluteRatePerMin` (the same constants as spike detection):
     text = `"steady ~<avg>/min for <peakIndex> min, spiked to <peakValue>/min
     at <clock time of that bucket>"`.
  4. Otherwise: text = `"steady ~<avg>/min over the last <bucket count> min"`.
- **Markdown fencing**: the standard triple-backtick fence is used for the
  stack-trace and context blocks; if the underlying text itself contains a
  triple-backtick sequence, the fence widens to four backticks so the block
  can't be broken out of early.

### Redaction (applied to the fully-assembled prompt string, last step
### before the response is returned — this is what the modal displays)

Two passes, both server-side, both re-run fresh at prompt-assembly time
(not reused from ingestion-time normalization, since the fingerprint
placeholder pass only ever touched the title, never the stack trace/context
blocks this section governs):

1. **Placeholder normalization re-run**: the same timestamp/UUID/hex/
   memory-address/port/duration/file-path rules from § Interaction specs —
   Fingerprinting are re-applied to the stack-trace and context blocks
   (using `⟨…⟩`, same as the title — these are generalization placeholders,
   not secrecy redaction, and stay visually distinct from the pass below).
2. **Secret-pattern scrubbing → `<redacted>`** (ASCII angle brackets,
   deliberately distinct from `⟨…⟩` above): applied line-by-line, value-only
   (the key name, where one exists, is preserved for context — e.g.
   `password=<redacted>`, not the whole line dropped). Baseline pattern set
   (non-exhaustive, conservative-by-design — same "documented as such"
   framing as fingerprinting; the corpus grows the same way, per new
   false-negative reports):
   - `Authorization: Bearer <token>` → `Authorization: Bearer <redacted>`
   - `password=`/`passwd=`/`pwd=` (any case) key-value → value replaced
   - AWS-style access key ids (`AKIA[0-9A-Z]{16}`) → replaced
   - generic `api[_-]?key`/`secret`/`token` key-value assignments (`=`, `:`,
     or `"key": "value"` JSON form) → value replaced
   These rules run over the stack-trace block, the context lines, and (for
   completeness/defense-in-depth) the title and environment lines too, even
   though those are expected to rarely contain secrets — a single scrub pass
   over the whole assembled string is simpler and safer than trying to
   scope it per-section.

## Design tokens used

Full color/typography/spacing/radius/motion/z-index tables:
[`design-system.md`](../design-system.md). This spec adds, with reasons
recorded there (§ Iconography, § Motion, § Z-index, § Layout & row metrics):

- **Icons**: `IconWarning` (per-source badge, Errors tab, Errors Only
  toggle, Latest Error button — always paired with a text label/number,
  never the sole signal), `IconBolt` (SPIKING chips), `IconSparkle` (Generate
  AI Prompt, both entry points — matches the concept art glyph spec 001
  deferred here).
- **Motion**: `--motion-pulse` (`1.6s ease-in-out infinite`) — the SPIKING
  chip's pulse; the app's first repeating-animation token, suppressed under
  `prefers-reduced-motion: reduce` like the existing one-shot tokens.
- **Z-index**: `--z-modal-overlay` (90), `--z-modal` (91) — the AI Prompt
  Preview modal, the app's first modal; deliberately below `--z-toast` (100)
  so a global toast still surfaces over it.
- **Layout**: `--sparkline-width`/`--sparkline-height` (64px/20px — the
  ErrorGroup card's histogram sparkline), `--modal-max-width` (640px).
- **No new color tokens.** Every color used above (level accents, accent-
  interactive, text-inverse, text-muted, border-interactive) is reused as-is.
  The per-source badge/Errors-Only/scope-chip "tinted pill" styling reuses
  the existing `color-mix(in srgb, var(--color-level-error) 18%, transparent)`
  pattern already implemented (not formally tokenized, but consistently
  used) for active level chips in `TopBar.css`/`LevelChips.tsx` — this spec
  extends that established implementation pattern rather than introducing a
  parallel one.

## Accessibility requirements

Everything in specs 001–003's accessibility sections still applies
unchanged. This phase adds:

- **Landmarks**: the view switcher is `role="tablist" aria-label="Console
  view"` with two `role="tab" aria-selected`; the active view's panel is
  `role="tabpanel"`. The Errors panel's list of cards is a `<ul>` of
  `<li>`-wrapped, real `<button>`-triggered expandable cards — same pattern
  as spec 001's stream rows, not a new interaction model. The AI Prompt
  Preview modal is `role="dialog" aria-modal="true" aria-labelledby="<title
  id>"`.
- **Live region strategy** (extends the existing single visually-hidden
  `aria-live="polite"` region — still one region, still discrete state
  changes only): "New error group: `<title>`" is **not** announced per-group
  (would spam the region at realistic volume, the same reasoning spec 001
  already applied to entries generally) — the per-source sidebar badge and
  Errors-panel tab's own count are the discoverable, glanceable signal
  instead, not an announcement. "`<n>` errors from `<source id>`" *is*
  announced once, at the moment the click-to-filter scope chip is applied
  (a direct result of user action, same as existing toast/announcement
  pairs). "Prompt copied to clipboard." is announced on a successful Copy.
- **Keyboard**: the view switcher tabs, Errors Only toggle, Latest Error
  button, scope-chip's `×`, sort radio buttons, ErrorGroup cards (and their
  sample rows), and the modal's controls are all real, Tab-reachable,
  native-semantic controls (`<button>`, `role="radio"`, `role="tab"`),
  operable via Enter/Space, showing `--color-focus-ring`. The global `e`
  shortcut never fires while focus is in an editable field or while the
  modal is open (§ Interaction specs), so it can never hijack normal typing
  or in-modal editing.
- **Focus management**: opening the AI Prompt Preview modal moves focus to
  its first focusable element (the `×`, or the textarea once loaded);
  closing it (Escape, `×`, or Cancel) returns focus to whichever button
  opened it — sparkle icon or card's Generate button — mirroring spec 001's
  existing expanded-row Escape-focus-return rule.
- **Text, never color alone**: the per-source badge is a numeral (text);
  SPIKING is always icon **+** the word "SPIKING", never a bare colored dot
  or bare pulse; the `⟨…⟩`/`<redacted>` distinction is carried by the
  bracket characters themselves (visible in plain text), not by any color
  difference between the two.
- **Reduced motion**: `--motion-pulse` is suppressed under
  `prefers-reduced-motion: reduce` (§ Design tokens used) — the SPIKING chip
  renders static or not at all, no information lost, matching spec 001's
  governing rule for every other `--motion-*` token.

## Acceptance criteria

Numbered and individually testable. Criteria 1–6 map directly to the six
exit criteria in `phase-4-error-intelligence.md` § Exit criteria, strengthened
with concrete thresholds/behaviors from this spec.

1. Feeding 400 occurrences of one real-world Laravel exception fixture
   through the pipeline produces exactly one `ErrorGroup` with `count: 400`
   — not 400 stream rows' worth of Errors-panel cards — and its card renders
   once in the Errors panel. *(exit: 400 reps → one group)*
2. Two fixtures sharing identical `message` text but different top stack
   frames (different file/line at the top of the trace) produce two
   distinct `ErrorGroup`s with different fingerprints, each with its own
   `count`. *(exit: same message, different stack top → separate groups)*
3. During a live stream: the sidebar's per-source error badge appears and
   increments within one broadcast interval of each new `ERROR`/`FATAL`
   entry for that source; the Errors panel's card list and the top bar's
   `Errors · <n>` tab badge update live without a page refresh; toggling
   Errors Only immediately restricts the stream to `ERROR`/`FATAL` entries
   and toggling it off restores the prior view; pressing `e` (or clicking
   Latest Error) scrolls the stream to the most recent visible error entry.
   *(exit: badges/panel/toggle/jump all work live)*
4. Simulating a burst of ≥ 10/min occurrences at ≥ 5× a group's established
   trailing 30-minute average sets `spiking: true` on that group within one
   histogram update, surfacing the SPIKING badge on its Errors-panel card
   and the pulsing SPIKING indicator on its sidebar source row; once the
   burst subsides back under either threshold, both clear automatically
   with no user action. *(exit: spike badge triggers and clears)*
5. A seeded fixture reproducing "nginx 500, caused by mysql going down
   moments before the *first* occurrence" produces a generated prompt whose
   "Surrounding log context" section includes the mysql `Connection
   refused` line(s) from before that first occurrence, and whose full
   assembled text contains no literal secret value that was present in the
   seed data (a seeded `Authorization: Bearer ...`/`password=...`/AWS-style
   key is replaced with `<redacted>` wherever it appears in the output).
   *(exit: cross-source context + redaction verified)*
6. A group whose raw entries have since been evicted from the ring buffer
   (simulated via a small `--buffer` cap in a test harness) retains its
   correct `count`/`firstSeen`/`lastSeen` in `GET /api/errors`, has
   `rawEntriesEvicted: true`, and its Errors-panel card shows the "some
   samples evicted" note; requesting its prompt either falls back
   gracefully (context/stack-trace fallback text per § API contract) or, if
   every sample is gone, still returns `200` with the fallback text rather
   than erroring. *(exit: groups survive eviction, samples marked evicted)*
7. `entry.fingerprint` is non-null on every `ERROR`/`FATAL` entry and null
   on every entry of any other level, verified against a mixed-level
   fixture.
8. Clicking a source's sidebar error badge switches to the Stream tab (if
   not already active), shows the `"<source id> errors ×"` filter chip,
   turns Errors Only on, and restricts the visible stream to exactly that
   source's `ERROR`/`FATAL` entries — without changing that or any other
   source's checkbox/visibility toggle state. Clicking the chip's `×`
   removes the source restriction while leaving Errors Only on.
9. The Errors panel's Recency sort orders cards by `lastSeen` descending by
   default; switching to Count sort re-orders by `count` descending; the
   currently-active sort option shows `aria-checked="true"` and only one
   option is checked at a time.
10. Expanding an ErrorGroup card reveals up to 10 sample occurrences (or
    fewer, capped by `count`), each independently expandable to its full
    stack trace via the same syntax-highlighted viewport spec 001 already
    defines for stream rows, and the "Generate AI Prompt" button.
11. Clicking "Generate AI Prompt" from either entry point (Errors-panel
    card, or a stream row's sparkle icon on an `ERROR`/`FATAL` row) opens
    the same modal, pre-filled with the fingerprint's assembled+redacted
    prompt text; the textarea is editable; clicking Copy copies the
    textarea's *current* (possibly user-edited) content to the clipboard
    and shows an inline "Copied" confirmation; Escape or `×` closes the
    modal and returns focus to the button that opened it.
12. The stream row's sparkle icon renders only on rows where
    `entry.level` is `ERROR`/`FATAL` **and** `entry.fingerprint` is
    non-null; it never renders on any other row, and spec 001's expanded
    panel is otherwise pixel-identical to before this spec for non-error
    rows. Verified by design review against rendered evidence.
13. The Errors panel's group list is unaffected by any source's `visible`
    toggle being off — a group whose only source is currently hidden from
    the stream still appears in the Errors panel with an accurate count.
14. Requesting `GET /api/errors/:fingerprint/prompt` for a fingerprint that
    has never existed, or has since been evicted from the 500-cap, returns
    `404 { "error": "not_found" }`; the modal shows the documented
    "no longer tracked" message in that case rather than a blank/broken
    state.
15. `GET /api/errors` returns the same `groups` content currently reflected
    by the most recent WS `errorGroups` message. QA/backend-owned.
16. Fingerprint golden tests (real-world Laravel/mysql/nginx-5xx/Node
    unhandled-rejection fixtures → expected group assignments) and prompt
    snapshot tests (seeded ring buffer → deterministic generated prompt,
    proving redaction + context selection + occurrence-pattern text are all
    reproducible) both pass. *(exit: § 4.4 testing requirements — QA/backend-owned,
    listed for traceability)*
17. Every new interactive control (view-switcher tabs, Errors Only toggle,
    Latest Error button, scope chip's `×`, sort radio buttons, ErrorGroup
    cards and their sample rows, the modal's `×`/textarea/Cancel/Copy) is
    reachable by Tab in a sensible order and shows the `--color-focus-ring`
    focus outline; the modal traps Tab/Shift+Tab within itself while open
    and returns focus correctly on close; the global `e` shortcut never
    fires while an editable field or the modal has focus.
18. No color token used or reused by this spec falls below
    `design-system.md`'s contrast requirements; the SPIKING chip and the
    per-source error badge remain legible and distinguishable from ordinary
    muted/primary text under color-vision-deficiency simulation, relying on
    their literal text/numeral content rather than hue. Verified by design
    review.
19. `--motion-pulse`'s animation is absent (chip renders static, fully
    legible) under `prefers-reduced-motion: reduce`, verified by design
    review against rendered evidence in both motion-preference states.
20. No network request to any third-party/AI-service host is made anywhere
    in this feature's code paths — prompt assembly and redaction are fully
    server-local, and Copy is the terminal action (clipboard only, per D9).
    QA/backend-owned, verified by code review / network-trace inspection.

## Decisions

Recorded for traceability, same convention as specs 002/003's Decisions
logs. Unlike those specs' entries, none of the following were put to the
product owner during this design pass (no live confirmation channel was
available) — each is this spec's own resolution of a genuine gap or
ambiguity in the phase doc's text, made conservatively and documented here
so it's easy to revisit if the product owner disagrees.

1. **Fingerprint namespace = the literal source id, not source kind.** The
   phase doc's "grouping is per source *type* namespace" phrasing, combined
   with its own worked example (a re-created `docker:mysql` regroups; mysql
   and nginx never merge), is consistent with either "namespace = the exact
   source id" or "namespace = kind only" — the example doesn't disambiguate,
   since both readings agree on it. This spec chose the literal-source-id
   reading: it's strictly more conservative (never merges across two
   distinct source ids, even same-kind ones), matching the phase doc's own
   explicit bias ("false merges... worse than false splits... err
   conservative"). Consequence: `sources: string[]` will, in practice, hold
   exactly one id per group under this spec — the field stays array-typed
   per the phase doc's model, in case a future, deliberately coarser
   namespace is chosen later.
2. **`sampleEntryIds` pins the oldest occurrence, not just "most recent
   10."** The phase doc's model comment says "up to 10 raw occurrences"
   without specifying which 10; the AI-prompt template separately requires
   both the *latest* occurrence (for the stack-trace section) and context
   *around the first* occurrence — which only works if the group's sample
   set actually retains the oldest one specifically, not just a rolling
   most-recent window that would eventually push it out. This spec's
   oldest-pinned-plus-9-most-recent scheme is the minimum change needed to
   make the template's own requirements satisfiable.
3. **Click-to-filter is a new, independent scope filter — never mutates
   sidebar visibility/subscribe toggles.** An alternative reading of "filters
   the stream to that source's errors" would force-hide every other source's
   `visible` flag. Rejected: it would silently clobber a user's existing,
   deliberate per-source visibility choices, contradicting spec 001's
   already-established "Clear filters... source toggles are left untouched"
   precedent, and would fight this tool's own stated differentiator
   (cross-source context) by hiding everything else. A dismissible,
   orthogonal filter chip achieves the same practical narrowing without
   destroying any other state.
4. **The Errors panel ignores source visibility/subscription state
   entirely** (except the structural case of a never-subscribed Docker
   source, which produces no data to begin with). Chosen because the phase
   doc frames this whole feature around "impossible to miss" — an error
   whose source a user happened to hide from the *stream* for decluttering
   reasons shouldn't therefore also vanish from the one view whose entire
   purpose is surfacing problems.
5. **No hysteresis/cooldown on spike detection.** The phase doc calls this
   "lightweight... a heuristic, documented as such" — adding a cooldown
   window to prevent flicker is a real, reasonable idea but is additional
   scope the phase doc didn't ask for; a direct, honest, always-current
   function of the histogram is the simplest thing that satisfies "triggers
   on a burst... clears when it subsides" (exit criterion 4) exactly as
   written.
6. **Error grouping is unconditional — no `errors.enabled` config flag.**
   Unlike Docker/discovery, the phase doc never mentions an opt-out, and
   frames this feature as *the* differentiator over plain log viewers; this
   spec doesn't invent a toggle the source material never asked for.

## Open Questions

None. Every ambiguity found in the phase doc's text during design was
resolved within this spec's own authority and recorded above (§ Decisions)
rather than left pending — each resolution is conservative, additive, and
reversible (a config flag, a namespace choice, and a sample-retention
policy are all cheap to change later without a wire-contract break), so
none of them rise to the level of blocking this spec on a live product-owner
response that wasn't available during this design pass.

---

ARTIFACTS WRITTEN: docs/specs/004-phase-4-error-intelligence.md, docs/design-system.md
STATUS: ready-for-dev
OPEN QUESTIONS: none
