# TraceRiver — project overview

A running summary of what's actually built, kept in sync as features ship.
For the full architectural spec see [`docs/architecture.md`](../architecture.md)
and [`docs/decisions.md`](../decisions.md); this doc is the shorter,
implementation-grounded companion to those, updated per feature. Per-feature
detail lives in [`docs/project/features/`](features/).

## What's shipped so far

**Phase 1 — Core Console** (see
[`features/001-phase-1-core-console.md`](features/001-phase-1-core-console.md))
and **Phase 2 — Docker Streams** (see
[`features/002-phase-2-docker.md`](features/002-phase-2-docker.md)).
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
  schema already defines `watch`/`docker`/`discovery`/`parsers` sections;
  as of phase 2, `docker` (`enabled`, `allContainers`, `include`, `exclude`)
  is fully resolved and acted on — `watch`/`discovery`/`parsers` remain
  inert scaffolding for later phases.
- **Server** (`src/server/`) — Fastify bound to `127.0.0.1` only. An
  `onRequest` hook enforces Host/Origin validation on every request and
  bearer-token auth on every `/api/*` route (`src/server/auth.ts`,
  `token.ts`); the WS upgrade checks the token as a query param
  (`src/server/ws.ts`). Serves the pre-built SPA (`dist/web`) via
  `@fastify/static`. REST routes live under `src/server/routes/`
  (`upload.ts`, `sources.ts`, `status.ts`, `replay.ts`, and, as of phase 2,
  `docker-status.ts`).
- **Ingest** (`src/ingest/`) — `upload.ts`: a streaming multipart-free upload
  handler (`POST /api/upload`) that pipes the raw request body straight into
  the parser pipeline, enforcing the 50 MB soft-warning point and 500 MB
  hard cap without buffering the whole file. `docker.ts` + `docker-client.ts`
  (phase 2, see below) are the second adapter. `tail.ts` (phase 3, local-file
  auto-discovery) doesn't exist yet.
- **Docker adapter** (`src/ingest/docker-client.ts`, `docker.ts`) — a
  `DockerManager` per server process (created regardless of
  `docker.enabled`, but only ever connects when it's true). `docker-client.ts`
  is a thin, read-only `dockerode` wrapper exposing only `listContainers`,
  `inspect`, `logs`, `getEvents`, and a `/_ping`-backed connectivity probe —
  no create/exec/remove call exists anywhere. Socket resolution order:
  `DOCKER_HOST` env var → platform default (`/var/run/docker.sock` macOS/
  Linux, `//./pipe/docker_engine` Windows) → Podman-compatible socket,
  best-effort. On connectivity loss, a 10 s poll (`setInterval`, `unref`'d)
  retries and reclassifies the failure (`not_installed` vs. `not_running` is
  a best-effort heuristic — a resolved socket file existing, or `docker` on
  `PATH`, vs. neither; `permission_denied` is the one exact signal, keyed off
  `EACCES`). Discovery filters containers to the current directory's Docker
  Compose project (`com.docker.compose.project` label, or a local
  `compose.yaml`/`docker-compose.yml` `name:` field) plus `docker.include`/
  `exclude` globs; `inCurrentProject` is sent for every discovered container
  regardless, and "Show all containers" is a client-side render filter only.
  Subscription (`subscribe`/`unsubscribe` for a `docker:<name>` id) is
  **server-global** — one shared `container.logs()` attachment per
  subscribed container regardless of how many browser tabs are open, unlike
  file sources' per-connection model (spec 002 Decision 5). Non-TTY
  containers are demultiplexed (stdout/stderr, stderr floored to WARN
  level); TTY containers are streamed as plain text, never demuxed. A Docker
  `rename` event is treated as a new, unrelated source — the old id settles
  to `stopped` permanently with its history intact, the new id is discovered
  fresh and unsubscribed (spec 002 Decision 4). A restart re-attach uses a
  Docker `since` timestamp (the last line actually read, +1ns) rather than
  `tail: 50`, so it never re-reads pre-restart history the `json-file` log
  driver keeps across a restart.
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
  filtering, freeze/pin state, and, as of phase 2, the tri-state
  `dockerAvailability` reducer described below), `web/src/components/`
  (Sidebar, TopBar, StreamPanel/Row/ExpandedPanel, drag-and-drop, toasts,
  banners, and, as of phase 2, `ContainersSection`/`FilesSection`/
  `DockerStatusCard`), `web/src/styles/tokens.css` (the terminal-chic
  design-token mirror of `docs/design-system.md`).

## Data flow

```
uploaded file --POST /api/upload-->        line
docker container --logs()/demux-->   ->  splitter -> aggregator -> format
                                            |          parsers -> normalize
                                            v                |
                                      TraceRiverLog <---------
                                            |
                                            v
                                     ring buffer -> WS broadcaster
                                                          |
                                                          v
                                                    browser SPA (store,
                                                    virtualized stream)
```

Both ingest adapters (uploaded files, live Docker containers) feed the same
Uniform Parser Pipeline and land in the same ring buffer/broadcaster —
there is exactly one pipeline regardless of source kind. Local-file
auto-discovery/tailing (the third ingest adapter `architecture.md`
describes, `kind: "local"`) is not implemented yet — the `SourceDescriptor`
shape was already generic enough that phase 1 built the sidebar/stream
against it without rework, and phase 2 confirms that held for `kind:
"docker"` too.

## Security model (as implemented)

- Bind to `127.0.0.1` only (never `0.0.0.0`).
- Per-run crypto-random session token, required via `Authorization: Bearer
  <token>` on every `/api/*` call and `?token=` on the `/ws` upgrade; a bad
  token on the WS upgrade is rejected with HTTP 401 before the handshake
  completes (not accept-then-close), so the client shows a distinct
  "Invalid or expired session" state rather than a retry loop.
- Host/Origin validated on every request (`isAllowedHost` /
  `isAllowedOrigin` in `src/server/auth.ts`).
- Docker access is read-only by construction (phase 2): `src/ingest/
  docker-client.ts` exposes only `listContainers`, `inspect`, `logs`,
  `getEvents`, and a ping-based connectivity probe — no create/exec/remove
  call exists anywhere in the codebase.
- No telemetry; nothing leaves the machine.

Full detail: [`docs/architecture.md` § Security model](../architecture.md#security-model).

## Testing

`npm test` runs Vitest across `test/parsers/` (golden fixtures per format +
chunk-boundary fuzz), `test/server/` (auth, ring buffer, replay/clear,
subscribe, upload guardrails, port-zero handling), `test/docker/` (phase 2 —
discovery/project-filtering, global subscribe/unsubscribe, TTY/non-TTY
demux, restart/rename lifecycle, `docker.enabled: false` fallback, daemon
status endpoints, a high-throughput load test; the suite `describe.skipIf`s
itself on a host without a reachable Docker daemon), and `test/e2e/` (a
smoke test that starts the server programmatically and asserts the WS
stream delivers parsed entries end-to-end, plus a memory/RSS test). Phase 1
shipped at 60/60 tests passing; phase 2 shipped at 81/81.

## Known deviations / accepted tradeoffs

- **Acceptance criterion 7** (100 MB Laravel log, target ~250 MB RSS):
  measured peak RSS was 263–292 MB. Product owner accepted this range as
  within tolerance on 2026-07-19 — see
  [`docs/specs/001-phase-1-core-console.md`](../specs/001-phase-1-core-console.md#acceptance-criteria),
  criterion 7.
- `traceriver init` (writing a starter `traceriver.json`) is documented in
  [`docs/configuration.md`](../configuration.md) but not yet implemented —
  still out of scope as of phase 2.
- The config file's `watch`/`discovery`/`parsers` sections remain inert
  scaffolding for phases 3/4 — only `port`/`buffer`/`open` (phase 1) and
  `docker.*` (phase 2, as of this feature) are actually acted on.
- **Docker `not_installed` vs. `not_running` is a best-effort heuristic**
  (`src/ingest/docker-client.ts` `classifyFailure()`): dockerode/docker-modem
  don't distinguish "daemon absent" from "daemon down" directly, so the
  server infers it from whether a resolved candidate socket file exists on
  disk, or the `docker` CLI is on `PATH`. `permission_denied` (`EACCES`) is
  the one exact signal.
- **Live Docker entries can show a provisional `raw` tag for their first
  ≤20 lines** while the shared per-source format-detection pipeline is
  still committing to a parser (no retroactive re-tagging once it locks) —
  product-owner-accepted behavior, not a defect (see
  [`docs/qa/defects/002-phase-2-docker-1.md`](../qa/defects/002-phase-2-docker-1.md)).
- **Windows named-pipe support (`//./pipe/docker_engine`) is
  code-review-verified only** — exercised end-to-end on macOS (Docker
  Desktop) during phase 2's QA pass; the Windows and native-Linux-socket
  legs of the cross-platform acceptance criterion were verified by reading
  `buildCandidates()`'s platform branch, not run on those platforms. See
  [`docs/qa/test-plans/002-phase-2-docker.md`](../qa/test-plans/002-phase-2-docker.md)
  § Known limitations.
- **The three Docker daemon-failure status cards** (`not_installed`,
  `not_running`, `permission_denied`), the "Docker connected" recovery
  toast, and the dismiss-persists-until-a-different-failure behavior were
  **not exercised live** in phase 2's QA pass — the only host available had
  one real, already-working Docker daemon backing the product owner's own
  `street_bites` project, and stopping it to simulate a failure was
  explicitly off-limits. These are verified by static code review against
  the spec's exact copy only; see the test plan's § Known limitations for
  detail.

## Roadmap

See the root [`README.md`](../../README.md#roadmap) for the phase-by-phase
scope table, and [`docs/phases/`](../phases/) for the full per-phase plans.
