# 003 — Phase 3: Auto-Discovery

Status: ready-for-dev
Depth: Tier 3 (full spec)
Source: [`docs/phases/phase-3-auto-discovery.md`](../phases/phase-3-auto-discovery.md)
Extends: [`docs/specs/001-phase-1-core-console.md`](001-phase-1-core-console.md),
[`docs/specs/002-phase-2-docker.md`](002-phase-2-docker.md)

## Overview

Phases 1–2 shipped two source kinds: uploaded files and Docker containers.
Phase 3 activates the third, already-reserved `SourceKind`, `"local"`: at
startup the server fingerprints the project root (Laravel, Symfony, Next.js,
Go, Rails, Django, WordPress) and, on macOS, a handful of environment-level
tools (Herd, Valet, Homebrew nginx/php-fpm), then tails whatever log files it
finds — plus anything declared explicitly in `traceriver.json`'s `watch`
array. After this phase, `traceriver start` in a fresh Laravel project tails
`storage/logs/laravel.log` with zero configuration: the sidebar shows
`local:laravel` checked and live before the user does anything, and
triggering an exception in the app surfaces the full multi-line trace within
a second.

This spec extends, and does not replace, specs 001–002: the top bar, unified
stream, row expansion, search/filtering, Freeze/Clear, file-upload behavior,
and the Docker sidebar section are all unchanged. Everything below is
additive to the sidebar and to the WS/REST contract, following the same
"local sources are siblings of Docker sources" shape the phase-1
`SourceDescriptor` was deliberately built generic enough to absorb.

**Explicitly out of scope for phase 3** (do not build):
- Any change to Docker/file-upload behavior, the top bar, or the unified
  stream's visual grammar.
- A manual "rescan project" button — fingerprinting runs once, at server
  startup, over the fixed working directory; it is not re-run mid-session
  (the phase doc's detector model scans "at startup," full stop — a running
  server doesn't need to notice a `composer.json` that didn't exist a minute
  ago, since the project root itself doesn't change without a restart).
- Linux environment-level detectors (`/var/log/nginx/` etc.) — noted in the
  phase doc as future work (permission handling differs); this spec's
  environment tier is macOS-only, matching the phase doc exactly.
- Phase 4's AI-prompt metadata consumption of the `discovery` payload — this
  spec defines the data shape so phase 4 doesn't need a contract change, but
  building anything that reads it is out of scope here.
- A "load last N KB of history" affordance for EOF-started tails — noted in
  the phase doc as a nice-to-have, not required for this phase.

## User flow

1. User runs `traceriver start` from `laravel-app/` (a Laravel project with
   `composer.json` + `artisan`, and `storage/logs/laravel.log` already
   present from a prior run of the app). The server fingerprints the working
   directory before accepting any WS connection: the `laravel` detector
   matches, resolves its default target, sees the file exists, and marks it
   `subscribed: true` from the start.
2. Console loads: the sidebar's **Files** section shows `local:laravel`
   already **checked**, full opacity, no state label (it's `live`) — tailing
   began at EOF (no back-history flood) the moment the server started.
3. User exercises the app and hits a route that throws. The exception's full
   PHP stack trace (many raw lines) appears in the unified stream as **one**
   `multiline: true` entry within about a second of it being written to
   `laravel.log` — same expand/collapse behavior spec 001 already built.
4. At midnight, Laravel's daily rotation creates `laravel-2026-07-21.log`.
   Because `laravel`'s default watch target is a glob
   (`storage/logs/*.log`), the new file's lines continue to arrive under the
   same `local:laravel` sidebar row — no new row, no restart, no gap.
5. Someone on the team runs `echo -n > storage/logs/laravel.log` to clear
   disk space. The tailer detects the file shrank below its stored offset,
   resets to 0, and keeps reading — no crash, no duplicate lines, no visible
   break in the stream.
6. The same project also has a `frontend/` Next.js app one directory over —
   irrelevant here, since `nextjs` only matches when its fingerprint files
   are found in the **working directory** the server was started from, not
   subdirectories. (If the user instead runs `traceriver start` from a
   monorepo root where both `composer.json`+`artisan` and
   `package.json`+`next.config.js` sit side by side, both detectors match
   and both show up — see step 8.)
7. This particular project doesn't declare anything custom, but a sibling
   project has a worker process that logs to `storage/logs/worker.log`,
   which no detector can guess. Its `traceriver.json` declares
   `{ "path": "storage/logs/worker.log", "label": "local:worker" }` under
   `watch`; that file doesn't exist yet at startup (the worker hasn't run
   today), so `local:worker` appears **unchecked**, dimmed, with a `WAITING`
   label under its name. The moment the worker process starts and creates
   the file, the row automatically flips to checked, full opacity, `live` —
   no page refresh, no user action.
8. On a monorepo matching both `laravel` and `nextjs`, the Files section
   shows `local:laravel` as a normal checked row, plus a short informational
   note — no checkbox, since there's nothing to tail — reading "Next.js
   detected — output is on stdout; run under Docker or add a file target in
   `traceriver.json`."
9. On a machine with [Laravel Herd](https://herd.laravel.com) installed, a
   new **Environment** sidebar section appears below Files, listing Herd's
   per-site nginx/PHP-FPM logs as `herd:*` sources — all **unchecked** by
   default, regardless of whether their log files already have content
   (these are shared, cross-project, often-noisy logs; the user opts in
   per session, same click-the-checkbox gesture as any other source).
10. User checks `herd:nginx-mysite.test`. It streams exactly like any other
    local source from then on — parser detection, stickiness, expand/collapse,
    search — all identical to `local:laravel`'s behavior.

## Layout

The sidebar's structure extends spec 002's two-section (Containers/Files)
layout with one more section, **Environment**, and one new element inside
**Files** — a no-checkbox informational note for detectors with no file
target. Nothing else in spec 002's layout changes; a project with Docker
disabled and no local sources still renders spec 001's flat, unsectioned
list exactly as before.

### Wireframe — default state (mixed sources)

```
┌ Sidebar ──────────────────────────────────┐
│ LOG SOURCES                               │
│                                            │
│ CONTAINERS          Show all containers ○ │
│ ☑ 🐳 docker:nginx           980  ⬤─       │
│ ☐ 🐳 docker:app               0  ○        │
│                                            │
│ FILES                                     │
│ ☑ 📄 local:laravel           12  ⬤─       │
│ ☐ 📄 local:worker              0  ○        │
│    WAITING                                │
│ ☐ 📄 File: dump.log            0  ○        │
│ ⓘ Next.js detected — output is on stdout; │
│   run under Docker or add a file target   │
│   in traceriver.json.                     │
│                                            │
│ ENVIRONMENT                               │
│ ☐ 📄 herd:nginx-mysite.test    0  ○        │
│ ☐ 📄 herd:php-fpm-mysite.test  0  ○        │
│                                            │
│ ─────────────────────────                 │
│ DROP AREA                                 │
│ ┌───────────────────────┐                 │
│ │         ☁              │                │
│ │ Drag & Drop Log File    │                │
│ │ (.log .txt .json .jsonl)│                │
│ │      or [Browse]        │                │
│ └───────────────────────┘                 │
└────────────────────────────────────────────┘
```

`WAITING` renders exactly like Docker's `STOPPED` state label (§ Components
& states extends this to `kind: "local"` rows) — a second line beneath the
label, `--font-size-xs`, uppercase, `--letter-spacing-label`,
`--color-text-muted`. The `ⓘ` glyph (new `IconInfo`, see § Design tokens
used) prefixes each no-file-target framework note, `--color-text-muted`,
`--font-size-sm`, wrapped to multiple lines like any other sidebar copy —
not a button, not dismissible (it isn't a problem to acknowledge, it's
static context that's true for the whole session).

### Wireframe — a source transitioning from WAITING to live

Before the target file exists (left) vs. immediately after the tailer
detects its creation (right) — no user action between the two, no reload:

```
☐ 📄 local:worker    0  ○        ☑ 📄 local:worker    0  ⬤─
   WAITING
```

The row's opacity, checkbox, and toggle all update in the same broadcast
that flips `state` — this is the existing generic `sources` broadcast
mechanism (§ API contract), not a new animation or transition.

### Wireframe — Environment section, nothing detected

Per this spec (confirmed by the product owner, see § Open Questions #1), the
section is omitted entirely, not shown with placeholder copy, when zero
environment-level sources are found:

```
FILES
☑ 📄 local:laravel           12  ⬤─
☐ 📄 File: dump.log            0  ○

─────────────────────────
DROP AREA
...
```

No `ENVIRONMENT` header, no "nothing found" line — on Windows/Linux, or a
Mac without Herd/Valet/Homebrew installed, this section simply never
exists for the session. This differs deliberately from the Containers
section's always-show-a-status-card behavior (see § Decisions for why).

### Wireframe — Files section, no-target detector note only (no matching file-target detector)

A pure Next.js project (`nextjs` matches, nothing else does — no local file
sources at all, only uploads if any):

```
FILES
ⓘ Next.js detected — output is on stdout; run
  under Docker or add a file target in
  traceriver.json.
☐ 📄 File: dump.log            0  ○
```

The Files section header still renders (uploads are always possible) even
when the only local-discovery outcome is an informational note with no
sidebar row of its own.

## Components & states

### Sidebar sections (extends spec 002)

- Section order, top to bottom: **Containers** (unchanged, docker-gated),
  **Files** (uploads + `kind: "local"` sources whose `local.origin` — see
  § API contract — is `"project"` or `"config"`), **Environment** (`kind:
  "local"` sources whose `local.origin` is `"environment"`).
- **Containers** gating is unchanged from spec 002 (`docker.enabled`).
- **Files** gating is unchanged from spec 001/002 — it always renders
  (uploads are always possible), and now additionally lists local
  project/config sources and no-target framework notes when discovery is
  enabled and finds anything.
- **Environment** renders (with a real `<h3 id="environment-heading">`,
  matching Containers/Files' landmark pattern) only when `discovery.enabled`
  is `true` **and** at least one environment-scope source was discovered —
  confirmed by the product owner, see § Open Questions #1.
- The three-vs-flat-list rule from spec 002 extends unchanged in spirit:
  when `docker.enabled: false` **and** `discovery.enabled: false` (or
  discovery enabled but nothing found and no environment sources), the
  sidebar reverts to spec 001's flat, unsectioned list — sub-section headers
  only appear when there's more than one kind of section actually possible
  server-side, mirroring 002's existing gate.

### No-file-target framework note

- One line per detector matched with `hasFileTarget: false` (see
  `DetectedFramework` in § API contract): `IconInfo` + the detector's exact
  guidance copy (§ API contract lists the copy per detector). Renders inside
  the **Files** `<section>`, after any source rows, as static text (`<p>`,
  not a `<button>` — nothing to interact with, nothing to dismiss).
- `--color-text-muted`, `--font-size-sm`, `--space-2` gap between stacked
  notes when more than one no-target detector matches.
- Never rendered for a detector whose fingerprint didn't match, or whose
  name is listed in `discovery.disable`.

### Local source row (extends spec 002's docker-row state-label pattern)

Reuses spec 001's `SourceRow` exactly (checkbox — kind icon — label — entry
count — visibility toggle) — kind icon is `IconFile` (the same icon already
used for `kind: "file"` uploads; spec 002's own wireframe already renders
`local:laravel` with the file icon, so this spec doesn't introduce a new
icon for the kind) — plus the same two extensions spec 002 built for Docker,
now generalized to `kind: "local"`:

- **State label**: a second line beneath the label, `--font-size-xs`,
  uppercase, `--letter-spacing-label`, driven by `SourceState` (extended
  this spec — see § API contract):
  | `state` | Label | Color |
  |---|---|---|
  | `"pending"` | `WAITING` | `--color-text-muted` |
  | `"stopped"` | `STOPPED` | `--color-text-muted` |
  | `"error"` | `ERROR` | `--color-level-error` |
  | `"live"` | *(none)* | — |

  `"pending"` is new this phase (§ API contract) and exists precisely so
  "the file doesn't exist yet" (`WAITING`) and "it existed, streamed, then
  disappeared" (`STOPPED`, e.g. the file was deleted mid-session) are never
  conflated — spec 002 explicitly scoped this state-label treatment to
  Docker only and deferred extending it to files; this spec is that planned
  extension, now applied to `kind: "local"` specifically (`kind: "file"`
  uploads remain unchanged from spec 001 — their error still surfaces only
  via the hover tooltip, exactly as spec 002 left it).
- **Tooltip**: the row's `title` attribute shows the resolved absolute
  target path, and — only when the source was matched by an auto-discovery
  detector — a trailing detector note; when a `traceriver.json` `watch`
  entry supplied (or overrode) this source, a trailing config note instead:
  - Pure auto-discovery: `"<targetPath>"`
  - Config-declared or config-overriding a discovered path:
    `"<targetPath> · configured via traceriver.json"`
  - When `detail` is non-null (the `WAITING`/`STOPPED`/`ERROR` explanation),
    it's appended: `"<targetPath> — <detail>"` (config suffix omitted in
    this case to keep the string readable — `detail` already carries the
    operative information).
  This has no effect on the collapsed row's fixed layout/width, matching
  spec 002's equivalent rule for Docker's tooltip.
- **Unsubscribed dimming** (checkbox off → ~55% opacity, toggle disabled)
  behaves exactly as spec 001/002 describe, unchanged — this is what a
  `WAITING` row looks like by default (dimmed, unchecked) and what an
  environment-scope row looks like until the user opts in (dimmed,
  unchecked, `live` underneath with no label since the file already exists,
  just not subscribed).
- **Checked but count frozen while unsubscribed**: identical rule to spec
  001/002 — unaffected by this spec.

## Interaction specs

### Discovery runs once, before any client connects

Fingerprinting (project-root detectors + macOS environment detectors) and
resolving `traceriver.json`'s `watch` entries all happen synchronously
during server startup, before the WS endpoint accepts its first connection —
every client, including the very first one, receives a fully-resolved
`sources` list and `discovery` payload (see § API contract) with no race
condition where a source pops in moments after initial load.

### Default `subscribed`/`state` at discovery time

| Source origin | Target file exists at startup? | `subscribed` | `state` |
|---|---|---|---|
| Project-root detector (`local.origin: "project"`) | Yes | `true` | `"live"` |
| Project-root detector | No | `false` | `"pending"` |
| `traceriver.json` `watch` entry (`local.origin: "config"`) | Yes | `true` | `"live"` |
| `traceriver.json` `watch` entry | No | `false` | `"pending"` |
| Environment detector (`local.origin: "environment"`) | Yes | `false` (always) | `"live"` |
| Environment detector | No | `false` (always) | `"pending"` |

A pending project/config source starts `subscribed: false` (unchecked, the
`WAITING` label) — it earns `subscribed: true` automatically, but only via
the one-time auto-subscribe flip described below (§ `"pending"` → `"live"`
auto-transition), not at discovery time itself. A project/config source
whose file already exists at startup skips the pending state entirely and
starts `subscribed: true` directly — there's no transition to wait for.
Together, these two paths are the "zero config" story the phase doc's exit
criteria require (a fresh Laravel app tails with no user action, whether or
not its log file existed before the server started). Environment sources
default to `subscribed: false` **unconditionally**, on every transition,
regardless of file state — the phase doc is explicit that these are
offered, not activated, because they're noisy and shared across projects.

### `"pending"` → `"live"` auto-transition

- The tailer watches a `"pending"` source's target path (via chokidar,
  same watcher used once the file exists) for creation. The instant it
  appears, the server sets `state: "live"`, clears `detail`, and begins
  tailing from **offset 0** (there is no "EOF-skip" concern here — the file
  is brand new) — broadcast via the normal `sources`/`sourceState` messages,
  no new message shape.
- For a **project/config-origin** source, this transition also
  **auto-subscribes**: any connection that hasn't explicitly unsubscribed
  since discovery has its `subscribed` flag flipped to `true` (checkbox
  flips to checked) in the same broadcast — the zero-config courtesy the
  phase doc's "unchecked but visible... checked... when it [the file] does
  [exist]" requirement describes. This can only ever happen **once** per
  source: `"pending"` is exclusively the pre-discovery, file-doesn't-exist-
  yet state, so a source undergoes at most one `pending`→`live` transition
  in its lifetime. Any later disappearance-and-return goes through
  `"stopped"`→`"live"` instead (§ Rotation, truncation, and file
  disappearance, below), which **never** auto-subscribes — it strictly
  preserves whatever `subscribed` value is already in effect.
- If a connection had manually unsubscribed a still-pending source before
  its file appeared (an edge case, but the checkbox is a normal,
  always-interactive control, not disabled while pending), that connection's
  explicit choice is respected — its `subscribed` stays `false` through the
  `pending`→`live` transition; the row simply updates to unchecked + `live`,
  no state label, same as any other discovered-but-unsubscribed source.
  **Auto-subscribe is a one-time zero-config courtesy on first discovery,
  never a standing override of a user's explicit choice** — mirrors spec
  002's restart re-attach rule, which only re-attaches "if it was
  subscribed," never forcing a stopped-and-user-uninterested source back to
  `live`.
- **Environment-origin** sources never auto-subscribe on their
  `pending`→`live` transition, consistent with their `subscribed: false`
  default holding on every transition (§ Default `subscribed`/`state`,
  above) — the row updates to `live` with no state label, still unchecked.

### Rotation, truncation, and file disappearance — transparent by design

- Daily rotation and mid-file truncation (phase doc § 3.3) never surface as
  distinct UI states — the row's `entryCount` keeps climbing (or, for
  truncation, simply keeps counting new entries; it never resets to reflect
  the truncated file's new smaller size) and `state` stays `"live"`
  throughout. This mirrors spec 002's precedent that a Docker daemon
  events-stream reconnect is "transparent to the UI... only becomes
  user-visible if the underlying problem trips a higher-level status."
- If a subscribed source's target file is deleted and doesn't immediately
  reappear (distinct from truncation — the path itself is gone, not just
  emptied), the server sets `state: "stopped"`, `detail: "File not found —
  waiting for it to reappear."`; the row keeps its checkbox checked (still
  "subscribed," just dormant — identical framing to Docker's stopped-but-
  subscribed rule) and shows the `STOPPED` label. It resumes at offset 0 and
  flips back to `"live"` automatically the moment the path reappears, with
  no user action — same broadcast mechanism as the pending→live case.
- The polling-fallback watcher reliability logic (phase doc § 3.3, native
  fsevents/inotify vs. 1s polling) has **no UI surface at all** — it's an
  internal watcher implementation detail; the row's behavior looks identical
  either way.

### Config `watch` / discovery dedup

- `traceriver.json`'s `watch` entries and auto-discovered targets dedupe by
  resolved absolute path; when both name the same path, the config entry
  wins and supplies the label/parser (configuration.md, unchanged by this
  spec) — exactly **one** `SourceDescriptor` exists for that path, tagged
  `local.origin: "config"`.
- A `watch` entry with no matching detector (a bespoke path, e.g.
  `storage/logs/worker.log`) is a `local.origin: "config"` source too, with
  `local.detector: null`.
- Any local target (discovered or config) that resolves via a glob to
  multiple files (Laravel's daily rotation being the built-in example) still
  produces exactly one sidebar row; new matching files extend that same
  source rather than creating new rows — this is universal glob-target
  handling, not something special-cased to Laravel specifically.
- **All `watch`/discovered local sources render inside the Files section**,
  regardless of what the declared path happens to look like — this spec
  doesn't attempt to path-sniff a config-declared source into "looks like an
  environment log" territory; only detector-driven environment matches get
  `local.origin: "environment"`.

### `discovery.enabled: false` / `discovery.disable`

- `discovery.enabled: false` disables **all** auto-discovery (both
  project-root and environment tiers) — no fingerprinting runs, no
  `local.origin: "project"`/`"environment"` sources or `DetectedFramework`
  entries are ever produced, no `discovery` WS message is ever sent (mirrors
  `docker.enabled: false`'s existing "message never sent at all" pattern
  from spec 002). It does **not** disable `traceriver.json`'s `watch`
  entries — those are explicit user declarations, independent of the
  `discovery` config section, and always tail regardless.
- `discovery.disable: ["herd"]` (or any other detector name, project-root or
  environment) excludes just that one detector — its sources and its
  `DetectedFramework` entry (if it's a no-target detector) both vanish
  entirely, as if the detector doesn't exist, matching Docker's
  include/exclude precedent ("excluded... never appears... under any toggle
  state").

## API contract

All shapes align with the existing `TraceRiverLog`/`SourceDescriptor`/WS
message contract from specs 001–002 and `src/shared/types.ts`. This section
is additive except for one field-value extension called out explicitly
below (`SourceState` gains `"pending"`).

### `SourceState` — new value

```ts
export type SourceState = "live" | "stopped" | "error" | "pending";
```

`"pending"` is produced **only** by `kind: "local"` sources whose target
file doesn't exist yet (§ Interaction specs). Docker and file-upload sources
never use it — their existing three-value lifecycles are unchanged. Worth a
one-line `decisions.md` ADR entry (extending an existing enum used across
the wire contract) — noted here for traceability; writing that entry is
outside this spec's lane.

### `SourceDescriptor` — new optional field

```ts
export interface SourceDescriptor {
  // ...all existing fields unchanged (id, kind, label, subscribed, visible,
  // entryCount, state, detail, createdAt, docker?)...

  /**
   * Present only when kind === "local". Metadata for sidebar section
   * placement and the tooltip. See docs/specs/003-phase-3-auto-discovery.md
   * § API contract.
   */
  local?: {
    /** How this source was found. Drives sidebar section placement:
     *  "project" and "config" both render in Files; "environment" renders
     *  in the Environment section. */
    origin: "project" | "environment" | "config";

    /** Matched detector name, e.g. "laravel", "herd" — null for a
     *  traceriver.json watch entry with no matching detector (a pure
     *  bespoke path). Present (non-null) even when origin === "config" if
     *  the config entry happened to override a path a detector also
     *  matched (config wins per configuration.md's dedup rule; the
     *  detector name is retained here for the tooltip/traceability). */
    detector: string | null;

    /** Resolved absolute path this source tails (post tilde/glob
     *  resolution — for a glob target, the winning individual file
     *  currently being read, which may change across rotations without
     *  changing the source id). */
    targetPath: string;
  };
}
```

`kind: "local"` sources use the id convention `local:<detector>` (project
detectors), `<detector>:<slug>` for environment sources (e.g.
`herd:nginx-mysite.test`, `valet:nginx-error`, `homebrew:php-fpm`), or the
exact `label` supplied by a `traceriver.json` `watch` entry — this is
already configuration.md's existing convention (`"label": "local:worker"`),
unchanged by this spec.

**Default values for a newly discovered local source**: see § Interaction
specs' table above (`subscribed`/`state` vary by origin and file existence);
`visible: true`, `entryCount: 0`, `detail: null` unless `state` is
`"pending"` (`detail: "Waiting for <targetPath> to be created."`) or
`"stopped"` (`detail: "File not found — waiting for it to reappear."`).

### `DetectedFramework` — new type

```ts
export interface DetectedFramework {
  /** Matches the detector table in phase-3-auto-discovery.md § 3.1. */
  detector: "laravel" | "symfony" | "nextjs" | "go" | "rails" | "django" | "wordpress";

  /** Display name, e.g. "Next.js", "Go". */
  label: string;

  /** False for a detector whose fingerprint matched but which has no
   *  default file target (nextjs, go, django per the phase doc's table) —
   *  or, in principle, any detector whose default target(s) don't exist
   *  AND weren't overridden by a watch entry. In practice today only
   *  nextjs/go/django can produce false, since the other four detectors
   *  always have a default target to watch for (even if it doesn't exist
   *  yet — that's the "pending" state, not "no target"). */
  hasFileTarget: boolean;

  /** Guidance copy, present only when hasFileTarget is false. Exact copy
   *  per detector (used verbatim by the sidebar note, § Components &
   *  states):
   *  - nextjs: "Next.js detected — output is on stdout; run under Docker
   *    or add a file target in traceriver.json."
   *  - go: "Go project detected — output is on stdout; run under Docker
   *    or add a file target in traceriver.json."
   *  - django: "Django project detected — output is on stdout (console
   *    logging is Django's default); run under Docker or add a file
   *    target in traceriver.json." */
  note: string | null;
}
```

Every matched detector appears in the `frameworks` array, including ones
with `hasFileTarget: true` (their `SourceDescriptor` row already covers the
UI; the array entry exists for completeness and for phase 4's AI-prompt
metadata, per the phase doc's explicit "detectors... still matter... phase
4's AI-prompt metadata" note — this spec only defines the shape, not any
consumer of it).

### WS message — new type, added to the server→client union

```ts
export type ServerToClientMessage =
  | { type: "entries"; entries: TraceRiverLog[] }
  | { type: "sources"; sources: SourceDescriptor[] }
  | { type: "sourceState"; id: string; state: SourceState; detail?: string | null }
  | { type: "dropped"; count: number }
  | { type: "cleared" }
  | { type: "dockerStatus"; status: DockerStatus; detail: string | null }
  | { type: "discovery"; frameworks: DetectedFramework[] };   // NEW
```

**No new client→server message is needed.** `subscribe`/`unsubscribe`
already generalize to any source id, including `local:<name>` and
`<detector>:<slug>` — subscription for `kind: "local"` sources is
**per-connection**, exactly like `kind: "file"` (unlike Docker's
server-global model from spec 002) — a local file's bytes are always fully
ingested into the ring buffer regardless of any client's interest; the
subscribe/unsubscribe flag only gates delivery to that one socket. It is
**not** server-global state the way Docker's `subscribed` flag is.

A fresh connection's initial `subscribed` value for a source depends on that
source's *current* `state`, per the § Interaction specs defaults table —
this is where the table's values actually get used, not just at server
startup:

- **Still `"pending"`** (project/config source, target file doesn't exist
  yet): a new tab does **not** default-subscribe — it starts unchecked,
  `WAITING`, matching the table. The zero-config auto-subscribe courtesy is
  a **one-time flip tied to the source's first `pending`→`live` transition**
  (§ Interaction specs), not a per-connection default; a tab that connects
  while the source is still pending simply hasn't reached that transition
  yet, and gets the same unchecked state every other not-yet-live view of
  that source has.
- **Already `"live"` or `"stopped"`** (its pending state, if it ever had
  one, is behind it): behaves like any other source — a fresh connection
  subscribes to it by default per spec 001's existing rule ("A freshly
  connected client is subscribed to all sources by default").
- **`local.origin: "environment"`, any state**: starts unsubscribed for
  **every** connection, at every state — matching the "offered, not
  activated" requirement even for a second browser tab opened later in the
  same session. This is the one standing exception to spec 001's
  default-subscribed-on-connect rule; every other local/file source keeps
  that rule unchanged.

### WS connection sequence (extended)

On successful `/ws` connect, the server sends, in order:

1. Zero or more `{ type: "entries", ... }` batches (ring buffer replay) —
   unchanged.
2. One `{ type: "sources", sources: SourceDescriptor[] }` — now may include
   `kind: "local"` entries.
3. One `{ type: "dockerStatus", ... }` (only if `docker.enabled`) — unchanged
   from spec 002.
4. **One `{ type: "discovery", frameworks: DetectedFramework[] }`** (NEW) —
   only if `discovery.enabled`. Its absence is how the client knows
   discovery is off (mirrors `dockerStatus`'s existing absence-means-disabled
   convention). Sent even when `frameworks` is `[]` (discovery ran, found
   nothing) — presence of the message, not the array's length, signals
   "discovery is on."
5. Live traffic from then on: everything from spec 002 plus `sources`/
   `sourceState` broadcasts for any local source's `pending`→`live`,
   `live`→`stopped`, or `stopped`→`live` transition. `discovery` is **not**
   rebroadcast mid-session (fingerprinting runs once, at startup — see
   § Interaction specs).

### REST endpoints — additions

**`GET /api/discovery`** →
- When `discovery.enabled` is `false`: `200 { "enabled": false, "frameworks": [] }`
- When `discovery.enabled` is `true`: `200 { "enabled": true, "frameworks": DetectedFramework[] }`

Convenience mirror of the WS-pushed value, for the same reason
`GET /api/docker/status` exists — non-WS tooling, and phase 4's AI-prompt
assembly is a plausible future non-WS consumer.

No changes to `POST /api/upload`, `GET /api/sources`, `GET /api/status`,
`GET /api/replay`, or `GET /api/docker/status` — `GET /api/sources`'s
existing `{ sources: SourceDescriptor[] }` shape already generalizes to
`kind: "local"` via the additive fields above.

### Config surface consumed (already scaffolded, `configuration.md`)

- `discovery.enabled` (default `true`) — see § Interaction specs.
- `discovery.disable` (array of detector names) — see § Interaction specs.
- `watch` (array of `{ path, label, parser? }`) — feeds the same tailer as
  auto-discovery per configuration.md's existing text ("feed the same
  tailer as auto-discovery (start at EOF, rotation-aware)"); this spec's
  `subscribed`/`state` defaults table applies identically to `watch`
  entries as to detector-discovered targets, since they share one tailer
  implementation (phase doc § 3.3: "One tailer implementation serves
  auto-discovered targets and explicit watch entries from config").

## Design tokens used

One new icon, no new color/spacing/type/radius tokens:

- `IconInfo` (new hand-authored icon, added to
  [`design-system.md`](../design-system.md) § Iconography by this spec) —
  circled "i", 16px, `currentColor`, neutral like the rest of the icon set;
  used only for the no-file-target framework note.
- Everything else reuses existing tokens: `--font-size-xs` +
  `--letter-spacing-label` + `--color-text-muted` (`WAITING`/`STOPPED`
  labels, reusing spec 002's Docker state-label treatment verbatim),
  `--color-level-error` (`ERROR` label), `--font-size-sm` +
  `--color-text-muted` (no-target note copy, matching the empty-section
  copy treatment from spec 002), `--space-2` (gap between stacked notes),
  `--color-focus-ring` (checkbox/toggle focus, unchanged), and the existing
  ~55% unsubscribed-dimming opacity rule (unchanged, no token — it's a
  fixed opacity value already established in spec 001's rendering, not a
  design-system color token).

## Accessibility requirements

Everything in specs 001–002's accessibility sections still applies
unchanged. This phase adds:

- **Landmarks**: when the Environment section renders, it's a
  `<section aria-labelledby="environment-heading">` with a real `<h3
  id="environment-heading">Environment</h3>` — same pattern as Containers/
  Files. The no-target framework note is a plain `<p>` inside the Files
  `<section>`, not a landmark of its own — a screen reader user reading the
  Files section in order encounters it as ordinary content between the
  source rows and (further down) the drop area.
- **Live region strategy** (extends the existing single visually-hidden
  `aria-live="polite"` region — still one region, still discrete state
  changes only):
  - "`<source label>` started streaming." — on a **subscribed** local
    source's `pending`→`live` transition (its first-ever appearance) or
    `stopped`→`live` transition (its file reappearing after deletion).
  - "`<source label>` stopped — file not found." — on a **subscribed**
    local source's `live`→`stopped` transition.
  - Unsubscribed sources' lifecycle (including the common case: a
    project-root source sitting in `pending`/`WAITING`, or any environment
    source's `pending`↔`live` toggling before the user has opted in) is
    **not** announced — mirrors spec 002's "an unsubscribed container's
    lifecycle isn't announced, since the user isn't watching it" rule
    exactly.
- **Keyboard**: no new interactive controls beyond the checkbox/toggle
  spec 001/002 already cover — the no-target note is intentionally
  non-interactive (not Tab-reachable, no role), since there's nothing to
  act on.
- **Text, never color alone**: `WAITING`/`STOPPED`/`ERROR` are real text
  labels, not color-coded dots, exactly like spec 002's Docker treatment;
  the no-target note's `IconInfo` is always paired with its full guidance
  sentence, never icon-alone.
- **Reduced motion**: the `pending`→`live` row update (checkbox/opacity/
  toggle flipping) is an instant state change, not an animated transition —
  nothing new for `prefers-reduced-motion: reduce` to suppress here beyond
  what spec 001 already covers.

## Acceptance criteria

Numbered and individually testable; each maps to a `phase-3-auto-discovery.md`
exit criterion where noted.

1. In a fresh Laravel project with `storage/logs/laravel.log` already
   present at startup, the sidebar shows `local:laravel` checked, full
   opacity, `live`, with no user action; triggering an application
   exception produces exactly one `multiline: true` entry containing the
   full stack trace, visible in the stream within about a second of the
   line being written. *(exit: zero-config Laravel tail + fast multi-line
   trace)*
2. In a fresh Laravel project where `storage/logs/laravel.log` does **not**
   yet exist at startup, `local:laravel` appears unchecked, dimmed, with a
   `WAITING` state label and entry count 0; the moment the file is created
   (first request that logs anything), the row automatically flips to
   checked, full opacity, `live`, with no page refresh and no user action.
3. Laravel's daily rotation (a new `storage/logs/laravel-<date>.log`
   matched by the glob default) continues streaming into the same
   `local:laravel` sidebar row — no new row appears, no restart is required.
   *(exit: daily-rotation rollover continues the same source)*
4. Truncating the actively-tailed file (`echo -n > laravel.log`) does not
   break tailing or crash the process; writes made after the truncation
   appear in the stream with no duplicate or garbled entries. *(exit:
   truncation doesn't break the tail)*
5. A pre-existing 500 MB log file attaches at EOF — no historical content
   is ingested into the ring buffer, the sidebar row shows `live` within a
   short, constant time of server startup regardless of file size, and
   server memory shows no spike proportional to the file's size. QA-owned
   load test. *(exit: 500 MB file attaches instantly, EOF start, no memory
   spike)*
6. `traceriver.json` `watch` entries behave per configuration.md: an
   explicit `label` override is used verbatim for the sidebar row and the
   `local:<detector>`/`<source>` prefix in `TraceRiverLog.source`; a pinned
   `parser` is used without running detection; a glob `path` (e.g.
   `~/sites/api/var/log/*.log`) folds all currently-matching files into one
   sidebar row, and files added later that match the glob extend that same
   source. *(exit: watch globs/label overrides/parser pinning behave per
   configuration.md)*
7. When a `watch` entry's resolved absolute path matches a path an
   auto-discovery detector would also have found, exactly one
   `SourceDescriptor` exists for that path, using the config entry's label
   and parser — not the detector's default label, and not two separate
   sidebar rows.
8. On a macOS machine with Laravel Herd installed, its per-site nginx/
   PHP-FPM logs appear as `herd:*` sources in a distinct **Environment**
   sidebar section, each unchecked by default — and stay unchecked even
   though their log files already exist and have content, confirming
   environment sources never auto-subscribe the way project/config sources
   do. *(exit: Herd detection offers its service logs, unchecked by
   default)*
9. A project matching a no-file-target detector (Next.js, Go, or Django)
   shows that detector's exact guidance sentence (§ API contract) as a
   plain-text note in the Files section, with no checkbox and no sidebar
   row of its own; a project matching more than one no-target detector
   stacks their notes.
10. `discovery.disable: ["<name>"]` in `traceriver.json` excludes that named
    detector entirely — no sidebar row and no framework note for it appear,
    for either a project-root or an environment-tier detector name.
11. Manually unchecking a source that was auto-subscribed by zero-config
    discovery (or that auto-subscribed itself the moment its `pending` file
    appeared) keeps it unsubscribed permanently in that connection — a
    subsequent truncation, rotation, deletion+recreation, or any other file
    event never re-flips its checkbox back on without explicit user action.
12. `WAITING`, `STOPPED`, and `ERROR` state labels render as real text
    (not color-coded dots) for `kind: "local"` sources, using the exact
    visual treatment spec 002 already established for Docker's `STOPPED`/
    `ERROR` labels; an `ERROR`-state local source's tooltip shows accurate
    error detail. `kind: "file"` upload rows remain unchanged (error still
    surfaces only via tooltip, per spec 002's explicit scoping).
13. A local source row's hover/focus tooltip shows its resolved absolute
    target path (and, when applicable, "configured via traceriver.json" or
    its `WAITING`/`STOPPED` detail text per § Components & states' exact
    format rules); this has no effect on the collapsed row's fixed layout
    or width. Verified by design review against rendered evidence.
14. When `discovery.enabled` is `false`: no `discovery` WS message is ever
    sent to any client, no Environment section renders, no Files-section
    framework notes render, no `kind: "local"` `SourceDescriptor` is ever
    produced from auto-discovery (explicit `watch` entries still work
    unaffected — see AC 6), and `GET /api/discovery` returns
    `{ "enabled": false, "frameworks": [] }`.
15. When `discovery.enabled` is `true` and zero environment-level detectors
    match (any non-macOS platform, or a Mac with none of Herd/Valet/
    Homebrew installed), no **Environment** section header renders at all —
    confirmed by the product owner, see § Open Questions #1.
16. The visually-hidden live region announces a **subscribed** local
    source's `pending`→`live` and `live`→`stopped`→`live` transitions at
    most once per transition; an unsubscribed source's lifecycle produces
    no announcement.
17. Every interactive local-source row control (checkbox, visibility
    toggle) is reachable by Tab, shows the `--color-focus-ring` focus
    outline, and is operable via Enter/Space — no keyboard pattern beyond
    what specs 001–002 already establish; the no-target framework note is
    confirmed not focusable (plain static text, no interactive role).
18. No color token used by this spec falls below `design-system.md`'s
    contrast requirements; `WAITING`/`STOPPED`/`ERROR` remain legible and
    distinguishable from ordinary muted text and from each other under
    color vision deficiency simulation, relying on their literal label text
    rather than hue. Verified by design review.
19. Two or more local sources streaming concurrently (e.g. `local:laravel`
    plus a subscribed `herd:*` source) interleave correctly in the unified
    stream in arrival order, with no UI freeze under realistic dev-loop
    volume — scrolling and clicking remain responsive. QA load test.
20. On a path where native filesystem events are unreliable (simulated via
    a network mount or equivalent test harness), the tailer's polling
    fallback continues delivering new lines with no user-visible difference
    in row behavior — no special UI state renders for the fallback, per
    § Interaction specs' "no UI surface at all" rule. QA/backend-owned.
21. `GET /api/discovery` returns the same `frameworks` content currently
    reflected by the most recent WS `discovery` message (or the
    `enabled: false` shape when discovery is off). QA/backend-owned.

## Design tokens used

See [`design-system.md`](../design-system.md) — this spec introduces one
new icon (`IconInfo`, added to the Iconography section) and no new color/
spacing/type/radius tokens; every other value referenced above is one
already defined there.

---

## Decisions

Recorded for traceability, same spirit as spec 002's Decisions log.

1. **`kind: "local"` reuses `IconFile`, not a new icon.** Spec 002's own
   wireframe already rendered `local:laravel` with the generic file icon
   (📄) alongside uploaded files — this spec continues that precedent
   rather than inventing a "discovered file" vs. "uploaded file" icon
   distinction the phase doc never asked for.
2. **`SourceState` gains one new value, `"pending"`, rather than deriving
   "waiting for file" purely from existing fields.** An earlier draft of
   this spec tried to derive `WAITING` vs. `STOPPED` client-side from
   `subscribed` alone (unsubscribed+stopped → WAITING, subscribed+stopped →
   STOPPED) — but that breaks the moment a user manually pre-checks a
   still-pending source's checkbox (allowed, since the checkbox is never
   disabled while pending): it would incorrectly read as `STOPPED` (implying
   the source was once live and died) instead of `WAITING` (accurate: never
   started). A real fourth `SourceState` value avoids the ambiguity at the
   cost of one small, additive wire-contract change.
3. **Local-source subscription is per-connection (like files), not
   server-global (like Docker).** A local file's bytes are always fully
   ingested regardless of any client's interest — unlike a Docker container
   log stream, there's no expensive daemon-side attachment to avoid opening.
   `subscribed` therefore behaves exactly like spec 001's file model, with
   one explicit exception (environment sources default unsubscribed on
   every fresh connection, not just the first) — see § API contract's WS
   message section for the precise carve-out.
4. **Auto-subscribe fires once, on first discovery of a source, and is
   never a standing override of an explicit unsubscribe.** Modeled directly
   on spec 002's restart re-attach rule ("if it was subscribed... no user
   action required") — re-attachment/re-appearance always respects the
   *current* subscription state rather than forcing it back to a default.
5. **RESOLVED 2026-07-20 by the product owner** (backend-developer flagged a
   self-contradiction between an earlier draft's summary prose/this decision
   and the § Interaction specs defaults table it was supposed to be
   describing): **a pending project/config source starts UNCHECKED
   (`subscribed: false`, `WAITING` label) even though it's headed for
   zero-config tailing** — it earns `subscribed: true` automatically, but
   only via a **one-time** auto-subscribe flip on its first-ever
   `pending`→`live` transition (the moment its target file is created),
   never on a later `stopped`→`live` reappearance, and never overriding a
   connection that had already explicitly unsubscribed while the source was
   still pending. A project/config source whose file already exists at
   startup skips the pending state entirely and starts `subscribed: true`
   directly. Environment sources always start — and remain, on every
   transition — `subscribed: false` regardless of file state; this is the
   phase doc's explicit, stated distinction ("environment logs are noisy and
   shared across projects; the user opts in per session"), unaffected by
   this resolution. **Ruling: the § Interaction specs defaults table was
   correct as originally built** — the surrounding prose and this decision
   entry were the parts that needed to be brought into line with it, not the
   reverse; table, wireframes, and acceptance criteria were already
   consistent and required no changes.
6. **No toast on a local source's first `pending`→`live` transition.**
   Unlike Docker's mid-session daemon-recovery toast (a rare, session-wide
   event), a local source going live can happen routinely in a normal dev
   loop (restarting a dev server that truncates/recreates its log) — a
   toast per occurrence would be noisy. The sidebar's own visual state
   change (checkbox flip, dimming lift, `WAITING` label disappearing) is
   sufficient feedback, consistent with spec 002's "silence is the correct
   behavior for the common case" precedent.

## Open Questions

None outstanding. One question was raised during design and has since been
**answered by the product owner**; recorded here for traceability, same
convention as spec 002's settled Decisions/Open Questions split.

1. **RESOLVED 2026-07-20 by the product owner: omit the Environment section
   entirely when zero environment-level sources are discovered.** Raised
   because this is a genuine tradeoff between two patterns already
   established in this codebase:
   - **Containers' pattern** (spec 002): the section is gated purely on the
     *feature flag* (`docker.enabled`), not on item count — even "Docker not
     installed" gets a persistent, explained card, because Docker is a
     cross-platform capability every user might reasonably expect to work,
     and its absence is diagnostic, actionable information.
   - **Environment's pattern (chosen)**: gated on the feature flag *and* on
     finding something, because on Windows/Linux (the majority of
     TraceRiver's potential install base, given Herd/Valet/Homebrew-nginx
     are all macOS-specific) an eternally-empty "Environment: nothing found"
     section would be permanent, uninformative sidebar chrome for most
     users — there's no "problem" to diagnose the way "Docker isn't
     running" is a problem; it's simply not applicable.

   **Confirmed as final, matching this spec's recommended default as
   written** — see § Layout's "nothing detected" wireframe, § Components &
   states' Environment gating rule, and acceptance criterion 15. This sets
   precedent for how future "may not apply to this platform/setup" sidebar
   sections should behave: omit-when-empty, not always-show-diagnostic,
   unless a future case argues otherwise on its own merits.

---

ARTIFACTS WRITTEN: docs/specs/003-phase-3-auto-discovery.md, docs/design-system.md
STATUS: ready-for-dev
OPEN QUESTIONS: none
