# 002 — Phase 2: Docker Streams

Status: ready-for-dev
Depth: Tier 3 (full spec)
Source: [`docs/phases/phase-2-docker.md`](../phases/phase-2-docker.md)
Extends: [`docs/specs/001-phase-1-core-console.md`](001-phase-1-core-console.md)

## Overview

Phase 1 shipped one source kind: uploaded files. Phase 2 adds a second,
live-by-nature kind: running Docker containers in the user's local compose
project. After this phase, starting `traceriver start` inside a compose
project (the product owner's own reference case is a Laravel app,
`street_bites`, run via `docker compose`) shows that project's containers in
the sidebar as checkboxes; checking one attaches a live log stream (tail +
follow) that flows through the same Uniform Parser Pipeline and unified
stream phase 1 already built. Containers outside the current project stay
hidden behind a "Show all containers" toggle. Docker daemon problems (not
installed, not running, permission denied) degrade gracefully — a dismissible
sidebar card explains the problem and the tool keeps working for files —
rather than crashing or spamming retries.

This spec extends, and does not replace, spec 001: the top bar, unified
stream, row expansion, search/filtering, Freeze/Clear, and file-upload
behavior are all unchanged. Everything below is additive to the sidebar and
to the WS/REST contract.

**Explicitly out of scope for phase 2** (do not build):
- Local file tailing / auto-discovery (`kind: "local"`) — phase 3.
- Any write/exec/create access to the Docker daemon — read-only by
  construction (`architecture.md` § Security model); the wrapper exposes
  only `listContainers`, `inspect`, `logs`, `getEvents`.
- A manual "rescan containers" button — discovery is event-driven (Docker
  events API), not polled, except for the daemon-*connectivity* poll
  described below, which is a different thing (see § Docker daemon status).
- Any change to file-source behavior, the top bar, or the unified stream's
  visual grammar.

## User flow

1. User runs `traceriver start` from `street_bites/` (a Docker Compose
   project directory with, say, `app`, `nginx`, and `mysql` services
   running). The server resolves the Docker socket (`DOCKER_HOST` → platform
   default → Podman fallback), lists running containers, and filters to
   those whose compose project matches the working directory.
2. Console loads: the sidebar's **Containers** section shows `docker:app`,
   `docker:nginx`, `docker:mysql` — each unchecked, entry count 0. No log
   stream has been opened for any of them yet.
3. User checks `docker:nginx`. The server attaches (`tail: 50, follow:
   true`), demultiplexes stdout/stderr if the container has no TTY, and
   starts feeding parsed entries into the shared ring buffer. Entries appear
   in the unified stream within one broadcast interval, tagged
   `[docker:nginx]`, exactly like a file source's rows.
4. User checks `docker:mysql` too. Both containers now stream concurrently,
   each with its own parser-detection state (per-source stickiness, as
   already true for files).
5. User runs `docker restart nginx` in a terminal. The sidebar row for
   `docker:nginx` shows **STOPPED** briefly, then returns to normal as the
   container comes back; the stream shows no duplicate lines across the gap.
6. User's colleague opens a second browser tab pointed at the same session.
   Both tabs show identical checkbox states and identical streams for the
   Docker sources — subscription is shared server-side state, not a
   per-tab preference (see § Interaction specs — this is the one place
   phase 2 deviates from phase 1's per-connection subscribe model, and the
   deviation is deliberate, confirmed by the product owner — see Decisions).
7. User clicks "Show all containers." Every other container running on the
   machine (a `redis` from an unrelated project, say) now appears in the
   sidebar too, unchecked, costing nothing until subscribed.
8. On a machine with no Docker running at all, the Containers section shows
   a dismissible "Docker not detected" card instead of any rows; file upload
   continues to work exactly as in phase 1.

## Layout

The sidebar's structure changes; nothing else in spec 001's layout changes.
When Docker is enabled (the default — see § API contract, `docker.enabled`),
the sidebar's source list splits into two labeled sections, **Containers**
and **Files**, instead of phase 1's single flat list. When Docker is
disabled entirely (`docker.enabled: false`), the sidebar renders exactly as
in phase 1 — no sections, no card, flat list — because the server never
emits any Docker-related message in that configuration.

### Wireframe — default state (mixed sources, one container stopped)

```
┌ Sidebar ──────────────────────────────────┐
│ LOG SOURCES                               │
│                                            │
│ CONTAINERS          Show all containers ○ │
│ ☑ 🐳 docker:nginx           980  ⬤─       │
│ ☑ 🐳 docker:mysql           142  ⬤─       │
│    STOPPED                                │
│ ☐ 🐳 docker:app               0  ○        │
│                                            │
│ FILES                                     │
│ ☑ 📄 local:laravel           12  ⬤─       │
│ ☐ 📄 File: dump.log            0  ○        │
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

`STOPPED` renders as a second line beneath the source label (`--font-size-xs`,
uppercase, `--letter-spacing-label`, `--color-text-muted`) — see § Components
& states. The "Show all containers" control is a small pill switch (same
visual language as the per-source visibility toggle) with its label to the
left, right-aligned in the **CONTAINERS** section header row.

### Wireframe — Docker status card (not detected / not running / permission denied)

Replaces the container rows entirely; the section header and its toggle are
omitted while a card is showing (there is nothing to toggle).

```
CONTAINERS
┌ ──────────────────────────────────────── ┐
│ 🐳 Docker not detected                 × │
│ Install Docker Desktop, or start your    │
│ daemon, to see this project's            │
│ containers here.                         │
│ Retrying automatically…                  │
└ ──────────────────────────────────────── ┘
```

```
CONTAINERS
┌ ──────────────────────────────────────── ┐
│ ⚠ Permission denied                    × │
│ TraceRiver can't access the Docker       │
│ socket. <backend-supplied detail, e.g.   │
│ "add your user to the docker group and   │
│ re-login">                               │
│ Retrying automatically…                  │
└ ──────────────────────────────────────── ┘
```

Card container: `--color-surface-row-expanded-panel` background,
`--color-border` 1px border, `--radius-md`, `--space-3` padding. The
"permission denied" variant only additionally uses `--color-level-warn` for
its leading icon and left accent (a real problem needing user action,
distinguished from the neutral "not detected"/"not running" copy by an icon
change **and** the "Permission denied" heading text itself — never color
alone). Dismiss control: `IconX`, top-right, `aria-label="Dismiss Docker
status message"`.

### Wireframe — empty Containers section (connected, zero matches)

```
CONTAINERS          Show all containers ○
No containers found in this project.
```

Muted (`--color-text-muted`, `--font-size-sm`), no icon. The existing
"Show all containers" toggle in the header is the discoverability path back
to the rest of the machine's containers — no duplicate inline action.

### Wireframe — Containers section, loading

Before the first `dockerStatus` message has arrived (a very short window in
practice):

```
CONTAINERS
Checking Docker…
```

## Components & states

### Sidebar sections

- Header hierarchy: `LOG SOURCES` (existing `--font-size-lg` section header)
  stays; **Containers** and **Files** become sub-section headers directly
  below it, `--font-size-xs`, `--font-weight-bold`, uppercase,
  `--letter-spacing-label`, `--color-text-muted` (visually subordinate to the
  main header, same family of tokens, no new token). Rendered as
  `<h3>` inside a `<section aria-labelledby="…">` (see § Accessibility).
- **Files** section is the exact same row/list rendering spec 001 already
  defines for file sources — unchanged. It is only ever *labeled*
  differently (a header above it); nothing about a file row's markup,
  states, or interactions changes.
- Both sections only appear when Docker is enabled server-side (see below).
  If Docker is enabled but zero sources of either kind exist yet (fresh
  start, nothing uploaded, no containers matched), each section shows its
  own empty copy ("No containers found in this project." /
  "(no files yet)") rather than the single flat "(no sources yet)" phase 1
  used — the flat empty copy is retained only for the `docker.enabled: false`
  case, matching phase 1 exactly.

### Docker status card

Four states, driven by the `dockerStatus` WS message (see § API contract):

| Status | Heading | Body copy | Icon/accent |
|---|---|---|---|
| `not_installed` | "Docker not detected" | "Install Docker Desktop, or start your daemon, to see this project's containers here." | `IconDocker`, `--color-text-muted` |
| `not_running` | "Docker not running" | "Start Docker to see this project's containers." | `IconDocker`, `--color-text-muted` |
| `permission_denied` | "Permission denied" | "TraceRiver can't access the Docker socket." + the server's `detail` string appended (platform-specific fix text, e.g. the `docker` group instruction on Linux) | `IconDocker`, `--color-level-warn` accent |
| `connected` | *(no card)* | — | — |

Every card variant ends with a fixed line, "Retrying automatically…" — this
is the user-facing expression of the 10 s daemon-availability poll; it
communicates that the tool isn't stuck without implying a spinner or
progress bar (there's nothing else to show).

- **Dismissal**: clicking `×` hides the card for the remainder of the
  session **for that specific status value**. If the status later changes
  to a *different* failure value (e.g. `not_running` → `permission_denied`),
  the card reappears with the new copy — that's a materially different
  problem the user hasn't seen guidance for yet. Dismissal state is
  client-local (not persisted, not sent to the server); a page refresh shows
  the card again if the problem persists.
- **Auto-recovery**: when status transitions from any failure value to
  `connected` (mid-session — not on a normal, always-worked-fine initial
  connect), the card disappears immediately, the Containers section
  populates with whatever the server just discovered, and a transient toast
  "Docker connected — `<n>` container(s) found" shows (`--z-toast`, ~2 s
  auto-dismiss, same pattern as the existing "Logs cleared" toast). No card
  and no toast render on a normal startup where Docker was reachable from
  the first `dockerStatus` message — silence is the correct behavior for the
  common case.
- The card is **never shown as a blocking modal** — it lives inline in the
  sidebar's Containers section; the rest of the console (file upload,
  existing sources, the unified stream) is fully usable while it's showing.

### Container source row

Reuses spec 001's `SourceRow` exactly (checkbox — kind icon — label — entry
count — visibility toggle), with one addition:

- **State label**: when a docker source's `state` is `"stopped"` or
  `"error"` (not `"live"`), a second line renders beneath the label:
  `STOPPED` or `ERROR`, `--font-size-xs`, uppercase, `--letter-spacing-label`,
  color `--color-text-muted` for `STOPPED`, `--color-level-error` for
  `ERROR`. This is real text content, not a color-only signal, and it is
  scoped to docker sources only — file-source rows are unchanged from spec
  001 (their `error` state still surfaces only via the existing hover
  tooltip); introducing a second visual treatment for the same field on
  files is out of scope for this spec.
- **Tooltip**: the row's `title` attribute (already used in spec 001 for a
  file's error detail) is extended for docker sources to also show image and
  compose metadata when present: `"<image> · <composeProject>/<composeService>"`.
  This has no effect on the collapsed row's fixed layout/width.
- **Unsubscribed dimming** (checkbox off → ~55% opacity, toggle disabled)
  behaves exactly as spec 001 describes — orthogonal to the state label
  above. A `stopped`-but-still-subscribed container is *not* dimmed (it's an
  active source with retained history, not a disabled one).
- **Checked but count frozen while unsubscribed**: identical rule to phase
  1 — while unchecked, the client freezes the displayed count rather than
  tracking the server's live value (spec 001's store already implements
  this generically per `SourceDescriptor.subscribed`).

### "Show all containers" toggle

- Same visual component as a source row's visibility toggle (pill switch,
  `--toggle-width`/`--toggle-height`/`--toggle-thumb-size`,
  `--color-accent-interactive` when on), with a text label
  (`--font-size-xs`, `--color-text-muted`) to its left reading "Show all
  containers." `role="switch" aria-checked aria-label="Show all containers"`.
- **Purely client-side render filter** — flipping it never sends anything to
  the server. The server always includes every discovered container
  (subject to `docker.include`/`docker.exclude`) in the `sources` list,
  tagged `docker.inCurrentProject`; the sidebar simply omits
  non-matching container rows from render when the toggle is off. This
  keeps the toggle instantaneous and matches the existing "filtering is
  client-side, no server round trip" principle already established for
  search and level chips.
- **Initial default**: comes from the resolved `docker.allContainers` config
  value / `--all-containers` flag, delivered via `GET /api/status`'s new
  `dockerAllContainersDefault` field (fetched once on mount, same call the
  client already makes for `bufferCapacity`). Not persisted beyond the page
  session — a refresh resets to the config default, consistent with how
  search text and level-chip state aren't persisted either.
- When on, containers are shown in the same single sort order as always
  (oldest `createdAt` first) — the spec does not require a further
  "this project" / "other projects" sub-grouping once revealed; keeping it a
  flat list once toggled avoids a third layout tier for a rarely-used view.

## Interaction specs

### Docker subscription is global, not per-connection

Spec 001 established `subscribe`/`unsubscribe` as **per-connection** filters
for file sources — a file's entries are always fully ingested regardless of
any client's interest; the WS messages only gate delivery to that one
socket. Docker containers are different: `phase-2-docker.md` § 2.2 states
discovered-but-unsubscribed containers must cost nothing (no stream opened),
and § 2.4 states unsubscribing "destroys the log stream... no orphaned
connections accumulating against the daemon." Both statements only make
sense if there is exactly **one** underlying `container.logs()` attachment
per subscribed container, shared by every connected client — not one per
connection.

**Confirmed by the product owner: global, not per-connection** (see
Decisions below). For `kind: "docker"` sources, `subscribed` is
**server-global** state on the `SourceDescriptor` itself, not a
per-connection delivery flag. A `subscribe`/`unsubscribe` message for a
`docker:<name>` source id, sent by *any* connected client, flips the shared
flag, starts or destroys the actual container log stream, and is broadcast
to *every* connected client via `sources`/`sourceState` — exactly like
`{ type: "cleared" }` is already broadcast to every tab regardless of which
tab clicked Clear Logs. No new message shapes are needed — the existing
`{ type: "subscribe" | "unsubscribe", sourceIds }` shapes are reused; only
their *effect* differs by source kind.

Practical consequence worth calling out explicitly so it isn't "fixed" later
as a bug: if tab A unsubscribes from `docker:mysql`, tab B's checkbox for
that source also flips to unchecked and tab B stops receiving new entries
for it too — this is intentional and confirmed, not an accident of
implementation (see Decisions).

### Subscribing / unsubscribing a container

- Checking the box: optimistic UI update (checkbox flips immediately,
  matching phase 1's existing pattern for files) + `subscribe` sent; the
  authoritative `sources`/`sourceState` broadcast that follows (arriving in
  well under a second) is what every tab, including the initiator,
  ultimately renders from.
- Unchecking the box: same shape, `unsubscribe`; server destroys the stream;
  entry count freezes at its last value in every tab.
- No confirmation dialog on unsubscribe (same "fast, local, low-stakes"
  philosophy as Clear Logs in spec 001) — even though it can affect other
  open tabs, so does Clear Logs already, and that precedent stands.

### Container lifecycle (start / stop / restart / rename)

- **Stop** (container exits while subscribed): stream ends naturally; the
  server marks the source `stopped` (`sourceState` broadcast); the sidebar
  row stays, gains the `STOPPED` state label, and its history remains in the
  unified stream. The checkbox stays checked — it's still "subscribed," just
  dormant.
- **Restart** (container comes back with the same name): if it was
  subscribed, the server re-attaches automatically (fresh `tail` from the
  new attach point, not from the beginning, so no duplicate lines); the
  source flips back to `live`. No user action required, no re-check of the
  box.
- **New container appears** (matches the project filter, wasn't previously
  discovered): a new row appears live, unchecked, entry count 0 — identical
  presentation to any other freshly discovered container.
- **Rename** (Docker `rename` event): **confirmed by the product owner** —
  treated with no special case. The old `docker:<oldname>` source settles to
  `stopped` permanently (its container object is gone) with its history
  intact, exactly as a normal stop; the new name is discovered as a
  brand-new source under `docker:<newname>`, unchecked, entry count 0, with
  no subscription or history transplant from the old id. A user who was
  actively watching a container that gets renamed needs to re-check the box
  under its new name.
- **Daemon events-stream reconnect** (the events subscription itself drops,
  e.g. daemon restart): handled entirely server-side with backoff and a
  re-list-to-resync step; this is **transparent to the UI** — no card, no
  toast, no additional state. It only becomes user-visible if the
  underlying daemon connectivity itself is actually lost long enough to trip
  the `dockerStatus` poll (see below), at which point the normal status-card
  flow takes over.

### Docker daemon status polling

- The 10 s gentle recovery poll (phase doc § 2.1) applies uniformly to all
  three failure statuses (`not_installed`, `not_running`,
  `permission_denied`) — the same "Retrying automatically…" copy and
  behavior regardless of which failure is showing.
- The poll is entirely server-side; the client does nothing but listen for
  `dockerStatus` broadcasts. There is no client-side polling of
  `GET /api/docker/status`.

## API contract

All shapes align with the existing `TraceRiverLog`/`SourceDescriptor`/WS
message contract from spec 001 and `src/shared/types.ts`. This section is
purely additive — nothing below removes or changes an existing field or
message shape.

### `SourceDescriptor` — new optional field

```ts
export interface SourceDescriptor {
  // ...all existing fields unchanged (id, kind, label, subscribed, visible,
  // entryCount, state, detail, createdAt)...

  /**
   * Present only when kind === "docker". Metadata for the sidebar tooltip
   * and the project-filter default. `inCurrentProject` drives which rows
   * the sidebar shows when "Show all containers" is off — see spec 002
   * § Interaction specs. The server includes every discovered container
   * (post include/exclude filtering) regardless of this value; the
   * project filter is a client-side render decision, not a discovery-time
   * exclusion, because discovered-but-unsubscribed containers cost nothing.
   */
  docker?: {
    image: string;
    composeProject: string | null;
    composeService: string | null;
    inCurrentProject: boolean;
  };
}
```

`kind: "docker"` sources use the existing `id` convention
(`docker:<container-name>`, leading slash from the Docker API stripped) and
the existing three-value `state` enum unchanged (`"live" | "stopped" |
"error"`) — no new state values are needed; a container's natural lifecycle
maps onto them exactly (`live` while attached and streaming, `stopped` once
its container exits, `error` if attaching/demuxing itself fails).

**Default values for a newly discovered docker source**: `subscribed:
false`, `visible: true`, `entryCount: 0`, `state: "live"` (it's running,
just not yet attached), `detail: null` — this differs from a freshly
uploaded file (`subscribed: true`), matching the phase doc's "no stream
opened until subscribed" requirement.

### `DockerStatus` — new type + WS message

```ts
export type DockerStatus = "not_installed" | "not_running" | "permission_denied" | "connected";
```

Added to the server→client union:

```ts
export type ServerToClientMessage =
  | { type: "entries"; entries: TraceRiverLog[] }
  | { type: "sources"; sources: SourceDescriptor[] }
  | { type: "sourceState"; id: string; state: SourceState; detail?: string | null }
  | { type: "dropped"; count: number }
  | { type: "cleared" }
  | { type: "dockerStatus"; status: DockerStatus; detail: string | null };   // NEW
```

`detail` carries the permission-denied guidance text (platform-specific,
e.g. the socket path and the fix); `null` for `not_installed`, `not_running`,
and `connected`.

**No new client→server message is needed.** The existing
`ClientToServerMessage` union (`subscribe`, `unsubscribe`, `clear`) already
generalizes to any source id, including `docker:<name>` — only the
server-side *effect* of subscribe/unsubscribe differs by source kind (see
§ Interaction specs).

### WS connection sequence (extended)

On successful `/ws` connect, the server sends, in order:

1. Zero or more `{ type: "entries", ... }` batches (ring buffer replay) —
   unchanged from spec 001.
2. One `{ type: "sources", sources: SourceDescriptor[] }` — now may include
   `kind: "docker"` entries.
3. **One `{ type: "dockerStatus", status, detail }`** (NEW) reflecting the
   current daemon connectivity state. If Docker is disabled
   (`docker.enabled: false`), this message is never sent at all — its
   absence is how the client knows to render the phase-1 flat sidebar (see
   § Components & states).
4. Live traffic from then on: `entries`, `sources` (broadcast on any
   container discovered/removed/subscribed/unsubscribed or metadata
   change), `sourceState` (any docker source's live/stopped/error
   transition), `dropped`, `cleared`, and `dockerStatus` (broadcast whenever
   daemon connectivity status changes, in either direction).

### REST endpoints — additions

**`GET /api/docker/status`** → `{ "status": DockerStatus, "detail": string | null }`
Convenience mirror of the WS-pushed value, for the same reason
`GET /api/sources` exists alongside the WS `sources` push (non-WS tooling,
traceability with the phase doc's explicit requirement).

**`GET /api/status`** — extended response shape:

```json
{
  "version": "0.2.0",
  "port": 7580,
  "bufferCapacity": 50000,
  "bufferUsed": 1834,
  "uptimeMs": 42000,
  "dockerAllContainersDefault": false
}
```

`dockerAllContainersDefault` (NEW) reflects the resolved
`docker.allContainers` config / `--all-containers` flag and initializes the
sidebar's "Show all containers" toggle on first load (see § Interaction
specs). All other fields unchanged from spec 001.

No changes to `POST /api/upload`, `GET /api/sources`, or
`GET /api/replay` — their shapes already generalize via `SourceDescriptor`
and `TraceRiverLog`.

### Config surface consumed (already scaffolded, `configuration.md`)

- `docker.enabled` (default `true`) — when `false`, the server runs with no
  Docker integration at all: no socket connection attempted, no
  `dockerStatus` message ever sent, no docker `SourceDescriptor`s ever
  created. This is the mechanism behind the phase-1-identical fallback
  layout.
- `docker.allContainers` / `--all-containers` — seeds
  `dockerAllContainersDefault` (see above). Does **not** change what the
  server discovers or sends (see "Show all containers" toggle above for
  why) — it only changes the client's default render filter.
- `docker.include` / `docker.exclude` — glob-filtered at discovery time,
  server-side; excluded containers are never sent to any client under any
  toggle state.

## Design tokens used

**No new tokens are introduced by this spec.** Every visual value above is
an existing token from `design-system.md`: `--color-surface-row-expanded-panel`
and `--color-border` (status card surface/border), `--radius-md` (card),
`--color-level-warn` (permission-denied accent), `--color-level-error`
(container ERROR state label), `--color-text-muted` (sub-section headers,
STOPPED label, toggle label, empty-section copy), `--font-size-xs` +
`--letter-spacing-label` (sub-section headers and state labels, reusing the
same treatment spec 001 already defines for "LOG SOURCES"), the existing
toggle/pill tokens (`--toggle-width`/`--toggle-height`/`--toggle-thumb-size`,
`--radius-pill`, `--color-accent-interactive`), `--z-toast` (Docker-connected
toast), and `IconDocker`/`IconX` from the existing hand-authored icon set —
`IconDocker` was already present in `web/src/components/icons.tsx` prior to
this spec, anticipating this phase.

## Accessibility requirements

Everything in spec 001's accessibility section still applies unchanged. This
phase adds:

- **Landmarks**: when Docker is enabled, the sidebar's source list is split
  into `<section aria-labelledby="containers-heading">` and `<section
  aria-labelledby="files-heading">`, each with a real `<h3>` heading (visually
  styled per § Components & states) — not just a styled `<div>`, so screen
  reader users get the same two-group structure sighted users see. When
  Docker is disabled, the markup reverts to spec 001's flat `<ul>` with no
  sub-sections.
- **Live region strategy** (extends spec 001's single visually-hidden
  `aria-live="polite"` status region — still one region, still discrete
  state changes only, never per-entry or per-poll-tick):
  - "Docker connected — `<n>` container(s) found" (only on recovery
    transition, not on a normal first connect).
  - "Docker not detected." / "Docker not running." / "Docker permission
    denied." (on transition *into* a failure status — announced once per
    transition, not repeated every 10 s poll tick).
  - "`<source label>` stopped." / "`<source label>` restarted." (on a
    *subscribed* docker source's live↔stopped transition only — an
    unsubscribed container's lifecycle isn't announced, since the user isn't
    watching it).
- **Keyboard**: the "Show all containers" toggle and the status card's
  dismiss button are both real, Tab-reachable, native `<button>` controls,
  operable via Enter/Space, and show `--color-focus-ring` — no new keyboard
  patterns beyond what spec 001 already establishes for the visibility
  toggle and the "×" affordance pattern (search's clear button).
- **Text, never color alone**: `STOPPED`/`ERROR` state labels are real text,
  not color-coded dots; the permission-denied card is distinguished from the
  other two failure cards by its heading text and icon, not by its accent
  color alone.
- **Reduced motion**: the status card's dismiss and the toast's
  appear/dismiss both respect `prefers-reduced-motion: reduce` per spec
  001's existing rule — no new transition is introduced beyond what
  `--motion-fast` already covers for existing toasts/toggles.

## Acceptance criteria

Numbered and individually testable; each maps to a `phase-2-docker.md` exit
criterion where noted. Items marked QA/backend-owned are listed here for
traceability per the phase doc's exit criteria, matching spec 001's
convention.

1. On startup in a compose project with ≥ 3 containers, the sidebar's
   Containers section shows exactly that project's containers (matched by
   `com.docker.compose.project` label against the working directory's
   basename, or the local `compose.yaml`/`docker-compose.yml` `name:` field
   when present) — other projects' containers are absent from the sidebar
   entirely, not merely dimmed, until "Show all containers" is on.
   *(exit: current-project-only default)*
2. Toggling "Show all containers" on immediately reveals every discovered
   container regardless of project match, with no additional network
   request; toggling it off hides non-matching containers again.
   *(exit: all-containers toggle)*
3. `docker.include`/`docker.exclude` glob patterns are applied before any
   container reaches the client — an excluded container never appears in
   the sidebar even with "Show all containers" on. QA/backend-owned.
4. A newly discovered container renders with its checkbox unchecked and
   entry count 0; no entries for it arrive in the unified stream until the
   checkbox is checked. *(exit: discovered-but-unsubscribed costs nothing)*
5. Checking a container's checkbox sends
   `{ type: "subscribe", sourceIds: ["docker:<name>"] }`; the server
   attaches with `tail: 50`, and both the sidebar's entry count and the
   unified stream reflect that container's output within one broadcast
   interval. A second, independently connected browser tab shows the same
   checkbox flip to checked and the same entries arriving, confirming
   subscription is shared server-side state, not per-tab.
   *(exit: checkbox subscription model)*
6. Unchecking a subscribed container's checkbox sends `unsubscribe`; the
   server destroys that container's log stream (verified by the daemon's
   active-stream/connection count returning to its pre-subscribe baseline,
   QA/backend-owned); its entry count stops climbing in every connected
   tab, not just the initiating one.
7. A non-TTY container (e.g. `mysql`) and a TTY container (run with `tty:
   true`) both stream correctly: non-TTY stdout/stderr frames are
   demultiplexed with no binary garbage in any rendered row; TTY output
   renders as plain text without corruption; stderr lines from the non-TTY
   container that lack their own level are floored to WARN. QA-owned.
   *(exit: TTY vs. non-TTY handling verified with one of each)*
8. `docker restart <svc>` on a subscribed container: its sidebar row
   transitions `live` → `stopped` (showing the `STOPPED` state label) →
   `live` again automatically, with no user action; the stream shows no
   duplicated lines across the restart boundary; the daemon's active
   stream/connection count returns to its pre-restart value.
   *(exit: restart re-attach, no duplicates, no zombie streams)*
9. Stopping a subscribed container without restarting it keeps its sidebar
   row visible (not removed) with accumulated history intact in the stream;
   the row shows `STOPPED`; the checkbox remains checked.
   *(exit: stopped sources stay visible with history)*
10. With no Docker daemon reachable at all (binary absent / no socket at any
    resolved path), the Containers section shows the "Docker not detected"
    card with its dismiss control; file upload and any existing sources
    continue to work normally; the process does not crash.
    *(exit: not-installed guidance, no crash)*
11. With a Docker installation present but the daemon not running, the
    Containers section shows the "Docker not running" card; once the daemon
    is started, the card disappears and the section populates automatically
    within the ~10 s poll interval, with no page refresh needed.
    *(exit: not-running guidance + auto-recovery)*
12. With a Docker socket present but inaccessible (permission denied), the
    Containers section shows the "Permission denied" card including the
    backend-supplied `detail` guidance text; dismissing it hides the card
    until the status changes to a different value.
    *(exit: permission-denied guidance)*
13. Dismissing a Docker status card hides only that card, for that specific
    status value, for the rest of the session; it reappears immediately if
    the status subsequently changes to a *different* failure value, and
    unconditionally on the next page load.
14. A container emitting ~5,000 lines/sec while subscribed does not freeze
    the browser tab — scrolling and clicking stay responsive throughout —
    and the ring buffer's eviction keeps server memory bounded (the
    "Showing last 50,000 entries" notice appears once eviction begins).
    QA-owned load test. *(exit: 5k lines/sec doesn't freeze UI, memory
    bounded)*
15. The console functions equivalently against Docker Desktop on macOS,
    Docker Desktop's named pipe on Windows, and a native Linux Docker
    socket — discovery, subscription, and streaming all succeed on each.
    QA/backend-owned. *(exit: cross-platform socket support)*
16. Socket resolution follows the documented order: `DOCKER_HOST` (if set)
    takes precedence over the platform default; when neither resolves a
    reachable daemon, the Podman-compatible socket is tried as a best-effort
    fallback. QA/backend-owned.
17. A container row's hover/focus tooltip shows its image and compose
    project/service metadata; this has no effect on the collapsed row's
    fixed layout or width. Verified by design review against rendered
    evidence.
18. When `docker.enabled` is `false`, the sidebar renders exactly as in
    phase 1 — no Containers/Files sub-headers, no status card, flat single
    list, no `dockerStatus` message ever received — confirming the feature
    is fully inert when turned off.
19. The "Show all containers" toggle and the status card's dismiss button
    are both reachable by Tab, show the `--color-focus-ring` focus outline,
    and are operable via Enter/Space; the visually-hidden live region
    announces Docker status transitions and per-subscribed-container
    stopped/restarted transitions at most once per transition, never per
    poll tick.
20. No color token introduced or reused by this spec falls below the
    contrast requirements recorded in `design-system.md`; the `STOPPED` and
    `ERROR` state labels remain legible and distinguishable from each other
    and from ordinary muted text with color vision deficiency simulated
    (relies on the text label itself, not hue). Verified by design review.
21. `GET /api/docker/status` returns the same status value currently
    reflected by the most recent WS `dockerStatus` message;
    `GET /api/status`'s `dockerAllContainersDefault` matches the resolved
    `docker.allContainers`/`--all-containers` configuration and correctly
    initializes the sidebar toggle's default state on first load.
    QA/backend-owned.

## Design tokens used

See [`design-system.md`](../design-system.md) — as noted above, this spec
introduces no new tokens; every value referenced is one already defined
there.

---

## Decisions (confirmed by the product owner)

Recorded for traceability, same spirit as spec 001's Decisions log. The two
below were raised as open questions during design and have since been
**confirmed by the product owner** — both are settled contract, not pending
decisions; devs should treat them as final, not provisional.

1. **"Show all containers" is a client-side render filter, not a
   server-round-trip.** The server always sends every discovered container
   (post include/exclude) tagged `inCurrentProject`; the sidebar decides
   what to render. Justified by "discovered-but-unsubscribed containers
   cost nothing" (phase doc § 2.2) and by the existing precedent that all
   other filtering (search, level chips, source visibility) is client-side.
2. **Sub-section headers ("Containers"/"Files") only appear when Docker is
   enabled at all** (`docker.enabled` default `true`), including the
   not-installed/not-running/permission-denied cases — the phase doc
   explicitly wants the card shown even for users who never intend to use
   Docker sources ("tool keeps working for files" implies the card is
   expected in that scenario, dismissible once). `docker.enabled: false` is
   the actual, explicit opt-out for anyone who wants phase 1's exact layout
   back.
3. **No toast on a normal, always-connected startup** — only on a
   mid-session recovery transition. Showing "Docker connected" every single
   time a healthy Docker install starts up would be noise for the common
   case; the phase doc frames the whole status surface around *failure*
   guidance, not success announcements.
4. **Container rename → new source, no continuity. CONFIRMED by product
   owner.** A `docker rename` event produces a fresh, unsubscribed discovery
   under the new name; the old `docker:<oldname>` source settles to
   `stopped` permanently with its history intact — no subscription/history
   transplant onto the new id. This was raised as an open question (a user
   actively watching a renamed container has to re-check the box under the
   new name) and the product owner confirmed this exact behavior as
   correct. See § Interaction specs → Container lifecycle for the resulting
   spec language.
5. **Docker subscription model is global (server-side), not per-connection.
   CONFIRMED by product owner.** One shared `container.logs()` attachment
   per subscribed container, regardless of how many browser tabs are open;
   `subscribe`/`unsubscribe` for a `docker:<name>` source mutates the shared
   `SourceDescriptor.subscribed` flag and is broadcast to every connected
   client, exactly like `{ type: "cleared" }` already is. This was raised as
   an open question given it's a real behavioral deviation from file
   sources' per-tab subscribe model (one tab's uncheck silently affects
   every other tab's view of that source) and the product owner confirmed
   the global model as intended. See § Interaction specs → "Docker
   subscription is global, not per-connection" for the full rationale and
   consequences, and acceptance criteria 5–6 for the testable contract.

## Open Questions

None. The two items raised during design (container-rename continuity, and
the global vs. per-connection Docker subscription model) have both been
confirmed by the product owner — see Decisions 4 and 5 above. Both are
settled contract as written in this spec.

---

ARTIFACTS WRITTEN: docs/specs/002-phase-2-docker.md
STATUS: ready-for-dev
OPEN QUESTIONS: none
