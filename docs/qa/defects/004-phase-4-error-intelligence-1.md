# Defect 004-phase-4-error-intelligence-1

**Area:** frontend
**Severity:** low
**Status:** verified-fixed
**Spec:** `docs/specs/004-phase-4-error-intelligence.md` § Components &
states — ErrorGroup card § Sparkline: "the sparkline's `title` attribute
tooltip summarizing the same 'steady ~X/min…' text the prompt itself
generates" and § API contract — Prompt assembly — Occurrence pattern (the
algorithm the tooltip is required to match).

## Summary

The sparkline's decorative `title` tooltip (`web/src/utils/
occurrencePattern.ts`'s `describeOccurrencePattern`) can render **different**
"steady ~X/min…" text than the AI prompt's own "## Occurrence pattern"
section (`src/errors/prompt.ts`'s `buildOccurrencePatternSummary`) for the
exact same `group.perMinute` histogram — contradicting the spec's explicit
"summarizing the *same*... text the prompt itself generates" requirement.

## Root cause (read, not modified)

Both implementations follow the same three-step algorithm (mean → rounded
average; peak value/index; `peakValue >= multiplierThreshold * avg AND
peakValue >= minAbsoluteRatePerMin` decides spike-worded vs. steady-worded
text), but they use a **different `avg` in the multiplier comparison**:

- Server (`src/errors/prompt.ts` `buildOccurrencePatternSummary`, line ~129):
  ```ts
  const avgRounded = Math.round(trueMean);
  ...
  if (peakValue >= CFG.spike.multiplierThreshold * avgRounded && peakValue >= CFG.spike.minAbsoluteRatePerMin) {
  ```
  compares against the **rounded** average.
- Client (`web/src/utils/occurrencePattern.ts` `describeOccurrencePattern`,
  line ~41):
  ```ts
  if (peakValue >= SPIKE_MULTIPLIER_THRESHOLD * rawAvg && peakValue >= SPIKE_MIN_ABSOLUTE_RATE_PER_MIN) {
  ```
  compares against the **raw (unrounded)** average.

Near the multiplier boundary, rounding the average before multiplying by 5
vs. not rounding it can put `peakValue` on opposite sides of the two
thresholds, flipping which of the two sentence templates is chosen.

## Reproduction

Pure-function repro, no server/browser needed — both functions given the
identical `perMinute = [1, 0, 0, 0, 10]`:

```
trueMean = 11/5 = 2.2, avgRounded = 2, peakValue = 10

server:  peakValue(10) >= 5 * avgRounded(2) = 10   -> true  -> "steady ~2/min for 4 min, spiked to 10/min ..."
client:  peakValue(10) >= 5 * rawAvg(2.2)   = 11   -> false -> "steady ~2/min over the last 5 min"
```

Confirmed by directly executing both algorithms with this input (see QA
session — both snippets above lifted verbatim from the two source files;
running them side by side on `[1,0,0,0,10]` reproduces the diverging output
shown).

For a group whose real histogram lands in this range, a user hovering the
Errors-panel card's sparkline sees "steady ~2/min over the last 5 min," then
clicks "Generate AI Prompt" on the very same card and gets a prompt whose
"## Occurrence pattern" section instead reads "steady ~2/min for 4 min,
spiked to 10/min at `<clock>`" — directly contradicting what the tooltip
just told them, for data that never changed in between.

## Impact

Low: the sparkline itself is `aria-hidden="true"` and explicitly documented
as decorative (the count and this tooltip are the two text carriers, per
spec); this defect only affects the tooltip's *wording choice* between two
already-similar sentence templates, not the sparkline's rendering, the
authoritative `group.spiking` flag (server-computed, unaffected), or the AI
prompt's own text (also unaffected — the server's copy is correct). No data
is lost or misrepresented in a way that could mislead triage; it's a
same-fact-worded-differently inconsistency that undermines the "the same
text" guarantee the spec calls out by name.

## Suggested fix (for the frontend-developer lane — not applied here)

Not prescribing a specific diff, but the minimal change is for
`describeOccurrencePattern` to round the average *before* using it in the
multiplier comparison (i.e. compare `peakValue >= SPIKE_MULTIPLIER_THRESHOLD
* avg` using the already-computed rounded `avg`, matching
`buildOccurrencePatternSummary`'s `avgRounded` exactly), so the two
independent implementations of the same documented algorithm can no longer
diverge at the rounding boundary.

## Automated regression coverage

No dedicated automated test exists for this (no frontend unit-test runner is
available in this repo — `@testing-library/react`/DOM-testing tooling isn't
on the dependency allowlist per `.claude/lanes.json`, and this is pure
client-side TS with no server round trip to exercise via the vitest server
suite). Reproduced and verified via direct side-by-side execution of both
algorithms (documented above) rather than a committed test file. The
server-side half of the shared algorithm (`buildOccurrencePatternSummary`)
*is* covered by `test/errors/prompt-snapshot.test.ts`'s "occurrence pattern
summary" tests, confirming the server's copy is correct and stable; this
defect is specifically about the client's independent copy diverging from
it.

## Re-verification (2026-07-21)

Fix landed in `web/src/utils/occurrencePattern.ts`: `describeOccurrencePattern`
now compares `peakValue >= SPIKE_MULTIPLIER_THRESHOLD * avg` using the
already-computed **rounded** `avg` (line ~41), exactly matching
`buildOccurrencePatternSummary`'s `avgRounded` comparison in
`src/errors/prompt.ts` — the raw/unrounded `rawAvg` is no longer used in the
multiplier comparison. Confirmed by reading the committed diff at the stated
line.

Repro confirmed by direct execution: `describeOccurrencePattern([1, 0, 0, 0,
10])` now returns `"steady ~2/min for 4 min, spiked to 10/min at <clock>"`
(peakIndex 4, avgRounded 2, `10 >= 5*2` true), matching the server's wording
for the identical histogram — the divergence reported above no longer
reproduces.

Added a permanent regression test, `test/errors/occurrence-pattern-client.test.ts`
(no dedicated coverage previously existed per this defect's "Automated
regression coverage" section above; `describeOccurrencePattern` is a plain
TS function with no React/DOM dependency, so it's directly importable from
`test/` under the existing vitest suite — no new frontend-testing tooling
needed, so the "no frontend unit-test runner available" constraint noted
above no longer blocks a committed automated test for this specific
function):

- `[1,0,0,0,10]` → spike-worded exactly as the server is, including
  asserting it does *not* fall back to the old raw-average steady-only
  wording (the defect's literal repro).
- `[1,0,0,0,9]` (avgRounded 2, `5*2=10 > peak 9`) → stays steady-worded, a
  boundary check just below the threshold.
- `[0,0,0,0,6]` (multiplier alone would qualify but peak 6 < the 10/min
  absolute floor) → stays steady-worded, confirming the fix didn't disturb
  the independent `SPIKE_MIN_ABSOLUTE_RATE_PER_MIN` gate.

Full gate re-run, no regressions:

- `npm run typecheck` (backend, `tsc -p tsconfig.json --noEmit`) — clean.
- `node_modules/.bin/tsc -p web/tsconfig.json --noEmit` (frontend typecheck)
  — clean.
- `npm run build` (`tsc` + `vite build`) — clean, `dist/web` produced with no
  errors or warnings.
- `npm test` (`vitest run`) — **39 files / 199 tests pass**, including the 3
  new regression tests and every previously-green test.

**Status: verified-fixed.**
