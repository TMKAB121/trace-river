/**
 * `discovery.disable` and `discovery.enabled: false` —
 * docs/specs/003-phase-3-auto-discovery.md acceptance criteria 10 and 14,
 * plus the `GET /api/discovery` REST mirror (criterion 21).
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  mkFixtureDir,
  rmFixtureDir,
  laravelProject,
  writeFixtureFile,
  startDiscoveryTestServer,
  connect,
  collect,
  sleep,
  type DiscoveryTestServer,
} from "./helpers.js";
import type { DetectedFramework, ServerToClientMessage, SourceDescriptor } from "../../src/shared/types.js";

let ts: DiscoveryTestServer | undefined;
let dir: string | undefined;
let realHome: string | undefined;

beforeEach(() => {
  dir = mkFixtureDir();
});

afterEach(async () => {
  await ts?.close();
  ts = undefined;
  if (dir) rmFixtureDir(dir);
  dir = undefined;
  if (realHome !== undefined) {
    process.env.HOME = realHome;
    realHome = undefined;
  }
});

describe("Criterion 10 — discovery.disable excludes a named detector entirely", () => {
  it("disabling the project-tier 'laravel' detector removes both its source and its framework entry", async () => {
    laravelProject(dir!, { withLogFile: true, logContent: "" });
    ts = await startDiscoveryTestServer({ cwd: dir!, discovery: { disable: ["laravel"] } });

    const [sourcesRes, discoveryRes] = await Promise.all([
      fetch(`${ts.baseUrl}/api/sources`, { headers: { Authorization: `Bearer ${ts.token}` } }),
      fetch(`${ts.baseUrl}/api/discovery`, { headers: { Authorization: `Bearer ${ts.token}` } }),
    ]);
    const { sources } = (await sourcesRes.json()) as { sources: SourceDescriptor[] };
    const { frameworks } = (await discoveryRes.json()) as { frameworks: DetectedFramework[] };
    expect(sources.find((s) => s.id === "local:laravel")).toBeUndefined();
    expect(frameworks.find((f) => f.detector === "laravel")).toBeUndefined();
  });

  it("disabling an environment-tier detector name ('herd', fixture-injected via $HOME) removes its source entirely, vs. present when not disabled", async () => {
    laravelProject(dir!, { withLogFile: true, logContent: "" });

    // Herd/Valet resolve relative to os.homedir(), which Node reads from
    // $HOME live on POSIX — fixture-injectable without touching this
    // machine's real home directory (unlike src/discovery/environment.ts's
    // Homebrew detector, whose log dir is a hardcoded absolute path with no
    // fixture seam; see the test plan's manual-only note for that one).
    realHome = process.env.HOME;
    const fakeHome = mkFixtureDir("tr-qa-fake-home-");
    const herdLogDir = join(fakeHome, "Library", "Application Support", "Herd", "Log");
    mkdirSync(herdLogDir, { recursive: true });
    writeFileSync(join(herdLogDir, "nginx-mysite.test.log"), "");
    process.env.HOME = fakeHome;

    // Control: with "herd" NOT in the disable list, its source is discovered.
    const withHerd = await startDiscoveryTestServer({ cwd: dir!, discovery: { disable: ["valet", "homebrew"] } });
    try {
      const res = await fetch(`${withHerd.baseUrl}/api/sources`, {
        headers: { Authorization: `Bearer ${withHerd.token}` },
      });
      const { sources } = (await res.json()) as { sources: SourceDescriptor[] };
      expect(sources.find((s) => s.id.startsWith("herd:"))).toBeDefined();
    } finally {
      await withHerd.close();
    }

    // Same fixture, "herd" added to disable — its source vanishes entirely.
    ts = await startDiscoveryTestServer({ cwd: dir!, discovery: { disable: ["herd", "valet", "homebrew"] } });
    const res = await fetch(`${ts.baseUrl}/api/sources`, { headers: { Authorization: `Bearer ${ts.token}` } });
    const { sources } = (await res.json()) as { sources: SourceDescriptor[] };
    expect(sources.find((s) => s.id.startsWith("herd:"))).toBeUndefined();
    rmFixtureDir(fakeHome);
  });
});

describe("Criterion 14 — discovery.enabled: false", () => {
  it("no discovery WS message, no local sources from auto-discovery, GET /api/discovery reports disabled — explicit watch entries still work", async () => {
    laravelProject(dir!, { withLogFile: true, logContent: "" });
    writeFixtureFile(dir!, "logs/worker.log", "");
    ts = await startDiscoveryTestServer({
      cwd: dir!,
      discovery: { enabled: false },
      watch: [{ path: "logs/worker.log", label: "local:worker" }],
    });

    const ws = await connect(ts.wsUrl, ts.token);
    const allMsgs: ServerToClientMessage[] = [];
    ws.on("message", (data) => allMsgs.push(JSON.parse(data.toString())));
    await sleep(300);
    ws.close();
    await sleep(50);

    expect(allMsgs.some((m) => m.type === "discovery")).toBe(false);

    const [sourcesRes, discoveryRes] = await Promise.all([
      fetch(`${ts.baseUrl}/api/sources`, { headers: { Authorization: `Bearer ${ts.token}` } }),
      fetch(`${ts.baseUrl}/api/discovery`, { headers: { Authorization: `Bearer ${ts.token}` } }),
    ]);
    const { sources } = (await sourcesRes.json()) as { sources: SourceDescriptor[] };
    expect(sources.find((s) => s.id === "local:laravel")).toBeUndefined(); // auto-discovery off
    expect(sources.find((s) => s.id === "local:worker")).toBeDefined(); // explicit watch still works

    expect(discoveryRes.status).toBe(200);
    expect(await discoveryRes.json()).toEqual({ enabled: false, frameworks: [] });
  });
});

describe("Criterion 21 — GET /api/discovery mirrors the WS discovery message", () => {
  it("REST response's frameworks array matches the WS discovery push exactly", async () => {
    laravelProject(dir!, { withLogFile: true, logContent: "" });
    ts = await startDiscoveryTestServer({ cwd: dir!, discovery: { enabled: true } });

    const ws = await connect(ts.wsUrl, ts.token);
    const discoveryMsgs = collect(ws, "discovery");
    await sleep(200);
    ws.close();

    const res = await fetch(`${ts.baseUrl}/api/discovery`, { headers: { Authorization: `Bearer ${ts.token}` } });
    const body = (await res.json()) as { enabled: boolean; frameworks: DetectedFramework[] };

    expect(discoveryMsgs).toHaveLength(1);
    expect(body).toEqual({ enabled: true, frameworks: discoveryMsgs[0].frameworks });
    expect(body.frameworks.some((f) => f.detector === "laravel")).toBe(true);
  });
});
