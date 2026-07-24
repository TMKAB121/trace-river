# Decisions

Lightweight ADRs — one paragraph each, recording *why* so future contributors (and future us) don't relitigate. Date is when the decision was made.

## D1 — React for the frontend (2026-07-19)

React over Vue/Svelte. The deciding factors are ecosystem fit for this specific app: TanStack Virtual is the most battle-tested virtualization library and is React-first, and the WebSocket/state patterns needed here are well-trodden. Bundle size matters little for a locally-served SPA. Vue and Svelte would both work; React maximizes contributor familiarity.

## D2 — TypeScript throughout (2026-07-19)

The project's core is a data contract (`TraceRiverLog`) shared across backend, WS protocol, and frontend — `src/shared/` types imported by both sides make protocol drift a compile error instead of a runtime surprise. Backend compiles with `tsc`; frontend via Vite. No plain-JS escape hatches.

## D3 — WebSocket over SSE (2026-07-19)

The channel is bidirectional: clients subscribe/unsubscribe sources and clear buffers, the server pushes entries, source-state changes, and error groups. With SSE those client→server messages become a parallel REST surface and two channels to keep in sync. One WS connection (`ws` library, no socket.io — no fallback transports needed on localhost) carries everything. Batched flushes (~75 ms) rather than per-entry frames.

## D4 — Fastify over Express (2026-07-19)

Lighter, faster, first-class TypeScript, built-in schema validation for the REST endpoints, and `@fastify/static` for serving the SPA. Express would work but brings no advantage in 2026.

## D5 — Server-side parsing for uploads (2026-07-19)

Uploaded files are POSTed and parsed by the same backend pipeline as live streams, rather than parsed in the browser with a Web Worker. One pipeline to build, test (golden fixtures + chunk-boundary fuzz), and extend; uploads exercise the exact code path live streams use. Cost: an upload round-trips through localhost — negligible.

## D6 — Default port 7580 (2026-07-19)

3000/5173/8000/8080 are claimed by the tools our users run all day; colliding with the user's own dev server on first run is the worst possible first impression. 7580 is unassigned in practice, memorable enough, auto-increments if taken, and `--port` overrides. An explicitly passed port errors on conflict instead of silently moving.

## D7 — Single package, no monorepo (2026-07-19)

One publishable artifact, one version, `web/` builds into `dist/web` inside the same tarball. A monorepo (separate `@traceriver/ui`, `@traceriver/server`) adds release coordination for zero consumer benefit — nobody installs the UI standalone. Revisit only if a programmatic API package becomes a real request.

## D8 — Session-token security model (2026-07-19)

Binding to 127.0.0.1 is necessary but not sufficient: any website in the user's browser can issue requests to localhost ports, and DNS rebinding defeats origin assumptions. A per-run crypto-random token required on every request/WS upgrade, plus Host/Origin validation, closes both — important because the server fronts the Docker socket (read-only, but container logs are sensitive). Details in [architecture.md](architecture.md#security-model).

## D9 — v1 AI integration is clipboard-only (2026-07-19)

The Generate AI Prompt feature assembles context; it does not call model APIs. No key management, no billing surprises, no network egress from a tool whose pitch is "fully local", and it works with whatever assistant the user already pays for. BYO-key integration and an MCP server mode are noted as future work in [phase 4](phases/phase-4-error-intelligence.md).

## D10 — Package name: `traceriver` (2026-07-19)

Both `traceriver` and `trace-river` were unclaimed on npm as of 2026-07-19. Ship as `traceriver` (matches the CLI binary); claiming `trace-river` as a pointer package is optional insurance. **Claim the name early** — before the first public release, publish a 0.0.1 placeholder.

## D11 — Project association prefers exact path signals over name heuristics (2026-07-22)

Phase 2 associated containers with the current project by name: `com.docker.compose.project` vs. a name derived from cwd (compose-file `name:`, else normalized basename). Real stacks break this — Lando derives `streetbites` from `street_bites` and keeps its compose files in `~/.lando/compose/`, so nothing matched (phase 5, scenario S1). Tools stamp the host project's absolute path onto containers (`io.lando.root`, `com.docker.compose.project.working_dir`); comparing that against cwd is deterministic where name normalization is guesswork. Matching order is therefore path label → compose-file `name:` → normalized basename, strictly short-circuiting: an applicable path signal decides even when negative — a weaker name heuristic must not override an exact path that says "no". Forward direction only (label equals or is an ancestor of cwd); reverse/monorepo matching was explicitly deferred by the product owner pending a real captured scenario, because a broad cwd (e.g. `~/projects`) would associate every container beneath it. Details in [architecture.md](architecture.md#docker-project-association-phases-2--5).

## D12 — Recognize Bitnami container-library log lines as a first-class format (2026-07-23)

Bitnami images (Redis, MariaDB, nginx, PostgreSQL, and the reverb/nginx/cache containers in the street_bites stack) emit their entrypoint/setup logs to **stderr** in a fixed shape — `<module> <HH:MM:SS.ff> <LEVEL> ==> <message>` — where the app states its own level (INFO/DEBUG/WARN/ERROR). No built-in parser matched it, so the source locked onto `raw`, which ignores that declarative level; the docker adapter's stderr WARN floor then lifted every self-declared INFO/DEBUG line to WARN, and occasional keyword hits in echoed config text produced false ERROR (issue #8). A narrow `bitnami` parser, positioned just ahead of `raw` (it only fires on the `==>` marker other parsers never claim), extracts the declared level; because the level is then known, the floor — which fills UNKNOWN only — no longer overrides it. The bare wall-clock time carries no date and is discarded in favor of Docker's per-line timestamp. Separately, the `raw` parser now classifies pure-decoration lines (banner ASCII art of box/block glyphs, or a rule of ≥4 repeated separator chars) as DEBUG so startup splashes sink below the default view instead of reading as UNKNOWN/WARN noise — matched only when the whole line is decoration, so a comment like `# Based on …` is never caught.
