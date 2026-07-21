# Defect 003-phase-3-auto-discovery-1

**Area:** backend
**Severity:** critical
**Status:** verified-fixed
**Spec:** `docs/specs/003-phase-3-auto-discovery.md` acceptance criteria 2
("the moment the file is created... the row automatically flips to
checked... with no page refresh and no user action") and 6 (`watch` entries
"behave per configuration.md"), and § User flow step 7's own worked example
("`local:worker`... doesn't exist yet at startup... the moment the worker
process starts and creates the file, the row automatically flips to
checked... no user action"). Also undermines the phase doc's core zero-config
exit criterion for every project-root detector whose default target isn't a
glob.

## Summary

A `pending` local/config source whose resolved target is a **literal
(non-glob) path** never transitions to `live` when the file is later
created — regardless of whether the file's *containing directory* already
exists at server startup. The row is permanently stuck showing `WAITING`,
unchecked, `entryCount: 0`, forever, even minutes/hours after the real file
appears and starts accumulating content on disk.

This is not a narrow edge case. Of the seven project-root detectors in
`src/discovery/detectors.ts`, only `laravel`'s default target is a glob
(`storage/logs/laravel*.log`, chosen specifically to fold in daily-rotation
files under one source). **`symfony` (`var/log/dev.log`), `rails`
(`log/development.log`), and `wordpress` (`wp-content/debug.log`) all default
to literal, non-glob paths** — meaning "zero config" for any of these three
frameworks is broken whenever their log file doesn't already exist at the
moment `traceriver start` runs. It also breaks the spec's own canonical
`traceriver.json` `watch` example (`storage/logs/worker.log`, § User flow
step 7 and § API contract's `configuration.md` reference) and, by the same
mechanism, Valet's `nginx-error.log` and Homebrew's `php-fpm.log`
environment-tier targets (both literal paths — `src/discovery/
environment.ts`).

## Root cause (read, not modified)

`src/ingest/tail.ts`'s `TailedSource.initWatcher()` hands the target pattern
straight to `chokidar.watch(this.target.pattern, { ignoreInitial: false,
alwaysStat: true, usePolling: false, ... })`, whether that pattern is a glob
or a literal path. Isolated with bare `chokidar` (same version pinned in
`package.json`, `^3.6.0`) outside any TraceRiver code:

- Watching a **glob** pattern for a target whose file (and even whose parent
  directory) doesn't exist yet reliably fires `"add"` once the file is later
  created, at any realistic delay (tested 0 ms–several seconds).
- Watching a **literal, non-glob** path for a file that doesn't exist yet
  **never** fires `"add"` when that file is later created — confirmed with
  the parent directory both absent and already pre-existing, and at delays
  from 0 ms up to 10 s (the tailer's own `RECONCILE_POLL_MS` reconciliation
  poll doesn't help either: `reconcileAll()` only re-checks paths already
  present in `TailedSource.files`, which a literal target that was never
  `add`-ed never enters).
- Watching the **containing directory itself** (rather than the literal file
  path within it) reliably fires `"add"` for a new file created inside it —
  a promising direction for a fix, noted here for traceability, not
  prescribed.

## Reproduction

Minimal, product-code-free repro (bare `chokidar`, no TraceRiver imports):

```js
import chokidar from "chokidar";
const w = chokidar.watch("/tmp/x/otherlogs/other.log" /* dir exists, file doesn't */, {
  persistent: true, ignoreInitial: false, alwaysStat: true, usePolling: false,
});
w.on("add", (p) => console.log("ADD", p)); // never fires
w.on("ready", async () => {
  await new Promise((r) => setTimeout(r, 500));
  fs.writeFileSync("/tmp/x/otherlogs/other.log", "hello\n");
  // "ADD" never logs, even after 10+ seconds
});
```

Full-stack repro via the real, built server (`dist/server/index.js`,
`createAppState`), no Fastify/WS involved — isolates the defect to
`src/ingest/tail.ts` itself:

```
tail started, worker state: pending
worker.log created (dir + file together)
after 10s wait, worker state: pending false    // still pending, still unsubscribed, forever
```

Committed as a permanent regression test:
`test/discovery/pending-literal-path.test.ts` (currently red — the
`waitFor(() => state === "live", 4000)` call times out). Reproduces the
spec's own `storage/logs/worker.log` walkthrough almost verbatim, including
pre-creating the containing `storage/logs/` directory to rule out the
(separate, ruled-out) "parent directory doesn't exist" hypothesis.

## Impact

- The zero-config promise ("no user action") silently fails for Symfony,
  Rails, and WordPress projects whenever their log file doesn't already
  exist at server startup — a completely normal state for a freshly
  scaffolded project before its first request/command.
- Every bespoke `traceriver.json` `watch` entry pointing at a literal path
  that doesn't exist yet at startup — the spec's own flagship non-Laravel
  example — never activates without a full server restart, contradicting
  acceptance criterion 6 and the § User flow walkthrough directly.
- Valet's and Homebrew's environment-tier `pending` sources have the same
  permanent-`WAITING` fate.
- Only Laravel's own default target (the one detector whose default happens
  to be a glob) is unaffected — easy to miss in ad hoc manual testing
  against a Laravel-only fixture, which is presumably how this shipped.

## Suggested fix (for the backend-developer lane — not applied here)

Not prescribing a specific implementation, but the "watch the containing
directory instead of the literal file path" behavior confirmed above (chokidar
reliably fires `"add"` for new files inside an already-watched directory) is
a promising, minimally invasive direction — worth checking whether it also
resolves the (separately fixed by watching a glob) "parent directory absent"
class of case for free.

## Automated regression test

`test/discovery/pending-literal-path.test.ts` — self-contained fixture
(`mkdtemp`), currently red on purpose (same convention as phase 2's
committed pre-fix regression tests, e.g. `test/docker/demux.test.ts`).

## Re-verification (2026-07-20)

Fix landed in `src/ingest/tail.ts`: a literal (non-glob) watch target is now
rewritten into a single-match bracket-glob (e.g. `worker.log` ->
`worker[.]log`) before being handed to `chokidar.watch`, routing it through
chokidar's reliable glob-watch code path instead of the literal-path path
that never fired `add`. Confirmed present in the committed code (see
`src/ingest/tail.ts` lines ~32-74, the `escapeToSingleMatchGlob`-style
helper and its doc comment).

- `test/discovery/pending-literal-path.test.ts` — now green (was red).
- Full committed regression: `npm test` — 109/109 tests pass, including this
  one and every previously-green test (no regressions).
- Confirmed the product-owner-accepted parent-directory-absent limitation
  (backlog B3) is out of scope here and not re-tested/re-opened — this
  defect's repro and regression test both pre-create the parent directory
  (`storage/logs/`), matching the ruling.

**Status: verified-fixed.**
