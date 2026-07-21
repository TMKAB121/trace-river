# Design Review — 003: Phase 3 Auto-Discovery

Spec: [`docs/specs/003-phase-3-auto-discovery.md`](../specs/003-phase-3-auto-discovery.md)
Tokens: [`docs/design-system.md`](../design-system.md)

## Re-review (2026-07-20)

**Verdict: APPROVED.**

Scope: delta re-verification of Finding 1 only (the sole outstanding item
from the first pass, below) — all other findings from the original review
were already `APPROVED` and are not re-litigated here.

Backend now populates `SourceDescriptor.label` with the full prefixed id for
`kind: "local"` sources. Re-examined the re-captured evidence:

- `docs/qa/evidence/003-phase-3-auto-discovery/mixed-sidebar.png` +
  `.dom.html`, `mixed-sidebar-stopped.png` + `.dom.html`.
- Both DOM dumps now show `<span class="source-row__label">local:laravel
  </span>`, `local:worker`, `herd:nginx-mysite.test`, and
  `herd:php-fpm-mysite.test` verbatim — matching the spec's wireframes
  (§ Layout) and prose ("the sidebar shows `local:laravel` checked and
  live…") exactly, for all four rows across both fixtures.
- The screenshots render these same strings truncated with an ellipsis
  (`herd:nginx-mysit…`) purely as a fixed-width CSS overflow effect at the
  213px sidebar column width — confirmed against the DOM, where the full
  untruncated string is present in the `<span>` and in the `title`/
  `aria-label` attributes. Not a defect: `local:worker` and `herd:php-fpm-
  mys…` truncate identically to how a long Docker container name already
  would under spec 002's same-width row, and the `title` tooltip still
  carries the full resolved path per § Components & states, unaffected by
  the label fix.
- `aria-label`s (`"Subscribe to local:laravel"`, `"Show herd:nginx-
  mysite.test in stream"`, etc.) and the `id`-derived values already checked
  out in the first pass and are unchanged.
- Nothing else regressed: `mixed-sidebar`'s worker row is still
  `source-row--dimmed`, unchecked, checkbox not disabled, toggle disabled,
  `source-row__state-label--pending`/"Waiting"; `mixed-sidebar-stopped`'s
  laravel row is still checked, **not** dimmed,
  `source-row__state-label--stopped`/"Stopped"; both Herd rows in both
  fixtures remain unchecked/dimmed with no state label (their files exist,
  state is `live`, matching AC 8's "stay unchecked even though content
  exists" rule); the Next.js no-target note's copy, icon, and non-button
  markup are byte-identical to the first pass; landmarks
  (`aria-labelledby="files-heading"`/`"environment-heading"` +real `<h3>`)
  and token usage are unchanged. All evidence-backed via direct comparison
  of both DOM dumps against the first-pass review's captured detail.

Finding 1 is resolved. No new findings from this delta pass. Checklist row
"Row label content matches the spec's `local:<detector>` / `<detector>:
<slug>` convention" now passes, evidence-backed.

## First-pass review (original — CHANGES REQUIRED, superseded by the
re-review above)

## Scope reviewed

Full-UI review (Tier 3 feature), scoped to the sidebar surfaces this spec adds
(Environment section, Files-section no-target notes, local/environment
`SourceRow` state labels).

- **Screenshot + DOM evidence** (`docs/qa/evidence/003-phase-3-auto-discovery/`):
  `mixed-sidebar` (unchecked/dimmed `WAITING` worker row, checked/live laravel
  row, one Next.js no-target note, Environment section with two unchecked
  Herd rows), `mixed-sidebar-stopped` (same fixture with the laravel row now
  checked + `STOPPED`), `nextjs-only-sidebar` (Files section rendering only
  the no-target note, no rows, no Environment section), `discovery-disabled-
  sidebar` (flat, unsectioned `(no sources yet)` fallback). All four DOM
  dumps were read directly for landmark/ARIA structure, `title` tooltip
  strings, and exact label/class content — not just the screenshots.
- **Static source review**: `web/src/components/{Sidebar,FilesSection,
  EnvironmentSection,SourceRow,ContainersSection}.{tsx,css}`,
  `web/src/components/icons.tsx`, `web/src/store/store.tsx`.
- **No evidence exists** for: `discovery.disable` excluding a named detector,
  more than one stacked no-target note, the pending→live auto-subscribe
  transition itself (only its two static end-states), or a captured
  live-region announcement string. These are called out inline as
  source-verified only, not evidence-backed, and — per the run brief — the
  auto-subscribe transition, the 500 MB/truncation/rotation acceptance
  criteria, and `discovery.disable` are QA/backend-owned load/functional
  tests outside this review's surface, not re-litigated here.

## Findings

| # | Severity | Area | Spec section | Expected | Actual | File |
|---|---|---|---|---|---|---|
| 1 | Major | backend | § Layout wireframes ("mixed sources," "Environment section, nothing detected," "WAITING→live"); Overview; AC 1, 2, 8 | The sidebar row label text itself reads `local:laravel`, `local:worker`, `herd:nginx-mysite.test`, `herd:php-fpm-mysite.test` — the wireframes render this literally, and the Overview/AC prose repeatedly refers to what's *shown* using this exact form ("the sidebar shows `local:laravel` checked and live," "`local:laravel` appears unchecked, dimmed…") | Every local/environment row in both `mixed-sidebar` and `mixed-sidebar-stopped` renders a bare label with no kind prefix: `<span class="source-row__label">worker</span>`, `laravel`, `php-fpm-mysite.test`, `nginx-mysite.test`. `SourceRow.tsx` renders `{source.label}` verbatim with no transformation (confirmed by reading the component — no substring/prefix logic exists anywhere in it), so the prefix is simply absent from the `SourceDescriptor.label` value the server sent for these fixtures. Corroborating detail: the same rows' `aria-label`s (`"Subscribe to local:worker"`, `"Subscribe to herd:php-fpm-mysite.test"`, etc.) *do* carry the correct prefixed form, because those are built from `source.id`, not `source.label` — confirming the frontend's own code already assumes `id` carries the prefix and treats `label` as separate content, and that the gap is in what the discovery/backend layer populates `label` with for auto-discovered and environment-tier sources. This also affects the live-region announcement text (`${prior.label} started streaming.`), which will read "laravel started streaming." instead of the spec's `local:laravel`-style identification. | `web/src/components/SourceRow.tsx:89` (renders verbatim, not the bug site); backend discovery/`SourceDescriptor.label` population (file not in this review's read set) |

No blocker findings. One major finding, rooted in the value the backend
populates `SourceDescriptor.label` with for auto-discovered/environment
sources, not in any frontend rendering logic — the frontend renders whatever
`label` string it receives correctly and consistently (evidence-backed for 4
rows across 2 fixtures).

## Verification detail

**Layout vs. wireframe (structure).** `mixed-sidebar`'s DOM matches the
spec's "mixed sources" wireframe structurally: `<section aria-labelledby=
"files-heading">` containing the source-row `<ul>` (worker, then laravel — an
allowed instance of spec 002's carried-over "oldest `createdAt` first" sort
rule, which the spec never overrides for phase 3; wireframe row order is
illustrative, not a required render order), then `<div class="files-section__
notes">` with exactly one Next.js note, then a sibling `<section aria-
labelledby="environment-heading">` with the two Herd rows. This is
evidence-backed and correct. `nextjs-only-sidebar` correctly renders only the
Files `<section>` with the note and no `<ul>` at all (`FilesSection.tsx`
guards the list behind `files.length > 0`) — matches the "no-target detector
note only" wireframe exactly, including the Files header still rendering.
`discovery-disabled-sidebar` reverts fully to spec 001's flat `sidebar__empty`
markup with no sub-sections — matches AC 14's flat-fallback requirement.

**Environment section omit-when-empty (settled decision).**
`EnvironmentSection.tsx` returns `null` outright when
`useEnvironmentSources()` is empty — no header, no "nothing found" copy —
exactly the product-owner-confirmed behavior (spec § Open Questions #1, AC
15). Confirmed both by source read and by the absence of any Environment
markup in `nextjs-only-sidebar`'s DOM. When sources exist (`mixed-sidebar`),
the section renders with the same `<h3 id="environment-heading">` /
`aria-labelledby` landmark pattern as Containers/Files, per spec.

**Pending/WAITING vs. STOPPED, distinctly.** `mixed-sidebar`'s worker row is
unchecked, `source-row--dimmed` (55% opacity, unchanged token-free rule per
spec 003 § Design tokens used), with `<span class="source-row__state-label
source-row__state-label--pending">Waiting</span>` (renders uppercase via
`text-transform`) and its checkbox carries **no** `disabled` attribute
(only the visibility toggle is disabled) — correctly matching "the checkbox
is a normal, always-interactive control, not disabled while pending."
`mixed-sidebar-stopped`'s laravel row is checked, **not** dimmed (dimming is
driven purely by `subscribed`, independent of `state`, matching spec 002's
carried-over rule), with `source-row__state-label--stopped` reading
"Stopped." The two states are visually and textually distinct — `Waiting`
vs. `Stopped` — with no risk of conflation, satisfying Decision 2's stated
rationale for adding a fourth `SourceState` value. Both labels correctly use
`--color-text-muted` per the § Components & states table; no `error`-state
row exists in evidence, but `SourceRow.css`'s
`.source-row__state-label--error { color: var(--color-level-error) }` rule is
present and correctly scoped, source-verified only.

**No-target detector info note.** Exact copy match, evidence-backed in both
`mixed-sidebar` fixtures and `nextjs-only-sidebar`: "Next.js detected —
output is on stdout; run under Docker or add a file target in
traceriver.json." — verbatim against the API contract's specified string.
Rendered as `<p class="files-section__note">` (never a `<button>`, no
`role`, no `tabindex`) with `IconInfo` (16px, `aria-hidden="true"` on both
the wrapping `<span>` and the inner `<svg>`) immediately followed by a
`<span>` carrying the full sentence — satisfies "never icon-alone" and
"non-interactive, not Tab-reachable." `--color-text-muted` /
`--font-size-sm` on `.files-section__note`, `--space-2` gap on
`.files-section__notes` for stacking — all confirmed as existing tokens, no
raw values. Multi-note stacking itself isn't exercised by any fixture in the
evidence set (only one no-target detector matches in both captured
projects) — source-verified only, the `.map()` over `notes` with the gap rule
applied is structurally correct.

**`local:<detector>` / `herd:<slug>` labels.** See Finding 1 — the row's
*visible text* does not carry this convention in the evidence, though the
`id`-derived `aria-label`/`aria-checked` strings do. Flagged above; not
re-stated here.

**Tooltip format.** Evidence-backed via all four DOM dumps' `title`
attributes: pure auto-discovery source (live laravel) → bare target path,
no suffix; pending source (worker) → `"<path> — Waiting for <path> to be
created."`; stopped source (laravel, second fixture) → `"<path> — File not
found — waiting for it to reappear."`; environment sources (both Herd rows,
either fixture) → bare target path, no suffix (correct — `origin:
"environment"`, not `"config"`, so no config-note suffix applies). All four
match the spec's exact format rules verbatim, including the "config suffix
omitted when `detail` is present" carve-out (implicitly confirmed since no
evidence fixture combines `origin: "config"` with a non-null `detail`, but
the implementation in `localTooltipText()` checks `detail` first,
unconditionally, before ever checking `origin === "config"` — correct
precedence per source read). No config-origin source exists in any fixture,
so the `"· configured via traceriver.json"` suffix itself is
source-verified only, not evidence-backed.

**State-label styling consistency with spec 002's Docker treatment.**
`SourceRow.css`'s `.source-row__state-label` block is shared, unmodified,
across `kind: "docker"` and `kind: "local"` rows (`STATE_LABEL_TEXT` and the
`stateLabel` computation in `SourceRow.tsx` are keyed off `state`, not
`kind`, beyond the initial `kind === "docker" || kind === "local"` gate) —
identical `--font-size-xs` / uppercase / `--letter-spacing-label` /
`--color-text-muted` (pending, stopped) / `--color-level-error` (error)
treatment, confirmed by direct source read, no divergent rule introduced.

**Accessibility landmarks/ARIA.** Evidence-backed via all four DOM dumps:
`<section aria-labelledby="files-heading">` / `<section aria-labelledby=
"environment-heading">`, each with a real `<h3 id="…">`, matching
Containers' established pattern. `role="switch"` / `aria-checked` /
`aria-label="Show <id> in stream"` on the visibility toggle, `aria-label=
"Subscribe to <id>"` on the checkbox — present and correctly scoped for
every local/environment row across all four fixtures. The single `role=
"status" aria-live="polite"` region is reused, not duplicated (`store.tsx`
dispatches into the same `announcement` state spec 001/002 already use).
**Live-region announcement text**: source-verified only (no fixture
captures an announcement in-flight) — `store.tsx`'s handler correctly gates
on `prior.subscribed` and `prior.state !== msg.state`, matches the
`pending`/`stopped`→`live` and `live`→`stopped` wording from spec, subject
to Finding 1's `label`-content caveat.

**Keyboard / focus.** No new interactive control types beyond checkbox and
toggle, both native/`role="switch"` elements already covered by the global
`:focus-visible` rule (unchanged from spec 001/002, confirmed by source
read, not independently re-verified from evidence since no fixture captures
a focus state).

**Text-not-color-alone.** `Waiting`/`Stopped`/`Error` are real text content,
not color-only signals — evidence-backed for `Waiting`/`Stopped` (present
in the two mixed-sidebar fixtures), source-verified for `Error` (no error-
state fixture exists). The info note is always icon + full sentence, never
icon-alone, evidence-backed.

**Design tokens used.** `IconInfo` (`icons.tsx`) matches the spec exactly:
circled "i", 16×16 default, `currentColor`, single-color, hand-authored SVG
— no icon library. No raw color/spacing/type/radius value found in
`FilesSection.css`, `EnvironmentSection.css`, or the phase-3-touched
portions of `SourceRow.css` — every value traces to an existing
`design-system.md` token (`--color-text-muted`, `--font-size-sm`,
`--font-size-xs`, `--letter-spacing-label`, `--color-level-error`,
`--space-2`, `--space-12`). Contrast: `--color-text-muted` (5.1:1) and
`--color-level-error` (6.9:1) both already clear the design system's ≥4.5:1
AA text threshold — no new contrast risk introduced (AC 18).

**Reduced motion / dimming opacity.** The `pending`→`live` row update
renders as an instant React re-render with no CSS transition triggered by
`state` (only `opacity`, gated by `subscribed` via `.source-row--dimmed`,
carries a `transition: opacity var(--motion-fast)` — pre-existing from spec
001, unaffected by state changes) — matches the spec's "instant state
change, not an animated transition" requirement.

**Minor documentation note (not a code finding).** The spec's own prose
refers to the API contract's `local.origin` field as `local.scope` in
several places (§ Layout, § Components & states) while the actual `SourceDescriptor.local` TypeScript interface in § API contract names the field `origin`. The implementation correctly follows the canonical TS interface (`s.local?.origin` in `store.tsx`'s `useFileSources`/`useEnvironmentSources`), so this is a spec-authoring terminology inconsistency to clean up in a future spec pass, not an implementation defect — noted here for traceability rather than raised as a review finding.

## Checklist

- [x] Layout vs. wireframe — Files/Environment section structure, no-target
      note placement, row anatomy all match; evidence-backed for all four
      captured states.
- [x] All specified states present in evidence or source: `pending`/WAITING
      (evidence-backed), `stopped`/STOPPED (evidence-backed), `error`
      (source-verified only, no fixture), no-target note (evidence-backed),
      Environment omit-when-empty (evidence-backed) and populated
      (evidence-backed).
- [x] Token-only styling — no raw values in any phase-3 CSS
      (`FilesSection.css`, `EnvironmentSection.css`, phase-3 additions to
      `SourceRow.css`); `IconInfo` matches the spec's stated dimensions/color
      rule exactly.
- [x] Semantics/landmarks — `<section aria-labelledby>` + real `<h3>` for
      Environment, matching Files/Containers; evidence-confirmed.
- [x] ARIA requirements — `role="switch"`/`aria-checked`/`aria-label` on
      every local/environment row's toggle and checkbox, evidence-confirmed;
      live-region wording source-verified only.
- [x] Focus states — global `:focus-visible` rule covers the (unchanged)
      checkbox/toggle controls; no new interactive element type introduced.
- [x] Text-not-color-alone — `Waiting`/`Stopped` real text, evidence-backed;
      `Error` source-verified; info note never icon-alone, evidence-backed.
- [x] **Row label content matches the spec's `local:<detector>` /
      `<detector>:<slug>` convention** — **fixed and now passes**, per the
      re-review above. `docs/qa/evidence/003-phase-3-auto-discovery/mixed-
      sidebar.dom.html` and `mixed-sidebar-stopped.dom.html` both now show
      `local:laravel`, `local:worker`, `herd:nginx-mysite.test`, `herd:php-
      fpm-mysite.test` as the literal `source-row__label` text.

## Verdict (first pass, superseded)

**CHANGES REQUIRED**

One major finding (Finding 1): the rendered sidebar label text for
auto-discovered local sources (`local:laravel`, `local:worker`) and
environment sources (`herd:nginx-mysite.test`, `herd:php-fpm-mysite.test`)
is missing the kind-scoped prefix the spec's wireframes and prose
repeatedly depict as the literal displayed text, across every local/
environment row in both fixtures that exercise them. The frontend
(`SourceRow.tsx`) is not at fault — it renders `source.label` verbatim, and
its own `aria-label`/`aria-checked` strings (built from `source.id`) already
carry the correct prefixed form, confirming the gap is in what value the
backend's discovery layer populates `SourceDescriptor.label` with for these
two source origins. Everything else reviewed — WAITING/STOPPED distinction,
the no-target note's copy/non-interactivity, Environment's omit-when-empty
behavior, tooltip formatting, landmarks/ARIA, and token-only styling — is
evidence-backed and correct with no other findings.

## Final verdict

**APPROVED** — see "Re-review (2026-07-20)" above. Finding 1 is resolved;
no other findings outstanding from either pass.

ARTIFACTS WRITTEN: docs/design-reviews/003-phase-3-auto-discovery.md
STATUS: APPROVED
OPEN QUESTIONS: none
