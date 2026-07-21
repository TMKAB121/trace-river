/**
 * Two local sources streaming concurrently interleave correctly and the
 * server stays responsive under realistic dev-loop volume — docs/specs/
 * 003-phase-3-auto-discovery.md acceptance criterion 19 (QA load test).
 * Mirrors the shape of test/docker/load.test.ts (status-latency proxy for
 * "no UI freeze" — this suite has no browser event loop to actually
 * measure janks against, so responsiveness is proxied by the HTTP
 * `/api/status` round-trip staying fast while both sources are being
 * written to as fast as Node can flush them).
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
  mkFixtureDir,
  rmFixtureDir,
  laravelProject,
  writeFixtureFile,
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

describe("Criterion 19 — two concurrent local sources interleave correctly with no server freeze", () => {
  it("local:laravel and a second watch-declared source both stream under load, in arrival order, with /api/status staying responsive throughout", async () => {
    laravelProject(dir!, { withLogFile: true, logContent: "" });
    writeFixtureFile(dir!, "worker/worker.log", "");
    ts = await startDiscoveryTestServer({
      cwd: dir!,
      watch: [{ path: "worker/worker.log", label: "local:worker" }],
    });

    const ws = await connect(ts.wsUrl, ts.token);
    try {
      const entries = collect(ws, "entries");
      await sleep(150);

      const laravelTarget = `${dir!}/storage/logs/laravel.log`;
      const workerTarget = `${dir!}/worker/worker.log`;

      const statusLatencies: number[] = [];
      let stop = false;
      const statusPoll = (async () => {
        while (!stop) {
          const t0 = Date.now();
          await fetch(`${ts!.baseUrl}/api/status`, { headers: { Authorization: `Bearer ${ts!.token}` } });
          statusLatencies.push(Date.now() - t0);
          await sleep(50);
        }
      })();

      const N = 500;
      for (let i = 0; i < N; i++) {
        appendFixtureFile(laravelTarget, `[2026-07-19 09:00:${String(i % 60).padStart(2, "0")}] local.INFO: laravel line ${i} {} []\n`);
        appendFixtureFile(workerTarget, `worker line ${i}\n`);
        if (i % 50 === 0) await sleep(5); // yield periodically, matching a realistic dev-loop burst pattern
      }

      await waitFor(() => {
        const all = entries.flatMap((m) => m.entries);
        const laravelCount = all.filter((e) => e.source === "local:laravel" && e.message.includes("laravel line")).length;
        const workerCount = all.filter((e) => e.source === "local:worker").length;
        return laravelCount >= N && workerCount >= N;
      }, 15000, 200);

      stop = true;
      await statusPoll;

      const all = entries.flatMap((m) => m.entries);
      const laravelEntries = all.filter((e) => e.source === "local:laravel" && e.message.includes("laravel line"));
      const workerEntries = all.filter((e) => e.source === "local:worker");

      // Arrival order within each source is preserved (monotonic ids).
      for (let i = 1; i < laravelEntries.length; i++) {
        expect(laravelEntries[i].id).toBeGreaterThan(laravelEntries[i - 1].id);
      }
      for (let i = 1; i < workerEntries.length; i++) {
        expect(workerEntries[i].id).toBeGreaterThan(workerEntries[i - 1].id);
      }
      // Exactly N of each, no drops/dupes under load.
      expect(laravelEntries).toHaveLength(N);
      expect(workerEntries).toHaveLength(N);

      // The server kept answering other requests throughout — no freeze.
      expect(statusLatencies.length).toBeGreaterThan(3);
      expect(Math.max(...statusLatencies)).toBeLessThan(2000);
    } finally {
      closeAll(ws);
    }
  }, 30000);
});
