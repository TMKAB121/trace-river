/**
 * No-file-target detector notes — docs/specs/003-phase-3-auto-discovery.md
 * acceptance criterion 9.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
  mkFixtureDir,
  rmFixtureDir,
  nextjsProject,
  goProject,
  djangoProject,
  startDiscoveryTestServer,
  type DiscoveryTestServer,
} from "./helpers.js";
import type { DetectedFramework, SourceDescriptor } from "../../src/shared/types.js";

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

describe("Criterion 9 — no-file-target detector notes", () => {
  it("Next.js: exact guidance copy, no checkbox/sidebar row", async () => {
    nextjsProject(dir!);
    ts = await startDiscoveryTestServer({ cwd: dir! });

    const [discoveryRes, sourcesRes] = await Promise.all([
      fetch(`${ts.baseUrl}/api/discovery`, { headers: { Authorization: `Bearer ${ts.token}` } }),
      fetch(`${ts.baseUrl}/api/sources`, { headers: { Authorization: `Bearer ${ts.token}` } }),
    ]);
    const { frameworks } = (await discoveryRes.json()) as { frameworks: DetectedFramework[] };
    const { sources } = (await sourcesRes.json()) as { sources: SourceDescriptor[] };

    expect(frameworks).toEqual([
      {
        detector: "nextjs",
        label: "Next.js",
        hasFileTarget: false,
        note: "Next.js detected — output is on stdout; run under Docker or add a file target in traceriver.json.",
      },
    ]);
    expect(sources.filter((s) => s.kind === "local")).toHaveLength(0);
  });

  it("Go: exact guidance copy", async () => {
    goProject(dir!);
    ts = await startDiscoveryTestServer({ cwd: dir! });
    const res = await fetch(`${ts.baseUrl}/api/discovery`, { headers: { Authorization: `Bearer ${ts.token}` } });
    const { frameworks } = (await res.json()) as { frameworks: DetectedFramework[] };
    expect(frameworks).toEqual([
      {
        detector: "go",
        label: "Go",
        hasFileTarget: false,
        note: "Go project detected — output is on stdout; run under Docker or add a file target in traceriver.json.",
      },
    ]);
  });

  it("Django: exact guidance copy", async () => {
    djangoProject(dir!);
    ts = await startDiscoveryTestServer({ cwd: dir! });
    const res = await fetch(`${ts.baseUrl}/api/discovery`, { headers: { Authorization: `Bearer ${ts.token}` } });
    const { frameworks } = (await res.json()) as { frameworks: DetectedFramework[] };
    expect(frameworks).toEqual([
      {
        detector: "django",
        label: "Django",
        hasFileTarget: false,
        note: "Django project detected — output is on stdout (console logging is Django's default); run under Docker or add a file target in traceriver.json.",
      },
    ]);
  });

  it("a project matching more than one no-target detector stacks both notes", async () => {
    // A monorepo root with both a Go service and a Next.js frontend
    // side-by-side (docs/specs/003-phase-3-auto-discovery.md § User flow
    // step 6's "both detectors match and both show up" scenario, applied to
    // two no-target detectors).
    goProject(dir!);
    nextjsProject(dir!);
    ts = await startDiscoveryTestServer({ cwd: dir! });
    const res = await fetch(`${ts.baseUrl}/api/discovery`, { headers: { Authorization: `Bearer ${ts.token}` } });
    const { frameworks } = (await res.json()) as { frameworks: DetectedFramework[] };
    expect(frameworks.map((f) => f.detector).sort()).toEqual(["go", "nextjs"]);
    expect(frameworks.every((f) => f.hasFileTarget === false && typeof f.note === "string")).toBe(true);
  });
});
