# Architecture

## Process model

TraceRiver is a **single Node.js process** started by the CLI:

```
traceriver start
  └── Fastify server bound to 127.0.0.1:<port>
        ├── serves the pre-built React SPA (shipped in the npm tarball at dist/web)
        ├── REST endpoints (upload, source list, buffer replay, error groups, AI prompt)
        └── WebSocket endpoint (live log stream + source control)
```

On startup the CLI resolves a port, starts the server, and opens the user's default browser at `http://127.0.0.1:<port>/?token=<session-token>` (suppressed with `--no-open`).

There is no daemon, no background service, no state that outlives the process. Ctrl-C ends everything.

## Data flow

```
┌─────────────────┐   ┌──────────────────┐   ┌─────────────────┐
│ Ingest adapters │   │  Uniform Parser   │   │   Ring buffer   │
│                 │──▶│     Pipeline      │──▶│  (default 50k)  │
│ • docker attach │   │ raw chunk → line  │   └────────┬────────┘
│ • file tailer   │   │ → TraceRiverLog   │            │
│ • file upload   │   └──────────────────┘            ▼
└─────────────────┘                          ┌─────────────────┐
                                             │ WS broadcaster  │──▶ Browser SPA
                                             │ (batched ~75ms) │
                                             └─────────────────┘
```

1. **Ingest adapters** (one per source type) produce raw byte chunks tagged with a source id. Adapters own source-specific concerns: Docker stream demuxing, file offsets, upload streaming.
2. The **Uniform Parser Pipeline** turns chunks into complete lines (partial-line buffering), then lines into [`TraceRiverLog`](log-schema.md) entries (format detection, multi-line aggregation, normalization).
3. Parsed entries land in a **server-side ring buffer** and are broadcast to connected browsers.

All parsing happens on the server — including uploaded files — so there is exactly one pipeline to build, test, and extend. The browser only ever sees `TraceRiverLog` objects.

## Transport: WebSocket

A single WebSocket connection per browser tab (`ws` library). Chosen over SSE because the channel is genuinely bidirectional — the client sends control messages (subscribe/unsubscribe sources, clear buffer), the server pushes entries. See [decisions.md](decisions.md).

**Message shapes** (all JSON):

```
server → client
  { type: "entries",  entries: TraceRiverLog[] }        // batched
  { type: "sources",  sources: SourceDescriptor[] }     // full source list on change
  { type: "sourceState", id, state: "live"|"stopped"|"error", detail? }
  { type: "errorGroups", groups: ErrorGroup[] }         // batched, same ~75ms cadence; sent (even empty) as the last connect-sequence step

client → server
  { type: "subscribe",   sourceIds: string[] }
  { type: "unsubscribe", sourceIds: string[] }
  { type: "clear" }                                     // empties the ring buffer
```

**Batching / backpressure.** Entries are never sent one-per-frame. The broadcaster accumulates and flushes every ~75 ms (or at 500 entries, whichever first). If a client's socket buffer exceeds a high-water mark (`ws` `bufferedAmount`), batches are dropped for that client with a `{ type: "dropped", count }` notice — the server ring buffer remains authoritative and the client can re-sync via replay.

**Replay on connect/refresh.** A new WS connection (or `GET /api/replay?after=<id>`) receives the current ring buffer contents first, then live entries. A browser refresh therefore never shows an empty console.

## Memory model

- **Server ring buffer**: fixed-capacity circular buffer, default **50,000 entries**, configurable via `--buffer` / `traceriver.json`. Oldest entries are evicted silently; the UI shows "showing last N" when eviction has occurred.
- **Client store**: mirrors the same cap. The virtualized list renders only visible rows, but the backing array is also bounded so a week-long session can't balloon the tab.
- **Freeze Stream** freezes *rendering only*: incoming batches keep landing in the client store (and server buffer) while frozen, with a "n new entries" badge; unfreezing scrolls to live tail. Nothing is dropped by freezing.

## Docker project association (phases 2 + 5)

Discovered containers are marked `inCurrentProject` on their `SourceDescriptor` (the sidebar shows only these until "Show all containers" is toggled). The matcher (`src/ingest/docker.ts`) resolves the flag per container in strict priority order — the first *applicable* tier decides, and lower tiers are never consulted once a higher tier applies, even on a negative comparison ("paths over names", [D11](decisions.md)):

1. **Path-label match (phase 5).** If the container carries `io.lando.root` (Lando), compare that path against TraceRiver's cwd; else if it carries `com.docker.compose.project.working_dir` (vanilla Compose), compare that. A label matches when it equals cwd or is an ancestor of cwd — segment-aware (no sibling-prefix false positives), realpath-normalized on both sides (macOS `$TMPDIR` symlinks), forward direction only (a labeled path *below* cwd does not match). Lando's `working_dir` points into `~/.lando/compose/` and is deliberately ignored whenever `io.lando.root` is present.
2. **Compose-file `name:` match (phase 2).** `com.docker.compose.project` vs. the top-level `name:` of a compose file in cwd, case-insensitive.
3. **Normalized-basename match (phase 2, final fallback).** `com.docker.compose.project` vs. cwd's basename lowercased with Compose-invalid characters stripped.

Association uses only label data already fetched via the read-only `listContainers`/`inspect` calls — no extra daemon capabilities, no tool-specific SDKs, fully offline. `docker.include`/`docker.exclude` and the all-containers toggle apply identically regardless of which tier matched. Each supported signal is regression-tested against a captured-label fixture (`test/fixtures/docker-labels/`); new real-world association gaps are collected as scenarios in [phase 5](phases/phase-5-project-association.md), a living document.

## Error intelligence (phase 4)

Every ERROR/FATAL entry gets a **fingerprint** at ingestion (`src/errors/`): `sha256(source + normalized message + normalized top stack frame)`, with conservative placeholder normalization (timestamps, ids, values, paths — false merges are worse than false splits). Recurrences collapse into server-side `ErrorGroup`s that live **beside the ring buffer** and survive entry eviction (counts/firstSeen persist; samples are flagged evicted). Capped at 500 groups, LRU by `lastSeen`. Each group keeps a rolling 30-minute per-minute histogram; a group is flagged `spiking` when its current rate exceeds 5× its trailing 30-min average and ≥ 10/min absolute (constants in `src/errors/config.ts`). Groups are pushed as `{type:"errorGroups"}` WS batches and served by `GET /api/errors`; the client never computes fingerprints.

`GET /api/errors/:fingerprint/prompt` assembles a copy-ready markdown debugging prompt server-side (error summary, latest sample stack trace, environment metadata from Docker inspect / discovery, the 15 interleaved cross-source entries before the first occurrence, occurrence-pattern summary). A **redaction pass** runs before the prompt leaves the server: placeholder rules re-run over quoted log lines plus secret-pattern scrubbing (bearer tokens, `password=`, AWS-style keys) → `<redacted>`. v1 is clipboard-only — no API keys, no network calls.

## Security model

A localhost web server with Docker-socket access needs real guardrails:

- **Bind to `127.0.0.1` only.** Never `0.0.0.0`. LAN exposure is explicitly out of scope for v1.
- **Session token.** The CLI generates a random token per run (crypto-random, 128-bit). It is embedded in the URL the CLI opens, stored by the SPA, and required on every WS upgrade and REST call (`?token=` or `Authorization` header). This defends against DNS-rebinding and against arbitrary sites on the user's machine talking to the server — `localhost` origin alone is *not* trustworthy.
- **Host/Origin validation.** Reject requests whose `Host` isn't `127.0.0.1:<port>`/`localhost:<port>` and WS upgrades whose `Origin` doesn't match — second layer against rebinding.
- **Docker socket is root-equivalent.** TraceRiver only ever calls read-only endpoints (list, inspect, logs, events). No create/exec/remove calls exist anywhere in the codebase — treat this as a hard rule, enforceable by the thin Docker client wrapper exposing only those methods.
- **Log files are read-only.** The tailer opens files with read flags only.
- **No telemetry.** Nothing leaves the machine.

## Port strategy

- Default port **7580** — deliberately outside the crowded dev range (3000/5173/8000/8080 are all claimed by popular tools).
- If occupied, auto-increment (7581, 7582, … up to +20) and log which port was chosen.
- `--port <n>` overrides; when explicitly set, conflict is a hard error, not auto-increment (the user asked for that port).

## Packaging & distribution

- **Single npm package**, `bin: { traceriver: "dist/cli.js" }` — works via `npx traceriver`, global install, or dev-dependency.
- **ESM**, **Node ≥ 20** (engines field enforced).
- **Frontend pre-built** by Vite at publish time and shipped in the tarball (`dist/web/`). Installing never triggers a build; there are zero postinstall scripts.
- **Dependency budget**: runtime deps limited to `fastify`, `@fastify/static`, `ws`, `dockerode`, `chokidar`, `commander`. All pure JS — no native compilation on install. Everything else (React, Vite, TanStack Virtual, TypeScript) is a devDependency baked into the built assets.
- Source layout (single package, no monorepo):

```
src/
  cli/        # commander entry, port resolution, browser-open, token gen
  server/     # fastify wiring, WS broadcaster, ring buffer, REST routes
  ingest/     # adapters: docker.ts, tail.ts, upload.ts
  errors/     # fingerprinting, ErrorGroup store, spike heuristic, prompt assembly + redaction
  parsers/    # pipeline + format parsers (see log-schema.md)
  shared/     # TraceRiverLog types + WS message types (imported by web/)
web/          # Vite + React SPA (own tsconfig, builds to dist/web)
test/
  fixtures/   # real-world log samples per format
```
