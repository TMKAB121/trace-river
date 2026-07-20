# Defect 002-phase-2-docker-3

**Area:** backend
**Severity:** high
**Status:** open
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
