# Defect 003-phase-3-auto-discovery-2

**Area:** backend
**Severity:** high
**Status:** verified-fixed
**Spec:** `docs/specs/003-phase-3-auto-discovery.md` § API contract's WS
message section ("subscription for `kind: 'local'` sources is
**per-connection**... It is **not** server-global state") and acceptance
criteria 2 ("the moment the file is created... no user action") and 11
("keeps it unsubscribed permanently in that connection... never re-flips its
checkbox back on without explicit user action").

## Summary

The server's `sources`/`sourceState` broadcast carries one shared
`subscribed` boolean per source, sent identically to every connected client
— but subscription for `kind: "local"` (and `"file"`) sources is documented,
and partly implemented, as **per-connection** (`ClientConnection
.excludedSourceIds`, `src/server/broadcaster.ts`). These two models don't
agree with each other, producing two confirmed, opposite-direction symptoms:

- **Symptom A** — an already-open connection that was subscribed to a
  `pending` source (dimmed, unchecked, per spec) never actually starts
  receiving that source's entries once the server's one-time zero-config
  auto-subscribe fires. The checkbox correctly re-renders checked (the
  broadcast `sources` message's shared `subscribed` field did flip to
  `true`), but **no data ever flows to that connection** — silently
  breaking the exact "no user action" promise acceptance criterion 2 makes,
  for the single most common case (a tab left open from before the app's
  first log line was ever written).
- **Symptom B** — the reverse: after a connection **explicitly**
  unsubscribes from a source, the very next `sources` broadcast triggered by
  *any other* lifecycle event (this same source going `stopped`, a
  different local source going `live`, an error, etc. — `broadcastSources()`
  always sends the full, unfiltered list to every client) reports the
  shared registry's untouched default value again, and the client's
  `REPLACE_SOURCES` reducer (`web/src/store/store.tsx`) takes
  `incoming.subscribed` verbatim — visually re-checking the box the user
  just unchecked, contradicting acceptance criterion 11's "never re-flips...
  without explicit user action" in the wire data itself (independent of
  whatever the frontend does with it).

## Root cause (read, not modified)

- `src/server/ws.ts`'s `onConnection` seeds `conn.excludedSourceIds` once,
  at connect time, from the registry's current `source.subscribed` value.
  Nothing thereafter keeps a given connection's `excludedSourceIds` in sync
  with later registry mutations — `src/ingest/tail.ts`'s
  `evaluateFilesChanged()` calls `this.state.sources.setSubscribed(id,
  true)` (the one-time auto-subscribe) but never touches any live
  `ClientConnection`'s `excludedSourceIds`, and there is no code path that
  would (Symptom A).
- `src/server/sources.ts`'s `SourceRegistry.setSubscribed()` is the *only*
  place that mutates a source's stored `subscribed` value for `local`
  origins other than the one-time auto-subscribe above — a client's
  `{"type":"unsubscribe",...}` message (`handleSubscribeToggle` in
  `src/server/ws.ts`) only ever calls `broadcaster.unsubscribe(conn, ids)`,
  which updates *that connection's* `excludedSourceIds` and nothing in the
  shared registry. So the registry's `subscribed` field for a local source,
  once past its one auto-subscribe mutation (or never touched at all), is
  frozen at its creation-time default forever — and every later
  `broadcastSources()` call (`src/ingest/tail.ts`, fired on every local
  source's `pending`→`live`, `live`→`stopped`, `stopped`→`live`, and error
  transition) re-sends that stale, connection-agnostic value to every
  client, clobbering whatever any individual connection's own explicit
  choice was (Symptom B).

Both symptoms are two faces of the same gap: the wire protocol's `sources`
message has no way to represent "connection X is subscribed but connection Y
isn't" for one source — `sendSources`/`broadcastSources` always send the
literal same array to every socket, never personalized per-connection.

## Reproduction

**Symptom A** — `test/discovery/zero-config-laravel.test.ts`, test
`"REGRESSION CHECK... the tab that was already connected while pending
actually receives entries after the auto-subscribe flip"`: connects before
`storage/logs/laravel.log` exists, creates the file, waits for the
`sourceState: "live"` broadcast, appends a line, and asserts the same,
already-open connection receives it. Currently red — `waitFor` on the
entries message times out.

**Symptom B** — `test/discovery/subscribed-broadcast-clobber.test.ts`:
connects to an already-`live` `local:laravel`, sends an explicit
`{"type":"unsubscribe"}`, then deletes the log file (a `live`→`stopped`
transition that reliably fires `broadcastSources()`), and asserts the next
`sources` message still reports `subscribed: false` for this connection.
Currently red — the message reports `subscribed: true`.

Both are self-contained, fixture-based, deterministic (no timing-dependent
flake observed across repeated runs).

## Impact

- Symptom A directly breaks the phase's headline zero-config promise for
  anyone who has the console open in a browser tab *before* their app's log
  file is first created — arguably the single most likely real-world timing
  (open TraceRiver, then start the app).
- Symptom B means a user's explicit "stop showing me this noisy source"
  choice is not durable across the session — it can silently revert the
  next time *any* local source (not necessarily the one they unsubscribed
  from) changes state, which — post phase 3 — happens routinely in a normal
  dev loop (file truncation/rotation/restart-driven deletion+recreation).

## Suggested fix (for the backend-developer lane — not applied here)

Not prescribing a specific implementation, but two directions worth
weighing: (a) personalize the `sources` message per connection (compute each
connection's own effective `subscribed` value from its `excludedSourceIds`
before sending, rather than sending the shared registry array verbatim), or
(b) push an explicit, connection-scoped "your subscription for source X is
now Y" message alongside (or instead of) mutating registry-global state for
what's documented as a per-connection concern. Either resolves both symptoms
at once, since they share one root cause.

## Automated regression test

`test/discovery/zero-config-laravel.test.ts` (Symptom A) and
`test/discovery/subscribed-broadcast-clobber.test.ts` (Symptom B) — both
self-contained fixtures, both currently red on purpose (same convention as
phase 2's committed pre-fix regression tests).

## Re-verification (2026-07-20)

Fix landed in `src/server/broadcaster.ts` (plus supporting changes in
`src/server/ws.ts`, `src/server/sources.ts`, `src/ingest/tail.ts`): the
`sources`/`sourceState` broadcast's `subscribed` field is now computed
per-connection (`{ ...source, subscribed: conn.isSubscribed(source.id) }`
in `broadcaster.ts`) instead of sending the shared registry value verbatim
to every socket, and a new `autoSubscribeAll(sourceId)` path removes a
source from every already-open connection's `excludedSourceIds` (unless
that connection itself explicitly excluded it) so the one-time zero-config
auto-subscribe actually starts delivering entries, not just flipping the
checkbox. Confirmed present in the committed code.

- `test/discovery/zero-config-laravel.test.ts` "REGRESSION CHECK" (Symptom
  A) — now green (was red).
- `test/discovery/subscribed-broadcast-clobber.test.ts` (Symptom B) — now
  green (was red).
- Full committed regression: `npm test` — 109/109 tests pass, including
  both of these and every previously-green test (no regressions, notably
  `test/discovery/rotation-truncation.test.ts` criterion 11's
  per-connection-unsubscribe cases and `test/docker/subscribe-global.test.ts`,
  which exercise related-but-distinct subscribe semantics, both still pass).
- Fixes are backend-only (no rendered-output change); no new evidence
  capture needed per the QA task's own instruction.

**Status: verified-fixed.**
