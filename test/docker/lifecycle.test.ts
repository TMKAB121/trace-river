/**
 * Container lifecycle — spec 002 acceptance criteria 8 & 9, and Decision 4
 * (rename produces a brand-new, unsubscribed source; the old id settles to
 * `stopped` permanently with history intact). Each `it` uses its own
 * throwaway container so lifecycle operations (restart/stop/rename) never
 * touch anything but `tr-qa-*` containers this file creates and removes.
 */
import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  dockerAvailable,
  startDockerTestServer,
  connect,
  collect,
  waitFor,
  sleep,
  closeAll,
  dockerRm,
  type DockerTestServer,
} from "./helpers.js";
import type { SourceDescriptor } from "../../src/shared/types.js";

function runFastLoop(name: string, prefix: string, sleepSeconds = "0.05"): void {
  execFileSync(
    "docker",
    [
      "run",
      "-d",
      "--name",
      name,
      "alpine",
      "sh",
      "-c",
      `i=0; while true; do i=$((i+1)); echo "${prefix} $i"; sleep ${sleepSeconds}; done`,
    ],
    { stdio: "ignore" },
  );
}

describe.skipIf(!dockerAvailable())("Docker container lifecycle (spec 002 §8-9, Decision 4)", () => {
  let ts: DockerTestServer | undefined;
  let cwd: string | undefined;

  afterEach(async () => {
    await ts?.close();
    ts = undefined;
    if (cwd) {
      rmSync(cwd, { recursive: true, force: true });
      cwd = undefined;
    }
  });

  it("criterion 8: docker restart transitions live -> stopped -> live automatically, with no duplicated lines across the boundary", async () => {
    const NAME = "tr-qa-lc-restart";
    cwd = mkdtempSync(join(tmpdir(), "tr-qa-lc-restart-"));
    dockerRm([NAME]);
    // Deliberately slower than the other lifecycle containers: within any
    // realistic reattach delay after a restart, this produces far fewer than
    // 50 new lines, so `tail: 50` on reattach is guaranteed to overlap with
    // already-delivered pre-restart lines if the implementation doesn't
    // account for that — see docs/qa/defects/002-phase-2-docker-3.md (the
    // duplication is real but its *magnitude* is timing-dependent; a fast
    // producer can occasionally outrun the overlap window on a given run).
    runFastLoop(NAME, "restart line", "0.3");
    await sleep(2000);

    ts = await startDockerTestServer({ cwd });
    await sleep(1500);
    const sourceId = `docker:${NAME}`;
    const client = await connect(ts.wsUrl, ts.token);
    try {
      const entries = collect(client, "entries");
      const sources = collect(client, "sources");
      const states = collect(client, "sourceState");
      client.send(JSON.stringify({ type: "subscribe", sourceIds: [sourceId] }));
      await waitFor(() => entries.some((m) => m.entries.some((e) => e.source === sourceId)), 10000);
      await sleep(500); // let a few batches land pre-restart

      const rawBeforeRestart = new Set(
        entries.flatMap((m) => m.entries).filter((e) => e.source === sourceId).map((e) => e.raw),
      );

      execFileSync("docker", ["restart", NAME], { stdio: "ignore" });

      // The source must visibly transition to "stopped" then back to "live"
      // (docs/specs/002-phase-2-docker.md § Interaction specs — Container
      // lifecycle: Restart).
      await waitFor(() => states.some((s) => s.id === sourceId && s.state === "stopped"), 15000);
      await waitFor(() => states.some((s) => s.id === sourceId && s.state === "live" && states.indexOf(s) > states.findIndex((x) => x.id === sourceId && x.state === "stopped")), 20000);

      // New entries keep arriving post-restart (re-attach happened automatically).
      await waitFor(() => {
        const all = entries.flatMap((m) => m.entries).filter((e) => e.source === sourceId);
        return all.length > rawBeforeRestart.size;
      }, 15000);

      const allRaw = entries.flatMap((m) => m.entries).filter((e) => e.source === sourceId).map((e) => e.raw);
      const seen = new Set<string>();
      const duplicates: string[] = [];
      for (const raw of allRaw) {
        if (seen.has(raw)) duplicates.push(raw);
        seen.add(raw);
      }
      expect(duplicates).toEqual([]);

      // Checkbox stays checked/subscribed throughout (no user action required).
      const latestSources = sources.at(-1)?.sources.find((s) => s.id === sourceId);
      expect(latestSources?.subscribed).toBe(true);
    } finally {
      closeAll(client);
      dockerRm([NAME]);
    }
  }, 60000);

  it("criterion 9: stopping a subscribed container (no restart) keeps its row visible, checked, with history intact", async () => {
    const NAME = "tr-qa-lc-stop";
    cwd = mkdtempSync(join(tmpdir(), "tr-qa-lc-stop-"));
    dockerRm([NAME]);
    runFastLoop(NAME, "stop line");
    await sleep(2000);

    ts = await startDockerTestServer({ cwd });
    await sleep(1500);
    const sourceId = `docker:${NAME}`;
    const client = await connect(ts.wsUrl, ts.token);
    try {
      const entries = collect(client, "entries");
      const states = collect(client, "sourceState");
      client.send(JSON.stringify({ type: "subscribe", sourceIds: [sourceId] }));
      await waitFor(() => entries.some((m) => m.entries.some((e) => e.source === sourceId)), 10000);

      const countBeforeStop = entries.flatMap((m) => m.entries).filter((e) => e.source === sourceId).length;
      expect(countBeforeStop).toBeGreaterThan(0);

      execFileSync("docker", ["stop", "-t", "2", NAME], { stdio: "ignore" });
      await waitFor(() => states.some((s) => s.id === sourceId && s.state === "stopped"), 15000);

      const res = await fetch(`${ts.baseUrl}/api/sources`, { headers: { Authorization: `Bearer ${ts.token}` } });
      const { sources } = (await res.json()) as { sources: SourceDescriptor[] };
      const source = sources.find((s) => s.id === sourceId)!;
      expect(source.state).toBe("stopped");
      expect(source.subscribed).toBe(true); // still "subscribed", just dormant
      expect(source.entryCount).toBeGreaterThanOrEqual(countBeforeStop); // history retained, not reset to 0
    } finally {
      closeAll(client);
      dockerRm([NAME]);
    }
  }, 40000);

  it("Decision 4: renaming a container settles the old source to stopped permanently and discovers a brand-new, unsubscribed source under the new name", async () => {
    const OLD_NAME = "tr-qa-lc-rename-old";
    const NEW_NAME = "tr-qa-lc-rename-new";
    cwd = mkdtempSync(join(tmpdir(), "tr-qa-lc-rename-"));
    dockerRm([OLD_NAME, NEW_NAME]);
    runFastLoop(OLD_NAME, "rename line");
    await sleep(2000);

    ts = await startDockerTestServer({ cwd });
    await sleep(1500);
    const oldSourceId = `docker:${OLD_NAME}`;
    const newSourceId = `docker:${NEW_NAME}`;
    const client = await connect(ts.wsUrl, ts.token);
    try {
      const entries = collect(client, "entries");
      const sourcesMsgs = collect(client, "sources");
      client.send(JSON.stringify({ type: "subscribe", sourceIds: [oldSourceId] }));
      await waitFor(() => entries.some((m) => m.entries.some((e) => e.source === oldSourceId)), 10000);
      const countBeforeRename = entries.flatMap((m) => m.entries).filter((e) => e.source === oldSourceId).length;

      execFileSync("docker", ["rename", OLD_NAME, NEW_NAME], { stdio: "ignore" });

      await waitFor(() => {
        const latest = sourcesMsgs.at(-1)?.sources;
        const oldSrc = latest?.find((s) => s.id === oldSourceId);
        const newSrc = latest?.find((s) => s.id === newSourceId);
        return oldSrc?.state === "stopped" && newSrc !== undefined;
      }, 20000);

      const latest = sourcesMsgs.at(-1)!.sources;
      const oldSrc = latest.find((s) => s.id === oldSourceId)!;
      const newSrc = latest.find((s) => s.id === newSourceId)!;

      expect(oldSrc.state).toBe("stopped");
      expect(oldSrc.entryCount).toBeGreaterThanOrEqual(countBeforeRename); // history intact
      expect(newSrc.subscribed).toBe(false); // no subscription transplant
      expect(newSrc.entryCount).toBe(0); // no history transplant
      expect(newSrc.state).toBe("live");
    } finally {
      closeAll(client);
      dockerRm([OLD_NAME, NEW_NAME]);
    }
  }, 40000);
});
