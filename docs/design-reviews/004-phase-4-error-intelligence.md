# Design Review — 004: Phase 4 Error Intelligence

Spec: [`docs/specs/004-phase-4-error-intelligence.md`](../specs/004-phase-4-error-intelligence.md)
Tokens: [`docs/design-system.md`](../design-system.md)

**Verdict: APPROVED.**

## Scope reviewed

Full-UI review (Tier 3 feature) of every surface this spec adds or touches:
sidebar per-source error badge + SPIKING indicator, top-bar view switcher,
Errors-Only toggle, Latest Error button, source-scope filter chip, Errors
panel (empty + populated + card-expanded states), ErrorGroup card
(sparkline, SPIKING badge, sample rows), the AI Prompt Preview modal, and
the stream row's sparkle-icon entry point.

- **Screenshot + DOM evidence** (`docs/qa/evidence/004-phase-4-error-intelligence/`):
  `01-stream-default-badges-spiking` (live-seeded stream, sidebar error
  badges, a pulsing SPIKING indicator, `Errors · 7` tab, Errors Only
  toggle) and `02-empty-no-sources-view-switcher-disabled` (pre-connection
  empty state, both view-switcher tabs and all toolbar/filter controls
  disabled). Both DOM dumps were read directly for exact markup, class
  names, and `aria-*` attributes, not just the rendered screenshots.
- **No evidence exists** for the Errors panel itself (card list, expanded
  card, sample rows), the AI Prompt Preview modal (loading/loaded/error
  states, focus trap), the source-scope filter chip, the Errors-view sort
  control, or the stream row's sparkle icon — QA's browser tool is
  nav-only, so none of these interactive states have screenshots. These
  are **source-verified only** below (read directly from
  `ErrorGroupCard.tsx`/`.css`, `ErrorsPanel.tsx`/`.css`,
  `ErrorsEmptyState.tsx`, `Sparkline.tsx`/`.css`, `SampleRow.tsx`/`.css`,
  `SpikingBadge.tsx`/`.css`, `ScopeChip.tsx`, `ErrorsSortControl.tsx`,
  `ErrorsOnlyToggle.tsx`, `LatestErrorButton.tsx`, `ViewSwitcher.tsx`,
  `AIPromptModal.tsx`/`.css`, `ExpandedPanel.tsx`/`.css`, `SourceRow.tsx`/
  `.css`, `TopBar.tsx`/`.css`, `App.tsx`, `store/store.tsx`, `types.ts`,
  `hooks/useFocusTrap.ts`, `hooks/useLatestErrorShortcut.ts`, `icons.tsx`,
  `styles/tokens.css`), explicitly called out inline, and are clearly
  distinguished from the two evidence-backed screenshots throughout.

## Ruling on the two explicitly delegated implementation calls

**(a) Sidebar error badge + SPIKING indicator rendered inline in the source
row's main line, not the wireframe's wrapped second line — RATIFIED,
compliant.** Evidence-backed: `01-stream-default-badges-spiking.dom.html`
shows, for every `source-row__main`, the sequence checkbox → icon → label →
`source-row__count` → `source-row__error-badge` → (`spiking-badge` when
present) → `source-row__toggle`, all as siblings inside one flex row, not a
second wrapped line. This matches the spec's own component prose exactly
("Extends... `SourceRow`... with one more element, rendered inline **after
the entry count**" / "SPIKING indicator: **immediately after the error
badge**") — the wireframe's stacked-second-line rendering was illustrative
ASCII-art shorthand, not a literal layout instruction, and the prose is the
binding contract per this spec's own conventions. `SourceRow.css` confirms
this is a single-row flexbox (`source-row__main { display: flex; align-items:
center; gap: var(--space-2); }`) with no line-wrap logic — the choice reads
cleanly and doesn't visually crowd the row in the 288px-wide sidebar per the
screenshot. No spec or token change needed; ruling this correct.

**(b) Errors-panel sort control's active state uses the
accent-interactive tint, not the error-red tint — RATIFIED, compliant.**
Source-verified: `ErrorsSortControl.tsx` applies
`filter-pill--neutral-active` (not `filter-pill--error-active`) to the
active Recency/Count button; `TopBar.css` defines
`.filter-pill--neutral-active { background: color-mix(in srgb,
var(--color-accent-interactive) 18%, transparent); border-color:
var(--color-accent-interactive); color: var(--color-accent-interactive); }`
with an explicit comment: "a sort axis has no error-level semantics of its
own." This is the correct call — the spec's own § Design tokens used text
only commits to "the per-source badge/Errors-Only/scope-chip" reusing the
error tint; the sort control was never listed there, and giving a
non-error, non-filtering control (recency vs. count is not "these are
errors") the red/error tint would have muddied the level-color grammar the
whole design system reserves for actual severity. Both colors used
(`--color-accent-interactive`, already 7.7:1 vs. bg) are pre-existing,
already-vetted tokens — no new token needed, no contrast regression. Ruling
this correct.

## Findings

| # | Severity | Area | Spec section | Expected | Actual | File |
|---|---|---|---|---|---|---|
| 1 | Minor | design | `design-system.md` § Iconography (spec 004 addition) vs. spec 004 § Components & states — Sidebar source row addition § Error badge, and § Layout — View switcher wireframe | `design-system.md`'s Iconography list states `IconWarning` is used on "the sidebar's per-source error-count badge" and "the top bar's 'Errors' view tab," in addition to the Errors Only toggle and Latest Error button | The spec's own § Components & states text says the opposite for the badge — "the numeral itself is the required text signal... **no icon is needed here**" — and the View switcher's wireframe/prose never depicts an icon on either tab. `SourceRow.tsx`'s error badge and `ViewSwitcher.tsx`'s tabs both correctly render numeral/text only, no icon — matching the more specific, authoritative section, not the Iconography list. This is a self-inconsistency inside `design-system.md` (my own authoring gap, not an implementation defect) — the implementation made the correct call by following § Components & states over the overbroad Iconography summary. | `docs/design-system.md` § Iconography; `web/src/components/SourceRow.tsx`, `web/src/components/ViewSwitcher.tsx` (both correct) |
| 2 | Minor | design | `design-system.md` § Layout & row metrics / "No spec or component may use a raw... value that isn't listed here" | `--modal-max-width` (640px) is the only new layout token spec 004 defines for the modal; any other governed dimension should be tokenized | `AIPromptModal.css`'s `.modal { max-height: 80vh; }` is a raw, non-tokenized value. Ruled acceptable, not a defect: it's a viewport-relative overflow safety net (keeps the dialog from exceeding the visible viewport on a short window), functionally distinct from the app's fixed-px design measurements (sidebar width, row heights, etc.) that the token table governs — nothing else in the app needs a viewport-relative dimension, so a dedicated token would be premature abstraction for a one-off case. No visual/contrast risk. Documented here for traceability only. | `web/src/components/AIPromptModal.css:17` |

No blocker or major findings. Both items above are minor, documentation-only
notes about `design-system.md`'s own internal consistency — the
implementation is correct in both cases (it followed the more specific,
correct section of the spec/system over an overbroad summary line).

## Verification detail

**Layout vs. wireframe — header height constant across tabs.**
Source-verified: `TopBar.tsx` always renders the `topbar` (56px,
`--topbar-height`) and `filter-row` (36px, `--filter-row-height`)
unconditionally, swapping only their *contents* based on `state.view`
(`isStream ? <>...</> : <ErrorsSortControl />`); no conditional wrapper
changes either row's height. Matches the spec's "overall header height...
stays constant across both, so switching tabs never reflows the main
panel's vertical position."

**View switcher.** Evidence-backed (both screenshots):
`role="tablist" aria-label="Console view"` wrapping two
`role="tab" aria-selected` buttons, `id="view-tab-stream"`/
`"view-tab-errors"`, `aria-controls` pointing at the matching
`role="tabpanel"` (confirmed in `App.tsx`: `id="view-panel-stream"`/
`"view-panel-errors"`). `Errors · 7` (populated) and `Errors · 0` (empty)
both render the literal group-count text, sourced from
`useErrorGroups().length` — the *group* count, not raw occurrence count,
correctly satisfying "400 repetitions... one group." Both tabs `disabled`
together in the empty-state DOM, matching Freeze/Clear/Search's existing
`!hasSources` gate — evidence-backed.

**Errors Only toggle / level chips / scope chip.** Evidence-backed
(screenshot 1): `filter-pill` with `IconWarning` + "Errors Only" text,
`aria-pressed="false"` when off (no live-fixture capture of the "on"
state, so the `filter-pill--error-active` tint itself is source-verified
only — confirmed present in `ErrorsOnlyToggle.tsx`/`TopBar.css` and reuses
the pre-existing `color-mix(...) 18%` pattern verbatim, not a new value).
Scope chip (`ScopeChip.tsx`) not present in either fixture (badge wasn't
clicked) — source-verified: renders `"<sourceId> errors"` text + a real
`<button aria-label="Clear <sourceId> errors filter">` `×`, both using
`filter-pill--error-active`, matching spec text exactly.

**Latest Error button.** Evidence-backed: `IconWarning` + "Latest Error"
label, `aria-label="Jump to the most recent error entry (press E)"`,
enabled in fixture 1 (sources + errors present), `disabled` in fixture 2
(no sources). The button's *own* additional disabling condition
(`!hasTarget` — no ERROR/FATAL entry currently visible) is source-verified
only via `useHasJumpableError()`/`LatestErrorButton.tsx`, no fixture
exercises "sources exist but nothing to jump to."

**Per-source error badge + SPIKING indicator.** Evidence-backed
(screenshot 1, all 7 file rows): every populated row shows a real
`<button class="source-row__error-badge" aria-label="<n> errors from
<source id> — filter stream to these">` containing only the numeral — text
IS the signal, no icon, matching § Components & states exactly (see
Finding 1 above re: the Iconography list's overbroad claim). The one row
with an active spike additionally shows `<span class="spiking-badge">`
(not a button) with `IconBolt` + "SPIKING" text immediately after the
badge and before the visibility toggle — matches "Not a button... per-
group spike state is only actionable from the Errors panel." `SpikingBadge.css`'s
`@keyframes spiking-pulse` (opacity 1↔0.55) is driven by `--motion-pulse`
per token, with a `prefers-reduced-motion: reduce` override disabling the
animation entirely — source-verified only (no fixture captures the
reduced-motion state), satisfying AC 19's requirement structurally.

**ErrorGroup card (source-verified, no evidence).** `ErrorGroupCard.tsx`:
header row is `level word (colored text for ERROR / filled inverse chip for
FATAL) → title (⟨…⟩ segments in --color-text-muted, rest in
--color-text-primary, via a regex split) → SpikingBadge (conditional) →
chevron`, flexbox with the title given `flex: 1 1 auto` so the badge/chevron
pin right — matches "top-right of the header row." Meta row: `"× <count>
occurrence(s)"` + `Sparkline`. Sources line, First/Last-seen line with the
spec's exact `"First <ts> · Last <ts> (<relative> ago)"` format (verified
against `formatShortTimestamp`/`formatRelativeShort` util signatures).
Whole header is one real `<button aria-expanded>` — satisfies "real
focusable control, not a div with a click handler." Expanded state renders
the `"Sample occurrences (<n> of <count><evicted note>)"` label (evicted
note conditional on `rawEntriesEvicted`), up to 10 `SampleRow`s
newest-first, then a bottom-right `--color-accent-interactive`/
`--color-text-inverse` "Generate AI Prompt" button — matches spec's
"primary action" styling call exactly, token-only.

**Sparkline.** Self-scaled per-card min/max, flat baseline when
`max === min` (covers the "only one occurrence so far" case spec calls
out), `aria-hidden="true"` with a `<title>` carrying the same "steady
~X/min…" text a redundant text/tooltip channel — satisfies "the chart
itself is decorative," text-not-color-alone. Stroke color is
`--color-level-error`/`--color-level-fatal` by group level, `64×20`
(`--sparkline-width`/`--sparkline-height`) — token-only, matches spec
exactly.

**Sample row / unresolvable fallback.** `SampleRow.tsx`: resolvable
samples render a real `<button aria-expanded>` reusing `ExpandedPanel`
verbatim (same component spec 001 already defines for stream rows) — "no
new visual pattern" satisfied literally, by reuse rather than
reimplementation. An id absent from `useEntriesById()`'s map renders a
plain `<li>` with the exact spec'd fallback text, not a button, not
focusable — matches "muted text, not a button, not focusable" precisely.

**AI Prompt Preview modal.** `role="dialog" aria-modal="true"
aria-labelledby`; backdrop uses the exact spec'd
`color-mix(in srgb, var(--color-bg) 85%, transparent)` at `--z-modal-overlay`;
dialog at `--z-modal`, `--color-surface-row-expanded-panel` background,
`--color-border-interactive` border, `--radius-lg`, `--modal-max-width`
(640px) — all token-only (see Finding 2 for the one non-tokenized `80vh`
overflow guard). Loading/error/loaded states match spec text verbatim
("Assembling prompt…", the exact 404 copy). Body is a real, non-readonly
`<textarea>` pre-filled with `prompt`, editable, Copy sends the textarea's
*current* value (not the original fetch), shows "Copied" for 1.5s, and
announces "Prompt copied to clipboard." via the shared live region — all
matching spec. Focus management: `useFocusTrap` traps Tab/Shift+Tab inside
the dialog; `App.tsx` marks the rest of the app `inert`+`aria-hidden` while
the modal is open (React 19's `inert` JSX prop, confirmed supported —
`package.json` pins `react@^19.2.7`); `store.tsx`'s `openPrompt`/
`closePrompt` capture `document.activeElement` at open time and restore
focus to it at close, correctly satisfying "returns focus to whichever
button opened it" for *both* entry points (card button and stream-row
sparkle) without hardcoding either. Escape closes via the dialog's own
`onKeyDown`. All of the above is source-verified only — no modal-open
screenshot exists in evidence.

**Stream row sparkle icon.** `ExpandedPanel.tsx`: `promptFingerprint` is
computed as `entry.level === "ERROR" || "FATAL" ? entry.fingerprint : null`
and the `IconSparkle` button renders only when that's non-null — exactly
the spec's dual condition (level ∈ {ERROR,FATAL} **and** fingerprint
present). `ExpandedPanel.css` positions it `position: absolute; bottom:
var(--space-3); right: var(--space-3)`, matching "bottom-right, absolutely
positioned." `aria-label="Generate AI debugging prompt for this error"`
matches spec verbatim. Nothing else in `ExpandedPanel` changed for
non-error rows (the sparkle's whole block is additive, gated behind one
conditional) — satisfies AC 12's "otherwise pixel-identical" claim,
source-verified (no non-error-row expanded-panel evidence to diff against,
but the diff against spec 001's original component is structurally
additive-only by inspection).

**Errors panel scope independence from visibility (AC 13).**
Source-verified: `useSortedErrorGroups()`/`ErrorsPanel.tsx` read straight
from `state.errorGroups` (the full WS-pushed list) with no `source.visible`
or `subscribed` filter anywhere in the chain — correctly matches Decision
4's "Errors panel ignores source visibility/subscription state entirely."
Contrast with `useSourceErrorCount`/`useSourceSpiking` (sidebar badge/
indicator), which are likewise unfiltered by visibility — correct, the
badge is meant to reflect "of those, N are errors" regardless of the
stream's own visibility toggle.

**Jump to latest error.** `useLatestErrorShortcut.ts` fires only on a bare
`e` (all modifier keys excluded), bails when focus is in
`INPUT`/`TEXTAREA`/`contenteditable`, and bails while the modal is open —
matches spec's keyboard gating exactly. `jumpToLatestError()` performs
"Clear filters" (reset search + all levels) unconditionally, switches to
the Stream tab unconditionally, and only dispatches a scroll target if
`findLatestVisibleError` finds one — correctly leaves `errorsOnly`/
`scopeSourceId`/source-visibility untouched (per spec, these are not part
of "Clear filters"). `StreamPanel.tsx` scrolls with `align: "center"` on
`scrollNonce` change (re-fires even for a repeat jump to the same id, by
design). Source-verified only — no evidence captures a jump in progress.

**Design tokens / no raw values.** Grepped every `web/src/components/*.css`
touched by this feature for raw hex/`rgb(`/`rgba(` literals — zero matches;
every value traces to `tokens.css`, which mirrors `design-system.md`
exactly (`--sparkline-width/height`, `--modal-max-width`, `--motion-pulse`,
`--z-modal-overlay`/`--z-modal` all present, correct values). The one
exception is Finding 2's `80vh`, ruled acceptable. "No new color tokens" is
confirmed — every color used (`--color-level-error`/`-fatal`,
`--color-accent-interactive`, `--color-text-inverse`/`-muted`,
`--color-border-interactive`) is a pre-existing, already-contrast-vetted
token (≥4.5:1 for text/icon, ≥3:1 for the interactive border), satisfying
AC 18 with no new contrast risk introduced.

**Text-not-color-alone / CVD.** Confirmed by source read across every
new component: the per-source badge is a bare numeral (never a dot), the
SPIKING chip is always icon **+** the word "SPIKING" (never a bare
pulse), and the `⟨…⟩`/`<redacted>` distinction is carried by the bracket
glyphs themselves, not by color — `TitleParts` in `ErrorGroupCard.tsx`
only changes color (muted vs. primary) as a *secondary* legibility aid
layered on top of the bracket characters already being the primary signal,
matching the spec's own framing of that color choice as "a small,
optional legibility aid," not the carrier of meaning.

**Keyboard / focus.** No new interactive element type lacks the global
`:focus-visible` rule (`global.css`, unconditional, applies to every
native `<button>`/`role="tab"`/`role="radio"` element this feature adds —
none of the new components override or suppress it). Confirmed for: view
switcher tabs, Errors Only toggle, Latest Error button, scope chip's `×`,
sort radio buttons, ErrorGroup cards, sample rows, and the modal's `×`/
textarea/Cancel/Copy — all real `<button>`/`<textarea>` elements, all
Tab-reachable in DOM order (no `tabindex` overrides found). Source-verified
only for the actual visible ring (no evidence captures a focused state).

**API contract / wire types.** `web/src/types.ts`'s `TraceRiverLog.fingerprint`,
`ErrorGroup`, and the `errorGroups` WS-message variant are a byte-for-byte
match against the spec's § API contract shapes (field names, optionality,
comments referencing the same spec sections). `api/rest.ts`'s
`getErrorPrompt` hits `GET /api/errors/:fingerprint/prompt` and surfaces a
`404` as `ApiError(404, ...)`, which `AIPromptModal.tsx` maps to the exact
spec'd "no longer tracked" copy — matches AC 14.

## Checklist

- [x] Layout vs. wireframe — header-height invariant across tabs, view
      switcher structure, filter-row content-swap all match; evidence-backed
      for the view switcher/badges/SPIKING indicator, source-verified for
      the Errors panel/modal (no evidence exists for those).
- [x] All specified states present in source/evidence: populated stream
      w/ badges + live SPIKING (evidence-backed), disabled empty state
      (evidence-backed), Errors panel empty/populated/expanded (source-
      verified), modal loading/loaded/error (source-verified).
- [x] Token-only styling — zero raw color values found; one raw `80vh`
      layout value (Finding 2, ruled acceptable, non-blocking).
- [x] Semantics/landmarks — `role="tablist"`/`"tab"`/`"tabpanel"`,
      `role="dialog" aria-modal`, `<ul>`/`<li>` card list, `role="radiogroup"`/
      `"radio"` sort control all present and correctly wired, source-verified
      plus evidence-backed for the tablist/tabpanel pairing.
- [x] ARIA requirements — badge/toggle/button `aria-label`s match spec text
      verbatim (evidence-backed for the badges); `aria-pressed`/
      `aria-selected`/`aria-checked`/`aria-expanded` all present and
      correctly driven by state, source-verified for the non-evidenced
      controls.
- [x] Focus states — global `:focus-visible` rule covers every new
      interactive element; modal focus trap + return-to-opener logic
      correctly implemented and generalized across both entry points.
- [x] Text-not-color-alone — badge numeral, SPIKING icon+word, `⟨…⟩`/
      `<redacted>` bracket distinction all confirmed carried by text/glyphs,
      not hue.
- [x] The two explicitly delegated implementation calls (a: inline badge/
      SPIKING placement, b: neutral-tint sort control) — both ratified as
      compliant with the spec's binding prose over its illustrative
      wireframe/unlisted-control text, per the rulings above.

## Verdict

**APPROVED.**

No blocker or major findings. Two minor findings, both `design-system.md`
documentation-consistency notes (Iconography list overstates two icon
use-sites the spec's own more specific sections and the implementation
correctly omit; one non-tokenized `80vh` viewport-relative overflow guard,
ruled an acceptable exception) — neither is an implementation defect and
neither blocks ship. Both explicitly delegated implementation calls are
ratified as compliant against rendered evidence and source. The feature's
token usage, ARIA/landmark structure, keyboard/focus handling, and
text-not-color-alone treatment are all correct wherever evidence or source
allows verification.

---

ARTIFACTS WRITTEN: docs/design-reviews/004-phase-4-error-intelligence.md
STATUS: APPROVED
OPEN QUESTIONS: none
