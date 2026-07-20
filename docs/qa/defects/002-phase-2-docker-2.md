# Defect 002-phase-2-docker-2

**Area:** backend
**Severity:** high
**Status:** verified-fixed
**Spec:** `docs/specs/002-phase-2-docker.md` acceptance criterion 7 ("TTY
output renders as plain text without corruption") and `docs/phases/
phase-2-docker.md` § 2.3 ("`timestamps: true` prepends Docker's own
RFC3339Nano timestamps — the ingest adapter strips them into
`rawTimestamp`").

## Summary

For a **TTY-enabled** Docker container (`Config.Tty === true`), every
entry's `message`/`raw` still contains the raw Docker RFC3339Nano timestamp
prefix that's supposed to be stripped into `rawTimestamp` before the format
parser ever sees the line. `rawTimestamp` itself ends up `null`, and the
normalized `timestamp` field falls back to arrival/aggregation time (visibly
batched — several consecutive entries share the exact same `timestamp`
value) instead of the container's real per-line emission time.

This is a real corruption of the rendered row for **every single entry**
from **every** TTY-enabled container — not an edge case — and it silently
degrades a normally-reliable timestamp into a much coarser, batching-
dependent one.

## Root cause (read, not modified)

`src/ingest/docker.ts`:

```ts
const DOCKER_TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z) (.*)$/;
...
class DockerLineFeeder {
  ...
  push(chunk: Buffer): void {
    this.buffer += chunk.toString("utf8");
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      this.feedLine(line);          // <-- `line` may still end in "\r" here
    }
    ...
  }
  private feedLine(line: string): void {
    const match = DOCKER_TIMESTAMP_RE.exec(line);   // <-- fails when `line` ends in "\r"
    if (match) {
      this.pipeline.feedLine(match[2], match[1]);
    } else {
      this.pipeline.feedLine(line, null);           // <-- falls through here for TTY
    }
  }
}
```

A TTY-allocated container's stream (Docker pty behavior) uses `\r\n` line
endings, not bare `\n`. `DockerLineFeeder.push()` splits only on `\n`, so
each extracted `line` for a TTY container still has a **trailing `\r`**.
`DOCKER_TIMESTAMP_RE`'s `(.*)$` can never consume that trailing `\r`
(JavaScript's `.` excludes line-terminator characters, `\r` included, and
`$` without the `/m` flag only matches the true end of the string) — so the
regex match **always fails** for every line of every TTY container, and the
whole raw line (timestamp prefix included) is passed straight through as
`sourceTimestamp: null`.

The `\r` is only stripped **later**, inside `SourcePipeline.feedLine()`:

```ts
feedLine(rawLine: string, sourceTimestamp: string | null = null): void {
  const withoutCr = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
  this.aggregator.addLine(stripAnsi(withoutCr), sourceTimestamp);
}
```

— by which point `DockerLineFeeder` has already committed to
`sourceTimestamp: null` and handed over the still-timestamp-prefixed text as
the line's content. The non-TTY path is unaffected because non-TTY
containers' stdout/stderr use plain `\n` line endings, so the regex matches
normally there (confirmed — see Reproduction).

## Reproduction

```
docker run -d -t --name tr-qa-repro-tty alpine sh -c \
  'i=0; while true; do i=$((i+1)); echo "tty plain line $i"; sleep 0.05; done'
```
Subscribe to `docker:tr-qa-repro-tty` and inspect the delivered entries:

```json
{"message":"2026-07-20T04:50:20.428994170Z tty plain line 18","rawTimestamp":null,"timestamp":1784523023155}
{"message":"2026-07-20T04:50:20.485838295Z tty plain line 19","rawTimestamp":null,"timestamp":1784523023155}
{"message":"2026-07-20T04:50:20.541209004Z tty plain line 20","rawTimestamp":null,"timestamp":1784523023155}
```
Every `message` carries the raw Docker timestamp prefix (should have been
stripped); `rawTimestamp` is `null` (should be the stripped ISO string); the
three consecutive entries above share the identical `timestamp`
(`1784523023155`), showing it was assigned once per aggregation/flush batch
rather than derived from each line's own real timestamp.

Contrast, same reproduction against a **non-TTY** container with identical
log content (`docker run -d --name tr-qa-repro-notty alpine sh -c '...'`,
no `-t`): `message` is clean (`"notty plain line N"`), confirming the defect
is TTY-path-specific.

## Impact

- Every visible row from a TTY-enabled container shows a garbled,
  doubled-up message (`"2026-07-20T04:50:20.428994170Z tty plain line 18"`
  instead of `"tty plain line 18"`) — a direct, 100%-reproducible violation
  of acceptance criterion 7's "renders as plain text without corruption."
- The entry's displayed/normalized timestamp silently degrades from a
  precise per-line value to a coarse, batching-dependent arrival time,
  which could visibly misorder or misrepresent timing for any TTY-attached
  container (common for interactive dev tools, `docker run -it`-style
  services, some `docker compose` services with `tty: true`).

## Automated regression test

`test/docker/demux.test.ts` — "a TTY container's plain-text output renders
unmodified (never demuxed)" — **currently fails**, asserting
`entry.message` matches the clean expected text; it currently observes the
polluted, timestamp-prefixed message instead. Left failing intentionally as
the regression test for this defect (matching the project's `port-zero`
precedent of a red test committed alongside its defect report).

## Suggested fix (for the backend-developer lane — not applied here)

Strip a trailing `\r` from `line` inside `DockerLineFeeder.push()`/`feedLine()`
*before* running `DOCKER_TIMESTAMP_RE` against it (rather than relying on
`SourcePipeline.feedLine()`'s later, too-late `\r` strip) — not a QA call to
implement.

## Re-verification (2026-07-20)

**Result: fixed.** `src/ingest/docker.ts`'s `DockerLineFeeder.feedLine()` now
strips a trailing `\r` from `line` before running `DOCKER_TIMESTAMP_RE`
against it (`const withoutCr = line.endsWith("\r") ? line.slice(0, -1) :
line;` followed by `DOCKER_TIMESTAMP_RE.exec(withoutCr)`, with both the
timestamp-match and fallback branches now operating on `withoutCr`) — exactly
the suggested fix, applied at the point where it actually matters (before the
regex, not `SourcePipeline`'s later, too-late strip).

The committed regression test, `test/docker/demux.test.ts` → "a TTY
container's plain-text output renders unmodified (never demuxed)", is now
**green**:

```
✓ test/docker/demux.test.ts (3 tests) 8239ms
  ✓ a non-TTY container's demuxed entries contain no binary frame-header garbage 1745ms
  ✓ a TTY container's plain-text output renders unmodified (never demuxed) 1661ms
  ✓ stderr lines without their own level are floored to WARN 1653ms
```

Ran in isolation (`node_modules/.bin/vitest run test/docker/demux.test.ts`)
against a real Docker daemon and real throwaway TTY/non-TTY containers — pass
was deterministic, not a fluke of full-suite ordering. Also confirmed via the
full suite (`npm test`): 79/79 pass. `typecheck` and `build` both pass
cleanly with the fix in place.
