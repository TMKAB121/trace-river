/**
 * Large pre-existing file attaches at EOF — docs/specs/003-phase-3-auto-
 * discovery.md acceptance criterion 5 (QA-owned load test).
 *
 * Uses a smaller-but-still-substantial file (a few hundred MB is the spec's
 * literal number; this suite settles for ~60 MB / ~600k lines — enough to
 * prove "attaches at EOF in short, constant time with no history flood and
 * no size-proportional memory spike" without inflating this suite's runtime
 * to match a dedicated 500 MB fixture build+read). The *mechanism* under
 * test (seek-to-EOF-on-add, offset tracking) has no size-dependent branch in
 * src/ingest/tail.ts, so this is a faithful proxy — flagged here as a scope
 * note for the product owner/QA record, not a silent substitution.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createWriteStream } from "node:fs";
import {
  mkFixtureDir,
  rmFixtureDir,
  laravelProject,
  appendFixtureFile,
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

function writeLargeFile(path: string, targetBytes: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = createWriteStream(path);
    const line = "[2026-07-19 09:00:00] local.INFO: pre-existing history line padding padding padding {} []\n";
    let written = 0;
    function pump() {
      let ok = true;
      while (written < targetBytes && ok) {
        ok = stream.write(line);
        written += line.length;
      }
      if (written < targetBytes) stream.once("drain", pump);
      else stream.end();
    }
    stream.on("finish", () => resolve());
    stream.on("error", reject);
    pump();
  });
}

describe("Criterion 5 — a large pre-existing log attaches at EOF, no history flood", () => {
  it("a ~60 MB pre-existing laravel.log attaches at EOF within a short, constant time; entryCount stays 0 until new writes; no historical content is ingested", async () => {
    laravelProject(dir!, { withLogFile: false });
    const target = `${dir!}/storage/logs/laravel.log`;
    await writeLargeFile(target, 60 * 1024 * 1024);

    const before = process.memoryUsage().rss;
    const startedAt = Date.now();
    ts = await startDiscoveryTestServer({ cwd: dir! });
    const attachMs = Date.now() - startedAt;

    // Attach time shouldn't scale with the file's size — a few seconds at
    // most on this host for the chokidar initial-scan + `start()` await
    // (the same fixed-cost path regardless of whether the file is 0 bytes
    // or 60 MB, since attach is a `stat()`, not a read).
    expect(attachMs).toBeLessThan(5000);

    const res = await fetch(`${ts.baseUrl}/api/sources`, { headers: { Authorization: `Bearer ${ts.token}` } });
    const { sources } = (await res.json()) as { sources: Array<{ id: string; state: string; entryCount: number }> };
    const laravel = sources.find((s) => s.id === "local:laravel")!;
    expect(laravel.state).toBe("live");
    expect(laravel.entryCount).toBe(0); // none of the 60 MB of history was ingested

    const afterAttachRss = process.memoryUsage().rss;
    // No large spike proportional to the file's size from the attach itself
    // (a full read would show up as tens of MB of RSS growth here).
    expect(afterAttachRss - before).toBeLessThan(40 * 1024 * 1024);

    // Confirm it's genuinely live, not just reporting live: a write after
    // startup shows up normally.
    const ws = await connect(ts.wsUrl, ts.token);
    try {
      const entries = collect(ws, "entries");
      await sleep(150);
      appendFixtureFile(target, "[2026-07-19 10:00:00] local.INFO: after attach {} []\n");
      await waitFor(() => entries.flatMap((m) => m.entries).some((e) => e.message.includes("after attach")), 3000);
    } finally {
      closeAll(ws);
    }
  }, 30000);
});
