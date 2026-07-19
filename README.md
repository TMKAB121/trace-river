# TraceRiver

<p align="center">
  <img src="assets/traceriver_logo_concept.png" alt="TraceRiver — local log console" width="600" />
</p>

**TraceRiver** is a local-development log console, distributed as an npm package. One command consolidates every log stream in your dev environment — Docker containers, framework log files, one-off dumps — into a single stylized browser UI, then helps you *identify* the errors hiding in the noise.

```bash
npx traceriver start
```

That's the whole workflow: run it from your project root, a browser tab opens, and your logs are flowing.

## Why

Local development today means logs scattered across `docker compose logs`, `storage/logs/laravel.log`, a Next.js terminal pane, and an nginx error log — each with its own format, timestamps, and terminal window. When something breaks, you grep four places and mentally diff timestamps. TraceRiver puts them in one river, normalized into one schema, with errors surfaced instead of scrolled past.

## Concept

<p align="center">
  <img src="assets/traceriver_ui_concept.png" alt="TraceRiver UI concept — unified log stream" width="800" />
</p>

- **Left sidebar** — every discovered log source (Docker containers, tailed files, uploads) with per-source toggles.
- **Main panel** — the unified, virtualized log stream: timestamp, source, level, message. Rows expand to show full stack traces in a syntax-highlighted viewport.
- **Top bar** — freeze stream, clear, and global search.
- **Drop area** — drag any `.log` / `.txt` / `.json` / `.jsonl` file in and it joins the river as a static source (any text file works — the extension is a hint, not a gate).

## Stack

- **Runtime**: Node.js ≥ 20, TypeScript, ESM throughout, single npm package (`traceriver`).
- **Backend**: [Fastify](https://fastify.dev) (+ `@fastify/static` to serve the built SPA), `ws` for the WebSocket transport, `commander` for the CLI. Compiled with `tsc`.
- **Frontend**: React 19 + Vite, [TanStack Virtual](https://tanstack.com/virtual) for the virtualized stream, `highlight.js` (core + `json`/`plaintext` grammars only) for the expanded-row viewport, `@fontsource/jetbrains-mono` for the self-hosted, offline-capable UI font.
- **Tests**: [Vitest](https://vitest.dev).
- See [Decisions](docs/decisions.md) for the *why* behind each choice, and [Architecture](docs/architecture.md) for how the pieces fit together.

## Getting started

Requires **Node ≥ 20**.

**Run the published package:**

```bash
npx traceriver start
```

This opens a browser tab at `http://127.0.0.1:7580/?token=<session-token>` (port and token are chosen fresh per run). Drag a log file onto the page — or click **Browse** in the sidebar — to start streaming parsed entries.

**Run from a checkout of this repo:**

```bash
npm install
npm run build   # tsc -> dist/, vite build -> dist/web/
npm start        # node dist/cli.js start
```

or, for frontend iteration with hot reload against the real backend:

```bash
npm install
npm run dev      # tsx-watched backend + Vite dev server (proxied) in parallel
```

**CLI flags** (`traceriver start [options]`):

| Flag | Default | Purpose |
|------|---------|---------|
| `--port <n>` | `7580` | Port to bind. Auto-increments (up to +20) on conflict; an explicitly passed port errors instead. |
| `--no-open` | off | Don't open the browser automatically. |
| `--config <path>` | `./traceriver.json` if present | Path to a config file. |
| `--buffer <n>` | `50000` | Ring buffer capacity, in entries. |

There is no `.env` — the server takes no environment variables. All configuration is CLI flags and/or an optional `traceriver.json` (CLI flag > file > built-in default); see [Configuration](docs/configuration.md) for the full field reference. Note that `traceriver.json`'s `docker`/`discovery`/`parsers` sections and the `traceriver init` command described there are forward-looking scaffolding for later phases — phase 1 only acts on `port`, `buffer`, and `open`.

**Security model, in brief**: the server binds to `127.0.0.1` only, every `/api/*` route and the `/ws` upgrade requires the per-run session token (`Authorization: Bearer <token>` on REST, `?token=` on the WS upgrade), and `Host`/`Origin` are validated on every request. See [Architecture § Security model](docs/architecture.md#security-model).

## Tests

```bash
npm test   # vitest run
```

Covers: golden fixture tests for all four built-in parsers (`monolog`, `clf`, `jsonl`, `raw`) plus a chunk-boundary fuzz test, ring-buffer unit tests, auth/replay/clear/subscribe/upload-guardrail server tests, and an end-to-end smoke test (start the server programmatically, upload a fixture over HTTP, assert the WS stream delivers the expected parsed entries). Phase 1 shipped at 60/60 tests passing against the 22 acceptance criteria in [`docs/specs/001-phase-1-core-console.md`](docs/specs/001-phase-1-core-console.md).

## Project layout

```
src/
  cli.ts        # commander entry point (bin: traceriver)
  cli/          # browser-open helper
  server/       # Fastify wiring, auth, WS broadcaster, ring buffer, REST routes
  ingest/       # source adapters (upload.ts in phase 1; docker/tail land later)
  parsers/      # Uniform Parser Pipeline: line splitter, aggregator, format parsers
  shared/       # config resolution + TraceRiverLog/WS types shared with web/
web/            # Vite + React SPA (own tsconfig), builds to dist/web
test/
  parsers/      # golden + chunk-fuzz parser tests
  server/       # auth, ring buffer, replay/clear, subscribe, upload guardrail tests
  e2e/          # smoke test + memory (RSS) test
  fixtures/     # real-world sample logs used by the above
docs/
  specs/            # per-feature specs (this feature: 001-phase-1-core-console.md)
  design-reviews/   # design-review verdicts
  qa/               # QA test plans, defects, evidence
  project/          # this project's living docs (see below)
  phases/           # the phase-by-phase build plan
```

## API overview

All `/api/*` routes and the `/ws` upgrade require the session token (see Security model above). Full contract: [`docs/specs/001-phase-1-core-console.md` § API contract](docs/specs/001-phase-1-core-console.md#api-contract).

| Method · Path | Purpose |
|---|---|
| `POST /api/upload?name=<filename>` | Streaming upload of raw file bytes (no multipart); returns the new `SourceDescriptor` once parsing completes. 50 MB soft-warning, 500 MB hard cap (`413`). |
| `GET /api/sources` | Snapshot of current `SourceDescriptor[]`. |
| `GET /api/status` | Version, port, buffer capacity/used, uptime. |
| `GET /api/replay?after=<id>` | Entries with `id > after`, for resync after a `dropped` notice. |
| `GET /ws?token=<token>` | WebSocket upgrade: replays the ring buffer, then the current source list, then live traffic (`entries`, `sources`, `sourceState`, `dropped`, `cleared`). |

## Roadmap

| Phase | Name | Scope | Status |
|-------|------|-------|--------|
| 0 | [Foundation](docs/phases/phase-0-foundation.md) | npm name claim, repo setup, license, account security | Done |
| 1 | [Core Console](docs/phases/phase-1-core.md) | CLI + local server, React UI, parser pipeline, file upload | **Shipped** — see [spec](docs/specs/001-phase-1-core-console.md) / [design review](docs/design-reviews/001-phase-1-core-console.md) |
| 2 | [Docker Streams](docs/phases/phase-2-docker.md) | Live container log attachment via the Docker daemon | Planned |
| 3 | [Auto-Discovery](docs/phases/phase-3-auto-discovery.md) | Framework fingerprinting and automatic log-file tailing | Planned |
| 4 | [Error Intelligence](docs/phases/phase-4-error-intelligence.md) | Error grouping, spike detection, AI prompt generation | Planned |

## Documentation

| Doc | Contents |
|-----|----------|
| [Architecture](docs/architecture.md) | Process model, data flow, transport, security, packaging |
| [Log Schema & Parser Pipeline](docs/log-schema.md) | The `TraceRiverLog` contract and how raw lines become structured entries |
| [Configuration](docs/configuration.md) | CLI flags and the `traceriver.json` config file |
| [Decisions](docs/decisions.md) | Why React, TypeScript, WebSockets, Fastify, and the rest |
| [`docs/project/`](docs/project/) | Living project overview + a short note per shipped feature |
| [`docs/specs/`](docs/specs/) | Per-feature specs (UI, API contract, acceptance criteria) |
| [`docs/design-reviews/`](docs/design-reviews/) | Design-review verdicts against each spec |

## Principles

- **Local-first, zero config.** No accounts, no API keys, no cloud. `npx traceriver start` must be useful with zero setup.
- **Read-only.** TraceRiver observes your environment (Docker socket, log files) and never mutates it.
- **Fast under fire.** A misbehaving container can emit thousands of lines per second; the UI must stay responsive (virtualized rendering, batched transport, bounded memory).

## Status

**Phase 1 (Core Console) has shipped**: `traceriver start`, token-authed local server, the terminal-chic React console, the Uniform Parser Pipeline (`monolog`/`clf`/`jsonl`/`raw`), and streaming file upload with ring-buffer replay are all in place and QA/design-verified (60/60 tests, 22/22 acceptance criteria, [design review: APPROVED](docs/design-reviews/001-phase-1-core-console.md)). Uploaded files are the only source type so far — Docker attachment (phase 2) and auto-discovered local files (phase 3) are still ahead, per the phase documents above. Desktop-only; no responsive/mobile layout is planned for phase 1's scope.
