# TraceRiver

<p align="center">
  <img src="assets/traceriver_logo_concept.png" alt="TraceRiver — local log console" width="600" />
</p>

**TraceRiver** is a local-development log console, distributed as an npm package. One command consolidates every log stream in your dev environment — Docker containers, framework log files, one-off dumps — into a single stylized browser UI, groups the errors hiding in the noise into one card per problem, and helps you write the debugging prompt.

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

- **Left sidebar** — every discovered log source with per-source toggles. When Docker is enabled (the default) and/or auto-discovery finds something, it splits into up to three sections: **Containers** (the current Docker Compose project's running containers, checkbox-subscribe to attach a live stream), **Files** (uploads, plus auto-discovered/`traceriver.json`-declared project log files), and **Environment** (macOS-only, cross-project tool logs — Herd/Valet/Homebrew nginx/PHP-FPM — offered unchecked by default). With Docker disabled and nothing discovered, it's phase 1's flat list.
- **Auto-discovery** — on startup, TraceRiver fingerprints the project root (Laravel, Symfony, Next.js, Go, Rails, Django, WordPress) and tails whatever log files it finds, starting at EOF so a pre-existing multi-gigabyte log never floods the stream. Running `traceriver start` in a Laravel project tails `storage/logs/laravel.log` with zero configuration the moment the file exists.
- **Main panel** — the unified, virtualized log stream: timestamp, source, level, message. Rows expand to show full stack traces in a syntax-highlighted viewport. A **Stream / Errors** view switcher swaps this panel between the raw stream and the Errors panel (below).
- **Top bar** — freeze stream, clear, global search, a **Latest Error** button (or press `e`) that jumps the stream straight to the newest error, and an **Errors Only** filter toggle.
- **Error intelligence** — every `ERROR`/`FATAL` entry is fingerprinted server-side (message + top stack frame, placeholder-normalized) and grouped: the same exception logged 400 times collapses into one **ErrorGroup**, not 400 rows. The sidebar shows a live per-source error-count badge (click it to filter the stream to that source's errors); the **Errors panel** lists every group as a card — title, occurrence count, a 30-minute sparkline, first/last seen, sortable by recency or count — expandable to sample occurrences with full stack traces. A lightweight heuristic (current rate > 5× trailing average **and** ≥ 10/min) flags a group **⚡ SPIKING**, clearing on its own once the burst subsides. Each group (or any error row) can **Generate AI Prompt**: a server-assembled, redacted, copy-ready markdown prompt — the error, its latest stack trace, 15 lines of cross-source context before the *first* occurrence, and an occurrence-pattern summary — shown in an editable preview modal before you copy it. Prompt generation is clipboard-only: no network calls to any AI service, no API keys, nothing sent anywhere.
- **Drop area** — drag any `.log` / `.txt` / `.json` / `.jsonl` file in and it joins the river as a static source (any text file works — the extension is a hint, not a gate).

## Stack

- **Runtime**: Node.js ≥ 20, TypeScript, ESM throughout, single npm package (`traceriver`).
- **Backend**: [Fastify](https://fastify.dev) (+ `@fastify/static` to serve the built SPA), `ws` for the WebSocket transport, `commander` for the CLI, `dockerode` (read-only wrapper — list/inspect/logs/events only) for Docker container discovery and log streaming, `chokidar` for filesystem-change-driven local file tailing (auto-discovered targets and `traceriver.json` `watch` entries). Compiled with `tsc`.
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
| `--all-containers` | off | Also show Docker containers outside the current Docker Compose project in the sidebar (initializes the client's "Show all containers" toggle; see below). |

There is no `.env` — the server takes no environment variables. All configuration is CLI flags and/or an optional `traceriver.json` (CLI flag > file > built-in default); see [Configuration](docs/configuration.md) for the full field reference. `traceriver.json`'s `docker` section (`enabled`, `allContainers`, `include`, `exclude`) is resolved and acted on as of phase 2, and its `discovery` section (`enabled`, `disable`) and `watch` array are resolved and acted on as of phase 3; the `parsers` section (custom regex parsers) and the `traceriver init` command remain forward-looking scaffolding.

**Docker container streaming** (phase 2): with a Docker daemon reachable (socket resolution: `DOCKER_HOST` env var → platform default socket/named pipe → Podman-compatible socket, in that order) and `docker.enabled` not set to `false`, the sidebar's Containers section lists the running containers belonging to the current directory's Docker Compose project (matched by the `com.docker.compose.project` label or a local `compose.yaml`/`docker-compose.yml` `name:` field); check a container to attach a live log stream (`tail: 50` + follow) into the same unified pipeline as uploaded files. Subscriptions are shared server-side state — every connected browser tab sees the same checkbox states and streams. `docker.include`/`docker.exclude` glob-filter which containers are ever discovered; "Show all containers" (or `--all-containers`) reveals containers outside the current project, purely client-side. If Docker isn't installed, isn't running, or its socket is inaccessible, a dismissible status card explains the problem and file upload keeps working — no crash, no retry spam (a 10 s recovery poll runs quietly in the background). Docker access is read-only by construction: only `listContainers`/`inspect`/`logs`/`getEvents` are ever called.

**Auto-discovery and local file tailing** (phase 3): at server startup, before any client connects, a detector fingerprints the working directory against seven frameworks (`laravel`, `symfony`, `nextjs`, `go`, `rails`, `django`, `wordpress`, per `docs/phases/phase-3-auto-discovery.md` § 3.1) and, on macOS, three environment-level tools — Laravel Herd, Valet, and Homebrew nginx/PHP-FPM — each individually excludable via `discovery.disable: ["<name>"]`. A matched detector with a default file target (e.g. Laravel's `storage/logs/laravel*.log`) becomes a `local:<detector>` sidebar row in **Files**: checked and `live` if the file already exists, or unchecked/dimmed with a `WAITING` label if it doesn't yet — the row flips to checked/live automatically, with no user action, the instant the file is created (a one-time zero-config courtesy; a later manual uncheck is never overridden). A matched detector with no file target (Next.js, Go, Django — they log to stdout) instead renders a static guidance note in Files, no checkbox. Matched environment-tier sources (Herd/Valet/Homebrew) render in a separate **Environment** section and always start unchecked, regardless of whether their log already has content — these are noisy, cross-project logs the user opts into per session. The `chokidar`-backed tailer starts at EOF for any pre-existing file (never floods the ring buffer with history), tracks read offset incrementally, resets to 0 on truncation, and continues the same sidebar row across glob-matched rotation (e.g. Laravel's daily `laravel-<date>.log` files). Bespoke paths a detector can't guess are declared in `traceriver.json`'s `watch` array (`{ path, label, parser? }`); `watch` entries always tail regardless of `discovery.enabled`, dedupe with auto-discovered targets by resolved absolute path (the config entry wins the label/parser), and an unrecognized `parser` name logs a startup warning and falls back to auto-detection rather than failing to start. See [`docs/project/features/003-phase-3-auto-discovery.md`](docs/project/features/003-phase-3-auto-discovery.md) for the shipped-state note, including a known tailing gap.

**Error intelligence** (phase 4): every `ERROR`/`FATAL` entry is fingerprinted server-side at ingestion (`sha256(source id + normalized message + normalized top stack frame)`, conservative placeholder normalization biased against false merges) into a server-side `ErrorGroup`, keyed independently of the ring buffer and capped at 500 groups (LRU by last-seen) — so groups and their `count`/`firstSeen` survive raw-entry eviction from the buffer. A rolling 30-minute per-minute histogram drives `spiking` (current-minute rate > 5× trailing average **and** ≥ 10/min absolute, no hysteresis — clears the moment the rate subsides). The Errors panel (new **Stream / Errors** view switcher in the top bar) lists every group as a sortable, expandable card; a sidebar per-source badge sums that source's error occurrences and click-filters the stream to just that source's errors via a dismissible chip; **Errors Only** and **Latest Error** (`e` key) are new stream-view controls. `GET /api/errors/:fingerprint/prompt` assembles a redacted markdown debugging prompt server-side (latest stack trace, 15 lines of cross-source context before the group's first occurrence, an occurrence-pattern summary) shown in an editable preview modal — Copy is the only exit path; v1 makes no network call to any AI service and stores no API key.

**Security model, in brief**: the server binds to `127.0.0.1` only, every `/api/*` route and the `/ws` upgrade requires the per-run session token (`Authorization: Bearer <token>` on REST, `?token=` on the WS upgrade), and `Host`/`Origin` are validated on every request. See [Architecture § Security model](docs/architecture.md#security-model).

## Tests

```bash
npm test   # vitest run
```

Covers: golden fixture tests for all four built-in parsers (`monolog`, `clf`, `jsonl`, `raw`) plus a chunk-boundary fuzz test, ring-buffer unit tests, auth/replay/clear/subscribe/upload-guardrail server tests, an end-to-end smoke test (start the server programmatically, upload a fixture over HTTP, assert the WS stream delivers the expected parsed entries), (phase 2) `test/docker/` — discovery/filtering, global subscribe/unsubscribe, TTY/non-TTY demux, restart/rename lifecycle, daemon-status endpoints, the `docker.enabled: false` fallback, and a load test against a high-throughput container, run against a real local Docker daemon (the suite no-ops on a host without one), and (phase 3) `test/discovery/` — zero-config Laravel tailing (including a pending→live regression check), daily-rotation/truncation handling and manual-unsubscribe permanence, `watch` config (label overrides, pinned parsers, glob folding, config/detector dedupe), no-file-target framework notes, `discovery.disable`/`discovery.enabled: false`, environment-tier sources (Herd, unchecked-by-default), a scaled large-file-attach load test, and a concurrent-sources load test. Also (phase 4) `test/errors/` — fingerprint golden fixtures (Laravel/mysql/nginx/Node, same-bug merges vs. distinct-bug never-merges), per-rule placeholder-normalization coverage, `ErrorGroupStore` unit tests (grouping, 500-cap LRU eviction, sample pinning, spike compute/clear), and prompt-assembly snapshot tests (redaction, cross-source context, eviction fallback text) — plus `test/server/errors-pipeline-criteria.test.ts` and `errors-rest-and-ws-sequence.test.ts` exercising fingerprinting/grouping/prompt endpoints through the real upload → pipeline → WS path. Phase 1 shipped at 60/60 tests passing against the 22 acceptance criteria in [`docs/specs/001-phase-1-core-console.md`](docs/specs/001-phase-1-core-console.md); phase 2 shipped at 81/81 tests passing against the 21 acceptance criteria in [`docs/specs/002-phase-2-docker.md`](docs/specs/002-phase-2-docker.md); phase 3 shipped at 109/109 tests passing against the 21 acceptance criteria in [`docs/specs/003-phase-3-auto-discovery.md`](docs/specs/003-phase-3-auto-discovery.md); phase 4 shipped at 199/199 tests passing against the 20 acceptance criteria in [`docs/specs/004-phase-4-error-intelligence.md`](docs/specs/004-phase-4-error-intelligence.md), after one low-severity fix-loop iteration ([defect 1](docs/qa/defects/004-phase-4-error-intelligence-1.md): sparkline tooltip vs. AI-prompt occurrence-pattern wording could diverge near a rounding boundary — verified fixed).

## Project layout

```
src/
  cli.ts        # commander entry point (bin: traceriver)
  cli/          # browser-open helper
  server/       # Fastify wiring, auth, WS broadcaster, ring buffer, REST routes, ingest-entries.ts (phase 4: centralizes fingerprint-attach across all three ingest adapters)
  ingest/       # source adapters: upload.ts (files), docker.ts + docker-client.ts (phase 2), tail.ts (phase 3, local file tailing)
  discovery/    # phase 3: project-root fingerprint detectors, macOS environment detectors, watch-entry resolution + dedupe
  errors/       # phase 4: fingerprinting (config.ts, normalize-text.ts, fingerprint.ts), ErrorGroup store (error-store.ts), redaction (redact.ts), AI-prompt assembly (prompt.ts)
  parsers/      # Uniform Parser Pipeline: line splitter, aggregator, format parsers
  shared/       # config resolution + TraceRiverLog/WS types shared with web/
web/            # Vite + React SPA (own tsconfig), builds to dist/web
test/
  parsers/      # golden + chunk-fuzz parser tests
  server/       # auth, ring buffer, replay/clear, subscribe, upload guardrail tests, (phase 4) errors REST/WS + pipeline-criteria tests
  docker/       # Docker discovery/subscribe/demux/lifecycle/status/load tests (phase 2)
  discovery/    # fingerprinting, tailing, watch config, environment sources, load tests (phase 3)
  errors/       # phase 4: fingerprint golden corpus, placeholder-normalization rules, ErrorGroupStore, prompt-assembly snapshots, client occurrence-pattern text
  e2e/          # smoke test + memory (RSS) test
  fixtures/     # real-world sample logs used by the above
docs/
  specs/            # per-feature specs (001-phase-1-core-console.md, 002-phase-2-docker.md, 003-phase-3-auto-discovery.md, 004-phase-4-error-intelligence.md)
  design-reviews/   # design-review verdicts
  qa/               # QA test plans, defects, evidence
  project/          # this project's living docs (see below)
  phases/           # the phase-by-phase build plan
```

## API overview

All `/api/*` routes and the `/ws` upgrade require the session token (see Security model above). Full contract: [`docs/specs/001-phase-1-core-console.md` § API contract](docs/specs/001-phase-1-core-console.md#api-contract), [`docs/specs/002-phase-2-docker.md` § API contract](docs/specs/002-phase-2-docker.md#api-contract) (Docker additions), [`docs/specs/003-phase-3-auto-discovery.md` § API contract](docs/specs/003-phase-3-auto-discovery.md#api-contract) (local/environment source and discovery additions), and [`docs/specs/004-phase-4-error-intelligence.md` § API contract](docs/specs/004-phase-4-error-intelligence.md#api-contract) (error-group and AI-prompt additions).

| Method · Path | Purpose |
|---|---|
| `POST /api/upload?name=<filename>` | Streaming upload of raw file bytes (no multipart); returns the new `SourceDescriptor` once parsing completes. 50 MB soft-warning, 500 MB hard cap (`413`). |
| `GET /api/sources` | Snapshot of current `SourceDescriptor[]` (includes `kind: "docker"` sources when Docker is enabled). |
| `GET /api/status` | Version, port, buffer capacity/used, uptime, `dockerAllContainersDefault`. |
| `GET /api/replay?after=<id>` | Entries with `id > after`, for resync after a `dropped` notice. |
| `GET /api/docker/status` | Current Docker daemon connectivity (`not_installed` \| `not_running` \| `permission_denied` \| `connected`) + detail — mirrors the WS-pushed value. |
| `GET /api/discovery` | Current auto-discovery result — `{ enabled: false, frameworks: [] }` when `discovery.enabled` is `false`, else `{ enabled: true, frameworks: DetectedFramework[] }` — mirrors the WS-pushed `discovery` message. |
| `GET /api/errors` | `{ groups: ErrorGroup[] }` — mirrors the most recent WS-pushed `errorGroups` payload (phase 4; always on, no config flag). |
| `GET /api/errors/:fingerprint/prompt` | `{ prompt: string }` — server-assembled, redacted markdown AI debugging prompt for that fingerprint. `404 { error: "not_found" }` if the fingerprint isn't currently tracked (never existed, or evicted from the 500-group cap) (phase 4). |
| `GET /ws?token=<token>` | WebSocket upgrade: replays the ring buffer, then the current source list, then (if Docker is enabled) a `dockerStatus` message, then (if discovery is enabled) a `discovery` message, then an `errorGroups` message (phase 4; always sent, even as `[]`), then live traffic (`entries`, `sources`, `sourceState`, `dropped`, `cleared`, `dockerStatus`, `errorGroups`). |

For `kind: "docker"` sources, `subscribe`/`unsubscribe` is **server-global** (shared across every connected tab), unlike file and `kind: "local"` sources' per-connection subscribe — checking a container's box in one tab attaches its stream and updates the checkbox in every other open tab too (see the spec's Decisions). `kind: "local"` sources whose `local.origin` is `"environment"` are the one exception to per-connection defaults: they start unsubscribed for every connection, at every state, even after the file already has content. Every `TraceRiverLog` entry (phase 4) carries a `fingerprint: string | null` field, non-null only when `level` is `ERROR`/`FATAL` and set in the same tick as ingestion.

## Roadmap

| Phase | Name | Scope | Status |
|-------|------|-------|--------|
| 0 | [Foundation](docs/phases/phase-0-foundation.md) | npm name claim, repo setup, license, account security | Done |
| 1 | [Core Console](docs/phases/phase-1-core.md) | CLI + local server, React UI, parser pipeline, file upload | **Shipped** — see [spec](docs/specs/001-phase-1-core-console.md) / [design review](docs/design-reviews/001-phase-1-core-console.md) |
| 2 | [Docker Streams](docs/phases/phase-2-docker.md) | Live container log attachment via the Docker daemon | **Shipped** — see [spec](docs/specs/002-phase-2-docker.md) / [design review](docs/design-reviews/002-phase-2-docker.md) |
| 3 | [Auto-Discovery](docs/phases/phase-3-auto-discovery.md) | Framework fingerprinting and automatic log-file tailing | **Shipped** — see [spec](docs/specs/003-phase-3-auto-discovery.md) / [design review](docs/design-reviews/003-phase-3-auto-discovery.md) |
| 4 | [Error Intelligence](docs/phases/phase-4-error-intelligence.md) | Error grouping, spike detection, AI prompt generation | **Shipped** — see [spec](docs/specs/004-phase-4-error-intelligence.md) / [design review](docs/design-reviews/004-phase-4-error-intelligence.md) |

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

**Phase 1 (Core Console) has shipped**: `traceriver start`, token-authed local server, the terminal-chic React console, the Uniform Parser Pipeline (`monolog`/`clf`/`jsonl`/`raw`), and streaming file upload with ring-buffer replay are all in place and QA/design-verified (60/60 tests, 22/22 acceptance criteria, [design review: APPROVED](docs/design-reviews/001-phase-1-core-console.md)).

**Phase 2 (Docker Streams) has shipped**: live log attachment to the current Docker Compose project's containers (checkbox-subscribe in a sectioned sidebar), read-only daemon access (`listContainers`/`inspect`/`logs`/`getEvents` only), TTY/non-TTY demux with an stderr WARN floor, automatic restart re-attach with no duplicated lines, a dismissible daemon-status card (not-installed/not-running/permission-denied) with a quiet 10 s recovery poll, and a "Show all containers" client-side toggle — all QA/design-verified (81/81 tests, 21/21 acceptance criteria, [design review: APPROVED](docs/design-reviews/002-phase-2-docker.md)). See [`docs/project/features/002-phase-2-docker.md`](docs/project/features/002-phase-2-docker.md) for the shipped-state note, including known heuristics/limitations.

**Phase 3 (Auto-Discovery) has shipped**: startup fingerprinting of the project root against seven frameworks plus (macOS-only) Herd/Valet/Homebrew environment detection, zero-config local file tailing (EOF start, offset-tracked incremental reads, truncation reset, glob-based rotation continuation) via a new **Files**-section auto-subscribe flow and a separate, opt-in **Environment** section, and `traceriver.json` `watch`-entry support with config/discovery dedupe — all QA/design-verified (109/109 tests, 21/21 acceptance criteria, [design review: APPROVED](docs/design-reviews/003-phase-3-auto-discovery.md)). See [`docs/project/features/003-phase-3-auto-discovery.md`](docs/project/features/003-phase-3-auto-discovery.md) for the shipped-state note, including a known tailing gap for literal (non-glob) targets whose parent directory is absent at startup.

**Phase 4 (Error Intelligence) has shipped**: server-side error fingerprinting and grouping (`ErrorGroup`s surviving ring-buffer eviction, capped at 500, LRU by last-seen), a sidebar per-source error badge with click-to-filter, a dedicated Errors panel (sortable, expandable cards with sparklines and sample stack traces), an **Errors Only** stream filter, **Latest Error** jump (button + `e` key), heuristic spike detection (⚡ SPIKING, no hysteresis), and one-click, redacted, clipboard-only **AI debugging prompt** generation via an editable preview modal — all QA/design-verified (199/199 tests, 20/20 acceptance criteria, one low-severity defect fixed and re-verified, [design review: APPROVED](docs/design-reviews/004-phase-4-error-intelligence.md)). See [`docs/project/features/004-phase-4-error-intelligence.md`](docs/project/features/004-phase-4-error-intelligence.md) for the shipped-state note. Desktop-only; no responsive/mobile layout is planned.
