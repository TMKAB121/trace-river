# Feature 005 — Phase 5 (Batch 1): Real-World Project Association — Scenario S1

**Status:** Shipped. QA PASS (211/211 tests, 41 test files, 14/14 QA-scoped
acceptance criteria, 0 defects), design verification **APPROVED**.

- Spec: [`docs/specs/005-phase-5-project-association.md`](../../specs/005-phase-5-project-association.md)
- Design review: [`docs/design-reviews/005-phase-5-project-association.md`](../../design-reviews/005-phase-5-project-association.md)
- QA test plan: [`docs/qa/test-plans/005-phase-5-project-association.md`](../../qa/test-plans/005-phase-5-project-association.md)
- Phase doc (living scenario log — stays open past this batch):
  [`docs/phases/phase-5-project-association.md`](../../phases/phase-5-project-association.md)
- ADR: [D11](../../decisions.md) — "paths over names" matching-order decision
- Architecture: [`docs/architecture.md` § Docker project association](../../architecture.md#docker-project-association-phases-2--5)

Unlike phases 1–4, phase 5 itself is not a one-shot, fully-closed phase: it's
a living document that collects real-world "current project" detection gaps
as they're found in the field, fixed incrementally, batch by batch. This
note covers **batch 1 only** — the fix for scenario S1 (Lando). Later
batches, if any, get their own feature numbers and their own notes; this one
is not rewritten by them.

## What shipped

Phase 2 associated a discovered Docker container with "the current project"
purely by name: `com.docker.compose.project` vs. a name derived from
TraceRiver's cwd (a local compose file's `name:`, else the normalized
directory basename). That heuristic silently fails for Lando-managed Laravel
apps — Lando derives a Compose project name that doesn't survive
normalization back to the directory name (`street_bites` → `streetbites`),
and its generated compose files live in `~/.lando/compose/<app>/`, not the
project directory phase 2 scans. Symptom: a healthy Docker connection, logs
streaming, but every one of the project's containers showing up only behind
"Show all containers."

This batch adds a **path-label tier that runs before the name heuristic**,
inside `resolveProjectName`'s call site in `src/ingest/docker.ts`'s
`discoverAll()`:

1. **Path-label match (new).** If the container carries `io.lando.root`
   (Lando), compare it against TraceRiver's cwd; else if it carries
   `com.docker.compose.project.working_dir` (vanilla Compose), compare that.
   Whichever label is applicable decides — even on a negative comparison —
   and the other is never consulted once one is present (Lando's own
   `working_dir` label points into its internal `~/.lando/compose/` scratch
   location, not the host project directory, and would produce a false
   negative if compared against cwd).
2. **Compose-file `name:` match** (phase 2, unchanged) — the existing first
   fallback, only reached when neither path label is present.
3. **Normalized-basename match** (phase 2, unchanged) — the final fallback,
   preserved byte-for-byte so every existing vanilla-Compose project keeps
   associating exactly as before.

**Ancestor-path semantics:** a path label matches cwd when, after
realpath-resolving and stripping any trailing separator from both sides, the
labeled path equals cwd or is an ancestor of it (segment-aware — a sibling
directory sharing a string prefix, e.g. `street_bites-old` vs. `street_bites`,
never matches). This is the forward direction only; the reverse direction (a
labeled path nested *below* cwd — the monorepo case) is explicitly **not**
implemented this batch (see § Known deviations).

Result: a Lando app (e.g. `street_bites`, where Lando labels the Compose
project `streetbites`) now associates with zero config — no
`traceriver.json`, no flags — the moment `traceriver start` runs from the
project root or any subdirectory of it, because its containers carry
`io.lando.root` equal to (or an ancestor of) cwd.

No wire-contract change, no new config key/flag, no UI change, read-only/
offline posture unchanged — this is a server-side matcher change only.

## Endpoints / UI / tests touched

- **API / wire contract**: none. `src/shared/types.ts` is byte-identical
  before and after (verified by QA's `git diff`); `SourceDescriptor.docker.
  inCurrentProject` keeps its existing type, only its server-side
  computation changes for containers carrying a recognized path label.
- **UI**: none. The sidebar's existing "Show all containers" client-side
  filter (`web/src/components/ContainersSection.tsx`) consumes
  `inCurrentProject` as an opaque boolean, unchanged.
- **Tests**:
  - `test/fixtures/docker-labels/s1-lando-street-bites.json` — the captured
    `street_bites` label set (`io.lando.root`, `com.docker.compose.project`,
    the misleading `working_dir` pointing into `~/.lando/compose/`).
  - `test/fixtures/docker-labels/vanilla-compose-working-dir.json` — a
    real, live-captured plain `docker compose` container's label set
    (`working_dir`, no Lando labels).
  - `test/docker/path-project-matcher.test.ts` (9 tests, no live Docker
    daemon required) — fixture-driven `resolvePathMatch`/`matchesProjectPath`
    coverage: exact/ancestor/sibling-prefix cases for both `io.lando.root`
    and `working_dir`, the `working_dir`-ignored-when-`io.lando.root`-present
    override, the reverse-ancestor non-match, and the no-path-label
    fall-through regression.
  - `test/docker/path-project-association-live.test.ts` (live daemon,
    `describe.skipIf`) — include/exclude glob filtering and the "Show all
    containers" toggle against real throwaway containers carrying a
    synthetic `io.lando.root` label.
  - `test/docker/discovery.test.ts` — pre-existing, confirmed **unmodified**
    (regression guarantee for vanilla Compose, no Lando involved).

## Changed files

Backend: `src/ingest/docker.ts` only (the sole product-code change this
batch — confirmed via `git diff --stat HEAD` by both dev and QA).

Tests: `test/fixtures/docker-labels/{s1-lando-street-bites,
vanilla-compose-working-dir}.json` (new), `test/docker/
path-project-matcher.test.ts` (new, 9 tests), `test/docker/
path-project-association-live.test.ts` (new). 199 phase-1–4 tests → 211
total (41 test files).

Docs: `docs/architecture.md` § Docker project association (updated),
`docs/decisions.md` D11 (new ADR), this note, and the root `README.md`.

## Known deviations / limitations

- **Reverse ancestor-path (monorepo) matching is deliberately not
  implemented** (spec 005 § Open Questions #1): a container whose path label
  is nested *below* TraceRiver's cwd falls through to the unchanged
  phase-2 name heuristics rather than matching via the path tier, pending a
  real captured scenario and an explicit product-owner call on the
  false-positive tradeoff (a broad cwd like `~/projects` would otherwise
  match every container beneath it). Tracked as a candidate scenario (S3) in
  the living [phase 5 doc](../../phases/phase-5-project-association.md).
- **No "matched via path/name" diagnostic affordance** was added to the
  container tooltip (spec 005 § Open Questions #2) — flagged in the spec as
  a possible future scope escalation, not built here; nothing in the UI
  currently surfaces which tier decided a given `inCurrentProject` value.
- This batch's evidence (both fixtures, the S1 symptom) is macOS-specific,
  consistent with phase 2's own already-documented Windows/Linux
  code-review-only caveat for Docker socket resolution — no new
  cross-platform gap introduced, none newly closed either.

## Scope explicitly deferred

Everything in § Known deviations above, plus any change to phase 2's
discovery/subscription/streaming pipeline, the sidebar's Containers/Files/
Environment layout, or any other Docker behavior — this batch touches only
how `inCurrentProject` is computed for containers carrying a recognized path
label. Future scenarios (S2+) in the phase 5 living document get their own
feature numbers and their own notes.
