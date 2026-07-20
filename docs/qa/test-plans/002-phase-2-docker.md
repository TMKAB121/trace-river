# Test Plan 002 — Phase 2: Docker Streams

Spec: [`docs/specs/002-phase-2-docker.md`](../../specs/002-phase-2-docker.md)
Phase doc: [`docs/phases/phase-2-docker.md`](../../phases/phase-2-docker.md)
Tier: 3 (Complex) — full plan + gap-filling tests + rendered evidence.

No `.claude/qa.json` exists in this repo (confirmed absent — same as phase
1), so the zero-dependency default gates were used: `typecheck` = `npm run
typecheck`, `build` = `npm run build`, `test` = `npm test`. No declared
`contract`/`e2e` gate tool exists either, and **`tools/browser.js`
(referenced by this run's instructions) does not exist in this repository**
(confirmed: no `tools/` directory at all, `git log --all -- tools/` returns
nothing). That file is outside the qa-engineer write lane (`test/`,
`docs/qa/` only per `.claude/lanes.json`), so it could not be authored here
either. Rendered evidence below was instead captured by invoking the
system's already-installed Google Chrome directly in headless mode
(`--headless=new --dump-dom` / `--screenshot`) — no new dependency, no
`npx`, just driving a binary already present on the host, in the same spirit
as `tools/browser.js`'s documented capabilities (navigation + DOM dump +
screenshot, no click/drag/keyboard scripting).

## Gate results

| Gate | Command | Result |
|---|---|---|
| typecheck | `npm run typecheck` | **PASS** — no errors |
| build | `npm run build` (server + web) | **PASS** — `dist/` and `dist/web/` produced cleanly |
| test | `npm test` (`vitest run`) | **78/79 passed** — the one failure is an intentional regression test for [defect 2](../defects/002-phase-2-docker-2.md), left red on purpose (see below) |

Full suite after this run's additions: 21 test files, 79 tests (the
phase-1 suite's 14 files / 60 tests, unchanged and still passing, plus 7 new
files / 19 tests under `test/docker/`).

## Test environment

- A real Docker daemon (Docker Desktop for Mac) is running on the QA host,
  with the product owner's own `street_bites` compose project (via Lando)
  already up. Per this run's directive, `street_bites` containers were only
  ever **observed** (listed, read via `docker inspect`/`docker logs`,
  subscribed to in the rendered-evidence pass) — never restarted, renamed,
  stopped, or removed. Confirmed still `Up` and untouched at the end of this
  run (spot-checked via `docker ps`).
- All lifecycle/demux/load/discovery testing used **throwaway containers
  created and destroyed by this run**, every one named with the `tr-qa-`
  prefix (bare `docker run` containers and two disposable `docker compose`
  projects). All were removed by each test's own `afterEach`/`afterAll`
  (or, for the manual rendered-evidence pass, by an explicit `docker compose
  down` at the end) — confirmed zero `tr-qa-*` containers/networks remain
  (`docker ps -a` / `docker network ls`, both empty of any `tr-qa`/`trqa*`
  entries at the end of this run).
- Windows named pipe (criterion 15's Windows leg) is **not testable on this
  macOS host** — marked verified-by-code-review, not FAIL, per this run's
  instructions. Same for the Linux-native-socket leg of criterion 15 (the
  code path is identical to macOS's Unix-socket path modulo the hardcoded
  default path string; not independently run on Linux here).

## Automated tests authored (`test/docker/`)

| File | Purpose |
|---|---|
| `test/docker/helpers.ts` | Shared harness: `dockerAvailable()` gate (suite no-ops via `describe.skipIf` on a host without Docker), `startDockerTestServer()` (real `startServer()` with `docker.enabled: true` + a chosen `cwd`), WS `connect()`/`collect()` (buffers messages **from socket construction**, not from `open` — see the note on a race this fixed, below), `waitFor()`, `closeAll()` |
| `test/docker/discovery.test.ts` | Criteria 1–4: current-project-only default, `docker.include`/`exclude` glob filtering, "Show all containers" data-contract (`inCurrentProject` always sent), newly-discovered-container defaults |
| `test/docker/subscribe-global.test.ts` | Criteria 5–6: subscribe/unsubscribe from one tab is reflected in a second, independent tab (server-global, not per-connection — Decision 5); unsubscribe genuinely stops the daemon-side stream (entryCount stays frozen across repeated polls) |
| `test/docker/demux.test.ts` | Criterion 7: non-TTY demux (no binary frame-header garbage), TTY plain-text passthrough (**fails** — see [defect 2](../defects/002-phase-2-docker-2.md)), stderr-without-a-level floored to WARN |
| `test/docker/lifecycle.test.ts` | Criterion 8 (restart re-attach, no duplicated lines — reliably reproduces [defect 3](../defects/002-phase-2-docker-3.md) in isolation), criterion 9 (stop-without-restart keeps history + `subscribed: true`), Decision 4 (rename → old id settles `stopped` with history intact, new id discovered fresh/unsubscribed/`entryCount: 0`) |
| `test/docker/status-endpoints.test.ts` | Criterion 21: `GET /api/docker/status` mirrors the last WS `dockerStatus`; `GET /api/status`'s `dockerAllContainersDefault` reflects `docker.allContainers`. Criterion 16 (partial): an unreachable `DOCKER_HOST` doesn't break discovery — the platform-default socket is still tried and succeeds |
| `test/docker/disabled.test.ts` | Criterion 18: `docker.enabled: false` never sends `dockerStatus`, never creates a `kind:"docker"` source, over the connection's whole lifetime |
| `test/docker/load.test.ts` + `test/docker/child-docker-runner.ts` | Criterion 14: a spamming container doesn't hang the server (responsiveness probe stays fast), RSS stays within the same owner-accepted ceiling as `test/e2e/memory.test.ts` (300 MB — measured 221–230 MB across runs), and the ring buffer's eviction genuinely caps `bufferUsed` at capacity (a small 2,000-entry buffer used to reach eviction quickly; the mechanism is capacity-independent) |

### A real race this run found and fixed in its own harness (not product code)

`test/docker/helpers.ts`'s original `collect()` attached its "message"
listener only when called, **after** `connect()`'s promise had already
resolved on the client's `open` event. On localhost, the server's very
first pushes (replay entries, `sources`, `dockerStatus`) can arrive in the
same tick as `open`, so a listener attached a microtask later can miss them
— this silently broke exactly the "one-shot, arrives-once" messages
(`dockerStatus` on connect) while happening to not affect tests that later
triggered a *second* copy of the same message type by their own actions.
Fixed by buffering every message from socket construction (a `WeakMap` keyed
by socket) and having `collect()` seed itself from that buffer. This is
harness code (`test/`), not a product fix, and worth calling out because it
could bite a future test author the same way.

## Defects filed

Three real, independently-reproduced backend defects were found while
building out this suite — none were "fixed" here (QA lane doesn't touch
`src/`); see each file for full root-cause analysis, reproduction, and
impact:

| # | Area | Severity | Summary |
|---|---|---|---|
| [002-phase-2-docker-1](../defects/002-phase-2-docker-1.md) | backend | high | A subscribed container whose lines don't confidently match monolog/CLF/JSON gets **zero** entries delivered for up to ~20 real-time log lines (the shared live-detection pipeline withholds everything until it commits), directly contradicting acceptance criterion 5's "within one broadcast interval." Confirmed via a plain-text vs. JSON-formatted control container. |
| [002-phase-2-docker-2](../defects/002-phase-2-docker-2.md) | backend | high | Every entry from a **TTY-enabled** container has the raw Docker RFC3339Nano timestamp prefix leaking into its visible `message` (never stripped), and `rawTimestamp` stays `null` while `timestamp` degrades to a coarse, batching-dependent arrival time — because the timestamp-strip regex never matches TTY output's `\r\n`-terminated lines. Non-TTY is unaffected (plain `\n`). Directly violates criterion 7's "renders as plain text without corruption." |
| [002-phase-2-docker-3](../defects/002-phase-2-docker-3.md) | backend | high | `docker restart` on a subscribed container re-delivers already-seen lines: reattach always uses `tail: 50` regardless of overlap, and Docker's default log driver doesn't truncate on restart, so a reattach shortly after a restart re-reads pre-restart history. Directly violates criterion 8's "no duplicated lines across the restart boundary." Confirmed both via raw `docker logs` and end-to-end through the pipeline; the automated regression test's exact duplicate count is timing-dependent (documented in the defect). |

## Rendered evidence

`docs/qa/evidence/002-phase-2-docker/`, captured against the real, built
production bundle (`dist/web`) served by the real, built server
(`node dist/cli.js start`), driven with headless Chrome (`--headless=new`,
`--dump-dom` / `--screenshot`) since no click/drag/keyboard scripting is
available (same hard limitation the phase-1 evidence pass documented):

- `01-current-project-default.png` / `.dom.html` — a throwaway 3-container
  compose project (`trqaevidence`), default startup (no `--all-containers`):
  Containers section shows **exactly** those 3 rows, `aria-checked="false"`
  on the toggle, `<section aria-labelledby="containers-heading">` /
  `files-heading` with real `<h3>` headings confirmed in the DOM, and each
  row's `title` attribute confirmed as exactly
  `"<image> · <composeProject>/<composeService>"` (e.g. `"alpine:3 ·
  trqaevidence/app"`) — criteria 1, 17, and the accessibility landmark
  requirement.
- `02-show-all-containers-default.png` / `.dom.html` — same project,
  started with `--all-containers`: `aria-checked="true"`, and all **11**
  discovered containers render (the 3 project containers plus 7 real
  `street_bites`/Lando containers plus the Lando proxy container, observed
  only, never touched) — criterion 2's data contract and the toggle's
  visual ON state (`--color-accent-interactive` track).
- `03-docker-disabled-flat-sidebar.png` / `.dom.html` — `docker.enabled:
  false` via `traceriver.json`: confirmed the DOM contains **no**
  `containers-heading`/`files-heading` sections at all, just the exact
  phase-1 flat `sidebar__empty` markup and copy — criterion 18.

Not capturable by navigation alone (no interaction capability, same gap the
phase-1 evidence pass documented): the Docker status card's three failure
variants (would need to simulate daemon unavailability without disturbing
the real, working daemon this host depends on — see below), the
dismiss-card and toast-on-recovery states (both require a click/a
transition after page load), and the `STOPPED`/`ERROR` state-label
rendering (both reachable but not captured here given time; verified
instead by static code/CSS review of `SourceRow.tsx`/`.css` against the
design tokens, and functionally by the automated lifecycle tests above).

## Acceptance criteria → verification mapping

| # | Criterion | Verified by |
|---|---|---|
| 1 | Current-project-only default discovery | `test/docker/discovery.test.ts` (server data contract) + evidence `01-current-project-default.png`/`.dom.html` (rendered sidebar, exactly 3 rows) — **PASS** |
| 2 | "Show all containers" reveals everything, no extra request | `test/docker/discovery.test.ts` (server always sends `inCurrentProject`-tagged out-of-project sources regardless of toggle) + evidence `02-show-all-containers-default.png` (11 rows rendered from one `GET`/WS connect, no additional network call needed to reveal them) — **PASS** |
| 3 | `docker.include`/`exclude` applied server-side, QA/backend-owned | `test/docker/discovery.test.ts` (2 tests: include-only and exclude-glob) — **PASS** |
| 4 | Newly discovered container defaults: unchecked, count 0, no entries until subscribed | `test/docker/discovery.test.ts` — **PASS** |
| 5 | Checking a container: `subscribe` sent, attaches with `tail:50`, sidebar + stream reflect output "within one broadcast interval", second tab sees the same | `test/docker/subscribe-global.test.ts` (both tabs receive entries from a single subscribe call) — **PASS for the mechanism**, but see [defect 1](../defects/002-phase-2-docker-1.md): the "within one broadcast interval" wording is **violated** for containers whose output isn't monolog/CLF/JSON-shaped (common case) — up to ~20s delay. Verdict for this row: **FAIL** (defect 1) |
| 6 | Unchecking stops the daemon-side stream; count frozen in every tab | `test/docker/subscribe-global.test.ts` (entryCount verified frozen across repeated `GET /api/sources` polls after unsubscribe, not just "briefly slowed") — **PASS** |
| 7 | TTY vs. non-TTY demux correctness; stderr WARN floor | `test/docker/demux.test.ts` — non-TTY demux clean (**PASS**), stderr WARN floor correct (**PASS**), **TTY plain-text corrupted — FAIL** ([defect 2](../defects/002-phase-2-docker-2.md)) |
| 8 | Restart: live→stopped→live automatic, no duplicated lines, stream/connection count back to baseline | `test/docker/lifecycle.test.ts` — state transitions and re-attach-without-user-action **PASS**; "no duplicated lines" **FAILS** reliably in isolation ([defect 3](../defects/002-phase-2-docker-3.md)) |
| 9 | Stop-without-restart: row stays visible, `STOPPED`, checkbox stays checked, history intact | `test/docker/lifecycle.test.ts` — **PASS** |
| 10 | Docker not detected: card + dismiss, files/other sources keep working, no crash | Not independently producible end-to-end on this host (see § Known limitations below) — verified by **static code review** of `src/ingest/docker-client.ts`'s `classifyFailure()` and `web/src/components/DockerStatusCard.tsx` against the spec's copy table (exact heading/body text match confirmed by direct comparison); `docker.enabled:false`'s "rest of the console keeps working" equivalent **is** confirmed live via evidence `03-docker-disabled-flat-sidebar.png` (file upload area fully rendered/functional) |
| 11 | Docker not running: card + auto-recovery within ~10s poll | Same limitation as #10 — static code review of `DockerManager.attemptConnect()`/`startPoll()` (10s `setInterval`, `unref()`'d) confirms the poll exists and reconnects/broadcasts on recovery; not exercised live (would require stopping the one real, working daemon this host depends on) |
| 12 | Permission denied: card + backend `detail`, dismiss-until-status-changes | Same limitation — static code review of `classifyFailure()`'s `EACCES` branch and `permissionDeniedDetail()`'s platform-specific copy; not exercised live (see below) |
| 13 | Dismiss is per-status-value, session-only, resets on reload | Static code review — `store.tsx`'s `DISMISS_DOCKER_STATUS_CARD`/`dismissedDockerStatuses` (a `Set<DockerStatus>`, not a single boolean) confirms dismissing one failure value doesn't suppress a later, different one; not exercised via a live status transition (see below) |
| 14 | ~5k lines/sec: UI/server stays responsive, memory bounded, eviction notice mechanism works | `test/docker/load.test.ts` — **PASS** (max status latency 10–16ms across runs, well under any freeze threshold; peak RSS 221–230 MB, within the owner-accepted 300 MB ceiling; ring buffer's `bufferUsed` genuinely caps at the configured capacity rather than growing unbounded, confirming the server-side signal the client's "Showing last N entries" notice depends on) |
| 15 | Cross-platform (macOS/Windows/Linux) socket support, QA/backend-owned | macOS: exercised throughout this entire run (real Docker Desktop daemon). Windows named pipe: **not testable on this macOS host** — verified-by-code-review only (`src/ingest/docker-client.ts`'s `buildCandidates()`: `process.platform === "win32"` branch uses `//./pipe/docker_engine`, structurally parallel to the macOS/Linux path). Linux native socket: same code path as macOS (`/var/run/docker.sock`), not independently run on Linux — code review only |
| 16 | Socket resolution order: `DOCKER_HOST` > platform default > podman fallback | `test/docker/status-endpoints.test.ts` (partial: an unreachable `DOCKER_HOST` doesn't break resolution — falls through to the platform default) + static code review of `buildCandidates()`'s ordered array construction (`DOCKER_HOST` pushed first only if set, then the hardcoded platform default, then podman only if `XDG_RUNTIME_DIR` is set) for the full ordering guarantee. Precedence when `DOCKER_HOST` **is** reachable (should win over the platform default) not independently verified — would need a second, real Docker-API-compatible endpoint to point `DOCKER_HOST` at, not available here |
| 17 | Row tooltip shows image + compose metadata, no layout effect | Evidence `01-current-project-default.dom.html` — `title` attributes confirmed exactly `"<image> · <composeProject>/<composeService>"` for all 3 rows; "no effect on collapsed row's fixed layout" confirmed by design review against rendered evidence (visual row height/alignment unchanged from spec 001, per `02-show-all-containers-default.png`'s uniform row heights even with long labels/tooltips) |
| 18 | `docker.enabled:false` → phase-1-identical flat sidebar, no dockerStatus ever | `test/docker/disabled.test.ts` (zero `dockerStatus` messages, zero docker sources, over the connection's whole lifetime) + evidence `03-docker-disabled-flat-sidebar.png`/`.dom.html` (DOM confirmed free of any Containers/Files section markup) — **PASS** |
| 19 | Toggle/dismiss keyboard-reachable + focus ring; live-region announces transitions once | Static code review: `ContainersSection.tsx`'s toggle and `DockerStatusCard.tsx`'s dismiss are both real `<button>`s (native Tab order, Enter/Space "for free"); global `:focus-visible` rule from spec 001 is unscoped so it applies here too (confirmed no override in `ContainersSection.css`/`DockerStatusCard.css`). `store.tsx`'s `dockerStatusAnnouncement()`/`SET_ANNOUNCEMENT` calls are gated on `prevStatus !== msg.status` (status card) and `prior.state !== msg.state` (per-source stopped/restarted) — confirmed by code reading these only fire on an actual transition, never on a repeated poll tick reporting the same value. Not exercised via real Tab-key traversal or a screen reader (no interaction capability) |
| 20 | Contrast / STOPPED-ERROR distinguishability without color alone | Design-review-owned per the spec's own footer; not re-derived here. Code-level confirmation only: `SourceRow.tsx` renders real text ("Stopped"/"Error"), not a color-only dot; `SourceRow.css` differs `--color-text-muted` vs. `--color-level-error` per spec |
| 21 | `GET /api/docker/status` mirrors WS push; `dockerAllContainersDefault` matches config | `test/docker/status-endpoints.test.ts` (3 tests: mirror match, `allContainers:true` reflected, default-false reflected) — **PASS** |

### Phase doc (`phase-2-docker.md`) exit-criteria cross-check

| Exit criterion | Status |
|---|---|
| ≥3-container compose project shows exactly that project's containers; all-containers toggle reveals the rest | **PASS** — criteria 1–2 |
| Subscribed containers stream live with correct TTY/non-TTY handling | **PARTIAL FAIL** — non-TTY demux and stderr floor correct; TTY output corrupted ([defect 2](../defects/002-phase-2-docker-2.md)) |
| `docker restart` resumes automatically, no duplicated lines, no zombie streams | **PARTIAL FAIL** — auto-resume works; duplicated lines confirmed ([defect 3](../defects/002-phase-2-docker-3.md)); "daemon connection count stable" not independently instrumented beyond functional re-attach behavior |
| not installed/not running/permission denied each produce specific guidance, never crash | Not independently exercised end-to-end (see § Known limitations) — verified by code review only |
| ~5k lines/sec doesn't freeze UI, memory bounded | **PASS** — criterion 14 |
| Works against Docker Desktop (macOS + Windows) and Linux socket | macOS **PASS** (this whole run); Windows/Linux — code review only |

## Known limitations of this run

1. **`tools/browser.js` does not exist in this repository** (see the header
   above) — evidence was captured with a direct headless-Chrome invocation
   instead, staying within the "navigation + DOM dump + screenshot, no
   interaction" capability boundary that tool is documented to have.
2. **The three Docker daemon-failure statuses (`not_installed`,
   `not_running`, `permission_denied`) could not be produced end-to-end on
   this host.** A real, working Docker daemon is already listening at the
   hardcoded platform-default socket path (`/var/run/docker.sock`), which
   `DockerClient.resolve()` always reaches regardless of what `DOCKER_HOST`
   is pointed at — so the failure branches of `classifyFailure()` are
   structurally unreachable without either (a) stopping the real daemon
   (which would also take down `street_bites`, explicitly off-limits) or (b)
   modifying product code to make the platform-default path configurable
   for tests (not a QA-lane change). These three statuses, the recovery
   toast, and the dismiss-persists-until-a-different-failure behavior are
   therefore verified by **static code review only** (see the criteria table
   above for exactly what was read and confirmed). This is a genuine gap,
   not a shortcut — flagged under OPEN QUESTIONS in the handoff for the
   product owner's awareness, since closing it would require either a
   sanctioned way to fake daemon-down (e.g. a test-only socket-path override)
   or accepting code review as sufficient for this class of criterion.
3. Windows named pipe and native Linux socket legs of criteria 15/16 are
   code-review-only, per this run's own instructions (not testable on this
   macOS host).
4. `DOCKER_HOST` **taking precedence when reachable** (as opposed to merely
   "not breaking resolution when unreachable," which *was* tested) wasn't
   independently verified — doing so would need a second real
   Docker-API-compatible endpoint (e.g. a fake unix-socket HTTP server
   mimicking `/_ping`), which wasn't built given this run's time budget.
