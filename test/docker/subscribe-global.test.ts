/**
 * Docker subscription is server-global, not per-connection — spec 002
 * acceptance criteria 5 & 6, § Interaction specs Decision 5. Two independent
 * WS clients must observe the identical subscribed/unsubscribed state and
 * entry flow for a `docker:<name>` source, driven by only one of them.
 *
 * The throwaway container logs quickly (20/s, no real sleep bottleneck) and
 * we wait ~2s before subscribing so its `tail: 50` backlog already exceeds
 * the pipeline's live-detection buffering threshold by the time we attach —
 * see docs/qa/defects/002-phase-2-docker-1.md for why a slow/fresh
 * container would otherwise make first-entry delivery take up to ~20s.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { dockerAvailable, startDockerTestServer, connect, collect, waitFor, sleep, closeAll, dockerRm, type DockerTestServer } from "./helpers.js";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SourceDescriptor } from "../../src/shared/types.js";

const NAME = "tr-qa-subscribe-global";

describe.skipIf(!dockerAvailable())("Docker subscription — global server-side state (spec 002 §5-6, Decision 5)", () => {
  let ts: DockerTestServer | undefined;
  let cwd: string;

  beforeAll(async () => {
    cwd = mkdtempSync(join(tmpdir(), "tr-qa-sub-"));
    execFileSync(
      "docker",
      ["run", "-d", "--name", NAME, "alpine", "sh", "-c", 'i=0; while true; do i=$((i+1)); echo "sub line $i"; sleep 0.05; done'],
      { stdio: "ignore" },
    );
    await sleep(2000); // build up backlog past the pipeline's live-detection buffer size
  }, 30000);

  afterEach(async () => {
    await ts?.close();
    ts = undefined;
  });

  afterAll(() => {
    dockerRm([NAME]);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("subscribing from one tab attaches the stream and both tabs see entries flow and the checkbox flip", async () => {
    ts = await startDockerTestServer({ cwd });
    await sleep(1500); // discovery

    const clientA = await connect(ts.wsUrl, ts.token);
    const clientB = await connect(ts.wsUrl, ts.token);
    try {
      const sourcesA = collect(clientA, "sources");
      const sourcesB = collect(clientB, "sources");
      const entriesA = collect(clientA, "entries");
      const entriesB = collect(clientB, "entries");

      const sourceId = `docker:${NAME}`;
      clientA.send(JSON.stringify({ type: "subscribe", sourceIds: [sourceId] }));

      // Both tabs' authoritative `sources` broadcast reflects subscribed:true —
      // not just the initiating tab.
      await waitFor(() => {
        const latestA = sourcesA.at(-1)?.sources.find((s) => s.id === sourceId);
        const latestB = sourcesB.at(-1)?.sources.find((s) => s.id === sourceId);
        return latestA?.subscribed === true && latestB?.subscribed === true;
      });

      // Entries for this source arrive on BOTH connections (shared attachment),
      // not just the one that sent `subscribe`.
      await waitFor(() => {
        const gotA = entriesA.some((m) => m.entries.some((e) => e.source === sourceId));
        const gotB = entriesB.some((m) => m.entries.some((e) => e.source === sourceId));
        return gotA && gotB;
      }, 10000);
    } finally {
      closeAll(clientA, clientB);
    }
  }, 20000);

  it("unsubscribing from a second, independent tab stops delivery in every tab, including the one that originally subscribed", async () => {
    ts = await startDockerTestServer({ cwd });
    await sleep(1500);

    const clientA = await connect(ts.wsUrl, ts.token);
    const clientB = await connect(ts.wsUrl, ts.token);
    try {
      const sourcesB = collect(clientB, "sources");
      const entriesA = collect(clientA, "entries");

      const sourceId = `docker:${NAME}`;
      clientA.send(JSON.stringify({ type: "subscribe", sourceIds: [sourceId] }));
      await waitFor(() => entriesA.some((m) => m.entries.some((e) => e.source === sourceId)), 10000);

      // Let a couple of batches land, then unsubscribe from tab B.
      await sleep(500);
      const countAtUnsubscribe = entriesA.reduce((n, m) => n + m.entries.filter((e) => e.source === sourceId).length, 0);

      // Tab B — which never itself subscribed via a client-side click, it's
      // just a second connection — sends the unsubscribe.
      clientB.send(JSON.stringify({ type: "unsubscribe", sourceIds: [sourceId] }));

      await waitFor(() => {
        const latest = sourcesB.at(-1)?.sources.find((s) => s.id === sourceId);
        return latest?.subscribed === false;
      });

      // Give any in-flight stream data a moment to (not) arrive, then confirm
      // the count has genuinely stopped climbing (not just slowed).
      await sleep(1000);
      const countShortlyAfter = entriesA.reduce((n, m) => n + m.entries.filter((e) => e.source === sourceId).length, 0);
      await sleep(1500);
      const countLaterStill = entriesA.reduce((n, m) => n + m.entries.filter((e) => e.source === sourceId).length, 0);
      expect(countLaterStill).toBe(countShortlyAfter); // no growth once settled — tab A stopped receiving new entries too
      expect(countAtUnsubscribe).toBeGreaterThan(0);

      // Verify the server actually destroyed the stream (daemon-side), not just
      // stopped broadcasting: GET /api/sources shows entryCount frozen, not
      // just slowed, across a further wait.
      const res = await fetch(`${ts.baseUrl}/api/sources`, { headers: { Authorization: `Bearer ${ts.token}` } });
      const { sources } = (await res.json()) as { sources: SourceDescriptor[] };
      const frozenCount = sources.find((s) => s.id === sourceId)!.entryCount;
      await sleep(1500);
      const res2 = await fetch(`${ts.baseUrl}/api/sources`, { headers: { Authorization: `Bearer ${ts.token}` } });
      const { sources: sources2 } = (await res2.json()) as { sources: SourceDescriptor[] };
      expect(sources2.find((s) => s.id === sourceId)!.entryCount).toBe(frozenCount);
    } finally {
      closeAll(clientA, clientB);
    }
  }, 25000);
});
