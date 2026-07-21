/**
 * REGRESSION (see docs/qa/defects/003-phase-3-auto-discovery-2.md): the
 * `sources`/`sourceState` broadcast's `subscribed` field for a
 * `kind: "local"` (or `"file"`) source is a single, non-personalized value
 * shared across every connected client — but subscription for these kinds
 * is documented as per-connection (docs/specs/003-phase-3-auto-discovery.md
 * § API contract: "subscription for kind: 'local' sources is
 * per-connection... It is not server-global state"). Two symptoms of the
 * same root cause, both reproduced here:
 *
 *  A. An already-open connection that was subscribed while a source was
 *     still `pending` never actually starts receiving entries after the
 *     server's one-time zero-config auto-subscribe flips the shared
 *     registry value to `true` — the per-connection delivery filter
 *     (`ClientConnection.excludedSourceIds`, src/server/broadcaster.ts)
 *     seeded at connect time is never updated to match.
 *  B. A connection's explicit manual unsubscribe is visually reverted by
 *     the very next unrelated `sources` broadcast (any other local source's
 *     lifecycle transition triggers a full, non-personalized re-broadcast)
 *     — the checkbox re-renders checked even though this connection's
 *     actual delivery correctly stays suppressed underneath.
 *
 * Symptom A is also covered directly, with fuller narrative, in
 * test/discovery/zero-config-laravel.test.ts's "REGRESSION CHECK". This file
 * adds symptom B and keeps both close together since they share one fix.
 * Left red on purpose (same convention as phase 2's committed regression
 * tests) until fixed.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { unlinkSync } from "node:fs";
import {
  mkFixtureDir,
  rmFixtureDir,
  laravelProject,
  startDiscoveryTestServer,
  connect,
  collect,
  sleep,
  waitFor,
  closeAll,
  type DiscoveryTestServer,
} from "./helpers.js";

let ts: DiscoveryTestServer | undefined;
let dir: string | undefined;

beforeEach(() => {
  dir = mkFixtureDir();
});

afterEach(async () => {
  await ts?.close();
  ts = undefined;
  if (dir) rmFixtureDir(dir);
  dir = undefined;
});

describe("Defect repro — non-personalized sources broadcast clobbers per-connection subscribe state", () => {
  it("symptom B: an unrelated source's later lifecycle broadcast reverts this connection's own explicit unsubscribe back to subscribed:true in the wire message", async () => {
    laravelProject(dir!, {
      withLogFile: true,
      logContent: "[2026-07-19 09:00:00] local.INFO: pre-existing {} []\n",
    });
    ts = await startDiscoveryTestServer({ cwd: dir! });

    const ws = await connect(ts.wsUrl, ts.token);
    try {
      const sourcesMsgs = collect(ws, "sources");
      await sleep(150);

      ws.send(JSON.stringify({ type: "unsubscribe", sourceIds: ["local:laravel"] }));
      await sleep(150);

      // Any other lifecycle transition for THIS SAME source (deletion ->
      // live->stopped is the simplest reliable trigger, unaffected by the
      // separate literal-path defect since the file already existed) fires
      // a full, non-personalized `sources` broadcast to every client.
      unlinkSync(`${dir!}/storage/logs/laravel.log`);
      await waitFor(
        () =>
          sourcesMsgs.some((m) => m.sources.find((s) => s.id === "local:laravel")?.state === "stopped"),
        3000,
      );
      await sleep(150);

      const last = sourcesMsgs[sourcesMsgs.length - 1];
      const laravel = last.sources.find((s) => s.id === "local:laravel")!;
      // Expected per acceptance criterion 11 ("never re-flips its checkbox
      // back on without explicit user action"): subscribed should still
      // read false for a connection that explicitly unsubscribed. It
      // currently reads true (the untouched shared registry default).
      expect(laravel.subscribed).toBe(false);
    } finally {
      closeAll(ws);
    }
  });
});
