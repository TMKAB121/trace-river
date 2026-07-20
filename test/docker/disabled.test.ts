/**
 * `docker.enabled: false` — spec 002 acceptance criterion 18. The server
 * must run with no Docker integration at all: no socket connection
 * attempted, no `dockerStatus` message ever sent, no docker `SourceDescriptor`
 * ever created — confirming the feature is fully inert when turned off.
 * This test doesn't require Docker to be installed/reachable at all (that's
 * the point), so it isn't gated by `dockerAvailable()`.
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDockerTestServer, connect, collect, closeAll, sleep, type DockerTestServer } from "./helpers.js";

describe("docker.enabled: false (spec 002 §18)", () => {
  let ts: DockerTestServer | undefined;
  let cwd: string;

  afterEach(async () => {
    await ts?.close();
    ts = undefined;
    rmSync(cwd, { recursive: true, force: true });
  });

  it("never sends a dockerStatus message and never creates a docker source, over the whole connection lifetime", async () => {
    cwd = mkdtempSync(join(tmpdir(), "tr-qa-disabled-"));
    ts = await startDockerTestServer({ cwd, docker: { enabled: false } });
    const client = await connect(ts.wsUrl, ts.token);
    try {
      const dockerStatuses = collect(client, "dockerStatus");
      const sources = collect(client, "sources");

      await sleep(1000); // long enough that a real dockerStatus push would have arrived if one were coming

      expect(dockerStatuses).toEqual([]);
      const anyDockerSource = sources.flatMap((m) => m.sources).some((s) => s.kind === "docker");
      expect(anyDockerSource).toBe(false);

      const statusRes = await fetch(`${ts.baseUrl}/api/status`, { headers: { Authorization: `Bearer ${ts.token}` } });
      const statusBody = (await statusRes.json()) as { dockerAllContainersDefault: boolean };
      expect(statusBody.dockerAllContainersDefault).toBe(false);

      // The convenience REST mirror still responds (route is always
      // registered), reflecting the manager's inert, never-connected state.
      const dockerStatusRes = await fetch(`${ts.baseUrl}/api/docker/status`, {
        headers: { Authorization: `Bearer ${ts.token}` },
      });
      expect(dockerStatusRes.status).toBe(200);
    } finally {
      closeAll(client);
    }
  }, 15000);
});
