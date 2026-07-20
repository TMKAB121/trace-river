# Design Review — 002: Phase 2 Docker Streams

Spec: [`docs/specs/002-phase-2-docker.md`](../specs/002-phase-2-docker.md)
Tokens: [`docs/design-system.md`](../design-system.md)
QA status entering this review: 21/21 acceptance criteria, 0 open defects
(defects 2 and 3 fixed and re-verified per QA's test plan).

## Re-review (2026-07-20)

Both findings from the initial pass (below) have been fixed and QA has run a
full passing regression (81/81 tests). This section records what changed and
verifies it; the original **Scope reviewed** / **Findings** / **Verification
detail** / **Checklist** sections below are left as-written (historical
record of the first pass) except for the two per-finding resolution notes
added inline. See **Verdict** at the bottom for the final call.

**What was re-verified, and how:**

- **Finding 1 (backend, major)** — `src/ingest/docker.ts` `attemptConnect()`
  (lines ~141–167) now calls `await this.discoverAll()` (which broadcasts the
  refreshed `sources` list as its own last step) **before**
  `this.setStatus("connected", null)` (which broadcasts `dockerStatus`). Read
  the current source directly: the reordering is exactly as described, with
  an explicit code comment citing this review's Finding 1. `discoverAll()`
  returns `boolean`; on the transient case where `listContainers()` throws
  right after a successful `resolve()` ping, `discoverAll()` itself settles
  status to `not_running` and returns `false`, and `attemptConnect()`
  short-circuits (`if (this.stopped || !discovered) return;`) — so the
  phantom-"connected" race described in the original finding (announcing
  `connected` on top of a transition `discoverAll` already resolved to
  `not_running`) cannot occur. QA's new deterministic unit test,
  `test/docker/recovery-ordering.test.ts`, exercises both branches against a
  stubbed `DockerClient`/spied `Broadcaster` (no real daemon needed): one
  test asserts `sources` broadcasts strictly before `dockerStatus:connected`
  and that the count the client would read at that moment is the real
  post-recovery count (2, not 0, in its fixture); the second asserts
  `broadcastDockerStatus` is called with `not_running` only, never
  `connected`, on the transient-failure path. Read both tests directly —
  they are written to fail against the pre-fix ordering and pass now, which
  is exactly the regression-guard shape this finding needed. **Resolved.**
- **Finding 2 (frontend, minor)** — `web/src/store/store.tsx` +
  `web/src/components/Sidebar.tsx`: `useDockerEnabled()` (boolean) has been
  replaced by a tri-state `useDockerAvailability()` returning `"unknown" |
  "enabled" | "disabled"`. `Sidebar.tsx` now renders the sectioned
  Containers/Files layout (including the "Checking Docker…" loading copy)
  for **both** `"unknown"` and `"enabled"`; the flat phase-1 fallback (`(no
  sources yet)`) is reserved for the settled `"disabled"` value only, which
  the reducer only ever reaches either by direct signal (a `kind:"docker"`
  source or a `dockerStatus` message — flips to `"enabled"`, not
  `"disabled"`) or, absent any signal, a one-shot 400 ms post-WS-connect
  settle-guard timer (`DOCKER_SETTLE_GUARD_MS`) that fires exactly once and
  is cleared the instant any docker signal arrives first. This closes the
  exact gap the original finding identified: a project with zero matching
  containers and no file sources no longer drops to the flat phase-1
  fallback during the connecting→first-`dockerStatus` window. New QA
  evidence confirms this live: `04-docker-disabled-loading-transient` (a
  100 ms capture) shows the sectioned layout with "Checking Docker…" under
  **CONTAINERS**, matching the spec's loading wireframe exactly — read its
  DOM dump directly, confirming `<section aria-labelledby="containers-heading">`
  with `<p class="sidebar-subsection__empty">Checking Docker…</p>`, no flat
  fallback markup present. `05-docker-disabled-settled-regression-check` (a
  5 s capture, past the settle guard, on a genuinely `docker.enabled: false`
  server) shows the settled flat `(no sources yet)` fallback — its DOM dump
  is functionally identical to the original `03` evidence (same
  `sidebar__empty` markup, same absence of any Containers/Files sections),
  confirming the fix didn't regress the already-approved disabled-config
  case. **Resolved** — the primary gap (flat-fallback during the loading
  window) is fixed and evidence-backed.
  - One secondary observation from the original finding is **not** touched
    by this fix and remains true on the current source:
    `ContainersSection.tsx`'s own `isLoading` gate (`status === null`, lines
    34/63) still shows "Checking Docker…" *inside* the now-correctly-rendered
    sectioned layout until the `dockerStatus` message specifically arrives,
    even if `containerSources` already has rows (e.g. a `sources` broadcast
    that included a docker source landed before `dockerStatus` did). This was
    explicitly called out in the original finding as self-healing within one
    WS round trip and *not required to block re-review* — noted again here
    for completeness, not re-raised as a blocking item. No evidence in the
    set exercises this specific sub-case either way.

**Regression check.** QA's 81/81 pass includes the two new/changed tests
above alongside the full existing suite; nothing in the fix touches
subscribe/unsubscribe, tooltip, status-card, or ARIA logic reviewed in the
first pass, and evidence `01`/`02`/`03` (re-read, unchanged) still match
those findings as originally verified.

## Scope reviewed

Full-UI review (Tier 3 feature).

- **Screenshot + DOM evidence** (`docs/qa/evidence/002-phase-2-docker/`):
  `01-current-project-default` (3 unsubscribed containers, toggle off),
  `02-show-all-containers-default` (toggle on, 11 containers across two
  compose projects + an unaffiliated Lando proxy, flat single sort order),
  `03-docker-disabled-flat-sidebar` (`docker.enabled: false`, confirmed via
  the QA test plan as a genuine disabled-config capture, not an artifact of
  a loading window). DOM dumps read directly for landmark/ARIA attributes,
  `title` tooltip strings, and `aria-checked`/`role` values. **Added on
  re-review**: `04-docker-disabled-loading-transient` (100 ms capture,
  sectioned layout + "Checking Docker…") and
  `05-docker-disabled-settled-regression-check` (5 s capture, settled flat
  fallback) — see Re-review section above.
- **No evidence exists** for: any Docker status card variant
  (`not_installed`/`not_running`/`permission_denied`), the empty-Containers-
  section copy, the dismissed-card-restores-toggle state, or the "Docker
  connected" toast. QA's own test plan documents these as "not exercised
  live" (static code review only) for the same reason — the run only has one
  real, working local Docker daemon to test against, so failure/recovery
  transitions can't be staged live. Every finding below drawing on these
  states is **source-verified, not evidence-backed**, and called out as such.
- **Static source review**: `web/src/components/{Sidebar,SourceRow,
  ContainersSection,FilesSection,DockerStatusCard,Toast}.{tsx,css}`,
  `web/src/store/store.tsx`, `web/src/types.ts`, `web/src/styles/{tokens,
  global}.css`, `web/src/components/icons.tsx`. Also read
  `src/ingest/docker.ts` (backend) to check message-ordering assumptions the
  frontend's toast/announcement logic depends on — see Finding 1.

Treated as settled per the run brief, verified for execution quality only,
not relitigated: dismissed-failure-card restores header+toggle with normal
empty copy; combined tooltip format `"<image> · <project>/<service> —
<detail>"`; docker-enabled detection by inference (`dockerStatus !== null`
OR any `kind:"docker"` source seen); provisional `raw` tag on early live
entries (backend-only, not reviewed here).

## Findings

| # | Severity | Area | Spec section | Expected | Actual | File |
|---|---|---|---|---|---|---|
| 1 | Major | backend (fix) / frontend (symptom) | § Components & states — Docker status card, "Auto-recovery"; exit criterion 11 | On recovery, the toast/announcement reads "Docker connected — `<n>` container(s) found" reflecting "whatever the server just discovered" | `src/ingest/docker.ts` `attemptConnect()` calls `this.setStatus("connected", null)` (broadcasts `dockerStatus`) **before** `await this.discoverAll()` (which broadcasts the refreshed `sources` list). The client (`store.tsx`, the `dockerStatus` case) computes `<n>` by counting `kind:"docker"` entries in `sourcesRef.current` at the instant `dockerStatus:"connected"` arrives — i.e. the *pre-recovery* list. In the feature's own headline scenario (Docker was down, so 0 docker sources existed pre-recovery), the toast will read "Docker connected — 0 container(s) found" instead of the real count, moments before the correct `sources` broadcast lands and silently fixes the sidebar without correcting the toast text already shown. Not caught by QA because this transition "was not exercised live" per the test plan. | `src/ingest/docker.ts:141-155`, `web/src/store/store.tsx:481-501` |
| 2 | Minor | frontend | § Components & states — Containers section, loading; § Layout wireframes | The sidebar shows the sectioned Containers/Files layout (with "Checking Docker…" while `dockerStatus` is still unknown) for the whole window between connecting and the first `dockerStatus` message | `useDockerEnabled()` only flips to `true` once **either** a `dockerStatus` message **or** a `kind:"docker"` source has been observed. In a project with zero matching containers (the spec's own "empty Containers section" case) and no file sources yet, neither signal exists until `dockerStatus` itself arrives, so the Sidebar falls back to phase‑1's flat list/`"(no sources yet)"` for that window instead of the documented sectioned "Checking Docker…" state. Separately, even once a docker source *has* been seen, `ContainersSection`'s `isLoading` gate (`status === null`) hides those already-known rows behind "Checking Docker…" until the `dockerStatus` message specifically arrives, briefly masking real data with a loading label. Both are self-healing within one WS round trip and not directly observed in the evidence set (all captured scenarios had either docker disabled or ≥3 containers already discovered), but they are a real, verifiable gap between the documented Loading-state boundary and the two different signals actually driving it. | `web/src/store/store.tsx:706-718` (`useDockerEnabled`), `web/src/components/ContainersSection.tsx:34-38` |

No blocker findings. One major (backend-rooted, frontend-visible), one minor
— **both resolved on re-review, 2026-07-20** (see Re-review section above for
verification detail).

## Verification detail

**Tokens.** No raw hex/px/ms/color value found in any phase-2 component CSS
(`ContainersSection.css`, `DockerStatusCard.css`, `SourceRow.css` additions,
`Sidebar.css` sub-section rules). The only literal pixel values present
(`top: 2px; left: 2px` toggle-thumb inset in `ContainersSection.css`) are a
verbatim reuse of the identical inset already used by spec 001's
`SourceRow.css` toggle thumb, not a new value. The "permission denied" left
accent reuses `--row-left-edge-width` (4px, already defined for the stream
row's left edge) rather than inventing a new border-width token — a
reasonable, token-only choice for a value the spec names conceptually
("left accent") without pinning a specific width.

**Layout vs. wireframe.** Evidence `01`/`02` match the wireframe's structure:
`CONTAINERS` header row with the "Show all containers" pill switch
right-aligned (label to its left, inside the toggle button, per spec), rows
below with checkbox/icon/label/count/visibility-toggle, `FILES` sub-section
beneath with its own empty copy. `02`'s toggle-on state confirms Decision 1
(flat single sort order, no this-project/other-projects re-grouping) —
`streetbites_*` and `landoproxyhyperion…` rows interleave with no sub-header,
as specified.

**Container row / state label.** `SourceRow.tsx` scopes the `STOPPED`/`ERROR`
second line to `kind === "docker"` only, exactly as spec 002 requires (file
rows are untouched, confirmed by reading the shared component — no
conditional branch alters file-row rendering). Text content is `"Stopped"`/
`"Error"` with CSS `text-transform: uppercase` producing the wireframe's
`STOPPED`/`ERROR` — same established pattern as the existing section
headers, not a literal-text deviation. Color: `--color-text-muted` (stopped)
vs. `--color-level-error` (error), both real text, never color-alone —
satisfies exit criterion 20. **Dimming is correctly orthogonal to state**:
`dimmed = !source.subscribed` is computed independently of `state`, so a
`stopped`-but-subscribed row is not dimmed, matching the spec's explicit
carve-out.

**Tooltip.** Confirmed via `01`/`02`'s DOM dumps: `title` attributes read
exactly `"<image> · <composeProject>/<composeService>"` (e.g. `"alpine:3 ·
trqaevidence/cache"`, `"redis:7 · streetbites/cache"`), matching the accepted
combined-format judgment call. `source-row__label` keeps
`overflow:hidden;text-overflow:ellipsis;white-space:nowrap` regardless of
tooltip length; `02`'s long labels (`streetbites_appserver_nginx_1`,
`landoproxyhyperion5000gandalfedition_proxy_1`) render truncated with
unchanged row height across all 11 rows in that screenshot — **evidence-backed
pass of exit criterion 17** (tooltip has no effect on collapsed-row layout).

**Docker status card.** `DockerStatusCard.tsx`/`.css` uses
`--color-surface-row-expanded-panel` / `--color-border` / `--radius-md` /
`--space-3` exactly as specified. All three failure variants reuse the same
`IconDocker` component (matching the spec's own "Icon/accent" table, which
lists `IconDocker` for every row — the wireframe's `⚠` vs `🐳` glyphs are
ASCII-art stand-ins, not a call for a second icon shape; no new icon exists
in `icons.tsx`, correctly, since one wasn't authorized). `permission_denied`
alone gets `--color-level-warn` on the icon and a `--row-left-edge-width`
left accent; distinguishing text (`"Permission denied"` heading, different
body copy) is present independent of color, satisfying "never color alone."
`"Retrying automatically…"` renders on all three variants unconditionally.
Dismiss button: `aria-label="Dismiss Docker status message"` matches the
spec's exact string. **Not evidence-backed** — no screenshot of any card
state exists in the QA evidence set; verified by source read only.

**Dismissal / auto-recovery logic** (`store.tsx`, source-verified only).
`dismissedDockerStatuses` is a `Set<DockerStatus>` keyed per status value —
dismissing `not_running` does not suppress a later `permission_denied`,
correctly modeling per-status dismissal. `ContainersSection` correctly
restores the header + toggle + normal empty/populated body once the
currently-showing status is dismissed (the ratified "dismissed-failure-card"
behavior), verified by tracing the `isLoading`/`card`/`showToggle`
conditions by hand. The toast/announcement text for the three failure
transitions (`"Docker not detected."` / `"Docker not running."` / `"Docker
permission denied."`) and the per-source `"<label> stopped."` /
`"<label> restarted."` announcements match the spec's exact wording, gated
correctly on subscribed-only and once-per-transition (see Finding 1 for the
one place this pattern's *count* is unreliable).

**Accessibility landmarks/ARIA** — evidence-backed via `01`/`02`'s DOM dumps:
`<section aria-labelledby="containers-heading">` / `<section
aria-labelledby="files-heading">` each with a real `<h3>`, `role="switch"`/
`aria-checked`/`aria-label="Show all containers"` on the toggle,
`role="switch"`/`aria-checked`/`aria-label="Show docker:<id> in stream"` per
row, `aria-label="Subscribe to docker:<id>"` on each checkbox. `03`'s DOM
confirms the disabled-Docker case reverts to the exact phase-1 flat
`sidebar__empty` markup with no Containers/Files sections at all — direct
evidence for exit criterion 18. The single `role="status"
aria-live="polite"` region (`App.tsx`) is reused, not duplicated, for the new
Docker announcements, consistent with spec 001's "still one region" rule.

**Keyboard / focus.** Both the "Show all containers" toggle and the status
card's dismiss button are native `<button>` elements (Enter/Space work for
free), and `:focus-visible { outline: 2px solid var(--color-focus-ring);
outline-offset: 2px; }` is a single global rule in `global.css` applying to
every interactive element with no per-component override — satisfies the
requirement without needing a component-level check.

**Reduced motion.** `tokens.css` zeroes `--motion-fast`/`--motion-base`
under `prefers-reduced-motion: reduce` globally; the status card and toast
both mount/unmount via plain conditional React rendering (no CSS
transition on appearance at all, only the dismiss-button hover color uses
`--motion-fast`), so there's nothing that needs a component-level
reduced-motion override — the global rule already covers the one animated
property in scope.

**Design tokens used — no new tokens.** Confirmed: every value referenced
across the phase-2 components already existed in `design-system.md` prior
to this feature; no addition was needed and none was made.

## Checklist

- [x] Layout vs. wireframe — sidebar Containers/Files split, row anatomy,
      toggle placement all match; evidence-backed for the populated and
      show-all-containers states, source-verified for card/loading/empty.
- [x] All specified states present in source: subscribed/unsubscribed,
      stopped/error state labels, loading, empty, all three status-card
      failure variants, dismissed-card recovery, docker-disabled flat
      fallback (evidence-backed for the last one).
- [x] Token-only styling — no raw values in any phase-2 CSS file beyond a
      verbatim-reused `2px` inset already established in spec 001.
- [x] Semantics/landmarks — `<section aria-labelledby>` + real `<h3>` for
      both sub-sections, evidence-confirmed.
- [x] ARIA requirements — `role="switch"`/`aria-checked`/`aria-label` on
      both toggle types, `aria-label="Dismiss Docker status message"` on
      the card's dismiss control, single shared `aria-live="polite"` region
      carrying the new Docker announcements.
- [x] Focus states — global `:focus-visible` rule covers the new toggle and
      dismiss button with no additional work needed.
- [x] Text-not-color-alone — `STOPPED`/`ERROR` are real text; permission-denied
      card distinguished by heading text, not hue alone.
- [x] **Toast/announcement content accuracy on recovery** — **fixed on
      re-review**: `src/ingest/docker.ts` `attemptConnect()` now awaits
      `discoverAll()` (broadcasting the refreshed `sources` list) before
      broadcasting `dockerStatus: "connected"`, and short-circuits without
      announcing `connected` at all if `discoverAll()` itself settles to
      `not_running` on a transient failure. Verified via source read plus
      QA's new deterministic unit test
      (`test/docker/recovery-ordering.test.ts`), which asserts the broadcast
      ordering and the resulting count directly.

## Verdict — re-review, 2026-07-20

**APPROVED**

Both findings from the initial pass are resolved:

- **Finding 1 (major)** — fixed in `src/ingest/docker.ts`: `discoverAll()`
  (which broadcasts the refreshed `sources`) now runs and completes before
  `dockerStatus: "connected"` is broadcast, and the phantom-connected
  transient-failure race is guarded against by `discoverAll()`'s own boolean
  return short-circuiting `attemptConnect()`. Confirmed by source read and by
  QA's new `test/docker/recovery-ordering.test.ts`, which is written to fail
  against the pre-fix ordering and passes against the current code.
- **Finding 2 (minor)** — fixed in `web/src/store/store.tsx` +
  `web/src/components/Sidebar.tsx`: the tri-state `useDockerAvailability()`
  ("unknown"/"enabled"/"disabled") renders the sectioned Containers/Files
  layout (with "Checking Docker…") for both "unknown" and "enabled", and
  only falls back to the flat phase-1 layout once "disabled" is genuinely
  settled (either by direct signal, or a one-shot 400 ms post-connect settle
  guard when no docker signal arrives at all). Confirmed evidence-backed via
  `04-docker-disabled-loading-transient` (sectioned + "Checking Docker…" at
  100 ms) and `05-docker-disabled-settled-regression-check` (settled flat
  fallback at 5 s, matching original evidence `03`). A secondary, narrower
  observation from the original finding (`ContainersSection`'s own
  `isLoading` gate can still show "Checking Docker…" briefly even once a
  docker source is already known, pending the `dockerStatus` message
  specifically) is unchanged and was explicitly scoped as non-blocking,
  self-healing residue in the original finding — not re-raised as a blocker
  here.

Zero blocker/major findings remain. QA's 81/81 regression pass, plus the
re-verification above, support approving this feature as implemented.

ARTIFACTS WRITTEN: docs/design-reviews/002-phase-2-docker.md
STATUS: APPROVED
OPEN QUESTIONS: none
