/**
 * Regression coverage for design review 002's Finding 1
 * (docs/design-reviews/002-phase-2-docker.md): on a Docker recovery
 * transition, `DockerManager` must broadcast the refreshed `sources` list
 * (from `discoverAll()`) BEFORE broadcasting `dockerStatus: "connected"`,
 * so the client's "Docker connected — <n> container(s) found" toast — which
 * computes `<n>` from whatever `sources` snapshot it already has at the
 * moment `dockerStatus` arrives — reflects the real post-recovery count
 * rather than a stale pre-recovery one (typically 0, in the feature's own
 * headline down→up scenario).
 *
 * This is a pure unit test against `DockerManager` with a stubbed
 * `DockerClient` and a spied `Broadcaster` — it exercises the exact ordering
 * logic in `attemptConnect()`/`discoverAll()` deterministically, without
 * needing a real Docker daemon (so it isn't gated by `dockerAvailable()`,
 * and — per this run's environment directive — doesn't touch the real
 * daemon or any `tr-qa-*`/`street_bites` container at all). The full
 * down→up transition against a *real* daemon remains code-review-verified
 * only (stopping the one real, working local daemon this host depends on,
 * which would also take `street_bites` down, is explicitly off-limits — see
 * docs/qa/test-plans/002-phase-2-docker.md § Known limitations).
 */
import { describe, it, expect, vi } from "vitest";
import { DockerManager } from "../../src/ingest/docker.js";
import { SourceRegistry } from "../../src/server/sources.js";
import { Broadcaster } from "../../src/server/broadcaster.js";
import type { ContainerInfo } from "dockerode";

/** Minimal fake AppState — only `sources` and `broadcaster` are touched by
 *  the code paths under test (`attemptConnect`/`discoverAll`). */
function fakeState() {
  return {
    sources: new SourceRegistry(),
    broadcaster: new Broadcaster(),
  };
}

function containerInfo(name: string): ContainerInfo {
  return {
    Id: `${name}-id`,
    Names: [`/${name}`],
    Image: "alpine:3",
    Labels: {},
    State: "running",
    Status: "Up",
    Created: Date.now() / 1000,
  };
}

/** Reaches into `DockerManager`'s private `client`/`attemptConnect` — the
 *  class exposes no public seam for this, and adding one is a product-code
 *  change outside the QA lane, so the test drives it the same way the
 *  design review itself read the ordering: by the private members directly. */
type ManagerInternals = {
  client: { resolve: () => Promise<unknown>; listContainers: () => Promise<ContainerInfo[]> };
  attemptConnect: () => Promise<void>;
};

describe("Docker recovery broadcast ordering (design review 002, Finding 1)", () => {
  it("broadcasts the refreshed sources list before announcing dockerStatus: connected", async () => {
    const state = fakeState();
    const manager = new DockerManager(state as never, { enabled: true, include: [], exclude: [], cwd: "/tmp" });
    const internals = manager as unknown as ManagerInternals;

    const order: string[] = [];
    let sourcesCountAtConnectedTime = -1;
    vi.spyOn(state.broadcaster, "broadcastSources").mockImplementation((sources) => {
      order.push("sources");
      // simulate the client's toast-count read at the moment dockerStatus lands
      sourcesCountAtConnectedTime = sources.filter((s) => s.kind === "docker").length;
    });
    vi.spyOn(state.broadcaster, "broadcastDockerStatus").mockImplementation((status) => {
      order.push(`dockerStatus:${status}`);
    });

    // Simulate "Docker just came back up with 2 containers" — connectivity
    // resolves, discovery finds 2 real containers.
    internals.client = {
      resolve: async () => ({ status: "connected" }),
      listContainers: async () => [containerInfo("tr-qa-a"), containerInfo("tr-qa-b")],
    };

    await internals.attemptConnect();

    // `sources` (with the 2 newly-discovered containers) must be broadcast
    // strictly before `dockerStatus: "connected"` — this is the fix.
    const sourcesIdx = order.indexOf("sources");
    const connectedIdx = order.indexOf("dockerStatus:connected");
    expect(sourcesIdx).toBeGreaterThanOrEqual(0);
    expect(connectedIdx).toBeGreaterThanOrEqual(0);
    expect(sourcesIdx).toBeLessThan(connectedIdx);

    // And the count the client would have read at `dockerStatus` time
    // reflects the real, post-recovery discovery — not a stale 0.
    expect(sourcesCountAtConnectedTime).toBe(2);
  });

  it("does not announce a phantom 'connected' status when listContainers fails right after a successful ping", async () => {
    const state = fakeState();
    const manager = new DockerManager(state as never, { enabled: true, include: [], exclude: [], cwd: "/tmp" });
    const internals = manager as unknown as ManagerInternals;

    const dockerStatusCalls: string[] = [];
    vi.spyOn(state.broadcaster, "broadcastSources").mockImplementation(() => {});
    vi.spyOn(state.broadcaster, "broadcastDockerStatus").mockImplementation((status) => {
      dockerStatusCalls.push(status);
    });

    // Ping succeeds, but the very next call (listContainers) hits a
    // transient connectivity drop — this is the race `discoverAll()`'s
    // boolean return guards against (docs/ingest/docker.ts discoverAll doc
    // comment).
    internals.client = {
      resolve: async () => ({ status: "connected" }),
      listContainers: async () => {
        throw new Error("simulated transient connectivity drop");
      },
    };

    await internals.attemptConnect();

    // discoverAll's own catch branch settles "not_running" — but
    // attemptConnect must never additionally announce "connected" on top of
    // that (the phantom-connected bug this test guards against).
    expect(dockerStatusCalls).toEqual(["not_running"]);
    expect(dockerStatusCalls).not.toContain("connected");

    manager.stop();
  });
});
