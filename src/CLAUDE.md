# src/ — backend (CLI, server, parser pipeline, ingest)

Compiled by `tsc` (root tsconfig) to `dist/`. ESM with NodeNext resolution — relative imports need explicit `.js` extensions. `web/` is a separate compilation unit; the only shared code is `src/shared/`.

## server/

- Startup (`index.ts` `startServer`): resolve port → generate token → Fastify bound to `127.0.0.1` → `@fastify/static` serves `dist/web`. `startServer({port: 0, strictPort: true})` is supported for tests (OS-assigned port).
- **Auth invariants** (`auth.ts`, `token.ts`): an `onRequest` hook validates Host/Origin on *every* request and bearer-token on every `/api/*` route. The WS upgrade (`ws.ts`) checks `?token=` and rejects a bad token with HTTP **401 before the handshake completes** — never accept-then-close; the client relies on this to show a distinct "invalid session" state instead of a retry loop.
- `ring-buffer.ts` assigns the monotonic `id` (the replay cursor) — nothing else may mint ids. Fixed capacity (default 50,000), silent eviction of oldest.
- `broadcaster.ts` batches WS sends: flush every ~75 ms or at 500 entries, whichever first — never one-per-frame. If a client's `bufferedAmount` exceeds the high-water mark, drop that client's batches and send `{type:"dropped", count}`; the client re-syncs via `/api/replay`.
- WS protocol messages are the unions in `../shared/types.ts`; extending the protocol means updating that file, the client (`web/src/api/ws.ts`, store), and `docs/architecture.md` § Transport together.

## parsers/ — the Uniform Parser Pipeline

`pipeline.ts` wires four stages. Stages 1–2 (`line-splitter.ts`, `aggregator.ts` + `continuation-heuristic.ts`) are **stateful per source**; stages 3–4 (`formats/`, `normalize.ts`) are pure — keep it that way, the test strategy depends on it.

Non-obvious invariants (full spec: `docs/log-schema.md`):

- **ANSI escapes are stripped in the line splitter, before any regex sees a line** — colored dev output otherwise breaks every format matcher. Partial-line buffering: chunks never align with newlines; hold the tail fragment until the next chunk, flush on stream end or 2 s idle.
- **Aggregation**: a line not matching the source's established `entryStart` pattern continues the previous entry's `body`. Cap: 500 lines / 256 KB per entry; overflow starts a new entry flagged `context.truncated`. 2 s idle flush emits a pending aggregate.
- **Detection is sticky per source**: chain order `monolog → clf → jsonl → bitnami → raw`; a parser locks after scoring ≥ 0.8 on 3 of the first ~20 entries; 10 consecutive raw-fallbacks reset the lock; uploads detect on the first 50 lines then commit for the whole file. User-defined regex parsers from `traceriver.json` insert at the head of the chain.
- **Normalization**: levels map to the 6-value enum (mapping table in `docs/log-schema.md` — includes pino numeric levels and HTTP-status derivation); timestamps → epoch ms UTC, zone-less timestamps assumed host-local, unparseable → arrival time with `rawTimestamp` preserved. `raw` parser never fails.

**Adding a format parser**: implement the `FormatParser` interface (`formats/types.ts` — `name`, `entryStart`, `score()`, `parse()`), register it in `formats/index.ts` at the right chain position, and add a real-world fixture + golden test + it must pass the chunk-boundary fuzz test (see `test/CLAUDE.md`).

## ingest/

One adapter per source type; each produces raw byte chunks tagged with a namespaced source id (`file:`, `docker:`, `local:`) and owns source-specific concerns only (parsing belongs to the pipeline). `upload.ts` streams the request body straight into the pipeline — the whole file is never in memory; 50 MB soft warning, 500 MB hard cap (413). `docker.ts` (phase 2, shipped) is the `DockerManager`: socket resolution (`DOCKER_HOST` → platform default → Podman), 10 s recovery poll, compose-project filtering, **global server-side subscriptions** (unlike per-connection file sources), TTY vs non-TTY demux with a WARN floor on stderr, and events-driven lifecycle with `since`-based dedup on restart re-attach. It talks to the daemon only through `docker-client.ts` — a read-only wrapper exposing exactly `listContainers`/`inspect`/`logs`/`getEvents` (+ ping); no create/exec/remove call may exist anywhere (hard rule), and the `dockerode` import stays lazy/dynamic (an eager import once blew the memory-test RSS ceiling). `tail.ts` (phase 3, shipped) is `TailManager`: one `chokidar`-backed watcher per auto-discovered/`watch`-config target, start-at-EOF for pre-existing files, offset-tracked incremental reads, truncation reset, rotation continuation, and deleted-file resume, all with a 1s reconciliation poll as an always-on backstop. A literal (non-glob) watch target is rewritten into a syntactically-a-glob pattern (a single basename character wrapped in a `[..]` bracket class) before being handed to `chokidar.watch()` — chokidar's fsevents/inotify backend only reliably detects the creation of a not-yet-existing file when the watched pattern is a glob, never for a literal path (see `docs/qa/defects/003-phase-3-auto-discovery-1.md`); the rewritten pattern still matches exactly one path, so this is invisible to the rest of the module.

## cli.ts / cli/

Commander entry (`traceriver start`). Sequence: resolve config → resolve port → generate token → start server → open browser at tokenized URL (`--no-open` suppresses). SIGINT/SIGTERM close the server; nothing survives the process.
