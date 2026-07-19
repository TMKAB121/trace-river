# Design Review — 001: Phase 1 Core Console

Spec: [`docs/specs/001-phase-1-core-console.md`](../specs/001-phase-1-core-console.md)
Tokens: [`docs/design-system.md`](../design-system.md)
QA status entering this review: 60/60 tests, 22/22 acceptance criteria, fix loop closed.

## Scope reviewed

Full-UI review (Tier 3 feature, first pass).

- **Screenshot + DOM evidence** (`docs/qa/evidence/001-phase-1-core-console/`):
  empty state, populated stream (all six levels incl. multiline FATAL entry),
  invalid-token terminal state. DOM dumps grepped for landmark/ARIA
  attributes to confirm rendered (not just authored) markup.
- **Static source review** for everything the evidence set couldn't capture
  (QA's browser tool has no click/drag/keyboard scripting): all of
  `web/src/components/**` with paired `.css` files, `web/src/store/store.tsx`,
  `web/src/api/{auth,rest,ws}.ts`, `web/src/utils/{format,clipboard,highlight}.ts`,
  `web/src/types.ts`, `web/src/styles/{tokens,reset,global,highlight}.css`,
  `web/src/main.tsx`, and `package.json` (dependency-allowlist check).
- Concept art (`assets/traceriver_ui_concept.png`) cross-checked against the
  populated-stream evidence for level-color grammar and layout fidelity.

Two owner-approved doc corrections were made in the ux-designer lane prior to
this review (not review findings, recorded for traceability): the
design-system.md syntax-highlight table's number/literal contradiction was
corrected to match the frontend's implemented `hljs-number`→warn /
`hljs-literal`→debug split, and acceptance criterion 7 was annotated with the
accepted 263–292 MB RSS range (2026-07-19).

Also treated as settled, not re-litigated: native `window.confirm`/`alert`
for the 50 MB/500 MB guardrails, tooltip-only affordance for errored
sources, client-local `visible` state, and the `· n new` freeze badge copy —
all per the coordinator's owner-approved list, and all confirmed present in
source during this review.

## Findings

| # | Severity | Area | Spec section | Expected | Actual | File |
|---|---|---|---|---|---|---|
| 1 | Minor | frontend | Layout § Wireframe — empty state | Wireframe for the empty state omits the top-bar filter row (only Freeze/Clear/Search are drawn, disabled) | The filter row (level chips) renders in the empty state too, correctly disabled (`.level-chip:disabled { opacity: 0.5 }`, `disabled={!hasSources}`) | `web/src/components/TopBar.tsx`, evidence: `01-empty-state.png` |

No blocker or major findings. Finding #1 is a literal-wireframe deviation
only — the ASCII wireframe was schematic and didn't explicitly call for
hiding the filter row; keeping it visible-but-disabled is arguably more
consistent than making it disappear and reappear, and the disabled treatment
is correctly implemented. Noted, not required to fix.

## Verification detail

**Tokens.** `web/src/styles/tokens.css` is a value-for-value mirror of
`design-system.md` (checked every custom property by hand — surfaces, text,
all six level accents, focus/interactive, typography, spacing, radius,
row/layout metrics, motion, z-index). No component CSS file reviewed
contains a raw hex/px value outside `tokens.css` — every rule uses
`var(--token-name)`. `prefers-reduced-motion: reduce` zeroes `--motion-fast`/
`--motion-base` in `tokens.css` itself, satisfying the reduced-motion
requirement globally rather than per-component.

**Level color grammar** (evidence: `02-populated-stream.png`, matched
against the concept art). Left edge bar + colored level word present on
every row for DEBUG/INFO/WARN/ERROR/UNKNOWN; FATAL correctly diverges into
the filled-chip treatment (`--color-level-fatal` background,
`--color-text-inverse` text) specified in design-system.md — this is the
one row in the evidence set that visually confirms the ERROR-vs-FATAL
weight distinction the spec calls for (spec §Accessibility, AC21). Contrast
math re-verified for the FATAL chip specifically (dark text on the
red-orange fill): 6.86:1, clears AA.

**Syntax highlighting.** `web/src/utils/highlight.ts` registers only the
`json` and `plaintext` grammars from `highlight.js/lib/core` (not the full
bundle) exactly as design-system.md requires, with a source comment citing
it. `web/src/styles/highlight.css` maps `hljs-attr`→text-primary,
`hljs-string`→level-info, `hljs-number`→level-warn, `hljs-literal`→level-debug
— matches the corrected table.

**API contract.** `web/src/types.ts` reproduces `SourceDescriptor` and the
WS message unions verbatim from the spec, including the approved `cleared`
extension. `web/src/api/auth.ts` implements the exact auth mechanics
specified (in-memory token from URL query, not localStorage; header on REST,
query param on WS). `web/src/api/ws.ts` handles the browser limitation that
a rejected WS upgrade's status code isn't readable from JS by preflighting
with `GET /api/status` before each connection attempt — a reasonable,
well-documented solution to a gap the spec's auth section didn't anticipate;
consistent with the spec's intent (distinct terminal state for bad token vs.
retryable disconnect) rather than a deviation from it.

**Interaction logic** (`web/src/store/store.tsx`, static review — no
scripted-interaction evidence available). Auto-follow/pin, Freeze-as-snapshot
(entries slice at `frozenAt` boundary, not just scroll-suppression),
search/level/visibility as an AND-intersection filter, unsubscribe pausing
count updates (AC14) via a deliberate `entryCount` freeze in the reducer,
and the `cleared` broadcast handling (empties store + toast on every tab,
whether or not it initiated the clear) all match the spec's interaction
specs section point-for-point, including edge cases the spec called out
explicitly (e.g. queuing a second `dropped` resync if one is already in
flight).

**Accessibility landmarks/ARIA** — evidence-backed via
`02-populated-stream.dom.html`: confirmed present in rendered output —
`aside[aria-label="Log sources"]`, `role="switch"`/`aria-checked` on source
toggles, `role="toolbar"[aria-label="Stream controls"]`, `role="search"`,
`main[aria-label="Unified log stream"]`, `role="feed"[aria-label="Log
entries"]`, `role="article"` per row, `aria-pressed` on level chips and
Freeze, `role="status"[aria-live="polite"]` for the discrete-announcement
region. This is the exact landmark/ARIA set the spec's Accessibility section
calls for — confirmed as actually rendered, not just authored in JSX.

**Iconography.** `web/src/components/icons.tsx` — all hand-authored inline
SVG, `currentColor`, `aria-hidden`/`focusable=false`, no icon library.
`package.json` dependencies/devDependencies checked line-by-line against
`.claude/lanes.json`'s allowlist: exact match, nothing extra.

**Font.** `web/src/main.tsx` imports only
`@fontsource/jetbrains-mono/400.css` and `/700.css` — matches the
two-weight, self-hosted, no-CDN requirement.

**Out-of-scope exclusions honored.** No AI-prompt/sparkle affordance
anywhere in `ExpandedPanel.tsx` or elsewhere in the component tree; no sort
control in `TopBar.tsx`; no responsive breakpoints in any reviewed CSS file
— all three consistent with the spec's confirmed-excluded scope.

## Checklist

- [x] Layout vs. wireframe (default, drag-over, empty) — matches; row-expanded structurally matches (Copy Raw top-right, body then Context sub-block) though not evidence-captured, confirmed via `ExpandedPanel.tsx`/`.css`.
- [x] All specified states present: sidebar subscribed/hidden/unsubscribed (incl. 55%-opacity dim and disabled toggle), drop area default/hover/uploading, row collapsed/expandable/expanded, connection connecting/disconnected/invalid-token, empty/filtered-empty, eviction notice, dropped-toast, cleared-toast.
- [x] Token-only styling — no hardcoded visual values found in any reviewed CSS file.
- [x] Semantics/landmarks — evidence-confirmed (`role="feed"`, `article`, `toolbar`, `search`, `switch`, `aside`, `main`).
- [x] ARIA requirements — `aria-pressed`, `aria-checked`, `aria-expanded`, `aria-posinset`/`aria-setsize`, `aria-live="polite"` status region (not a blanket live-region on the feed) all present.
- [x] Focus states — `:focus-visible` global rule, 2px solid `--color-focus-ring`, 2px offset.
- [x] Text-not-color-alone — level word text pairs every color cue; FATAL further distinguished from ERROR by fill, not hue.

## Verdict

**APPROVED**

ARTIFACTS WRITTEN: docs/design-reviews/001-phase-1-core-console.md, docs/design-system.md, docs/specs/001-phase-1-core-console.md
STATUS: APPROVED
OPEN QUESTIONS: none
