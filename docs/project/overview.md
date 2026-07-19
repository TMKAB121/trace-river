# TraceRiver — project overview

A running summary of what's actually built, kept in sync as features ship.
For the full architectural spec see [`docs/architecture.md`](../architecture.md)
and [`docs/decisions.md`](../decisions.md); this doc is the shorter,
implementation-grounded companion to those, updated per feature. Per-feature
detail lives in [`docs/project/features/`](features/).

## What's shipped so far

**Phase 1 — Core Console** (see
[`features/001-phase-1-core-console.md`](features/001-phase-1-core-console.md)).
Everything described below reflects that shipped state; nothing here is
aspirational.

## Components

TraceRiver runs as a single Node.js process, started by the CLI
(`src/cli.ts`, bin `traceriver`):

- **CLI** (`src/cli.ts`, `src/cli/open-browser.ts`) — commander-based, parses
  `start` and its flags, resolves config, starts the server, opens the
  browser at the tokenized session URL, handles `SIGINT`/`SIGTERM` shutdown.
- **Config resolution** (`src/shared/config.ts`) — merges CLI flags >
  `traceriver.json` (JSONC, comments stripped) > built-in defaults. The file
  schema already defines `watch`/`docker`/`discovery`/`parsers` sections for
  later phases; phase 1 only *acts* on `port`, `buffer`, `open`.
- **Server** (`src/server/`) — Fastify bound to `127.0.0.1` only. An
  `onRequest` hook enforces Host/Origin validation on every request and
  bearer-token auth on every `/api/*` route (`src/server/auth.ts`,
  `token.ts`); the WS upgrade checks the token as a query param
  (`src/server/ws.ts`). Serves the pre-built SPA (`dist/web`) via
  `@fastify/static`. REST routes live under `src/server/routes/`
  (`upload.ts`, `sources.ts`, `status.ts`, `replay.ts`).
- **Ingest** (`src/ingest/upload.ts`) — phase 1's only source adapter: a
  streaming multipart-free upload handler (`POST /api/upload`) that pipes
  the raw request body straight into the parser pipeline, enforcing the
  50 MB soft-warning point and 500 MB hard cap without buffering the whole
  file. `docker.ts`/`tail.ts` adapters (phases 2/3) don't exist yet.
- **Uniform Parser Pipeline** (`src/parsers/`) — `line-splitter.ts` (partial
  line buffering across chunk boundaries) → `aggregator.ts` +
  `continuation-heuristic.ts` (multi-line entries, e.g. PHP stack traces,
  collapse to one `TraceRiverLog`) → `formats/` (the `monolog` → `clf` →
  `jsonl` → `raw` detection chain, confidence-scored, sticky per source) →
  `normalize.ts` (level/timestamp normalization). Wired together in
  `pipeline.ts`.
- **Ring buffer + broadcaster** (`src/server/ring-buffer.ts`,
  `broadcaster.ts`) — fixed-capacity circular buffer (default 50,000
  entries, `--buffer` overridable); the broadcaster batches WS sends
  (~75 ms / 500-entry cap) and emits `{ type: "dropped" }` if a client's
  socket backs up, per `docs/architecture.md`.
- **Frontend** (`web/`) — Vite + React 19 SPA. `web/src/api/` (auth, REST,
  WS client), `web/src/store/store.tsx` (the client-side entry store,
  filtering, freeze/pin state), `web/src/components/` (Sidebar, TopBar,
  StreamPanel/Row/ExpandedPanel, drag-and-drop, toasts, banners), `web/src/
  styles/tokens.css` (the terminal-chic design-token mirror of
  `docs/design-system.md`).

## Data flow (phase 1)

```
uploaded file --POST /api/upload--> line splitter -> aggregator -> format
parsers -> normalize -> TraceRiverLog -> ring buffer -> WS broadcaster
                                                              |
                                                              v
                                                        browser SPA (store,
                                                        virtualized stream)
```

Docker attachment and local-file tailing (the other two ingest adapters
`architecture.md` describes) are not implemented — the `SourceDescriptor`
shape (`kind: "file" | "docker" | "local"`) is already generic enough that
phase 1 built the sidebar/stream against it without rework, but phase 1
itself only ever produces `kind: "file"`.

## Security model (as implemented)

- Bind to `127.0.0.1` only (never `0.0.0.0`).
- Per-run crypto-random session token, required via `Authorization: Bearer
  <token>` on every `/api/*` call and `?token=` on the `/ws` upgrade; a bad
  token on the WS upgrade is rejected with HTTP 401 before the handshake
  completes (not accept-then-close), so the client shows a distinct
  "Invalid or expired session" state rather than a retry loop.
- Host/Origin validated on every request (`isAllowedHost` /
  `isAllowedOrigin` in `src/server/auth.ts`).
- No telemetry; nothing leaves the machine.

Full detail: [`docs/architecture.md` § Security model](../architecture.md#security-model).

## Testing

`npm test` runs Vitest across `test/parsers/` (golden fixtures per format +
chunk-boundary fuzz), `test/server/` (auth, ring buffer, replay/clear,
subscribe, upload guardrails, port-zero handling), and `test/e2e/` (a smoke
test that starts the server programmatically and asserts the WS stream
delivers parsed entries end-to-end, plus a memory/RSS test). Phase 1 shipped
at 60/60 tests passing.

## Known deviations / accepted tradeoffs

- **Acceptance criterion 7** (100 MB Laravel log, target ~250 MB RSS):
  measured peak RSS was 263–292 MB. Product owner accepted this range as
  within tolerance on 2026-07-19 — see
  [`docs/specs/001-phase-1-core-console.md`](../specs/001-phase-1-core-console.md#acceptance-criteria),
  criterion 7.
- `traceriver init` (writing a starter `traceriver.json`) is documented in
  [`docs/configuration.md`](../configuration.md) but not yet implemented —
  it's out of phase 1's scope.

## Roadmap

See the root [`README.md`](../../README.md#roadmap) for the phase-by-phase
scope table, and [`docs/phases/`](../phases/) for the full per-phase plans.
