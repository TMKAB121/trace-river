# Defect 001-phase-1-core-console-2

**Area:** backend
**Severity:** medium
**Status:** accepted-by-owner
**Spec:** `docs/specs/001-phase-1-core-console.md` acceptance criterion 7; `docs/phases/phase-1-core.md` § Exit criteria ("Dragging in a 100 MB Laravel log parses it without the Node process exceeding ~250 MB RSS, and the tab stays responsive.")

## Resolution

Product owner reviewed the measurements below (263–292 MB peak RSS across
three independent runs) and ruled them **ACCEPTED as within the "~250 MB"
tolerance for phase 1** — no code change requested. Closed as
accepted-by-owner, not fixed.

`test/e2e/memory.test.ts`'s threshold was updated by QA from the literal
250 MB spec figure to an owner-accepted 300 MB ceiling (a sensible margin
above the observed 263–292 MB range) so the suite reflects the ruling
instead of failing forever on an accepted baseline, while still catching a
genuine future regression. Re-run after the change: peak RSS 268.8 MB,
**passes** against the new 300 MB ceiling.

The product owner also separately accepted the ~3s peak responsiveness
latency noted below (see "Secondary observation") — no numeric criterion
added to the spec; recorded as an owner-accepted observation in the test
plan.

## Summary

Independently measured peak server RSS while parsing a 100 MB log
consistently exceeds the spec's ~250 MB figure. Three separate runs of
`test/e2e/memory.test.ts` (a synthetic, realistic Laravel/Monolog-shaped 100
MB fixture, ~779k entries — 1-in-20 of them a small multi-line PHP stack
trace) measured:

| Run | Peak RSS |
|---|---|
| 1 | 291.6 MB |
| 2 | 263.3 MB |
| 3 | 280.2 MB |

All three are above the spec's stated ~250 MB. This independently
reproduces the ~288 MB peak the backend developer self-reported on their own
fixture (per the QA task brief) — not a fixture-specific fluke.

## Measurement method

- The server under test is spawned as a **separate Node process**
  (`test/helpers/child-server-runner.ts`, run via `tsx`) specifically so its
  RSS can be measured in isolation from the test harness's own memory use
  (generating/streaming the 100 MB body, running vitest, etc. — all of that
  lives in the parent process, not the server process).
- RSS is sampled every 250 ms via `ps -o rss= -p <server-pid>` (a standard
  OS utility, not a new dependency) for the duration of the upload.
- The upload is streamed via a raw `http.request` with no `Content-Length`
  (chunked/unknown-length path), matching the spec's "streams to the
  server... never held in memory on either side" requirement — this test is
  not exercising a degenerate buffered-upload path.
- A WS client stays connected and drains all broadcast traffic throughout,
  mirroring a real connected browser tab.

## Secondary observation (not asserted as pass/fail — see Open Questions)

The same run also recorded a peak latency of ~3.2 seconds on a trivial `GET
/api/status` call issued concurrently during the upload (vs. a typical
sub-10ms latency when idle). This suggests the parsing loop can
synchronously occupy the event loop long enough to visibly delay other
request handling for multi-second stretches under sustained high-volume
input — plausibly the same mechanism a real browser tab's "stays responsive"
requirement would also be sensitive to, though this harness cannot drive an
actual browser tab under load to confirm that side directly (see the test
plan's notes on this criterion). The automated test does not fail on this
latency number specifically, since the spec defines no numeric
responsiveness threshold — see OPEN QUESTIONS in the QA handoff.

## Automated regression test

`test/e2e/memory.test.ts` — originally asserted peak RSS ≤ 250 MB (failed
with the measurements above); now asserts peak RSS ≤ 300 MB per the owner's
ruling (see Resolution) and passes. Also asserts the upload completes
correctly and the server never fully hangs, which held true throughout.

## Impact

A user with a real ~100 MB framework log (the exact scenario the phase's
exit criteria call out) will see the TraceRiver server process use noticeably
more memory than documented, on a tool explicitly positioned as a
lightweight local dev utility.

## Note on the ~250 MB figure

"~250 MB" is not a hard number to the byte, and some margin is reasonable —
but a consistent 5–17% overage across independent runs (and independent
confirmation of the backend developer's own ~288 MB finding) reads as a real
gap rather than measurement noise, so this is filed as a defect rather than
waved through. Whether ~260–290 MB is "close enough" to ~250 MB to ship
phase 1 as-is is a product-owner judgment call — flagged in OPEN QUESTIONS,
not decided here.
