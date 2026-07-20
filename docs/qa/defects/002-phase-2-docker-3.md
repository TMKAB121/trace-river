# Defect 002-phase-2-docker-3

**Area:** backend
**Severity:** high
**Status:** verified-fixed
**Spec:** `docs/specs/002-phase-2-docker.md` acceptance criterion 8
("`docker restart <svc>`... the stream shows no duplicated lines across the
restart boundary") and `docs/phases/phase-2-docker.md` § 2.4 ("re-attach
automatically (`tail` from attach point, avoiding duplicate history)").

## Summary

Restarting a subscribed container re-delivers a chunk of lines that were
**already delivered before the restart**, producing real duplicate entries
in the unified stream. Confirmed both at the raw `docker logs` level and
end-to-end through the actual ingest pipeline.

## Root cause (read, not modified)

`src/ingest/docker.ts`, `attach()`:

```ts
const rawStream = await this.client.logs(managed.containerId, {
  follow: true,
  stdout: true,
  stderr: true,
  tail: 50,
  timestamps: true,
});
```

`tail: 50` is used unconditionally, for both a container's *first* attach
and every *re-attach* (e.g. `discoverAll()`'s restart-recovery branch: `if
(existing.subscribed && managed && !managed.attachment) { void
this.attach(sourceId); }`). Docker's default `json-file` log driver does
**not** truncate or rotate a container's log on `restart` — it keeps
appending to the same log to the same file across the restart boundary (see
Reproduction). So a reattach's `tail: 50` pulls the last 50 lines of the
**entire lifetime log**, which — whenever fewer than 50 lines have been
produced since the restart — necessarily includes lines from **before** the
stop that were already streamed to clients in the prior attachment. Nothing
in `attach()` tracks "the last raw line/offset already delivered for this
source" to exclude that overlap on a reattach.

## Reproduction

Raw `docker logs`, no TraceRiver involved — proves the log driver itself
doesn't truncate on restart:
```
docker run -d --name tr-qa-repro-restart alpine sh -c \
  'i=0; while true; do i=$((i+1)); echo "rline $i"; sleep 0.2; done'
# ... wait, then:
docker restart tr-qa-repro-restart
docker logs --tail 20 tr-qa-repro-restart
```
Output (verbatim) — note "rline 52"–"rline 65" (**pre-restart** lines) are
immediately followed by a **new** "rline 1"–"rline 6" run, all still present
in the *same* log:
```
rline 52
rline 53
...
rline 65
rline 1
rline 2
...
rline 6
```

End-to-end, through `test/docker/lifecycle.test.ts`'s "criterion 8" test
(subscribe → let several batches land → `docker restart` → wait for
`stopped` then `live` again → collect every delivered `entry.raw` for the
source): the test asserts zero duplicate raw entries and **fails**, with
the collected transcript showing entries like `"restart line 226"` through
`"restart line 243"` delivered **twice** (once from the pre-restart
attachment's tail, once again from the post-restart reattach's `tail: 50`
overlapping the same log region), followed eventually by the genuinely-new
post-restart sequence starting at `"restart line 1"`.

## Impact

Every `docker restart` of a subscribed container (a very ordinary dev-loop
action — recompiling, `docker compose restart <service>`, a crash-loop
recovering) reliably re-shows up to ~50 already-seen log lines in the
unified stream, directly contradicting acceptance criterion 8 and the phase
doc's explicit "avoiding duplicate history" requirement. This gets *worse*,
not better, right after a fast restart (little/no new output yet), since
nearly the entire `tail: 50` window on reattach is pre-restart overlap.

## Automated regression test

`test/docker/lifecycle.test.ts` — "criterion 8: docker restart transitions
live -> stopped -> live automatically, with no duplicated lines across the
boundary" — reliably **fails** (duplicate raw entries observed) when run in
isolation (`vitest run test/docker/lifecycle.test.ts -t "criterion 8"`,
confirmed failing across repeated runs). **Note on flakiness**: because the
duplication's *magnitude* depends on exactly how many new lines the
container has produced by the moment the reattach's `tail: 50` fires
relative to the restart, this same test has been observed to **pass** when
run as part of the full `test/docker/` suite back-to-back with other
container-heavy tests (system/daemon load shifts the timing enough that the
post-restart backlog occasionally fills the entire 50-line tail window
before reattach, leaving no overlap to duplicate). This is expected given
the root cause above, not a flaw in the test — the defect is real and
independently confirmed via the raw `docker logs` reproduction (which has
no such timing dependency) and via repeated standalone test runs. Left in as
the regression test; a real fix should make it pass deterministically, not
just "usually."

## Suggested fix (for the backend-developer lane — not applied here)

Not prescribing an exact mechanism, but the reattach path specifically (as
opposed to a source's very first attach) has information the current code
discards: the last entry's timestamp/id already delivered for that source.
Options worth considering: use a smaller/zero `tail` on a *reattach*
specifically (relying on `follow` for genuinely-new output only), or use
Docker's `logs({ since: <lastDeliveredTimestamp> })` option keyed off the
last entry actually emitted before the stream ended, so a reattach only
ever requests output after that point. Not a QA call to make.

## Re-verification (2026-07-20)

**Result: fixed.** `src/ingest/docker.ts` now tracks `lastTimestampNanos` on
each `ManagedContainer` (the newest Docker per-line timestamp actually read
off that container's stream, updated by `recordTimestamp()` on every line)
and `attach()` branches on it:

```ts
const logsOptions =
  managed.lastTimestampNanos !== null
    ? { since: sinceParam(managed.lastTimestampNanos + 1n) }
    : { tail: 50 };
```

`lastTimestampNanos` is reset to `null` in `detach()` (explicit unsubscribe
or permanent stop), so a genuinely fresh subscribe still gets the full
`tail: 50` backfill (criterion 5); only a stream that ended on its own while
still subscribed (restart) preserves it, so `discoverAll()`'s automatic
reattach uses `since: <last seen timestamp + 1ns>` and never re-reads
already-delivered history. This is exactly the "options worth considering"
approach from this defect's own suggested-fix section.

The committed regression test, `test/docker/lifecycle.test.ts` → "criterion
8: docker restart transitions live -> stopped -> live automatically, with no
duplicated lines across the boundary", is now **green**, and — unlike the
pre-fix version, which this defect explicitly flagged as timing-dependently
flaky — it now passes **deterministically** in isolation, run 4 times back to
back with no failures:

```
✓ criterion 8: ... 14784ms
✓ criterion 8: ... 14778ms
✓ criterion 8: ... 14808ms
```

Also observed passing as part of the full `npm test` suite run (not just in
isolation). This determinism is expected from the fix: the root cause was specifically
that `tail: 50`'s overlap with pre-restart history was itself a function of
how much new output had landed by reattach time (i.e. inherently racy);
`since: <timestamp>` has no such window, so there's no longer a timing
dependency to be flaky about.

Also confirmed via the full suite (`npm test`): 79/79 pass. `typecheck` and
`build` both pass cleanly with the fix in place.

Throwaway containers used for the demux/lifecycle regression runs above were
all created and destroyed by the tests' own `afterEach`/`afterAll` hooks
(`tr-qa-`-prefixed, per `test/docker/helpers.ts`); confirmed zero `tr-qa-*`
containers remained after each run (`docker ps -a`). The owner's
`street_bites` containers were only ever observed (`docker ps`), never
restarted, renamed, stopped, or removed.
