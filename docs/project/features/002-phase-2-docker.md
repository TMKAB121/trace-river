# Feature 002 — Phase 2: Docker Streams

**Status:** Shipped. QA PASS (81/81 tests, 21/21 acceptance criteria), design
verification **APPROVED** (re-review, after two findings fixed).

- Spec: [`docs/specs/002-phase-2-docker.md`](../../specs/002-phase-2-docker.md)
- Design review: [`docs/design-reviews/002-phase-2-docker.md`](../../design-reviews/002-phase-2-docker.md)
- QA test plan: [`docs/qa/test-plans/002-phase-2-docker.md`](../../qa/test-plans/002-phase-2-docker.md)
- Defect reports filed during the fix loop (all fixed and re-verified before
  design review's re-review pass):
  [`docs/qa/defects/002-phase-2-docker-1.md`](../../qa/defects/002-phase-2-docker-1.md)
  (live entries withheld pending format detection),
  [`-2.md`](../../qa/defects/002-phase-2-docker-2.md) (TTY timestamp-prefix
  leak into `message`),
  [`-3.md`](../../qa/defects/002-phase-2-docker-3.md) (`docker restart`
  re-delivering pre-restart lines)
- Phase doc: [`docs/phases/phase-2-docker.md`](../../phases/phase-2-docker.md)
- Rendered evidence: [`docs/qa/evidence/002-phase-2-docker/`](../../qa/evidence/002-phase-2-docker/)

## What shipped

A second, live-by-nature source kind — running Docker containers in the
user's current Docker Compose project — attaches into the same Uniform
Parser Pipeline and unified stream phase 1 already built. Nothing about
phase 1's top bar, unified stream, row expansion, search/filtering,
Freeze/Clear, or file-upload behavior changed; this phase is additive to the
sidebar and to the WS/REST contract.

- **Discovery**: on startup (and on any Docker `start`/`stop`/`die`/`rename`
  event), the server lists running containers and filters to those whose
  `com.docker.compose.project` label (or a local `compose.yaml`/
  `docker-compose.yml` `name:` field) matches the current working
  directory's project name, plus `docker.include`/`docker.exclude` glob
  filtering (server-side, before any client sees them). Every discovered
  container is still sent to the client tagged `inCurrentProject` —
  "Show all containers" (or `--all-containers`) is a purely client-side
  render filter, not a server round trip.
- **Subscription is server-global, not per-connection** (spec Decision 5,
  a deliberate deviation from phase 1's per-tab file-source model): checking
  a container's box in one browser tab attaches one shared
  `container.logs()` stream and flips every connected tab's checkbox;
  unchecking destroys that stream for every tab. A newly discovered
  container defaults to unsubscribed, entry count 0 — no daemon stream
  opened, no cost, until subscribed.
- **Streaming**: `tail: 50` + `follow: true` on first attach. Non-TTY
  containers are demultiplexed (stdout/stderr split via `dockerode`'s
  `modem.demuxStream`), with stderr lines lacking their own level floored to
  WARN; TTY containers stream as plain text, never demuxed.
- **Lifecycle**: a container stopping (without restart) settles its source
  to `stopped`, stays visible with history intact, checkbox stays checked.
  A restart automatically re-attaches (no user action) using a Docker
  `since` timestamp scoped to the last line actually read — not `tail: 50`
  — so no duplicate lines cross the restart boundary. A `rename` event is
  treated as a brand-new, unrelated source (spec Decision 4): the old id
  settles to `stopped` permanently with its history; the new id is
  discovered fresh, unsubscribed, entry count 0 — no continuity.
- **Daemon status**: socket resolution order `DOCKER_HOST` env var →
  platform default (`/var/run/docker.sock` / `//./pipe/docker_engine`) →
  Podman-compatible socket. Three failure classifications
  (`not_installed`, `not_running`, `permission_denied`) drive a dismissible
  sidebar status card (dismissal is per-status-value, session-only); a
  quiet 10 s recovery poll retries in the background with no crash and no
  retry spam. `not_installed`/`not_running` is a best-effort heuristic
  (socket-file existence / `docker` on `PATH`); `permission_denied` is an
  exact `EACCES` signal.
- **Frontend**: the sidebar splits into **Containers** and **Files**
  sub-sections (each a real `<section aria-labelledby>` + `<h3>`) whenever
  Docker isn't settled `disabled`; a tri-state `dockerAvailability`
  (`"unknown" | "enabled" | "disabled"`) renders the sectioned
  "Checking Docker…" loading state for both `"unknown"` and `"enabled"`, and
  only falls back to phase 1's flat list once genuinely `"disabled"` (either
  by direct signal, or a one-shot 400 ms post-connect settle-guard timer).
  Container rows reuse phase 1's `SourceRow` with an added `STOPPED`/`ERROR`
  text state label (scoped to docker sources only) and an extended tooltip
  (`"<image> · <composeProject>/<composeService>"`). "Show all containers"
  is a pill-switch toggle seeded from `GET /api/status`'s
  `dockerAllContainersDefault`.

## Endpoints / UI / tests touched

- **REST**: `GET /api/docker/status` (new); `GET /api/status` extended with
  `dockerAllContainersDefault`.
- **WebSocket**: `GET /ws` — new `{ type: "dockerStatus", status, detail }`
  server→client message, sent once after the `sources` snapshot on connect
  (never sent at all when `docker.enabled: false`) and again on any status
  transition. No new client→server message — `subscribe`/`unsubscribe`
  generalize to `docker:<name>` ids, with server-global effect for that
  kind.
- **`SourceDescriptor`**: new optional `docker: { image, composeProject,
  composeService, inCurrentProject }` field, present only for
  `kind: "docker"`.
- **UI**: sectioned Containers/Files sidebar, all three status-card
  variants, "Show all containers" toggle, STOPPED/ERROR state labels,
  extended row tooltip, "Docker connected" recovery toast, new live-region
  announcements for status transitions and per-subscribed-source
  stopped/restarted transitions.
- **Tests**: `test/docker/` (9 files) — `discovery.test.ts`,
  `subscribe-global.test.ts`, `demux.test.ts`, `lifecycle.test.ts`,
  `status-endpoints.test.ts`, `disabled.test.ts`, `load.test.ts` +
  `child-docker-runner.ts`, `recovery-ordering.test.ts` (added during design
  review's re-review pass), plus shared harness `helpers.ts`. Run against a
  real local Docker daemon; `describe.skipIf`s itself on a host without one.

## Changed files

Backend: `src/ingest/{docker-client,docker}.ts` (new), `src/types/
dockerode.d.ts` (new), `src/server/routes/docker-status.ts` (new),
`src/server/routes/status.ts`, `src/shared/{types,config}.ts`, `src/cli.ts`
(`--all-containers`), `src/server/{app-state,sources,broadcaster,ws,
index}.ts`, `src/parsers/{pipeline,aggregator}.ts`, `src/parsers/formats/
types.ts`, `package.json` (+`dockerode`).

Frontend: `web/src/types.ts`, `web/src/store/store.tsx`, `web/src/
components/{Sidebar,SourceRow}.tsx`+`.css`, `ContainersSection.tsx`+`.css`
(new), `FilesSection.tsx` (new), `DockerStatusCard.tsx`+`.css` (new).

Tests: `test/docker/*` (new directory, 9 files, 21 tests added to the
suite: 60 phase-1 tests → 81 total).

## Known deviations / limitations

- **Live entries provisionally tag `raw` for up to ~20 lines** while a
  subscribed container's per-source format detection is still committing
  to a parser, with no retroactive re-tagging once it locks — accepted by
  the product owner as in-scope behavior, not a defect (see [defect
  1](../../qa/defects/002-phase-2-docker-1.md), fixed to reduce
  first-entry latency from ~20s to under 1s, but the provisional-tag window
  itself remains).
- **`not_installed` vs. `not_running` is a heuristic**, not an exact signal
  — see `src/ingest/docker-client.ts` `classifyFailure()`.
- **The three daemon-failure status cards, the recovery toast, and the
  dismiss-persists-until-a-different-failure behavior were verified by
  static code review only**, not exercised live — the QA host had one real,
  already-working Docker daemon backing the product owner's own
  `street_bites` project, and stopping it to simulate a failure was
  explicitly off-limits for this run.
- **Windows named pipe and native Linux socket support are code-review-
  verified only** — this run's host was macOS; the platform-branch code in
  `buildCandidates()` was read and confirmed structurally parallel, not
  executed on either platform.
- `DOCKER_HOST` *taking precedence when reachable* (as opposed to merely
  "not breaking resolution when unreachable," which was tested) wasn't
  independently verified — would need a second real Docker-API-compatible
  endpoint, not available in this run.

## Scope explicitly deferred

Local file tailing / auto-discovery (`kind: "local"`, phase 3) — the
`SourceDescriptor` shape and sidebar were already generic enough to accept
Docker without rework, and phase 3 is expected to follow the same pattern.
Any write/exec/create access to the Docker daemon (permanently out of
scope, not just deferred — read-only by construction). A manual "rescan
containers" button (discovery is event-driven off the Docker events API,
not polled, aside from the daemon-connectivity poll). Any change to the top
bar, unified stream's visual grammar, or file-source behavior.
