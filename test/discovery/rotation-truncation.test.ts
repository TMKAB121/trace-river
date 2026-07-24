/**
 * Daily rotation, truncation, and the "auto-subscribe never overrides an
 * explicit unsubscribe" rule — docs/specs/003-phase-3-auto-discovery.md
 * acceptance criteria 3, 4, 11.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
  mkFixtureDir,
  rmFixtureDir,
  laravelProject,
  writeFixtureFile,
  appendFixtureFile,
  truncateFixtureFile,
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

describe("Criterion 3 — daily rotation continues the same source", () => {
  it("a new laravel-<date>.log matched by the glob default streams into the same local:laravel row, no new row", async () => {
    laravelProject(dir!, { withLogFile: true, logContent: "[2026-07-19 09:00:00] local.INFO: day one {} []\n" });
    ts = await startDiscoveryTestServer({ cwd: dir! });

    const ws = await connect(ts.wsUrl, ts.token);
    try {
      const entries = collect(ws, "entries");
      await sleep(150);

      // Midnight rollover — Laravel's daily driver creates a new dated file
      // and stops writing to the old one.
      appendFixtureFile(
        `${dir!}/storage/logs/laravel-2026-07-21.log`,
        "[2026-07-21 00:00:05] local.INFO: day two {} []\n",
      );

      await waitFor(
        () => entries.flatMap((m) => m.entries).some((e) => e.message.includes("day two")),
        3000,
      );

      const res = await fetch(`${ts!.baseUrl}/api/sources`, {
        headers: { Authorization: `Bearer ${ts!.token}` },
      });
      const { sources } = (await res.json()) as { sources: Array<{ id: string }> };
      const localSources = sources.filter((s) => s.id.startsWith("local:") || s.id.startsWith("laravel"));
      // Exactly one row for the whole laravel*.log family — no second row for
      // the rotated file.
      expect(sources.filter((s) => s.id === "local:laravel")).toHaveLength(1);
      expect(localSources.length).toBe(1);

      const allEntries = entries.flatMap((m) => m.entries);
      expect(allEntries.some((e) => e.message.includes("day two") && e.source === "local:laravel")).toBe(true);
    } finally {
      closeAll(ws);
    }
  });
});

describe("Criterion 4 — truncation doesn't break the tail", () => {
  it("echo -n > laravel.log resets the offset with no crash, no duplicate/garbled entries, and subsequent writes appear", async () => {
    laravelProject(dir!, {
      withLogFile: true,
      logContent: "[2026-07-19 09:00:00] local.INFO: before truncate {} []\n",
    });
    ts = await startDiscoveryTestServer({ cwd: dir! });

    const ws = await connect(ts.wsUrl, ts.token);
    try {
      const entries = collect(ws, "entries");
      await sleep(300); // let the pre-existing (EOF-attached) content settle — expect nothing ingested

      const target = `${dir!}/storage/logs/laravel.log`;
      truncateFixtureFile(target);
      appendFixtureFile(target, "[2026-07-19 09:05:00] local.INFO: after truncate {} []\n");

      await waitFor(
        () => entries.flatMap((m) => m.entries).some((e) => e.message.includes("after truncate")),
        3000,
      );
      await sleep(300);

      const all = entries.flatMap((m) => m.entries).filter((e) => e.source === "local:laravel");
      // No history from before startup (EOF-attach), no duplicate copies of
      // the post-truncation line, nothing garbled.
      expect(all.filter((e) => e.message.includes("before truncate"))).toHaveLength(0);
      const afterLines = all.filter((e) => e.message.includes("after truncate"));
      // Exactly one copy, no duplication/garbling from the truncate+reset —
      // this is genuinely the *first* entry this source's pipeline has ever
      // seen (the pre-truncation content was skipped by the EOF-start attach),
      // so it's still within the live-detection window and a single entry
      // can't yet earn a lock (which requires 3 of the first ~20 to score
      // ≥0.8). It is nonetheless emitted provisionally tagged with the parser
      // that strongly matches *this* line — monolog here (issue #8) — rather
      // than the `raw` fallback, so it already renders with its parsed message
      // and level instead of the whole line verbatim.
      expect(afterLines).toHaveLength(1);
      expect(afterLines[0].message).toBe("after truncate");
      expect(afterLines[0].level).toBe("INFO");

      const res = await fetch(`${ts!.baseUrl}/api/sources`, {
        headers: { Authorization: `Bearer ${ts!.token}` },
      });
      const { sources } = (await res.json()) as { sources: Array<{ id: string; state: string }> };
      expect(sources.find((s) => s.id === "local:laravel")!.state).toBe("live");
    } finally {
      closeAll(ws);
    }
  });
});

describe("Criterion 11 — a manual unsubscribe never gets re-flipped back on by a later file event", () => {
  // NOTE: these two tests deliberately start with `local:laravel` already
  // `live`/`subscribed:true` at connect time (spec 001's default-subscribed
  // rule for an already-live source, not the pending->live auto-subscribe
  // path) so they isolate acceptance criterion 11's "never re-flips ...
  // without explicit user action" claim from the confirmed, separately-filed
  // defect in the pending->live auto-subscribe broadcast path itself (see
  // docs/qa/defects/003-phase-3-auto-discovery-2.md and
  // test/discovery/zero-config-laravel.test.ts's REGRESSION CHECK, which
  // covers that path directly).
  it("unsubscribing from an already-live source never re-delivers entries to this connection across a later truncation and rotation", async () => {
    laravelProject(dir!, {
      withLogFile: true,
      logContent: "[2026-07-19 09:00:00] local.INFO: pre-existing {} []\n",
    });
    ts = await startDiscoveryTestServer({ cwd: dir! });

    const ws = await connect(ts.wsUrl, ts.token);
    try {
      const entryMsgs = collect(ws, "entries");
      await sleep(150);

      ws.send(JSON.stringify({ type: "unsubscribe", sourceIds: ["local:laravel"] }));
      await sleep(150);

      // Truncate, then rotate — neither should re-deliver entries to this
      // connection (Decision 4 / acceptance criterion 11: never a standing
      // override of an explicit unsubscribe).
      const target = `${dir!}/storage/logs/laravel.log`;
      truncateFixtureFile(target);
      appendFixtureFile(target, "[2026-07-19 09:01:00] local.INFO: post-truncate {} []\n");
      await sleep(400);

      appendFixtureFile(
        `${dir!}/storage/logs/laravel-2026-07-20.log`,
        "[2026-07-20 00:00:01] local.INFO: rotated {} []\n",
      );
      await sleep(600);

      const delivered = entryMsgs.flatMap((m) => m.entries).filter((e) => e.source === "local:laravel");
      expect(delivered).toHaveLength(0);
    } finally {
      closeAll(ws);
    }
  });

  it("a still-subscribed second connection keeps receiving entries after the first connection unsubscribes (per-connection, not server-global)", async () => {
    laravelProject(dir!, {
      withLogFile: true,
      logContent: "[2026-07-19 09:00:00] local.INFO: pre-existing {} []\n",
    });
    ts = await startDiscoveryTestServer({ cwd: dir! });

    const wsA = await connect(ts.wsUrl, ts.token);
    const wsB = await connect(ts.wsUrl, ts.token);
    try {
      const entriesA = collect(wsA, "entries");
      const entriesB = collect(wsB, "entries");
      await sleep(150);

      wsA.send(JSON.stringify({ type: "unsubscribe", sourceIds: ["local:laravel"] }));
      await sleep(150);

      const target = `${dir!}/storage/logs/laravel.log`;
      appendFixtureFile(target, "[2026-07-19 09:02:00] local.INFO: after unsub {} []\n");
      await waitFor(
        () => entriesB.flatMap((m) => m.entries).some((e) => e.message.includes("after unsub")),
        3000,
      );
      await sleep(300);

      const aGotIt = entriesA.flatMap((m) => m.entries).some((e) => e.message.includes("after unsub"));
      const bGotIt = entriesB.flatMap((m) => m.entries).some((e) => e.message.includes("after unsub"));
      expect(bGotIt).toBe(true);
      expect(aGotIt).toBe(false);
    } finally {
      closeAll(wsA, wsB);
    }
  });
});
