/**
 * Docker discovery & project filtering — spec 002 acceptance criteria 1-4.
 * Exercises real throwaway containers (`tr-qa-*` prefix, cleaned up here)
 * against a real Docker daemon; a compose project (`trqacompose`, 3
 * services) plus one standalone container outside any project.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  dockerAvailable,
  startDockerTestServer,
  dockerRm,
  type DockerTestServer,
} from "./helpers.js";
import type { SourceDescriptor } from "../../src/shared/types.js";

const COMPOSE_PROJECT = "trqacompose";
const NAMES = ["tr-qa-compose-app", "tr-qa-compose-worker", "tr-qa-compose-excluded"];
const OUTSIDE_NAME = "tr-qa-outside-discovery";

let composeDir: string;

async function fetchSources(ts: DockerTestServer): Promise<SourceDescriptor[]> {
  const res = await fetch(`${ts.baseUrl}/api/sources`, { headers: { Authorization: `Bearer ${ts.token}` } });
  const body = (await res.json()) as { sources: SourceDescriptor[] };
  return body.sources;
}

describe.skipIf(!dockerAvailable())("Docker discovery & project filtering (spec 002 §1-4)", () => {
  let ts: DockerTestServer | undefined;

  beforeAll(() => {
    composeDir = mkdtempSync(join(tmpdir(), "tr-qa-compose-"));
    writeFileSync(
      join(composeDir, "compose.yaml"),
      [
        `name: ${COMPOSE_PROJECT}`,
        "services:",
        "  app:",
        "    image: alpine:3",
        "    container_name: tr-qa-compose-app",
        '    command: ["sh", "-c", "i=0; while true; do i=$((i+1)); echo \\"app line $i\\"; sleep 1; done"]',
        "  worker:",
        "    image: alpine:3",
        "    container_name: tr-qa-compose-worker",
        '    command: ["sh", "-c", "i=0; while true; do i=$((i+1)); echo \\"worker line $i\\"; sleep 1; done"]',
        "  excluded:",
        "    image: alpine:3",
        "    container_name: tr-qa-compose-excluded",
        '    command: ["sh", "-c", "while true; do echo excluded; sleep 1; done"]',
        "",
      ].join("\n"),
    );
    execFileSync("docker", ["compose", "up", "-d"], { cwd: composeDir, stdio: "ignore" });
    execFileSync(
      "docker",
      ["run", "-d", "--name", OUTSIDE_NAME, "alpine", "sh", "-c", "while true; do echo outside; sleep 1; done"],
      { stdio: "ignore" },
    );
  }, 60000);

  afterEach(async () => {
    await ts?.close();
    ts = undefined;
  });

  afterAll(async () => {
    try {
      execFileSync("docker", ["compose", "down"], { cwd: composeDir, stdio: "ignore" });
    } catch {
      /* best-effort */
    }
    dockerRm([OUTSIDE_NAME, ...NAMES]);
    rmSync(composeDir, { recursive: true, force: true });
  }, 30000);

  it("criterion 1: default discovery shows exactly the current project's containers, none from outside it", async () => {
    ts = await startDockerTestServer({ cwd: composeDir });
    // Give the docker manager's discoverAll() a moment to complete.
    await new Promise((r) => setTimeout(r, 1500));

    const sources = await fetchSources(ts);
    const dockerSources = sources.filter((s) => s.kind === "docker");

    // Server always sends every discovered container (spec Decision 1) —
    // "current project only" is the client's render filter via
    // `inCurrentProject`, not a discovery-time exclusion. Verify the data
    // contract that filter depends on.
    const inProject = dockerSources.filter((s) => s.docker?.inCurrentProject);
    const outsideProject = dockerSources.filter((s) => s.docker?.inCurrentProject === false);

    expect(inProject.map((s) => s.id).sort()).toEqual(
      ["docker:tr-qa-compose-app", "docker:tr-qa-compose-worker", "docker:tr-qa-compose-excluded"].sort(),
    );
    expect(outsideProject.some((s) => s.id === `docker:${OUTSIDE_NAME}`)).toBe(true);
    expect(inProject.every((s) => s.docker?.composeProject === COMPOSE_PROJECT)).toBe(true);
  });

  it("criterion 4: a newly discovered container defaults to unsubscribed, entryCount 0, state live", async () => {
    ts = await startDockerTestServer({ cwd: composeDir });
    await new Promise((r) => setTimeout(r, 1500));
    const sources = await fetchSources(ts);
    const app = sources.find((s) => s.id === "docker:tr-qa-compose-app");
    expect(app).toBeDefined();
    expect(app).toMatchObject({ subscribed: false, entryCount: 0, state: "live", detail: null, visible: true });
  });

  it("criterion 3: docker.exclude glob hides a container from the discovery list entirely, at any toggle state", async () => {
    ts = await startDockerTestServer({ cwd: composeDir, docker: { exclude: ["tr-qa-compose-excl*"] } });
    await new Promise((r) => setTimeout(r, 1500));
    const sources = await fetchSources(ts);
    expect(sources.some((s) => s.id === "docker:tr-qa-compose-excluded")).toBe(false);
    // The other two containers in the same project are unaffected.
    expect(sources.some((s) => s.id === "docker:tr-qa-compose-app")).toBe(true);
    expect(sources.some((s) => s.id === "docker:tr-qa-compose-worker")).toBe(true);
  });

  it("criterion 3: docker.include glob restricts discovery to only matching names", async () => {
    ts = await startDockerTestServer({ cwd: composeDir, docker: { include: ["tr-qa-compose-app"] } });
    await new Promise((r) => setTimeout(r, 1500));
    const sources = await fetchSources(ts);
    const dockerIds = sources.filter((s) => s.kind === "docker").map((s) => s.id);
    expect(dockerIds).toEqual(["docker:tr-qa-compose-app"]);
  });

  it("criterion 2 (data-contract half): 'Show all containers' is a pure client-side filter — the server always includes out-of-project containers tagged inCurrentProject:false regardless of any config toggle, with no extra request needed to reveal them", async () => {
    ts = await startDockerTestServer({ cwd: composeDir, docker: { allContainers: false } });
    await new Promise((r) => setTimeout(r, 1500));
    const sources = await fetchSources(ts);
    const outside = sources.find((s) => s.id === `docker:${OUTSIDE_NAME}`);
    expect(outside).toBeDefined();
    expect(outside?.docker?.inCurrentProject).toBe(false);
  });
});
