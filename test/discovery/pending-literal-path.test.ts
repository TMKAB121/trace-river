/**
 * REGRESSION (see docs/qa/defects/003-phase-3-auto-discovery-1.md): a
 * `pending` local/config source whose resolved target is a literal
 * (non-glob) path never transitions to `live` when the file is later
 * created, even though its containing directory already exists at server
 * startup. This reproduces docs/specs/003-phase-3-auto-discovery.md's own
 * § User flow step 7 walkthrough almost verbatim: a `traceriver.json`
 * `watch` entry for `storage/logs/worker.log` that "doesn't exist yet at
 * startup... the moment the worker process starts and creates the file, the
 * row automatically flips to checked... no user action."
 *
 * Left red on purpose (same convention as phase 2's committed regression
 * tests, e.g. test/docker/demux.test.ts pre-fix) until the backend fixes
 * src/ingest/tail.ts's chokidar usage for literal (non-glob) targets.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdirSync } from "node:fs";
import {
  mkFixtureDir,
  rmFixtureDir,
  writeFixtureFile,
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

describe("Defect repro — literal (non-glob) watch target never activates", () => {
  it("a worker.log watch entry whose containing directory already exists still never flips pending->live once the file is created", async () => {
    // storage/logs/ already exists (matching a realistic sibling-of-Laravel
    // project per the spec's own example) — only the file itself is missing.
    mkdirSync(`${dir!}/storage/logs`, { recursive: true });
    ts = await startDiscoveryTestServer({
      cwd: dir!,
      discovery: { enabled: false },
      watch: [{ path: "storage/logs/worker.log", label: "local:worker" }],
    });

    const ws = await connect(ts.wsUrl, ts.token);
    try {
      const stateMsgs = collect(ws, "sourceState");
      await sleep(150);

      const before = await fetch(`${ts!.baseUrl}/api/sources`, {
        headers: { Authorization: `Bearer ${ts!.token}` },
      });
      const { sources: beforeSources } = (await before.json()) as { sources: Array<{ id: string; state: string }> };
      expect(beforeSources.find((s) => s.id === "local:worker")!.state).toBe("pending");

      // The worker process starts and creates its log file.
      writeFixtureFile(dir!, "storage/logs/worker.log", "worker started\n");

      // Expected per spec: flips to live "with no user action" — this
      // currently never happens (see defect 003-phase-3-auto-discovery-1).
      await waitFor(() => stateMsgs.some((m) => m.id === "local:worker" && m.state === "live"), 4000);
    } finally {
      closeAll(ws);
    }
  });
});
