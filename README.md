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
- **Drop area** — drag any `.log` / `.txt` / `.json` file in and it joins the river as a static source.

## Roadmap

| Phase | Name | Scope |
|-------|------|-------|
| 0 | [Foundation](docs/phases/phase-0-foundation.md) | npm name claim, repo setup, license, account security |
| 1 | [Core Console](docs/phases/phase-1-core.md) | CLI + local server, React UI, parser pipeline, file upload |
| 2 | [Docker Streams](docs/phases/phase-2-docker.md) | Live container log attachment via the Docker daemon |
| 3 | [Auto-Discovery](docs/phases/phase-3-auto-discovery.md) | Framework fingerprinting and automatic log-file tailing |
| 4 | [Error Intelligence](docs/phases/phase-4-error-intelligence.md) | Error grouping, spike detection, AI prompt generation |

## Documentation

| Doc | Contents |
|-----|----------|
| [Architecture](docs/architecture.md) | Process model, data flow, transport, security, packaging |
| [Log Schema & Parser Pipeline](docs/log-schema.md) | The `TraceRiverLog` contract and how raw lines become structured entries |
| [Configuration](docs/configuration.md) | CLI flags and the `traceriver.json` config file |
| [Decisions](docs/decisions.md) | Why React, TypeScript, WebSockets, Fastify, and the rest |

## Principles

- **Local-first, zero config.** No accounts, no API keys, no cloud. `npx traceriver start` must be useful with zero setup.
- **Read-only.** TraceRiver observes your environment (Docker socket, log files) and never mutates it.
- **Fast under fire.** A misbehaving container can emit thousands of lines per second; the UI must stay responsive (virtualized rendering, batched transport, bounded memory).

## Status

Pre-implementation. The phase documents above are the build plan.
