# Phase 2 — Docker Streams

**Objective:** Attach to live log streams from Docker containers in the user's local environment and pipe them through the phase-1 pipeline to the browser in real time. After this phase, starting TraceRiver inside a compose project shows every container in the sidebar, streaming live.

## 2.1 Connecting to the Docker daemon

- Integrate `dockerode` in a **thin read-only wrapper** — the wrapper exposes exactly `listContainers`, `inspect`, `logs`, and `getEvents`, and nothing else. This makes the read-only security guarantee ([architecture.md](../architecture.md#security-model)) structural rather than aspirational.
- **Socket resolution**, in order:
  1. `DOCKER_HOST` env var if set (covers Colima, Rancher Desktop, remote contexts).
  2. Platform default: `/var/run/docker.sock` (macOS/Linux), `//./pipe/docker_engine` (Windows named pipe).
  3. Podman-compatible socket (`$XDG_RUNTIME_DIR/podman/podman.sock`) as a best-effort fallback — the API is Docker-compatible.
- **Failure UX matters more than the happy path**: daemon not running → sidebar shows a dismissible "Docker not detected" card, tool keeps working for files; permission denied on the socket (common on Linux without the `docker` group) → card explains the cause and the fix, no crash, no retry-spam (poll for daemon availability at a gentle 10 s interval and recover automatically when it appears).

## 2.2 Container discovery & selection

- On startup, list running containers and build `SourceDescriptor`s: id `docker:<name>`, plus image, compose service/project labels, and state.
- **Default filter — current project only**: match containers whose `com.docker.compose.project` label corresponds to the working directory (compare against the directory basename and, more reliably, against `name:` in a local `compose.yaml`/`docker-compose.yml` if present). This keeps the sidebar relevant when the user runs six projects' worth of containers.
- "Show all containers" toggle in the sidebar (and `--all-containers` / `docker.allContainers` config) reveals the rest. `docker.include`/`docker.exclude` glob patterns from [configuration.md](../configuration.md) apply on top.
- Containers appear in the sidebar as checkboxes; discovered-but-unsubscribed containers cost nothing (no log stream is opened until subscribed).

## 2.3 Live stream attachment & multiplexing

- On subscribe: `container.logs({ follow: true, stdout: true, stderr: true, tail: 50, timestamps: true })`.
  - `tail: 50` gives immediate context on attach instead of a blank pane.
  - `timestamps: true` prepends Docker's own RFC3339Nano timestamps — the ingest adapter strips them into `rawTimestamp`, giving reliable timestamps even for apps that don't print any. (The parser may override with an app-level timestamp when the line contains one.)
- **Stream demultiplexing — the classic gotcha.** Containers without a TTY multiplex stdout/stderr into one stream with an **8-byte frame header** per chunk; piping it raw into a text parser yields binary garbage every few lines. Inspect the container: if `Config.Tty === false`, run the stream through `docker.modem.demuxStream` into separate stdout/stderr line splitters (stderr lines get a level floor of WARN when the app didn't specify one); if TTY is enabled, the stream is plain text already — demuxing would corrupt it.
- Frame/chunk boundaries still don't align with newlines — the phase-1 partial-line buffering handles this per stream.
- Each subscribed container is one ingest adapter instance feeding the pipeline with its `docker:<name>` tag; parser stickiness operates per container.

## 2.4 Lifecycle & reconnection

- Subscribe to the **Docker events API** (`getEvents`, filtered to container start/stop/die/rename) instead of polling:
  - Container stops → its log stream ends naturally; sidebar marks the source "stopped" (kept visible with its buffered history — a crashed container's last lines are precisely what the user wants to read).
  - Container (re)starts → if it was subscribed, re-attach automatically (`tail` from attach point, avoiding duplicate history); new containers matching the project filter appear in the sidebar live.
- The events stream itself can drop (daemon restart) — reconnect with backoff, then re-list containers to resync sidebar state.
- Unsubscribing destroys the log stream (`stream.destroy()`) — no orphaned connections accumulating against the daemon.

## Exit criteria

- [ ] In a compose project with ≥ 3 containers, `traceriver start` shows exactly that project's containers; the all-containers toggle reveals the rest.
- [ ] Subscribed containers stream live with correct stdout/stderr handling for both TTY and non-TTY containers (verify with one of each — e.g. `mysql` non-TTY, something run with `tty: true`).
- [ ] `docker restart <svc>` while subscribed: stream resumes automatically, no duplicated lines, no zombie streams (daemon connection count stable).
- [ ] Docker not installed / not running / permission denied each produce their specific guidance card and never crash the tool.
- [ ] A container spamming ~5k lines/sec doesn't freeze the UI (batching holds) and memory stays bounded (ring buffer eviction works).
- [ ] Works against Docker Desktop (macOS + Windows named pipe) and Linux socket.
