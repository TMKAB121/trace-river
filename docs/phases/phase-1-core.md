# Phase 1 — Core Console

**Objective:** Build the CLI wrapper, the local server, the React frontend with the signature look, the Uniform Parser Pipeline, and static file upload. At the end of this phase, `traceriver start` opens a working console and dragging a log file in produces a parsed, searchable, expandable stream — no Docker, no auto-discovery yet.

## 1.1 Package initialization & CLI wrapper

- Initialize the package per the layout in [architecture.md](../architecture.md#packaging--distribution): TypeScript, ESM, Node ≥ 20, `bin` entry, single package with `src/` (backend) and `web/` (Vite + React SPA).
- `commander`-based CLI: `traceriver start` with `--port`, `--no-open`, `--config`, `--buffer` (full flag reference in [configuration.md](../configuration.md)).
- Startup sequence: resolve config → resolve port (default 7580, auto-increment on conflict) → generate session token → start Fastify bound to `127.0.0.1` → serve `dist/web` → open browser at the tokenized URL.
- Implement the security baseline from day one, not as a retrofit: token check on every route/WS upgrade, Host/Origin validation ([architecture.md § Security model](../architecture.md#security-model)).
- Dev ergonomics: `npm run dev` runs the backend via `tsx` and the Vite dev server with a proxy, so frontend iteration gets HMR while the real backend serves data.

## 1.2 UI theme & layout

Get the layout and feel right before heavy backend logic — the concept art in [`assets/traceriver_ui_concept.png`](../../assets/traceriver_ui_concept.png) is the reference.

**Theme.** High-contrast terminal-chic: near-black background, monospaced font (JetBrains Mono, self-hosted — no CDN fonts, the tool must work offline), neon level accents. Level colors are the core visual grammar:

| Level | Accent |
|---|---|
| DEBUG | blue |
| INFO | green |
| WARN | amber |
| ERROR / FATAL | red/orange |
| UNKNOWN | gray |

Each row gets a colored left edge + colored level chip (matching the concept art), so level is scannable even peripherally.

**Layout.**

- **Left sidebar** — source list with per-source toggles (checkbox = subscribed, toggle = visible), entry counts, and the drop area at the bottom. In phase 1 the only sources are uploaded files; the component is built against the generic `SourceDescriptor` shape so Docker/local sources slot in later without rework.
- **Main panel** — unified stream: Timestamp · Source · Level · Message columns.
- **Top bar** — Freeze Stream, Clear Logs, global search input.

**Virtualized list — non-negotiable, built first.** Thousands of styled DOM rows will kill the tab. Use **TanStack Virtual** with fixed row height for collapsed rows and dynamic measurement for expanded ones. Auto-follow behavior: pinned to bottom while at bottom; any upward scroll unpins and shows a "↓ live" jump-back button. Freeze Stream freezes rendering only — entries keep accumulating with an "n new entries" badge ([architecture.md § Memory model](../architecture.md#memory-model)).

**Search & filtering (v1 scope).** Client-side, over the client store: plain-text substring match (matches `message`, `body`, and `raw`) plus level filter chips and the sidebar source toggles. Debounced; regex mode and time-range filters are future work.

**Row expansion.** Clicking a row with `multiline: true` (or with `context`) expands it: full `body` in a syntax-highlighted viewport (highlight.js or Shiki with a small grammar set — stack traces, JSON), rendered `context` object, and a "copy raw" button. Expansion state keyed by entry `id` so virtualization doesn't lose it.

## 1.3 Uniform Parser Pipeline & upload engine

- Implement the full pipeline specified in [log-schema.md](../log-schema.md): line splitter with partial-line buffering and ANSI stripping → multi-line aggregator (continuation heuristic, caps, idle flush) → format parser chain (`monolog` → `clf` → `jsonl` → `raw`) with confidence scoring and per-source stickiness → level/timestamp normalization.
- **Upload engine:**
  - Frontend: drag-and-drop area + file browser fallback; accepts `.log`, `.txt`, `.json`, `.jsonl` (and honestly any text file — extension is a hint, not a gate).
  - Files are **POSTed to the backend and parsed server-side** — one pipeline for uploads and (later) live streams. No client-side parsing path to maintain.
  - **Streaming end-to-end**: the browser streams the request body; Fastify streams into the line splitter. The whole file is never held in memory on either side.
  - Guardrails: soft warning above 50 MB ("this will occupy most of the ring buffer"), hard cap at 500 MB. Upload progress reported per-file; a finished upload becomes a normal toggleable source (`file:<name>`).
- Ring buffer + WS broadcaster + replay-on-connect per [architecture.md](../architecture.md#transport-websocket) — phase 1 exercises the exact transport that phase 2's live streams will use, just fed by uploads.

## 1.4 Testing

- Parser golden tests + chunk-boundary fuzz per [log-schema.md § Testing strategy](../log-schema.md#testing-strategy). These land in this phase, alongside the pipeline — not after.
- One end-to-end smoke test: start the server programmatically, upload a fixture via HTTP, assert the WS stream delivers the expected parsed entries.

## Exit criteria

- [ ] `npx traceriver start` (from the packed tarball, not just the repo) opens the console on a free port with token auth active.
- [ ] Dragging in a 100 MB Laravel log parses it without the Node process exceeding ~250 MB RSS, and the tab stays responsive.
- [ ] Multi-line PHP stack traces appear as single expandable entries with highlighted bodies.
- [ ] All four built-in parsers pass golden + fuzz tests.
- [ ] Search, level chips, source toggles, Freeze, and Clear behave per this doc.
- [ ] Browser refresh repopulates the stream via replay.
