# 005 — Phase 5: Real-World Project Association (Batch 1 — S1)

Status: ready-for-dev
Depth: Tier 2 (light)
Source: [`docs/phases/phase-5-project-association.md`](../phases/phase-5-project-association.md) — scenario S1
Extends: [`docs/specs/002-phase-2-docker.md`](002-phase-2-docker.md) (matching algorithm inside
`resolveProjectName`/`discoverAll` in `src/ingest/docker.ts`); no other part of spec 002 changes.

## Overview

Phase 2 associates a container with "the current project" purely by **name**:
compare the container's `com.docker.compose.project` label against a name
TraceRiver derives from its cwd (a local compose file's `name:` field, else
the normalized directory basename). Scenario S1 (Lando + Laravel) shows this
heuristic fails for real, common local stacks whose tooling generates a
Compose project name that doesn't survive normalization back to the
directory name (Lando strips `_` from `street_bites` → `streetbites`, and its
compose files aren't even where phase 2 looks for them).

This batch adds a **path-based signal that runs before the name heuristic**:
several container-management tools stamp the host project's absolute
filesystem path onto their containers as a label (`io.lando.root` for Lando,
`com.docker.compose.project.working_dir` for vanilla Compose). Comparing
that path against TraceRiver's cwd is deterministic where name-normalization
is guesswork. This is a **server-side matcher change only** — no wire
contract change, no sidebar/UI change. `inCurrentProject` already exists on
`SourceDescriptor.docker` (spec 002) and already drives the sidebar's
show/hide filter; this batch only changes *how the server computes that
boolean* for containers carrying a recognized path label. Everything else
about discovery, filtering, subscription, and streaming (spec 002, unchanged)
stays exactly as shipped.

## User flow

1. User runs `traceriver start` from `~/projects/street_bites/` (a Lando +
   Laravel app: `.lando.yml` present, no `compose.yaml`/`docker-compose.yml`
   in the directory, Lando-managed containers already running). No
   `traceriver.json`, no flags.
2. Today (pre-fix): the sidebar's Containers section shows every one of the
   project's containers only once "Show all containers" is switched on —
   `inCurrentProject` was false for all of them (see root cause, phase doc).
3. After this fix: the same startup, same zero config, shows the project's
   containers under "Show all containers" **off** — i.e. as the current
   project's containers, matching spec 002's intended default experience.
   The mechanism: each of these containers carries `io.lando.root =
   /Users/anthonysayge/projects/street_bites`, an exact match to cwd.
4. A second, unrelated Lando or Compose project running elsewhere on the same
   machine continues to show up only behind "Show all containers" — its
   path label doesn't match this cwd.
5. A vanilla `docker compose` project (no Lando involved) continues to
   associate exactly as before — via its `com.docker.compose.project.working_dir`
   label first (new, path-based, same signal class as Lando's), falling
   through to the existing compose-file-`name:`/basename chain only if no
   recognized path label is present on the container at all.
6. Include/exclude globs and the "Show all containers" toggle behave
   identically regardless of which signal produced `inCurrentProject` — a
   path-matched container is filtered and toggled exactly like a
   name-matched one always has been.

No interaction changes: nothing new to click, no new config key, no new
onboarding step. The fix is invisible except that more containers correctly
default into view.

## Layout

**No layout change.** This batch touches no rendered UI. The sidebar's
Containers/Files sections, source rows, "Show all containers" toggle, and
Docker status card are exactly as specified in
[`002-phase-2-docker.md`](002-phase-2-docker.md) § Layout — no new wireframe
needed.

## Components & states

**No new or changed component states.** `inCurrentProject` was already a
boolean render input to the existing "Show all containers" client-side
filter (spec 002 § Components & states, § Interaction specs — Decision 1);
this batch changes only the server-side logic that *computes* that boolean
for containers carrying a recognized path label. The four Docker status card
states, the container source row (including `STOPPED`/`ERROR` labels and the
image/compose tooltip), and the toggle itself are all unchanged and are not
re-specified here — see spec 002 for their full definitions, which remain
authoritative and unmodified.

## Interaction specs — project-match resolution (the actual change)

Per discovered container, in strict priority order — the first applicable
tier decides the result; lower tiers are **not** consulted once a higher tier
is applicable, even if that tier's comparison comes back negative (an exact
path signal that says "no" is not overridden by a weaker name heuristic that
might say "yes" — "prefer exact path signals over name heuristics," phase doc
§ Design direction):

1. **Path-label match (new).**
   - If the container carries `io.lando.root`, compare it against
     TraceRiver's cwd (see "Ancestor-path semantics" below) and use that
     result. Lando's own `com.docker.compose.project.working_dir` value is
     never consulted for a container that has `io.lando.root` — the phase
     doc's evidence shows that label points into `~/.lando/compose/<app>/`
     for Lando containers, an internal scratch location, not the host
     project directory, and would produce a false negative if compared
     against cwd.
   - Else, if the container carries `com.docker.compose.project.working_dir`
     (vanilla Compose, no Lando involvement), compare *that* against cwd the
     same way.
   - Else (neither label present): this tier is not applicable; fall through
     to tier 2.
2. **Compose-file `name:` match (existing, unchanged).** If a local
   `compose.yaml`/`compose.yml`/`docker-compose.yaml`/`docker-compose.yml` in
   cwd has a top-level `name:` field, compare the container's
   `com.docker.compose.project` label against it (case-insensitive, exact
   string match) — this is phase 2's existing first fallback, untouched.
3. **Normalized-basename match (existing, unchanged — the final fallback).**
   Compare `com.docker.compose.project` against cwd's basename, lowercased,
   with Compose-invalid characters stripped — phase 2's original, and now
   final, fallback. Preserved byte-for-byte so every existing vanilla-Compose
   project keeps associating exactly as it does today (no regression).

A container with no path label and no `com.docker.compose.project` label at
all (e.g. a bare `docker run`, no Compose/Lando involvement) falls through
all three tiers with no match — identical to today's behavior; that
scenario is explicitly unconfirmed/out of scope per the phase doc's living
scenario log (§ S2+) and is not addressed by this batch.

### Ancestor-path semantics (confirmed direction only — see Open Questions for the rest)

**Confirmed, binding, and covered by this batch's acceptance criteria:** a
path label matches cwd when, after stripping any trailing path separator
from both sides, **the labeled path equals cwd, or the labeled path is an
ancestor of cwd** (cwd is nested one or more directories below the labeled
path) — i.e. `cwd === labelPath || cwd.startsWith(labelPath + separator)`,
compared on whole path segments (a sibling directory whose name happens to
start with the same characters, e.g. `street_bites-old` vs `street_bites`,
must never match). This is exactly what scenario S1 needs (`io.lando.root`
equals cwd in the captured evidence) and generalizes to the case of running
`traceriver start` from a subdirectory of the project root, which the phase
doc's design-direction wording ("cwd... or an ancestor of it" being compared
against) and S1's fix sketch ("cwd equals *or is inside* `io.lando.root`")
both describe.

**Not implemented by this batch, pending product-owner input — see Open
Questions:** the reverse direction, where the *labeled path* is nested below
cwd (e.g. a monorepo where `traceriver start` runs at the repo root and the
compose file/Lando app lives in a subdirectory). The phase doc's own S2+
section assumes "ancestor-path matching covers this if implemented in S1's
fix," but the design-direction text and the S1 fix sketch both describe only
the forward direction above; extending to the reverse direction is a
materially different, higher-risk comparison (any container whose project
path happens to live anywhere under a broad cwd — e.g. `~/projects` — would
match) that the phase doc lists only as an "unconfirmed candidate," not
confirmed design direction. This batch implements and tests the forward
direction only.

### Regression guarantee

Every container that has neither `io.lando.root` nor
`com.docker.compose.project.working_dir` set follows exactly the same code
path phase 2 shipped (tiers 2–3 above, unchanged) — `test/docker/
discovery.test.ts`'s existing criterion-1 scenario (vanilla Compose project,
no Lando) must continue to pass unmodified, with no test changes required
for it to do so.

### Fixture requirement (batch exit criterion, per phase doc)

Every signal this batch adds ships with a **captured-label fixture** — a
JSON snapshot of a real container's label set, not an idealized example —
and a matcher test that fails against the pre-fix code path and passes
post-fix:

- **S1 fixture**: the label set captured in the phase doc's root-cause
  section for the `street_bites` Lando app (`io.lando.root`,
  `com.docker.compose.project` = `"streetbites"`, `io.lando.src`,
  `io.lando.landofiles`, plus the misleading
  `com.docker.compose.project.working_dir` pointing into `~/.lando/compose/`
  — the fixture must include this last label specifically to regression-test
  that it is correctly *ignored* in favor of `io.lando.root` for this
  container).
- **Vanilla-Compose path-signal fixture**: a captured (or, if unavailable,
  clearly-labeled representative) label set for a plain `docker compose`
  container carrying `com.docker.compose.project.working_dir` and no Lando
  labels, confirming tier 1's second branch independent of tier 1's first.
- Both fixtures must be exercised by a matcher test that does **not**
  require a live Docker daemon (a pure "given this label set and this cwd,
  what does `inCurrentProject` resolve to" test) — the existing
  `test/docker/discovery.test.ts` style (real throwaway containers against a
  live daemon) remains valuable for end-to-end coverage but a live-daemon
  requirement must not be the only place the path-matching logic itself is
  exercised, so the matcher's decision logic is unit-testable in isolation.

## API contract

**No wire-contract change.** `src/shared/types.ts` is unmodified by this
batch:

- `SourceDescriptor.docker.inCurrentProject` remains the same `boolean`
  field defined in spec 002 — only the server-side computation behind it
  changes (§ Interaction specs above), never its type or presence.
- `SourceDescriptor.docker.composeProject` / `.composeService` are populated
  from the same labels as before (`com.docker.compose.project` /
  `com.docker.compose.service`), regardless of which tier decided
  `inCurrentProject` — a Lando container's tooltip still shows whatever its
  `com.docker.compose.project` label says (e.g. `"streetbites"`), unchanged.
- No new REST endpoint, no new WS message, no new field anywhere in the
  contract.
- **No new configuration surface.** No new CLI flag or `traceriver.json`
  key is introduced — the fix consumes label data already fetched by the
  existing `listContainers` call (spec 002's read-only Docker access,
  unchanged), same as the phase doc's "read-only and offline" requirement
  states.
- **No frontend work required.** `inCurrentProject` already drives the
  sidebar's project filter (spec 002); this batch changes only how the value
  arrives at true/false, which is invisible to `web/`. (A "matched via
  path/name" diagnostic affordance in the tooltip was considered and is
  **not** specified here — see Open Questions; building it without product-
  owner sign-off would be a scope escalation beyond this batch's ask.)

## Design tokens used

None. This is a server-side matcher change with zero rendered surface —
nothing in `docs/design-system.md` is referenced or added.

## Accessibility requirements

None beyond what spec 002 already specifies and which remains unchanged and
unaffected (no new UI, no new state, no new interactive control).

## Acceptance criteria

Numbered and individually testable; each maps to a lettered item from the
orchestrator's ask and/or a phase-5 exit criterion where noted.

1. **(a)** A container carrying `io.lando.root` **exactly equal** to
   TraceRiver's cwd associates as the current project
   (`docker.inCurrentProject: true`) with no `traceriver.json` and no CLI
   flags — reproducing scenario S1 using the captured `street_bites` fixture
   (§ Fixture requirement). *(exit: S1 fixed)*
2. **(a)** The same container's `com.docker.compose.project.working_dir`
   label (present per the captured evidence, pointing into
   `~/.lando/compose/...`) is not used to compute `inCurrentProject` for it —
   only `io.lando.root` is consulted once present. Verified against the same
   fixture with `working_dir` deliberately mismatching cwd.
3. **(a)** A container carrying `io.lando.root` set to an **ancestor** of
   cwd (TraceRiver started from a subdirectory of the Lando project root)
   still associates as the current project.
4. **(a)** A container carrying `io.lando.root` set to a **sibling**
   directory that shares a string prefix with cwd (e.g. label
   `/Users/x/street_bites-old` vs cwd `/Users/x/street_bites`) does **not**
   associate — segment-aware comparison, not a naive string-prefix test.
5. **(b)** A vanilla Compose container with no Lando labels, carrying
   `com.docker.compose.project.working_dir` exactly equal to cwd, associates
   as the current project via the path-label tier (tier 1's second branch),
   independent of and prior to any name-based comparison.
6. **(b)/(c)** The same working-directory ancestor and sibling-prefix cases
   as criteria 3–4 apply identically to `com.docker.compose.project.working_dir`
   matching.
7. **(c)** The reverse ancestor direction (a container's path label nested
   *below* cwd — the monorepo case) produces the same result as phase 2
   would today (i.e., falls through to tiers 2–3, no special-cased path
   match) — this batch does not implement reverse-direction path matching;
   confirmed by test that such a fixture does **not** spuriously associate
   via tier 1. (See Open Questions — this is deliberately conservative
   pending product-owner confirmation, not an oversight.)
8. **(d)** A container with neither `io.lando.root` nor
   `com.docker.compose.project.working_dir` set falls through to the
   existing compose-file-`name:` comparison (tier 2), and — absent a local
   compose file — to the normalized-basename comparison (tier 3), byte-for-
   byte as phase 2 shipped. `test/docker/discovery.test.ts`'s existing
   criterion-1 scenario continues to pass with no changes to that test file.
   *(exit: vanilla Compose keeps associating exactly as in phase 2, no
   regressions)*
9. **(d)** A container with no `com.docker.compose.project` label at all
   (bare `docker run`, no path label either) does not associate —
   unchanged from phase 2, no new false positive introduced.
10. **(e)** `docker.include`/`docker.exclude` glob filtering is applied
    identically to path-matched and name-matched containers — an excluded
    container carrying a matching `io.lando.root` still never reaches the
    client, with or without "Show all containers."
11. **(e)** The "Show all containers" toggle continues to function as a
    pure client-side render filter (spec 002 Decision 1) for path-matched
    containers exactly as for name-matched ones — no server round trip, no
    change to when a path-matched container is included in the `sources`
    list.
12. **(f)** Both the S1 fixture and the vanilla-Compose path-signal fixture
    (§ Fixture requirement) are committed as real captured-label JSON (not
    synthesized from imagination) and are each exercised by a matcher test
    that fails against the pre-fix logic and passes post-fix.
13. **(f)** The path-matching decision logic is exercised by at least one
    test that does not require a live Docker daemon — a fixture-driven,
    label-set-in/boolean-out test independent of `test/docker/
    discovery.test.ts`'s live-container integration style.
14. No wire-contract change ships with this batch: `src/shared/types.ts` is
    byte-identical before and after, verified by design/QA review diffing
    the file. *(traceability for the "no frontend work required" claim
    above)*
15. `docs/architecture.md`'s Docker association description and a new ADR
    in `docs/decisions.md` recording the "paths over names" matching-order
    decision are updated as part of this batch's exit criteria (phase doc §
    Exit criteria) — owned by the backend/technical-writer lanes, not by
    this spec's UI/QA scope, but listed here for traceability.

## Open Questions

1. **Reverse ancestor-path matching (monorepo case) — STATUS: needs product-
   owner decision.** The phase doc's own scenario log (§ S2+) assumes
   "ancestor-path matching covers" the case where `traceriver start` runs at
   a monorepo root and the matched compose/Lando project lives in a
   subdirectory below it — but the phase doc's confirmed design-direction
   text and S1's fix sketch describe only the forward direction (cwd nested
   inside, or equal to, the labeled path), not this reverse one. Extending
   to the reverse direction is a real, higher false-positive-risk decision
   (any container anywhere below a broad cwd, e.g. `~/projects`, would then
   match) that the phase doc itself lists only as an unconfirmed candidate.
   This spec implements and tests the forward direction only (acceptance
   criteria 1–6) and explicitly does *not* implement the reverse direction
   (criterion 7 asserts it does *not* fire). If the monorepo case is wanted
   in this same batch, it needs its own captured-label evidence (per the
   phase doc's evidence-based process) and an explicit product-owner call on
   the false-positive tradeoff — recommend treating it as its own scenario
   (S3) in the living phase doc rather than folding it into S1's fix
   unconfirmed.
2. **A "matched via path/name" tooltip affordance — STATUS: not specified,
   flagging as a possible scope escalation, not decided here.** The
   orchestrator's brief flagged this as the expected-none case, and this
   spec follows that (no frontend work). If the product owner later wants
   visible confirmation of *why* a container associated (useful for
   debugging a mismatch), that is new sidebar-tooltip surface beyond this
   batch's ask and would need its own (at minimum Tier 1/light) design pass
   — not unilaterally added here.

---

ARTIFACTS WRITTEN: docs/specs/005-phase-5-project-association.md
STATUS: ready-for-dev
OPEN QUESTIONS: 2 (see § Open Questions — reverse ancestor-path/monorepo matching direction; optional "matched via" tooltip affordance). Neither blocks this batch's forward-direction, S1-fixing scope from proceeding to dev; both are scope-boundary calls for the product owner, not blockers to building what is specified above.
