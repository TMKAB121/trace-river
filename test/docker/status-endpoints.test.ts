/**
 * `GET /api/docker/status` mirrors the WS `dockerStatus` push, and
 * `GET /api/status`'s `dockerAllContainersDefault` reflects the resolved
 * config — spec 002 acceptance criterion 21.
 *
 * Also exercises part of criterion 16 (socket resolution order): an
 * unreachable `DOCKER_HOST` must not prevent falling through to the
 * platform-default socket — see the note on the third test for the scope
 * of what is/isn't independently verifiable on this host (a real Docker
 * daemon is already listening at the platform-default path, so the
 * not_installed/not_running/permission_denied statuses can't be produced
 * end-to-end without disturbing that real daemon — see the test plan for
 * how those are verified instead).
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dockerAvailable, startDockerTestServer, connect, collect, waitFor, closeAll, type DockerTestServer } from "./helpers.js";

describe.skipIf(!dockerAvailable())("Docker status endpoints (spec 002 §21) + socket fallback (§16, partial)", () => {
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

  it("GET /api/docker/status returns the same status the WS dockerStatus push last reported", async () => {
    cwd = mkdtempSync(join(tmpdir(), "tr-qa-status-"));
    ts = await startDockerTestServer({ cwd });
    const client = await connect(ts.wsUrl, ts.token);
    try {
      const statuses = collect(client, "dockerStatus");
      await waitFor(() => statuses.length > 0, 10000);

      const res = await fetch(`${ts.baseUrl}/api/docker/status`, { headers: { Authorization: `Bearer ${ts.token}` } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; detail: string | null };
      const lastPush = statuses.at(-1)!;
      expect(body.status).toBe(lastPush.status);
      expect(body.detail).toBe(lastPush.detail ?? null);
      // On this host a real daemon is reachable, so the happy path is what's
      // actually exercised end-to-end.
      expect(body.status).toBe("connected");
    } finally {
      closeAll(client);
    }
  }, 20000);

  it("GET /api/status's dockerAllContainersDefault reflects the resolved docker.allContainers config", async () => {
    cwd = mkdtempSync(join(tmpdir(), "tr-qa-status2-"));
    ts = await startDockerTestServer({ cwd, docker: { allContainers: true } });
    const res = await fetch(`${ts.baseUrl}/api/status`, { headers: { Authorization: `Bearer ${ts.token}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { dockerAllContainersDefault: boolean };
    expect(body.dockerAllContainersDefault).toBe(true);
  });

  it("GET /api/status's dockerAllContainersDefault is false when docker.allContainers isn't set", async () => {
    cwd = mkdtempSync(join(tmpdir(), "tr-qa-status3-"));
    ts = await startDockerTestServer({ cwd });
    const res = await fetch(`${ts.baseUrl}/api/status`, { headers: { Authorization: `Bearer ${ts.token}` } });
    const body = (await res.json()) as { dockerAllContainersDefault: boolean };
    expect(body.dockerAllContainersDefault).toBe(false);
  });

  it("criterion 16 (partial): an unreachable DOCKER_HOST doesn't break discovery — the platform-default socket is still tried and succeeds", async () => {
    cwd = mkdtempSync(join(tmpdir(), "tr-qa-status4-"));
    const previousDockerHost = process.env.DOCKER_HOST;
    process.env.DOCKER_HOST = "unix:///tmp/tr-qa-nonexistent-socket-for-qa.sock";
    try {
      ts = await startDockerTestServer({ cwd });
      const res = await fetch(`${ts.baseUrl}/api/docker/status`, { headers: { Authorization: `Bearer ${ts.token}` } });
      const body = (await res.json()) as { status: string };
      // Confirms the resolution chain doesn't stop/fail on the first
      // (unreachable) candidate — it falls through to the platform default,
      // which is genuinely reachable on this host.
      expect(body.status).toBe("connected");
    } finally {
      if (previousDockerHost === undefined) delete process.env.DOCKER_HOST;
      else process.env.DOCKER_HOST = previousDockerHost;
    }
  }, 15000);
});
