# Test Plan 005 — Phase 5 (Batch 1, Scenario S1): Real-World Project Association

Spec: [`docs/specs/005-phase-5-project-association.md`](../../specs/005-phase-5-project-association.md)
Phase doc: [`docs/phases/phase-5-project-association.md`](../../phases/phase-5-project-association.md) § S1
Tier: 2 (Standard) — declared gates + gap-filling tests + this plan. Full
browser-evidence capture (`tools/browser.js`) is intentionally **not**
performed this run: this batch is a backend-only, server-side matcher change
with zero rendered UI (spec 005 § Layout: "No layout change... this batch
touches no rendered UI"), so there is no post-JS DOM/screenshot criterion to
capture.

Changed product code this batch: `src/ingest/docker.ts` only (plus
regenerated `dist/ingest/docker.js`/`.js.map` build artifacts). Confirmed via
`git diff --stat HEAD` before authoring any tests.

## Gates

No `.claude/qa.json` exists in this repo (confirmed absent, same as every
prior QA pass in this repo — `ls .claude/` shows only `lanes.json` and
`launch.json`). Per this repo's own established convention (see
`docs/qa/test-plans/002-phase-2-docker.md` § header), the gates used are this
project's real npm-script equivalents of the zero-dependency defaults, not
the generic `app/test/`-shaped defaults (this repo's layout is `test/` +
`vitest`, not `app/test/` + `node --test`; there is no `tools/` directory in
this repo at any commit — confirmed again this run):

| Gate | Command | Result |
|---|---|---|
| typecheck | `npm run typecheck` (`tsc -p tsconfig.json --noEmit`) | **PASS** — no errors |
| build | `npm run build` (server + web) | **PASS** — `dist/` and `dist/web/` produced cleanly |
| test | `npm test` (`vitest run`) | **211/211 passed** (41 files) on a clean re-run. One prior run in the middle of this pass showed 2 unrelated flaky failures (`test/discovery/rotation-truncation.test.ts`, `test/discovery/watch-config.test.ts`) — both are chokidar file-watch timing tests untouched by this batch (they exercise `src/ingest/tail.ts`, not `src/ingest/docker.ts`); both passed in isolated re-runs and in a subsequent full-suite re-run, confirming resource-contention flakiness under the full 41-file parallel run, not a regression from this batch's change. `test/e2e/memory.test.ts`'s RSS (279–297 MB across runs in this pass) stays within the product-owner-accepted range documented in `test/CLAUDE.md` — not re-litigated here. |

## Criterion 14 (no wire-contract change) — verified directly

```
git diff HEAD -- src/shared/types.ts
```

produced **zero output** — the file is byte-identical to `HEAD`, confirming
the backend handoff's claim and the "no frontend work required" basis for
this batch. **PASS.**

## Fixtures authored (`test/fixtures/docker-labels/`)

Per spec 005 § Fixture requirement / acceptance criterion 12:

| File | Provenance |
|---|---|
| `s1-lando-street-bites.json` | `io.lando.root` and `com.docker.compose.project` quoted **verbatim** from the phase doc's captured root-cause evidence. `io.lando.src` follows the phase doc's own stated template (`<root>/.lando.yml`). `io.lando.landofiles` and the exact `com.docker.compose.project.working_dir` value are **not** quoted verbatim anywhere in the spec/phase doc (only described, not literal-captured) — reconstructed representatively for fixture completeness, and disclosed as such in the fixture's own `_meta.note`. The two fields the matcher actually decides on (`io.lando.root`, and the deliberately-mismatching `working_dir` it must override) are both exact quotes from the evidence. |
| `vanilla-compose-working-dir.json` | **Captured live by this QA pass**, not synthesized: a real, disposable `docker compose` project (`compose.yaml`, one `alpine:3` service) was started (`docker compose up -d`) on this host and its full label set read via `docker inspect ... --format '{{json .Config.Labels}}'`, then torn down (`docker compose down`). All 10 label keys in the fixture are genuine, verbatim captured values. Notably confirms live that vanilla Compose's `working_dir` label reflects the *unresolved* symlinked tmpdir path (`/var/folders/...`) rather than the realpath-resolved form — direct evidence for why `src/ingest/docker.ts`'s `safeRealpath()` exists. |

Both fixtures are exercised by `test/docker/path-project-matcher.test.ts`
(below), which does **not** require a live Docker daemon.

## Automated tests authored

| File | Live daemon? | Criteria covered |
|---|---|---|
| `test/docker/path-project-matcher.test.ts` | No — follows the exact precedent of `test/docker/recovery-ordering.test.ts` (a real `DockerManager` with its private `client` swapped for a stub returning hand-built `ContainerInfo` fixtures; the real, unmodified `discoverAll()` → `resolvePathMatch()` → `matchesProjectPath()` production code path runs, not a reimplementation) | 1, 2, 3, 4, 5, 6, 7, 8 (mechanism-level regression), 9, 13 |
| `test/docker/path-project-association-live.test.ts` | Yes (`describe.skipIf(!dockerAvailable())`, throwaway `tr-qa-path-*` containers, cleaned up in `afterAll`) | 10, 11 (end-to-end, against the real discovery/filter pipeline) |
| `test/docker/discovery.test.ts` | Yes (pre-existing, **unmodified** — confirmed via `git diff --stat -- test/docker/discovery.test.ts` returning nothing) | 8 (regression guarantee), 9 (bare `docker run`, no compose label, associates false) |

### Criterion 12 — demonstrated fail-before/pass-after

`src/ingest/docker.ts`'s fix is an **uncommitted working-tree change**
(`git diff HEAD -- src/ingest/docker.ts` shows the entire diff; `HEAD` itself
is the pre-fix revision — no separate stash of an older commit was needed).
Procedure, following the exact precedent in
`docs/qa/test-plans/002-phase-2-docker.md` § Finding 1:

1. `git stash push --quiet -- src/ingest/docker.ts` — reverts the file to
   the committed (pre-fix) revision in the working tree only; confirmed via
   `grep -c "resolvePathMatch" src/ingest/docker.ts` returning `0`.
2. `node_modules/.bin/vitest run test/docker/path-project-matcher.test.ts` —
   **5 of 9 tests failed** (`expected false to be true`): criteria 1, 2
   (both halves), 3, 5, 6 — every fixture case whose expected result depends
   on the new path-label tier existing. Criteria 7, 8, 9 (whose expected
   result is `false`/unchanged) correctly still passed even pre-fix, as
   expected (they assert the *absence* of a behavior this batch doesn't
   change).
3. `git stash pop --quiet` — restores the fix; confirmed via
   `grep -c "resolvePathMatch" src/ingest/docker.ts` returning `2` and
   `git diff --stat HEAD -- src/ingest/docker.ts` matching the original
   97-insertion/2-deletion diff exactly (no loss).
4. `node_modules/.bin/vitest run test/docker/path-project-matcher.test.ts` —
   **9/9 passed** again.

This is a genuine regression guard, not a tautological pass — the same
technique the phase-2 QA pass used and documented.

## Acceptance criteria → verification mapping

| # | Criterion | Verified by | Result |
|---|---|---|---|
| 1 | `io.lando.root` exactly equal to cwd associates, zero config (S1 fixture) | `path-project-matcher.test.ts` "criterion 1" + `path-project-association-live.test.ts` "criterion 1/10 (live)" | **PASS** |
| 2 | Same container's misleading `working_dir` not consulted once `io.lando.root` present | `path-project-matcher.test.ts` "criterion 2" (asserts both the full-fixture `true` **and** that the same `working_dir` value alone, `io.lando.root` removed, independently evaluates `false` — proving it's a genuine override, not a coincidental match) | **PASS** |
| 3 | `io.lando.root` as ancestor of cwd (subdirectory start) still associates | `path-project-matcher.test.ts` "criterion 3" | **PASS** |
| 4 | Sibling directory sharing a string prefix does not associate (segment-aware) | `path-project-matcher.test.ts` "criterion 4" (both directions: label-longer-than-cwd and cwd-longer-than-label) | **PASS** |
| 5 | Vanilla Compose `working_dir` exact match associates independent of any name signal | `path-project-matcher.test.ts` "criterion 5" (genuine captured fixture, name signal deliberately mismatching) | **PASS** |
| 6 | Ancestor/sibling semantics apply identically to `working_dir` | `path-project-matcher.test.ts` "criterion 6" | **PASS** |
| 7 | Reverse ancestor (label nested below cwd, monorepo case) does not spuriously match | `path-project-matcher.test.ts` "criterion 7" | **PASS** |
| 8 | No path label present → falls through to existing tier 2/3 name comparison, byte-for-byte, no regression | `path-project-matcher.test.ts` "criterion 8" (mechanism-level: matching and mismatching names both resolve as tier 3 alone would) + `test/docker/discovery.test.ts` passing **unmodified** (git-diff-confirmed) | **PASS** |
| 9 | No `com.docker.compose.project` and no path label at all → no association | `path-project-matcher.test.ts` "criterion 9" + `discovery.test.ts`'s pre-existing `OUTSIDE_NAME` bare-`docker run` case | **PASS** |
| 10 | `docker.include`/`exclude` applied identically to path-matched containers | `path-project-association-live.test.ts` "criterion 1/10" (exclude) + "criterion 4/10" (include) — real throwaway containers carrying a synthetic `io.lando.root` label | **PASS** |
| 11 | "Show all containers" toggle stays a pure client-side filter for path-matched containers (server always sends the real `inCurrentProject`) | `path-project-association-live.test.ts` "criterion 11" | **PASS** |
| 12 | Both fixtures are real captured-label JSON, each exercised by a fail-before/pass-after matcher test | § Fixtures authored + § Criterion 12 above | **PASS** |
| 13 | Path-matching logic exercised by ≥1 non-live-daemon test | `path-project-matcher.test.ts` (all 9 tests; zero Docker daemon dependency, runs unconditionally) | **PASS** |
| 14 | No wire-contract change: `src/shared/types.ts` byte-identical | `git diff HEAD -- src/shared/types.ts` — empty | **PASS** |
| 15 | `docs/architecture.md` + new ADR in `docs/decisions.md` updated | Confirmed **not yet done** (`docs/decisions.md`'s last entry is D10, unrelated; no `io.lando`/`working_dir`/path-label mention in `docs/architecture.md`) — per spec 005 itself, this is "owned by the backend/technical-writer lanes, not by this spec's UI/QA scope." Recorded here as **pending, out of QA scope** — not a defect. | N/A (tracked, not QA-owned) |

## Test environment / cleanup discipline

- A real Docker daemon (Docker Desktop for Mac) was available on this host
  throughout (`docker info` succeeds), so both the live-daemon fixture
  capture and `path-project-association-live.test.ts` ran against it rather
  than being skipped.
- The product owner's real `street_bites` (Lando) containers were present on
  this host (`docker ps -a` lists 7 `streetbites_*` containers) and were
  **only observed** (`docker ps -a` listing), never started/stopped/removed
  by this pass.
- All throwaway containers created by this pass used a `tr-qa-` /
  `tr-qa-path-` prefix and were removed by each test's own
  `afterAll`/teardown or an explicit capture-session `docker compose down`;
  confirmed zero `tr-qa-path-*` containers remain
  (`docker ps -a --filter "name=tr-qa-path-"` empty) at the end of this pass.
- Scratch directories (`mkdtempSync`) used by both the vanilla-compose
  fixture capture and the matcher/live tests are OS temp-dir throwaways;
  the fixture-capture session's own scratch dir was left in place
  (harmless — contains only a static `compose.yaml`, matches the OS's normal
  temp-file lifecycle) rather than force-deleted, since its path is quoted
  verbatim inside the committed fixture's `_meta.source` field for
  traceability.

## Defects filed

None. Every acceptance criterion in QA's scope (1–14) passed against the
delivered `src/ingest/docker.ts` change with no code modification needed.

## Open questions

None raised by QA this run. Spec 005's own two open questions (reverse
ancestor-path/monorepo matching direction; an optional "matched via" tooltip
affordance) are pre-existing product-owner-facing questions already
documented in the spec itself (§ Open Questions) — not re-litigated or
duplicated here; criterion 7's test in this plan confirms the spec's stated
current (conservative, forward-direction-only) behavior is what's actually
shipped, which is the QA-relevant fact for those open questions' resolution.
