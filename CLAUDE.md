# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

TraceRiver is a local-development log console shipped as a single npm package (`traceriver`, bin `dist/cli.js`). One Node process: a Fastify server on `127.0.0.1` that ingests logs from four source kinds — uploaded files, live Docker container streams, auto-discovered/config-declared tailed files, and (macOS) environment tool logs — parses them all through one normalized pipeline, and streams them over WebSocket to a pre-built React SPA. No daemon, no state outliving the process, no telemetry.

**Status**: Phases 1–5 are shipped and product-owner-accepted (Core Console, Docker streams, auto-discovery + tailing, error intelligence, project association). Phase 5 is a *living* phase — real-world "current project" detection gaps fixed incrementally; currently through batch 1 (Lando). `docs/phases/` holds the per-phase plans as **historical build docs**, not a forward roadmap. The one open item is backlog B3 (see `docs/backlog.md`): the tailer misses file creation when the parent directory is absent at startup.

## Commands

```bash
npm run build        # tsc -> dist/  +  vite build -> dist/web/
npm run dev          # backend (tsx watch, port 7580) + Vite dev server (5173) in parallel
npm test             # vitest run — entire suite
npm test -- test/parsers/clf.test.ts   # single test file
npm run typecheck    # backend only (root tsconfig excludes web/; web typechecks via its own tsconfig)
npm start            # node dist/cli.js start (requires a build)
```

Dev mode: the Vite server proxies `/api` and `/ws` to the backend on 7580. The backend prints its session token on startup — open `http://localhost:5173/?token=<that token>`. `npm start` / the real CLI opens the tokenized URL automatically.

## Architecture (the shape that spans multiple files)

```
ingest adapter → line splitter → multi-line aggregator → format parsers → normalizer
   (chunks)         (lines)      (entries w/ stack traces)  (monolog|clf|jsonl|raw)
                                        ↓
                            ring buffer (assigns monotonic id)
                                        ↓
                          WS broadcaster (batched) → browser SPA
```

- **Everything parses server-side** — uploads included — so there is exactly one pipeline. The browser only ever sees `TraceRiverLog` objects.
- **`src/shared/types.ts` is the wire contract** (`TraceRiverLog`, `SourceDescriptor`, WS message unions). It is imported by both backend and `web/`, so protocol drift is a compile error. Any change here ripples across server, client store, and `docs/log-schema.md` — keep all three in sync.
- **Replay model**: the ring buffer's `id` is the replay cursor. A new WS connection gets the buffer contents first, then live entries; clients that fall behind get `{type:"dropped"}` and re-sync via `GET /api/replay?after=<id>`. The server buffer is always authoritative.
- Per-directory detail: see `src/CLAUDE.md`, `web/CLAUDE.md`, `test/CLAUDE.md`.

## Hard rules

- **Bind `127.0.0.1` only, never `0.0.0.0`.** Session-token auth (`Authorization: Bearer` on every `/api/*` route, `?token=` on the WS upgrade) plus Host/Origin validation on every request. These exist to defeat DNS rebinding and hostile localhost pages — do not weaken them for convenience.
- **Docker access (phase 2+) is read-only by construction**: the wrapper may expose only list/inspect/logs/events. No create/exec/remove call may exist anywhere in the codebase.
- **Dependency allowlist** (`.claude/lanes.json`): runtime deps are limited to `fastify`, `@fastify/static`, `ws`, `dockerode`, `chokidar`, `commander` — all pure JS, no native compilation, no postinstall. Frontend deps are devDependencies baked into `dist/web` at build time. Adding any dependency requires product-owner approval and an allowlist entry first. No icon libraries; no CDN assets (the tool must work fully offline).
- **Port 7580 default**: auto-increments (+20 max) when taken, but an explicitly passed `--port` errors on conflict instead.
- **No `.env`**: configuration is CLI flags > `traceriver.json` > built-in defaults (`src/shared/config.ts`). `port`, `buffer`, `open`, `docker`, `discovery`, and `watch` are all resolved and acted on. Still scaffolding: the `parsers` section (custom regex parsers) and the `traceriver init` command are declared/documented but not implemented.

## Docs

`docs/` is extensive and has its own `docs/CLAUDE.md` explaining which files are authoritative vs. process artifacts. Minimum to know: `docs/architecture.md` and `docs/log-schema.md` are the binding specs; `docs/decisions.md` holds one-paragraph ADRs (add one when making an architectural choice, so it isn't relitigated); `docs/design-system.md` is the single source of truth for every visual value in the UI.

## Agentic pipeline conventions

Features are built via the agentic-dev pipeline (UX spec → parallel dev → QA → design verification → docs). `.claude/lanes.json` defines per-agent write scopes (e.g. frontend may only touch `web/`, QA only `test/` + `docs/qa/`) and names backend-developer as the sole dependency installer. Artifacts share a feature number: `docs/specs/NNN-slug.md`, `docs/qa/*/NNN-slug*`, `docs/design-reviews/NNN-slug.md`, `docs/pipeline/NNN-slug.md` (run state), `docs/project/features/NNN-slug.md`. Hooks enforce the dependency allowlist and block `npx`-invoked tools — use npm scripts or `node_modules/.bin/` binaries; verify packed tarballs by tar-extract + `npm install --omit=dev` inside the extracted package rather than `npm install <tarball>`.
