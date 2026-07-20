# Phase 5 — Real-World Project Association

**Objective:** Make "current project" detection work drop-in for real local stacks — not just vanilla `docker compose` projects. Phase 2 shipped label-vs-directory-name matching; this phase collects the real-world scenarios where that heuristic fails and fixes them with stronger, evidence-based signals. Unlike phases 0–4, this is a **living collection document**: new association gaps get appended as they are found in the field, each with captured evidence, and are batched into implementation runs.

## Design direction (applies to all scenarios)

- **Prefer exact path signals over name heuristics.** Container labels frequently carry the host project path (`com.docker.compose.project.working_dir` for vanilla Compose, `io.lando.root` for Lando). An absolute-path comparison against TraceRiver's cwd (or an ancestor of it) is deterministic; name normalization is guesswork. Matching order should become: path label match → compose-file `name:` → normalized basename (the phase-2 fallback, kept last).
- Association must remain **read-only and offline** — signals come from `listContainers`/`inspect` label data already fetched; no new daemon capabilities, no tool-specific SDKs.
- Every fix lands with a captured-label fixture (a JSON snapshot of the real container's labels) so the matcher is regression-tested against reality, not an idealized example.
- A container matched by any signal still respects `docker.include`/`docker.exclude` and the all-containers toggle exactly as in phase 2.

## Scenario log

### S1 — Lando apps don't associate (found 2026-07-20, macOS, Lando + Laravel)

**Symptom:** Running `traceriver start` from the project root (`~/projects/street_bites`) shows a healthy Docker connection and streams logs, but all of the project's containers appear only under "Show all containers" — `inCurrentProject` is false for every one.

**Root cause (evidence captured from a live container):**

- Label: `com.docker.compose.project = "streetbites"` — Lando derives the Compose project from the `.lando.yml` app name and strips separators.
- TraceRiver fallback (`src/ingest/docker.ts` `resolveProjectName`): basename `street_bites` lowercased with only Compose-*invalid* chars stripped — underscores are valid, so it stays `street_bites`. `street_bites ≠ streetbites`.
- The compose-file branch never fires: Lando's generated compose files live in `~/.lando/compose/<app>/`, so the project dir has no `compose.yaml`/`docker-compose.yml` (only `.lando.yml`, which phase 2 doesn't scan).

**Available exact signals (from the same label set):**

- `io.lando.root = /Users/anthonysayge/projects/street_bites` — the host project path, exact match to cwd. Primary fix.
- `io.lando.src = <root>/.lando.yml`, `io.lando.landofiles` — corroborating.
- Generic sibling: `com.docker.compose.project.working_dir` (for Lando it points into `~/.lando/compose/`, so it is *not* usable here — but for vanilla Compose it is the project dir and should be used for the same path-match strategy).

**Fix sketch:** add a path-signal pass before name matching — `inCurrentProject` if cwd equals (or is inside) `io.lando.root` or `com.docker.compose.project.working_dir`. Optionally also scan `.lando.yml` for `name:` as a name-signal fallback. Keep the phase-2 basename heuristic as the final fallback.

### S2+ — (append future scenarios here)

Candidates to watch for, unconfirmed: Podman quadlets/systemd units without compose labels; `docker run` containers with no labels at all (possible `--project-path` manual override); devcontainers (`devcontainer.local_folder` label); Tilt/Skaffold-managed projects; monorepos where the compose file lives in a subdirectory but `traceriver` is run at the repo root (ancestor-path matching covers this if implemented in S1's fix).

## Exit criteria (per implementation batch)

- [ ] Each logged scenario has a captured-label fixture and a matcher test that fails pre-fix and passes post-fix.
- [ ] The Lando project (S1) associates correctly when `traceriver start` runs from the project root, with no config required.
- [ ] Vanilla Compose projects keep associating exactly as in phase 2 (no regressions in the existing `test/docker/` suite).
- [ ] Association order (path label → compose-file name → normalized basename) is documented in `docs/architecture.md` and an ADR records the "paths over names" decision.
