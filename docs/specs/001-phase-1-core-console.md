# 001 — Phase 1: Core Console

Status: ready-for-dev
Depth: Tier 3 (full spec)
Source: [`docs/phases/phase-1-core.md`](../phases/phase-1-core.md)

## Overview

`traceriver start` boots a local Fastify server bound to `127.0.0.1`, opens a
browser tab at a tokenized URL, and shows a single-screen console: a sidebar
of log sources and a unified, virtualized stream of parsed log entries. In
phase 1 the only source type is an uploaded/dropped file — parsed server-side
by the Uniform Parser Pipeline, streamed to the browser over WebSocket, and
rendered with the terminal-chic theme (near-black background, JetBrains Mono,
neon level colors as the sole carrier of saturated color).

This spec covers the CLI startup surface, the full visual design, the
frontend/backend API contract (REST + WebSocket), accessibility
requirements, and acceptance criteria. It intentionally builds the sidebar
and `SourceDescriptor` shape generically so Docker (phase 2) and
auto-discovered local files (phase 3) slot in without rework.

**Explicitly out of scope for phase 1** (do not build):
- Docker or live local-file sources — sidebar/data model support them
  structurally, but phase 1 only ever produces `kind: "file"` sources.
- The "Generate AI Prompt" affordance (the sparkle/diamond glyph visible in
  the bottom-right corner of the expanded-row example in
  [`assets/traceriver_ui_concept.png`](../../assets/traceriver_ui_concept.png))
  — that's phase 4 (error intelligence, D9: clipboard-only, no network
  calls). The phase-1 expanded row has exactly two actions: nothing else
  should render there.
- Regex search mode, time-range filters — explicitly future work per
  `phase-1-core.md`.
- A sort-by-timestamp toggle — confirmed excluded from phase 1 (product
  owner, see Decisions log below); arrival order only.
- Any responsive/mobile layout — confirmed desktop-only (product owner, see
  Decisions log below).

## User flow

1. User runs `npx traceriver start` from a project directory. CLI resolves
   config → port → generates a session token → starts the server → opens
   `http://127.0.0.1:<port>/?token=<token>` in the default browser.
2. Console loads: empty state (no sources yet) — sidebar shows only the drop
   area, main panel shows a centered "waiting for logs" placeholder.
3. User drags a `.log` file onto the app (anywhere in the viewport, not just
   the small drop-area box) or clicks "Browse" in the sidebar drop area and
   picks a file.
4. Upload begins: the file appears in the sidebar immediately as a new
   source (subscribed + visible by default), with an upload-progress
   indicator. The file streams to the server; the server streams it through
   the parser pipeline and broadcasts parsed entries over the already-open
   WebSocket as they're produced — so entries start appearing in the stream
   panel while the upload is still in flight, not just after it completes.
5. User watches entries accumulate in the unified stream, auto-scrolled to
   the bottom. They can: type in search, toggle level chips, toggle sources,
   click a row with a stack trace to expand it, freeze the stream to read
   without new rows pushing content around, or clear the buffer.
6. User refreshes the browser tab: a new WebSocket connection replays the
   current ring-buffer contents first, so the stream repopulates exactly —
   no re-upload needed.

## Layout

Desktop, single fixed layout: sidebar (`--sidebar-width`, 288px) + main
panel filling the remainder. No column headers row — the format is
self-evident from the row content itself (matches the concept art).

### Wireframe — default state (populated)

```
┌ Sidebar ─────────────────────┬ Top bar (56px) ─────────────────────────────────────────────────┐
│ LOG SOURCES                  │ [⏸ Freeze Stream]  [🗑 Clear Logs]  [🔍 Search logs (e.g., '500…] │
│                               ├ Filter row (36px) ─────────────────────────────────────────────┤
│ ☑ 🐳 docker:mysql    142  ⬤─ │ (DEBUG)(INFO)(WARN)(ERROR)(FATAL)(UNKNOWN)  ← level chips, all on │
│ ☑ 🐳 docker:nginx    980  ⬤─ ├ Unified stream (virtualized) ──────────────────────────────────┤
│ ☑ 📄 local:laravel    12  ⬤─ │▐2026-07-19 15:31:01 [docker:nginx]  | INFO  | GET /api/users - …│
│ ☐ 📄 File: dump.log     0  ○ │▐2026-07-19 15:31:05 [docker:mysql]  | DEBUG | Connection establ…│
│                               │▐2026-07-19 15:31:12 [local:laravel] | WARN  | Deprecation warn…│
│ ─────────────────────────    │▐2026-07-19 15:31:15 [docker:nginx]  | ERROR | 500 INTERNAL SERV…│
│ DROP AREA                    │▐2026-07-19 15:31:16 [docker:nginx]  | INFO  | GET /api/health -…│
│ ┌───────────────────────┐    │ …                                                                │
│ │         ☁              │   │                                                                  │
│ │ Drag & Drop Log File    │   │                                             ┌────────────────┐ │
│ │ (.log .txt .json .jsonl)│   │                                             │   ↓ Live        │ │
│ │      or [Browse]        │   │                                             └────────────────┘ │
│ └───────────────────────┘    │ (shown only once user has scrolled up / unpinned)                │
└───────────────────────────────┴──────────────────────────────────────────────────────────────────┘
```

`▐` = the row's colored left edge (`--row-left-edge-width`, colored per
level). Each source row: checkbox (subscribed) — kind icon — label — entry
count (`--font-size-xs`, `--color-text-muted`) — visibility toggle.

### Wireframe — row expanded

Clicking a row with `multiline: true` or a non-null `context` expands it in
place (virtualization keeps this keyed by entry `id`, not list index).

```
│▐2026-07-19 15:31:15 [docker:nginx]  | ERROR | 500 INTERNAL SERVER ERROR      ^ (chevron, expanded)│
│┌ expanded panel (--color-surface-row-expanded-panel, max-height 420px, internal scroll) ─────────┐│
││ {                                                          [Copy Raw]                            ││
││   "stack_trace": {                                                                                ││
││     "file": "/app/routes/api.php",                                                                ││
││     "line": 42,                                                                                   ││
││     ...                                                                                            ││
││   }                                                                                                ││
││ }                                                                                                  ││
│└────────────────────────────────────────────────────────────────────────────────────────────────┘│
│▐2026-07-19 15:31:16 [docker:nginx]  | INFO  | GET /api/health - 200 OK                            │
```

Panel contents, top to bottom: syntax-highlighted `body` (full multi-line
text — the stack trace / continuation lines), then, if `context` is
non-null, a visually separated "Context" sub-block rendering it as
pretty-printed, syntax-highlighted JSON. "Copy Raw" (copies `entry.raw`
verbatim to the clipboard) sits top-right of the panel. **No other controls
render in this panel in phase 1** (see Overview — the AI-prompt affordance
from the concept art is phase 4).

### Wireframe — drag-over

Drag-over is detected globally (`dragenter` on the window), not just over
the small sidebar drop box — the whole viewport becomes a drop target so
users don't need pixel-perfect aim.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│ ░░                                                                    ░░ │
│ ░░                 ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐                     ░░ │
│ ░░                        ☁  Drop to add source                        ░░ │
│ ░░                 └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘                     ░░ │
│ ░░                                                                    ░░ │
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
└──────────────────────────────────────────────────────────────────────────┘
```

Full-viewport overlay, `--color-bg` at ~85% opacity, large dashed
`--color-accent-interactive` border box centered, `--motion-base` fade
in/out. Releasing the drop anywhere completes the upload; dragging out or
pressing Escape cancels with no state change. `--z-dragover-overlay`.

### Wireframe — empty state (no sources yet)

```
┌ Sidebar ─────────────────────┬───────────────────────────────────────────────────────────────────┐
│ LOG SOURCES                  │  [⏸ Freeze Stream]  [🗑 Clear Logs]  [🔍 Search logs…]  (disabled)  │
│                               ├───────────────────────────────────────────────────────────────────┤
│ (no sources yet)             │                                                                     │
│                               │                          ☁                                         │
│ ─────────────────────────    │              No logs yet — drag a file in, or                      │
│ DROP AREA                    │                  click Browse in the sidebar.                       │
│ ┌───────────────────────┐    │                                                                     │
│ │         ☁              │   │                                                                     │
│ │ Drag & Drop Log File    │   │                                                                     │
│ │ (.log .txt .json .jsonl)│   │                                                                     │
│ │      or [Browse]        │   │                                                                     │
│ └───────────────────────┘    │                                                                     │
└───────────────────────────────┴───────────────────────────────────────────────────────────────────┘
```

Top-bar controls render disabled/inert (dimmed, non-interactive — search has
nothing to search, Freeze/Clear have nothing to act on) until at least one
source exists.

## Components & states

### Top bar (`--topbar-height`, `--color-surface-topbar`)

- **Freeze Stream** button: icon (pause, filled circle) + label. Default
  state label "Freeze Stream". Clicking freezes rendering (see Interaction
  specs) and the button becomes "▶ Resume" with a numeric badge showing
  accumulated new-entry count, e.g. `▶ Resume · 42 new`. Badge uses
  `--font-size-xs`, `--color-accent-interactive` pill, `--radius-pill`.
- **Clear Logs** button: icon (trash) + label. Click immediately sends the
  clear command (no confirmation modal — this is a fast, local, low-stakes
  action; the source data on disk is untouched) and shows a transient toast
  "Logs cleared" (`--z-toast`, auto-dismiss ~2s) as feedback.
- **Search input**: icon (magnifier) + placeholder `Search logs (e.g., '500
  ERROR').`. `--debounce-search` (250ms) after last keystroke before
  filtering. Clears with an inline "×" once non-empty.
- **Level filter chips** (second row, `--filter-row-height`): one pill per
  `LogLevel` value (`DEBUG INFO WARN ERROR FATAL UNKNOWN`), all active by
  default. Active state: filled/tinted background in the level's accent
  color at reduced opacity + full-opacity accent text/border. Inactive:
  `--color-text-muted` outline only. Multi-select toggle, `aria-pressed`.

### Sidebar (`--sidebar-width`, `--color-surface-sidebar`)

- Header: `LOG SOURCES` label (`--font-size-lg`, uppercase, bold,
  `--letter-spacing-label`).
- **Source row** (one per `SourceDescriptor`): kind icon — checkbox
  (subscribed) — label — entry count (`--font-size-xs`,
  `--color-text-muted`, right-aligned before the toggle) — visibility toggle.
  - **Subscribed + visible** (default for a newly added source): full
    opacity, toggle on (filled `--color-accent-interactive`).
  - **Subscribed + hidden** (checkbox on, toggle off): row entries keep
    streaming to the client and the count keeps updating live, but rows from
    this source are excluded from the rendered stream and from search
    matching. Row itself renders at full opacity (it's an active, just
    hidden-from-view source) — only the toggle shows off.
  - **Unsubscribed** (checkbox off): the client sends `unsubscribe` for this
    source id; server stops pushing its entries to this client. The
    visibility toggle becomes **disabled** (shown off, non-interactive —
    there's nothing to show/hide) and the whole row dims to ~55% opacity.
    Re-checking the checkbox sends `subscribe` again and restores the row to
    its last visibility state (default: visible).
- **Drop area** (bottom of sidebar, `--radius-lg`, dashed
  `--color-border-interactive`): cloud-upload icon, "Drag & Drop Log File",
  "(.log .txt .json .jsonl)", "or **Browse**" (the word "Browse" is a real
  button opening the OS file picker, styled as inline text per the concept
  art). On hover/keyboard-focus: border brightens to
  `--color-accent-interactive`. During an active upload: a thin progress bar
  fills the box bottom edge, driven by client-side byte-sent tracking (no
  server round-trip needed for this — see API contract).
- Files over 50 MB trigger a client-side confirm step before the upload
  starts: "This file is 118 MB and will occupy most of the ring buffer —
  continue?" (Continue / Cancel). Files over 500 MB are rejected client-side
  before any bytes are sent, with the same messaging pattern, no
  server round trip: "This file is over the 500 MB limit and can't be
  loaded."

### Unified stream (main panel)

- **Row (collapsed)**, `--row-height-collapsed` (40px), fixed height fed to
  TanStack Virtual: left edge bar (level color) — timestamp
  (`--color-text-muted`) — `[source]` (`--color-text-primary`) — `|
  LEVEL |` (level-colored, uppercase, bold) — message (`--color-text-primary`,
  single line, `text-overflow: ellipsis`, never wraps).
- Rows where `multiline: true` or `context !== null` show a chevron
  affordance (`⌄`, `--color-text-muted`) at the row's right edge on
  hover/focus, indicating they're expandable. Rows without either are not
  interactive (no hover background, no chevron, not focusable as a
  row-button — though still text-selectable).
- **Row (expanded)**: see wireframe above. Height is dynamically measured
  (TanStack Virtual dynamic-size mode) up to `--row-expanded-max-height`
  (420px), beyond which the panel scrolls internally.
- **"↓ Live" jump-back button**: floating, bottom-right of the stream
  viewport, `--z-jump-button`, appears only when the list is unpinned (user
  scrolled up). Clicking scrolls to bottom and re-pins auto-follow. This is
  independent of Freeze (see Interaction specs).
- **Eviction notice**: once the server ring buffer has evicted any entries
  (buffer capacity exceeded), a small persistent label appears at the top of
  the stream panel: `Showing last 50,000 entries` (`--font-size-xs`,
  `--color-text-muted`). Absent otherwise.
- **Dropped-entries toast**: on receiving a `{ type: "dropped", count }` WS
  message, show a transient toast "`<count>` entries dropped — resyncing…"
  and immediately issue a `GET /api/replay?after=<lastKnownId>` call to
  backfill the gap; toast dismisses once the resync completes.
- **Filtered-empty state**: sources exist and have entries, but the active
  search/level/source filters exclude all of them: centered message "No log
  entries match your filters." + a "Clear filters" text action that resets
  search text and re-enables all level chips (source toggles are left
  untouched — those are a deliberate choice, not a "filter" in this sense).

## Interaction specs

### Auto-follow / pinning

- Default: pinned to bottom. Every new rendered entry auto-scrolls the list
  so the newest row is visible.
- Any manual upward scroll unpins immediately. While unpinned, new entries
  still render into the virtualized list (it keeps growing) — the view just
  doesn't auto-scroll to follow them. The "↓ Live" button appears.
- Clicking "↓ Live" (or scrolling all the way to the bottom manually)
  re-pins.

### Freeze Stream

- Distinct from pinning: Freeze stops the visible list from re-rendering at
  all (a snapshot), regardless of scroll position, guaranteeing zero DOM
  churn for performance under high entry volume. Entries keep landing in the
  client store (and server ring buffer) while frozen — nothing is dropped.
- While frozen, the button shows the count of entries received since
  freezing began: `▶ Resume · <n> new`.
- Unfreezing re-renders the list with everything that accumulated, jumps to
  the live tail (bottom), and re-pins auto-follow.

### Row expansion

- Click (or Enter/Space while focused) toggles expand/collapse on rows where
  `multiline: true` or `context !== null`.
- Expansion state is a `Set<entryId>` in the client store, not tied to list
  position/index — scrolling a row out of the virtualized window and back
  preserves its expanded/collapsed state.
- "Copy Raw" copies `entry.raw` (untouched original text) to the clipboard
  and shows a brief inline "Copied" confirmation on the button itself
  (no toast).

### Search & filtering

- Plain-text, case-insensitive substring match over `message`, `body`, and
  `raw` (a match in any one of the three qualifies the entry).
  `--debounce-search` (250ms) after the last keystroke.
- Level chips: multi-select; an entry must have its `level` among the
  currently-active chips.
- Source visibility toggles: an entry's source must be visible (see
  Sidebar states above).
- All three filters intersect (AND): text match ∩ active levels ∩ visible
  sources.
- Filtering is purely client-side over the client store (per phase-1-core.md
  §1.2) — no server round trip per keystroke.

## API contract

All shapes align with `TraceRiverLog` and the WS message shapes already
defined in [`log-schema.md`](../log-schema.md) and
[`architecture.md`](../architecture.md#transport-websocket). This section
adds the concrete pieces those docs leave to be filled in for phase 1:
`SourceDescriptor`, the REST surface, and exact auth mechanics.

### Auth

- The CLI opens `http://127.0.0.1:<port>/?token=<token>`. The static SPA
  shell (`index.html`, JS/CSS bundles) is served **without** a token check —
  it must be, since the token only reaches the browser by being embedded in
  that first URL, and the SPA's JS is what reads it back out. This is safe:
  the shell itself carries no data.
- On load, the SPA reads `token` from the URL query string into an
  in-memory singleton (not `localStorage` — no reason to persist a
  per-run secret to disk). A plain browser refresh still works because the
  token remains in the URL's query string across reload.
- Every `/api/*` REST call sends `Authorization: Bearer <token>`.
- The WS upgrade sends the token as a query param —
  `GET /ws?token=<token>` — because the browser `WebSocket` constructor
  can't set custom request headers. If the token is invalid, the server
  **rejects the upgrade with HTTP 401** before completing the handshake
  (not accept-then-close), so the client can distinguish "bad session" from
  "network hiccup" and show the right error state (see below).
- Host/Origin validation is a backend concern (architecture.md); the
  frontend does nothing special beyond always calling same-origin URLs.

### `SourceDescriptor`

Not fully specified in `architecture.md`/`log-schema.md` beyond "the generic
`SourceDescriptor` shape" — this is the concrete contract for phase 1:

```ts
interface SourceDescriptor {
  /** Namespaced id, matches TraceRiverLog.source exactly, e.g. "file:dump.log". */
  id: string;

  /** Phase 1 only ever produces "file". "docker" / "local" are reserved
   *  for phases 2/3 so the sidebar component needs no rework later. */
  kind: "file" | "docker" | "local";

  /** Display name, e.g. "dump.log" (the id's prefix implies the kind icon;
   *  the label is the part after the colon). */
  label: string;

  /** Checkbox state. Server stops sending this source's entries to a
   *  client that has unsubscribed (see WS protocol below). */
  subscribed: boolean;

  /** Toggle state. Client-side only — does not affect what the server
   *  sends; purely filters rendering. Included here so a fresh page load
   *  / reconnect restores the same visibility a previous tab had... */
  visible: boolean;

  /** Authoritative total as of this message. Phase-1 files are static:
   *  once state moves to "stopped" this number is final. Clients may
   *  optimistically increment their own display count as `entries`
   *  messages tagged with this source arrive, rather than waiting for a
   *  fresh `sources` broadcast. */
  entryCount: number;

  /** "live" while the upload is still streaming/parsing; "stopped" once
   *  parsing is complete (the whole point of a phase-1 file source);
   *  "error" if the upload/parse failed. */
  state: "live" | "stopped" | "error";

  /** Human-readable detail for "error" (and optionally "stopped") states. */
  detail: string | null;

  /** Epoch ms — sidebar sort order (oldest first, matching upload order). */
  createdAt: number;
}
```

### REST endpoints

All require `Authorization: Bearer <token>` unless noted.

**`POST /api/upload?name=<url-encoded filename>`**
Streaming upload. `Content-Type: application/octet-stream`, raw file bytes
as the body (no multipart — multipart parsing would force buffering the
request differently than the pipeline wants; see phase-1-core.md's
streaming requirement). `Content-Length` is used server-side as an
up-front 500 MB hard-cap check where present; for chunked bodies without a
known length, the server tracks running byte count and aborts the
connection if it crosses the cap mid-stream.

Client-side upload progress (the byte-progress bar in the drop area) is
computed entirely client-side from bytes-sent (e.g. `XMLHttpRequest.upload`
progress events) — no server support needed for that part.

Response, `200`, once the body is fully consumed **and** the pipeline's
end-of-stream flush has completed (so `entryCount` in the response is truly
final, not a snapshot mid-parse):

```json
{ "source": { "id": "file:dump.log", "kind": "file", "label": "dump.log",
              "subscribed": true, "visible": true, "entryCount": 4213,
              "state": "stopped", "detail": null, "createdAt": 1752936000000 } }
```

Errors:
- `401 { "error": "unauthorized" }` — missing/bad token.
- `413 { "error": "payload_too_large", "limitBytes": 524288000 }` — over the
  500 MB hard cap.
- `400 { "error": "bad_request", "message": "..." }` — missing/invalid
  `name`, etc.

**`GET /api/sources`** → `{ "sources": SourceDescriptor[] }` — convenience
snapshot; the WS connection already pushes this on connect/change, this
endpoint exists for the phase doc's explicit "source list" requirement and
any non-WS tooling.

**`GET /api/status`** → `{ "version": string, "port": number,
"bufferCapacity": number, "bufferUsed": number, "uptimeMs": number }`.

**`GET /api/replay?after=<id>`** → `{ "entries": TraceRiverLog[] }` —
entries with `id > after`, bounded by what's still in the ring buffer. Used
by the frontend to backfill after a `dropped` notice; the WS connection's
own replay-on-connect (below) is the primary path for a fresh page load.

### WebSocket protocol

`GET /ws?token=<token>` (upgrade). On successful connect, the server sends,
**in order**:

1. Zero or more `{ type: "entries", entries: TraceRiverLog[] }` batches
   replaying the current ring buffer, chunked at the same ≤500-entries cap
   used for live traffic (never one giant frame).
2. One `{ type: "sources", sources: SourceDescriptor[] }` with the current
   full source list.
3. Live traffic from then on, as documented in architecture.md: `entries`
   (batched ~75ms/500-entry), `sources` (on any add/state change),
   `sourceState`, `dropped`.

A freshly connected client is **subscribed to all sources by default** (so
a first load shows everything with no setup); it sends `unsubscribe` only
for sources the user has explicitly turned the checkbox off for, and
`subscribe` to turn one back on.

**Protocol extension, approved by product owner**: a server→client
`{ type: "cleared" }` message, broadcast to **every** connected client when
any client's `{ type: "clear" }` empties the ring buffer. Without it, only
the initiating tab would know the buffer was cleared; other open tabs would
just go quiet with no explanation. Backend broadcasts it on Clear Logs; all
connected tabs empty their stores in response. Frontend behavior: on
receiving `cleared`, empty the client store and show the "Logs cleared"
toast on that tab too (whether or not it initiated the clear).
`architecture.md` will be updated to match separately, outside this spec's
lane.

**WS connection-state UI** (not itself a data message, client-side only):
- Not yet connected: thin "Connecting…" banner at the top of the stream
  panel.
- Connection drops after having connected: "Disconnected — retrying…"
  banner, automatic reconnect with exponential backoff.
- Server rejects the upgrade (401 — bad/expired token): terminal error
  state, no retry loop (retrying can't fix an invalid token) — "Invalid or
  expired session. Reopen the console from the CLI." Distinct copy from the
  transient disconnected state above.

## Design tokens used

All tokens referenced in this spec are defined in
[`design-system.md`](../design-system.md): full color table (surfaces, text,
the six level accents, focus/interactive), typography (JetBrains Mono,
sizes, weights), spacing scale, radius scale, row/layout metrics
(`--sidebar-width`, `--topbar-height`, `--row-height-collapsed`,
`--row-expanded-max-height`, toggle/checkbox sizes), motion, z-index, and the
iconography approach (hand-authored inline SVG, no new dependency).

## Accessibility requirements

- **Contrast**: every color token used for text/icons that conveys
  information clears 4.5:1 against `--color-bg` (see design-system.md's
  per-token contrast column — all six level colors, primary and muted text
  all independently verified). Non-text interactive borders
  (`--color-border-interactive`) clear 3:1.
- **Never color-alone**: level is always paired with the text label itself
  (`DEBUG`/`INFO`/etc., uppercase) — the colored left edge and colored word
  are a reinforcement, not the only signal. FATAL is further distinguished
  from ERROR by a filled-chip treatment, not color alone (they share a hue).
  Filter chip active/inactive state is conveyed by filled-vs-outline
  treatment plus `aria-pressed`, not color alone.
- **Landmarks**: sidebar is `<aside aria-label="Log sources">`; top bar is
  `<div role="toolbar" aria-label="Stream controls">` with the search input
  as `role="search"`; main stream is `<main aria-label="Unified log
  stream">`.
- **Live region strategy**: the stream list itself is `role="feed"` (WAI-ARIA
  Feed pattern — built for exactly this "long, continuously-updating list"
  case) with each row as `role="article"`; it is **not** wrapped in a blanket
  `aria-live="polite"` region, which would spam a screen reader on every
  batch at realistic log volumes. Instead, a single visually-hidden
  `aria-live="polite"` status region announces only discrete state changes:
  "42 new entries available" (on freeze accumulation, announced at most
  every few seconds, not per-entry), "3 entries dropped, resyncing",
  "Logs cleared".
- **Keyboard**: every row with `multiline`/`context` is a real focusable
  control (native `<button>` wrapping the row content, not a `div` with a
  click handler) — Tab reaches it, Enter/Space expands/collapses, Escape
  while focus is inside the expanded panel collapses it and returns focus to
  the row. Checkboxes and toggles are native-semantic controls with
  `aria-label`s built from the source label ("Subscribe to docker:mysql",
  "Show docker:mysql in stream"). Level filter chips are `<button
  aria-pressed>`. The sidebar drop area is reachable by Tab and Enter/Space
  opens the OS file picker (same as clicking "Browse").
- **Focus states**: `--color-focus-ring` (solid white, 2px, 2px offset) on
  every interactive element — rows, buttons, checkboxes, toggles, chips,
  search input, drop area, "↓ Live" button, "Copy Raw".
- **Reduced motion**: all `--motion-*` transitions (row expand/collapse,
  drag-over overlay fade) are suppressed under `prefers-reduced-motion:
  reduce` — state changes apply instantly instead.

## Acceptance criteria

Numbered and individually testable; each maps to a `phase-1-core.md` exit
criterion where noted. "Verified by design review" items are visual/UX;
others are functional and QA-owned but listed here for traceability since
the ask requires mapping to the phase doc's exit criteria.

1. `traceriver start` opens the browser at a URL containing a `?token=`
   query param; loading that URL without the token (or with a wrong one)
   on any `/api/*` call or the `/ws` upgrade returns 401 and the console
   shows the "Invalid or expired session" terminal error state, not a blank
   or silently-broken UI. *(exit: token auth active)*
2. With no sources uploaded, the console renders the empty state exactly per
   the empty-state wireframe: sidebar shows only header + drop area,
   top-bar controls render visually disabled, main panel shows the centered
   placeholder copy.
3. Dragging a file anywhere in the viewport (not just onto the sidebar drop
   box) triggers the full-viewport drag-over overlay; dropping it starts the
   upload; dragging out or pressing Escape cancels with no state change.
4. A file between 50 MB and 500 MB triggers the client-side soft-warning
   confirm dialog before any bytes are sent; declining sends nothing.
5. A file over 500 MB is rejected client-side before any bytes are sent,
   with the "over the limit" message; the server's own 413 hard-cap path is
   exercised independently (e.g. via a non-browser client) and returns the
   documented error shape.
6. A completed upload produces a new sidebar row: correct kind icon, label,
   entry count matching the number of parsed entries, checkbox checked,
   toggle on, state settles to `stopped`.
7. A 100 MB real-world (e.g. Laravel) log file parses to completion, the
   Node process stays under ~250 MB RSS, and the browser tab remains
   responsive to input (scroll, click) throughout the upload. *(exit:
   100 MB / ~250 MB RSS / responsive tab — QA-verified, not a design-review
   check)* **Accepted 2026-07-19**: measured peak RSS was 263–292 MB, above
   the ~250 MB target. Product owner accepted this range as within
   tolerance — criterion considered met with this annotated range, not the
   original ~250 MB figure.
8. A multi-line PHP stack trace in the source file produces exactly one
   `TraceRiverLog` entry with `multiline: true`; that row shows the chevron
   affordance, and expanding it renders the full trace in the
   syntax-highlighted viewport with `context` (if present) as a separate
   pretty-printed JSON block below it. *(exit: multi-line stack traces
   expandable)*
9. Collapsed rows render exactly the four columns in order (timestamp,
   `[source]`, `| LEVEL |`, message), fixed 40px height, colored left edge
   and colored level word matching the entry's `level`, with no layout
   shift as new rows stream in. Verified by design review against rendered
   evidence.
10. The list auto-scrolls to follow new entries while pinned; any manual
    upward scroll unpins and shows "↓ Live"; clicking it re-pins and scrolls
    to bottom.
11. Clicking "Freeze Stream" stops visible row updates immediately; entries
    that arrive while frozen do not appear until unfreezing, and the button
    shows an accurate accumulating "· n new" count while frozen; unfreezing
    renders everything, scrolls to the live tail, and re-pins.
12. Typing in search filters the stream to entries whose `message`, `body`,
    or `raw` contains the (case-insensitive) query, after the debounce
    window elapses — filtering does not fire on every keystroke.
13. Toggling a level chip off hides all entries of that level from the
    stream and from search matching; toggling it back on restores them,
    without needing to re-run the search.
14. Unchecking a source's checkbox stops new entries from that source from
    arriving at all (client-side visible effect: the count for that source
    stops climbing); its visibility toggle becomes disabled; re-checking
    restores both the flow of new entries and the toggle's interactivity.
15. Toggling a source's visibility off (checkbox still on) hides its rows
    from the stream and from search while its sidebar entry count keeps
    climbing live.
16. "Clear Logs" empties the stream in the initiating tab and, given a
    second connected tab, in that tab too (via the `cleared` broadcast),
    each showing the "Logs cleared" toast.
17. Refreshing the browser tab repopulates the stream from the ring buffer
    via WS replay-on-connect before any live entries arrive — no re-upload
    required, no empty flash of "no sources" for a session that had data.
    *(exit: refresh repopulates via replay)*
18. All four built-in parsers (`monolog`, `clf`, `jsonl`, `raw`) pass their
    golden fixture tests and chunk-boundary fuzz tests. *(exit: parsers
    pass golden + fuzz — QA/backend-owned, listed for traceability)*
19. The end-to-end smoke test (start server programmatically, upload a
    fixture over HTTP, assert the WS stream delivers the expected parsed
    entries) passes. *(QA/backend-owned, listed for traceability)*
20. Every interactive element (rows, buttons, checkboxes, toggles, chips,
    search, drop area) is reachable by Tab in a sensible order and shows the
    `--color-focus-ring` focus outline; row expand/collapse works via
    Enter/Space; Escape collapses an expanded row from within its panel.
21. No color token used for text/icons on `--color-bg` falls below 4.5:1
    contrast (spot-checked against the values recorded in
    design-system.md); ERROR and FATAL rows remain visually distinguishable
    from each other with color vision deficiency simulated (relies on the
    filled-vs-text-only treatment, not hue).
22. "Copy Raw" copies the entry's exact `raw` field to the clipboard
    (byte-for-byte, not the formatted/highlighted display text).

## Design tokens used

See [`design-system.md`](../design-system.md) — this spec introduces no
values outside that file; anything visual referenced above (colors, type,
spacing, radius, row/layout metrics, motion, z-index) is a token defined
there.

---

## Decisions log

Four questions raised during design were resolved by the product owner;
recorded here for traceability. Nothing below is an open question anymore.

1. **Sort-by-timestamp toggle.** Raised because `log-schema.md` §4 mentions
   it as a standing UI feature while `phase-1-core.md` §1.2's explicit
   top-bar control list omits it. **CONFIRMED excluded from phase 1** —
   the spec's top bar has no sort control; arrival-order display only, per
   the layout and wireframes above.
2. **No responsive/mobile layout.** **CONFIRMED desktop-only** — the fixed
   `--sidebar-width`, no-breakpoints layout throughout this spec is final,
   not a placeholder.
3. **WS protocol extension: `{ type: "cleared" }`.** A server→client
   broadcast, not present in `architecture.md`'s documented message set,
   needed so every connected tab (not just the one that clicked "Clear
   Logs") empties its store together. **APPROVED as a protocol extension**
   — backend broadcasts it on Clear Logs; all connected tabs empty their
   stores in response (see the WebSocket protocol section above, updated to
   reflect this). `architecture.md` will be updated to match separately,
   outside this spec's (and the UX designer's) lane — not something to edit
   here.
4. **No `CLAUDE.md` at the repo root.** Product owner confirmed: chose not
   to create one this run. No action taken; this spec proceeded on
   `.claude/lanes.json`, the phase docs, and explicit task instructions.

ARTIFACTS WRITTEN: docs/specs/001-phase-1-core-console.md, docs/design-system.md
STATUS: ready-for-dev
OPEN QUESTIONS: none
