# Feature 001 — Phase 1: Core Console

**Status:** Shipped. QA PASS (60/60 tests, 22/22 acceptance criteria), design
verification **APPROVED**.

- Spec: [`docs/specs/001-phase-1-core-console.md`](../../specs/001-phase-1-core-console.md)
- Design review: [`docs/design-reviews/001-phase-1-core-console.md`](../../design-reviews/001-phase-1-core-console.md)
- QA test plan: [`docs/qa/test-plans/001-phase-1-core-console.md`](../../qa/test-plans/001-phase-1-core-console.md)
- Defect reports filed during the fix loop (resolved before design review):
  [`docs/qa/defects/001-phase-1-core-console-1.md`](../../qa/defects/001-phase-1-core-console-1.md),
  [`-2.md`](../../qa/defects/001-phase-1-core-console-2.md),
  [`-3.md`](../../qa/defects/001-phase-1-core-console-3.md)
- Phase doc: [`docs/phases/phase-1-core.md`](../../phases/phase-1-core.md)

## What shipped

`traceriver start` boots a token-authed local Fastify server bound to
`127.0.0.1`, opens a browser tab at the tokenized session URL, and serves a
single-screen console: a sidebar of log sources plus a unified, virtualized
stream of parsed entries. In phase 1 the only source type is an
uploaded/dropped file, parsed server-side and streamed to the browser over
WebSocket.

- **CLI**: `traceriver start` with `--port`, `--no-open`, `--config`,
  `--buffer`; config resolves CLI flag > `traceriver.json` > default; port
  auto-increments on conflict (hard error if `--port` was explicit).
- **Server**: session-token auth on every route and the WS upgrade,
  Host/Origin validation, ring buffer (default 50,000 entries) with
  WS replay-on-connect, batched broadcaster (~75 ms/500-entry), `dropped`
  resync notice, and the approved `{ type: "cleared" }` protocol extension
  broadcasting Clear Logs to every connected tab.
- **Uniform Parser Pipeline**: line splitter (partial-line buffering across
  chunk boundaries, ANSI stripping) → multi-line aggregator (continuation
  heuristic — PHP stack traces collapse into one `multiline: true` entry) →
  format parser chain (`monolog` → `clf` → `jsonl` → `raw`, confidence-scored
  with per-source stickiness) → level/timestamp normalization.
- **Upload engine**: streaming (no multipart) `POST /api/upload`, 50 MB
  soft-warning confirm, 500 MB hard cap enforced both client- and
  server-side (`413`).
- **Frontend**: terminal-chic theme (self-hosted JetBrains Mono, fully
  offline, no CDN fonts), TanStack Virtual stream with fixed 40px collapsed
  rows and dynamically measured expanded rows, auto-follow/pin with "↓ Live",
  Freeze Stream (rendering snapshot, not data-loss, "· n new" badge), Clear
  Logs synced across tabs, client-side search (debounced, matches `message`/
  `body`/`raw`) + level chips + source subscribe/visibility toggles (AND
  filter), row expansion with highlight.js-highlighted body + pretty-printed
  `context` JSON + "Copy Raw".

## Endpoints / UI / tests touched

- **REST**: `POST /api/upload`, `GET /api/sources`, `GET /api/status`,
  `GET /api/replay`.
- **WebSocket**: `GET /ws` — replay-on-connect, `entries`/`sources`/
  `sourceState`/`dropped`/`cleared` server→client, `subscribe`/`unsubscribe`/
  `clear` client→server.
- **UI**: full console — empty state, populated stream (all six levels),
  drag-over overlay, row expansion, invalid-token terminal state,
  filtered-empty state, eviction notice.
- **Tests**: `test/parsers/` (golden fixtures for all four formats +
  chunk-boundary fuzz), `test/server/` (auth, ring buffer, replay/clear,
  subscribe, upload guardrails, port-zero), `test/e2e/` (smoke test +
  memory/RSS test).

## Changed files

Backend `src/**` (CLI, config, parser pipeline, upload ingest, server with
ring buffer/WS/auth), `web/**` (full SPA), `test/**`, `package.json` /
`tsconfig.json`.

## Known deviation

Acceptance criterion 7 targeted ~250 MB RSS for a 100 MB real-world log
upload; measured peak RSS was 263–292 MB. The product owner accepted this
range as within tolerance on 2026-07-19 (see the spec's acceptance-criteria
section, criterion 7, and the design review's "Two owner-approved doc
corrections" note). Criterion is considered met at this annotated range, not
the original figure.

## Scope explicitly deferred

Docker/live local-file sources (phase 2/3 — the `SourceDescriptor` shape and
sidebar were built generically to accept them without rework), the
"Generate AI Prompt" affordance (phase 4), regex search / time-range
filters, a sort-by-timestamp toggle, and any responsive/mobile layout
(desktop-only, confirmed by product owner). `traceriver init` (writing a
starter `traceriver.json`, documented in
[`docs/configuration.md`](../../configuration.md)) is not yet implemented.
