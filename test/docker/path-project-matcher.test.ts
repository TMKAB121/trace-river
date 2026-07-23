/**
 * Fixture-driven, no-live-daemon coverage for spec 005's tier-1 path-label
 * matcher (docs/specs/005-phase-5-project-association.md, acceptance
 * criteria 1-9, 12-13). Follows the exact precedent established by
 * `test/docker/recovery-ordering.test.ts`: a real `DockerManager` instance
 * with its private `client` swapped for a stub whose `listContainers()`
 * returns hand-built `ContainerInfo` fixtures, so the *actual* production
 * `discoverAll()` -> `resolvePathMatch()` -> `matchesProjectPath()` code path
 * runs unmodified — this is not a reimplementation of the matching logic,
 * it drives the real one. Neither `dockerAvailable()`-gated nor touching any
 * real container; safe to run on any host, with or without Docker installed.
 *
 * Criterion 12's "fails pre-fix, passes post-fix" requirement is
 * demonstrated by temporarily reverting `src/ingest/docker.ts` to its
 * committed (pre-fix) revision via `git stash push -- src/ingest/docker.ts`,
 * re-running this file, and restoring via `git stash pop` — documented in
 * `docs/qa/test-plans/005-phase-5-project-association.md` (this is a
 * verification step performed once during this QA pass, not a repeatable
 * part of `npm test`).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DockerManager } from "../../src/ingest/docker.js";
import { SourceRegistry } from "../../src/server/sources.js";
import { Broadcaster } from "../../src/server/broadcaster.js";
import type { ContainerInfo } from "dockerode";

interface LabelFixture {
  _meta: unknown;
  labels: Record<string, string>;
}

function loadFixture(name: string): LabelFixture {
  const path = join(__dirname, "..", "fixtures", "docker-labels", name);
  return JSON.parse(readFileSync(path, "utf8")) as LabelFixture;
}

const s1Fixture = loadFixture("s1-lando-street-bites.json");
const vanillaFixture = loadFixture("vanilla-compose-working-dir.json");

function fakeState() {
  return {
    sources: new SourceRegistry(),
    broadcaster: new Broadcaster(),
  };
}

function containerInfo(name: string, labels: Record<string, string>): ContainerInfo {
  return {
    Id: `${name}-id`,
    Names: [`/${name}`],
    Image: "alpine:3",
    Labels: labels,
    State: "running",
    Status: "Up",
    Created: Date.now() / 1000,
  };
}

type ManagerInternals = {
  discoverAll: () => Promise<boolean>;
  client: { listContainers: () => Promise<ContainerInfo[]> };
};

/** Builds a `DockerManager` wired to a fake state + a stubbed client that
 *  returns exactly one container with the given labels, runs discovery, and
 *  returns whatever `inCurrentProject` the real matcher computed. */
async function resolveInCurrentProject(cwd: string, labels: Record<string, string>): Promise<boolean | undefined> {
  const state = fakeState();
  const manager = new DockerManager(state as never, { enabled: true, include: [], exclude: [], cwd });
  const internals = manager as unknown as ManagerInternals;
  internals.client = { listContainers: async () => [containerInfo("tr-qa-matcher-fixture", labels)] };
  await internals.discoverAll();
  const source = state.sources.get("docker:tr-qa-matcher-fixture");
  return source?.docker?.inCurrentProject;
}

describe("Path-label project matcher (spec 005 §1-9, 12-13) — fixture-driven, no live daemon", () => {
  it("criterion 1: io.lando.root exactly equal to cwd associates as current project (S1 fixture, no config)", async () => {
    const cwd = s1Fixture.labels["io.lando.root"];
    const result = await resolveInCurrentProject(cwd, s1Fixture.labels);
    expect(result).toBe(true);
  });

  it("criterion 2: the same container's working_dir label (present, pointing into ~/.lando/compose/) is not consulted once io.lando.root is present", async () => {
    const cwd = s1Fixture.labels["io.lando.root"];

    // Full fixture (io.lando.root + the misleading working_dir): must be true.
    const withLandoRoot = await resolveInCurrentProject(cwd, s1Fixture.labels);
    expect(withLandoRoot).toBe(true);

    // Same cwd, same working_dir value, io.lando.root removed: proves the
    // working_dir label genuinely mismatches cwd on its own (it points into
    // ~/.lando/compose/, an unrelated path) — i.e. it isn't a coincidental
    // match that would have produced the same answer either way.
    const { "io.lando.root": _dropped, ...withoutLandoRoot } = s1Fixture.labels;
    const withoutLandoRootResult = await resolveInCurrentProject(cwd, withoutLandoRoot);
    expect(withoutLandoRootResult).toBe(false);
  });

  it("criterion 3: io.lando.root set to an ancestor of cwd (subdirectory start) still associates", async () => {
    const root = s1Fixture.labels["io.lando.root"];
    const cwd = `${root}/public`;
    const result = await resolveInCurrentProject(cwd, s1Fixture.labels);
    expect(result).toBe(true);
  });

  it("criterion 4: io.lando.root set to a sibling directory sharing a string prefix does not associate (segment-aware, not naive prefix)", async () => {
    const root = s1Fixture.labels["io.lando.root"]; // /Users/anthonysayge/projects/street_bites

    // Direction A: label has an extra suffix beyond cwd (spec's own example:
    // label /Users/x/street_bites-old vs cwd /Users/x/street_bites).
    const siblingLabels = { ...s1Fixture.labels, "io.lando.root": `${root}-old` };
    const resultA = await resolveInCurrentProject(root, siblingLabels);
    expect(resultA).toBe(false);

    // Direction B: cwd has the extra suffix beyond the label — must not be
    // treated as "cwd nested below label" either (no trailing separator at
    // the shared prefix boundary).
    const resultB = await resolveInCurrentProject(`${root}-old`, s1Fixture.labels);
    expect(resultB).toBe(false);
  });

  it("criterion 5: vanilla Compose working_dir exactly equal to cwd associates via the path-label tier, independent of any name comparison", async () => {
    const scratchCwd = mkdtempSync(join(tmpdir(), "tr-qa-vanilla-matcher-"));
    // Use the captured fixture's full label shape (service/version/config-hash
    // etc., genuinely captured — see fixture _meta), substituting only the
    // working_dir value with this test's own scratch cwd so the exact-match
    // assertion is deterministic and independent of the capture session's
    // temp-directory lifetime.
    const labels = { ...vanillaFixture.labels, "com.docker.compose.project.working_dir": scratchCwd };
    // Deliberately mismatching name signal: proves the match came from
    // tier 1 (path), not tier 3 (basename) — the compose project name
    // ("trqa-vanilla-path") does not equal this scratch dir's basename.
    const result = await resolveInCurrentProject(scratchCwd, labels);
    expect(result).toBe(true);
  });

  it("criterion 6: ancestor and sibling-prefix semantics apply identically to working_dir matching", async () => {
    const scratchCwd = mkdtempSync(join(tmpdir(), "tr-qa-vanilla-matcher-anc-"));
    const ancestorLabels = { ...vanillaFixture.labels, "com.docker.compose.project.working_dir": scratchCwd };
    // The nested cwd must actually exist on disk (as a real `traceriver
    // start` cwd always would be) — otherwise `safeRealpath` resolves the
    // (existing) label's symlinked tmpdir but can't resolve the
    // (non-existent) nested cwd, producing a spurious mismatch that's a test
    // artifact of macOS's symlinked $TMPDIR, not a real-world scenario.
    const nestedCwd = mkdtempSync(join(scratchCwd, "app-public-"));
    const ancestorResult = await resolveInCurrentProject(nestedCwd, ancestorLabels);
    expect(ancestorResult).toBe(true);

    const siblingLabels = { ...vanillaFixture.labels, "com.docker.compose.project.working_dir": `${scratchCwd}-old` };
    const siblingResult = await resolveInCurrentProject(scratchCwd, siblingLabels);
    expect(siblingResult).toBe(false);
  });

  it("criterion 7: reverse ancestor direction (label nested below cwd, monorepo case) does not spuriously associate — falls through to tiers 2-3", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "tr-qa-monorepo-root-"));
    const nestedLabelPath = join(cwd, "packages", "api");
    const labels = {
      "io.lando.root": nestedLabelPath,
      // A name signal deliberately chosen NOT to match cwd's basename or any
      // compose file (there is none in this scratch dir), so a `true` result
      // here could only come from an (unwanted) reverse-direction path match.
      "com.docker.compose.project": "totally-unrelated-name",
    };
    const result = await resolveInCurrentProject(cwd, labels);
    expect(result).toBe(false);
  });

  it("criterion 8 (regression, mechanism-level): with neither path label present, tier 1 is not applicable and the existing name-based comparison decides the result unchanged", async () => {
    const cwd = join(tmpdir(), "MyApp_2"); // basename normalizes to "myapp_2" (underscore valid, case-folded)
    const matchingName = { "com.docker.compose.project": "MyApp_2" };
    const matchResult = await resolveInCurrentProject(cwd, matchingName);
    expect(matchResult).toBe(true);

    const mismatchingName = { "com.docker.compose.project": "somethingElse" };
    const mismatchResult = await resolveInCurrentProject(cwd, mismatchingName);
    expect(mismatchResult).toBe(false);
  });

  it("criterion 9: no com.docker.compose.project label and no path label at all does not associate (bare docker run, unchanged)", async () => {
    const cwd = join(tmpdir(), "whatever-project");
    const result = await resolveInCurrentProject(cwd, {});
    expect(result).toBe(false);
  });
});
