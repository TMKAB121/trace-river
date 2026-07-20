# Defect 002-phase-2-docker-1

**Area:** backend
**Severity:** high
**Status:** verified-fixed
**Spec:** `docs/specs/002-phase-2-docker.md` acceptance criterion 5 ("Checking a
container's checkbox... both the sidebar's entry count and the unified
stream reflect that container's output **within one broadcast interval**")
and the phase doc's general "streams live" framing (`docs/phases/
phase-2-docker.md` § 2.3 / Exit criteria).

## Summary

For a subscribed Docker container whose log lines don't confidently match
`monolog`/`clf`/`jsonl` (i.e. plain, unstructured text — a very common real
case: any app that isn't emitting JSON-structured or Monolog/CLF-shaped
lines), **no entry reaches the client for up to ~20 real-time log lines**
after subscribing, instead of "within one broadcast interval" (~75 ms) as
acceptance criterion 5 requires. For a container logging roughly one line
per second (typical for many services), that is a **~20 second blank stream**
after checking the box, not a near-instant one.

This is not docker-specific plumbing — it's `SourcePipeline`'s existing
`"live"` detection mode (`src/parsers/pipeline.ts`), which phase 1 wrote and
left unwired ("not wired to any ingest adapter yet, kept here so those
phases don't need to rebuild this" — see the file's own header comment).
Phase 2's `src/ingest/docker.ts` is the **first** ingest adapter to actually
attach a live pipeline to a real-time stream, so this is the first place the
behavior becomes user-visible and testable against a concrete acceptance
criterion.

## Root cause (read, not modified)

`src/parsers/pipeline.ts`:

- `LIVE_DETECTION_ENTRY_CAP = 20` — in `"live"` mode, every aggregated entry
  is pushed onto `bufferedDetectionEntries` and **withheld** (no `"entries"`
  event fires) until detection commits.
- Detection only commits early (`checkEarlyLock()`) once some parser scores
  `>= LOCK_SCORE_THRESHOLD` (0.8) on 3 samples. `rawParser.score()` is
  hard-coded to `0.05` (`src/parsers/formats/raw.ts`) specifically so it can
  never win an early lock — by design, per that file's own comment, for the
  *file*-mode "best average after the full cap" tie-break. In `"live"` mode
  this same low score means: if the container's lines don't look like
  Monolog, a CLF/nginx access/error line, or JSON, **no parser ever early-
  locks**, so `commitDetection()` only runs once `budgetExhausted` — i.e.
  once **20** entries have been buffered — and only then are all 20 (or
  more, if arrived in one synchronous read that a `tail` attach can deliver)
  flushed to the client at once via a single `"entries"` emit.
- A `tail: 50` attach against a container that already has ≥ 20 lines of
  history sidesteps this (all the backlog arrives in one synchronous chunk,
  so the 20-entry threshold is crossed instantly and `commitDetection` fires
  within the same tick) — which is why this is easy to miss in ad hoc manual
  testing against a container that's already been running a while. It only
  manifests as a real, user-facing delay for a **freshly subscribed
  container with little/no backlog**, which is exactly the state a container
  is in right after `docker run` (or any container with a small `tail`
  window because it hasn't logged much yet).

## Reproduction

1. Start a plain (non-JSON, non-Monolog, non-CLF) container that logs about
   once per second, e.g.:
   ```
   docker run -d --name tr-qa-repro alpine sh -c \
     'i=0; while true; do i=$((i+1)); echo "line $i"; sleep 1; done'
   ```
2. Start `traceriver` (Docker enabled) pointed at any cwd, wait for
   discovery, then send `{"type":"subscribe","sourceIds":["docker:tr-qa-repro"]}`
   over the WS **immediately** (before the container has logged 20 lines).
3. Observe: zero `"entries"` messages arrive for that source until roughly
   20 real seconds have elapsed (20 lines @ ~1/s), then all ~20 arrive in one
   batch.

Contrast: repeating the same steps with a container that emits
`{"level":"info","msg":"line N"}` (valid JSON — the `jsonl` parser scores
≥ 0.8) delivers the first entries within ~1-2 seconds (3 samples to
early-lock), confirming the delay is specific to the "no parser confidently
matches" case, not a general subscribe-path problem.

Full transcript (plain-text container, timestamps in ms):
```
container created at 1784521668459
post-wait at 1784521669962      // discovery done
... subscribe sent ...
closing ws clients and server at 1784521438594   // ~15s later, still 0 "entries" messages received
```
vs. the JSON-formatted control container:
```
subscribing at 1784521862325
entries at 1784521863744 3 [ 'json line 1', 'json line 2', 'json line 3' ]   // ~1.4s later
```

## Impact

Any subscribed container whose output isn't Monolog/CLF/JSON-shaped (a large
fraction of real containers — plain `console.log`/`print`/shell-script
output, many custom app logs) shows an empty stream for up to ~20 log lines'
worth of real time after the user checks its box, directly contradicting
acceptance criterion 5's "within one broadcast interval" and giving the
impression the subscribe action silently failed.

## Suggested fix (for the backend-developer lane — not applied here)

Not prescribing a specific number, but options worth considering: shrink
`LIVE_DETECTION_ENTRY_CAP` significantly for live sources, add a time-based
(not just count-based) commit fallback (e.g. "commit after N ms of live
detection regardless of buffered count"), or emit provisionally under the
`raw` parser as entries arrive and simply re-tag/re-emit already-delivered
entries if a later lock changes the classification. Any of these would need
to preserve the existing "sticky per-source parser" guarantee `log-schema.md`
already documents; not a QA call to make.

## Automated regression test

Reproduced directly against the real Docker daemon (see the transcript
above); not committed as a permanent `test/` regression test because it
requires either a ~20s real-time sleep loop (slow, flaky under load) or
mocking the pipeline's live-detection timing, which risks masking the very
behavior being tested. `test/docker/subscribe-global.test.ts` and sibling
files were written using JSON-formatted throwaway container output (or a
pre-accumulated backlog before subscribing) specifically to route around
this defect rather than depend on it — see those files' comments for why.

## Re-verification (2026-07-20)

**Result: fixed.** `src/parsers/pipeline.ts`'s `handleAggregatedEntry()` now
emits every live-mode entry immediately as it's aggregated (`this.emit(
"entries", [this.buildLog(entry, provisional)])`), provisionally tagged with
whatever parser has already earned an early lock (`checkEarlyLock() ??
rawParser`), instead of buffering up to `LIVE_DETECTION_ENTRY_CAP` (20)
entries before emitting anything. Read the diff (`git log -- src/parsers/
pipeline.ts`) and confirm the withholding branch (`this.bufferedDetectionEntries.push(entry)`
gating all emission) is gone for `mode === "live"`.

Re-reproduced live end-to-end against a real, freshly-created throwaway
container (`tr-qa-repro-defect1`, plain unstructured text, ~1 line/sec, no
pre-existing backlog — same shape as the original repro) using a one-off
script that boots the real built server (`dist/server/index.js`) and a real
WS client, subscribes the moment the container is discovered, and measures
the delay from `subscribe` to the first `"entries"` message for that source:

```
subscribe sent at 1784570220100
entries received for source: 6
first entry delay from subscribe (ms): 949
```

949 ms (dominated by the real `docker inspect`/`logs` attach round-trip, not
by any artificial detection buffering) vs. the original defect's ~20,000 ms
(zero entries until 20 lines had accumulated). 6 entries arrived steadily
over the following 6 seconds (roughly 1/sec, matching the container's own
emission rate) with no further gap — confirms entries are no longer withheld
pending detection. Per this run's product-owner-ratified note, the
provisional `raw` tag on these early entries (and the fact that they aren't
retroactively re-tagged) is expected, in-scope behavior, not re-litigated
here — only "entries appear within one broadcast interval" (criterion 5) was
re-verified.

Also re-ran the full automated suite (`npm test`): 79/79 pass, including all
`test/docker/*.test.ts` files that were written to route around this defect
— no regression from the fix.

Throwaway container `tr-qa-repro-defect1` removed at the end of the
reproduction (confirmed via `docker ps -a` — no `tr-qa-*` containers
remain); the owner's `street_bites` containers were only observed
(`docker ps`), never touched.
