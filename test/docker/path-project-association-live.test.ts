/**
 * Live-daemon confirmation for spec 005 acceptance criteria 10-11: a
 * container that associates via the NEW path-label tier (io.lando.root) must
 * be filtered by docker.include/exclude and toggled by "Show all containers"
 * identically to a name-matched container (spec 002, unchanged). Real
 * throwaway containers (`tr-qa-path-*` prefix, cleaned up here) carrying a
 * synthetic `io.lando.root` label — no real Lando installation is needed
 * (or available on this host); Docker labels are freely assignable at
 * `docker run` time regardless of what tool "normally" sets them, so this
 * validly exercises the real label-reading code path end-to-end.
 *
 * Complements test/docker/path-project-matcher.test.ts (which is
 * fixture-driven and does not require a live daemon, per spec 005 criterion
 * 13) with an end-to-end check that the rest of the discovery pipeline
 * (filters, sources broadcast) treats a path-matched container exactly like
 * any other.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dockerAvailable, startDockerTestServer, dockerRun, dockerRm, type DockerTestServer } from "./helpers.js";
import type { SourceDescriptor } from "../../src/shared/types.js";

const IN_PROJECT_NAME = "tr-qa-path-lando-app";
const EXCLUDED_NAME = "tr-qa-path-lando-excluded";
const OUTSIDE_NAME = "tr-qa-path-outside";

let projectDir: string;
let outsideDir: string;

async function fetchSources(ts: DockerTestServer): Promise<SourceDescriptor[]> {
  const res = await fetch(`${ts.baseUrl}/api/sources`, { headers: { Authorization: `Bearer ${ts.token}` } });
  const body = (await res.json()) as { sources: SourceDescriptor[] };
  return body.sources;
}

describe.skipIf(!dockerAvailable())("Path-label association: filters + toggle semantics (spec 005 §10-11)", () => {
  let ts: DockerTestServer | undefined;

  beforeAll(() => {
    projectDir = mkdtempSync(join(tmpdir(), "tr-qa-path-project-"));
    outsideDir = mkdtempSync(join(tmpdir(), "tr-qa-path-outside-"));

    // Two containers "in" the project (one to keep, one to exclude via
    // glob), both carrying io.lando.root === projectDir (a real, synthetic
    // Lando-style label — no Lando install needed to set a label).
    dockerRun([
      "-d",
      "--name",
      IN_PROJECT_NAME,
      "--label",
      `io.lando.root=${projectDir}`,
      "--label",
      "com.docker.compose.project.working_dir=/nonexistent/lando-scratch",
      "alpine",
      "sh",
      "-c",
      "while true; do echo in-project; sleep 1; done",
    ]);
    dockerRun([
      "-d",
      "--name",
      EXCLUDED_NAME,
      "--label",
      `io.lando.root=${projectDir}`,
      "alpine",
      "sh",
      "-c",
      "while true; do echo excluded; sleep 1; done",
    ]);
    // A container "outside" the project: io.lando.root points elsewhere.
    dockerRun([
      "-d",
      "--name",
      OUTSIDE_NAME,
      "--label",
      `io.lando.root=${outsideDir}`,
      "alpine",
      "sh",
      "-c",
      "while true; do echo outside; sleep 1; done",
    ]);
  }, 60000);

  afterEach(async () => {
    await ts?.close();
    ts = undefined;
  });

  afterAll(() => {
    dockerRm([IN_PROJECT_NAME, EXCLUDED_NAME, OUTSIDE_NAME]);
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }, 30000);

  it("criterion 1/10 (live): a path-matched container associates as current project, and docker.exclude still hides an excluded path-matched container entirely", async () => {
    ts = await startDockerTestServer({ cwd: projectDir, docker: { exclude: [`${EXCLUDED_NAME}*`] } });
    await new Promise((r) => setTimeout(r, 1500));
    const sources = await fetchSources(ts);

    const inProject = sources.find((s) => s.id === `docker:${IN_PROJECT_NAME}`);
    expect(inProject).toBeDefined();
    expect(inProject?.docker?.inCurrentProject).toBe(true);

    // Excluded container never reaches the client at all, despite carrying
    // a matching io.lando.root — exclude is applied identically regardless
    // of which tier produced inCurrentProject.
    expect(sources.some((s) => s.id === `docker:${EXCLUDED_NAME}`)).toBe(false);
  });

  it("criterion 4/10 (live): docker.include restricts discovery to only the matching name, even though an out-of-scope path-matched container exists", async () => {
    ts = await startDockerTestServer({ cwd: projectDir, docker: { include: [IN_PROJECT_NAME] } });
    await new Promise((r) => setTimeout(r, 1500));
    const sources = await fetchSources(ts);
    const dockerIds = sources.filter((s) => s.kind === "docker").map((s) => s.id);
    expect(dockerIds).toEqual([`docker:${IN_PROJECT_NAME}`]);
  });

  it("criterion 11 (live): 'Show all containers' data contract holds for a path-matched project — the server always sends every discovered container's real inCurrentProject value regardless of the allContainers config, with no extra request needed to reveal an out-of-project one", async () => {
    ts = await startDockerTestServer({ cwd: projectDir, docker: { allContainers: false } });
    await new Promise((r) => setTimeout(r, 1500));
    const sources = await fetchSources(ts);

    const inProject = sources.find((s) => s.id === `docker:${IN_PROJECT_NAME}`);
    expect(inProject?.docker?.inCurrentProject).toBe(true);

    // The sibling-project container (different io.lando.root) is still
    // present in the same response, correctly tagged false — proving the
    // toggle is a pure client-side render filter even for path-matched
    // sources, exactly as spec 002 already established for name-matched ones.
    const outside = sources.find((s) => s.id === `docker:${OUTSIDE_NAME}`);
    expect(outside).toBeDefined();
    expect(outside?.docker?.inCurrentProject).toBe(false);
  });
});
