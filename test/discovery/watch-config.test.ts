/**
 * `traceriver.json` `watch` entries — docs/specs/003-phase-3-auto-discovery.md
 * acceptance criteria 6 and 7, plus the unknown-parser fallback warning
 * (docs/configuration.md § Semantics, src/discovery/index.ts).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  mkFixtureDir,
  rmFixtureDir,
  laravelProject,
  writeFixtureFile,
  appendFixtureFile,
  startDiscoveryTestServer,
  connect,
  collect,
  sleep,
  waitFor,
  closeAll,
  type DiscoveryTestServer,
} from "./helpers.js";
import type { SourceDescriptor } from "../../src/shared/types.js";

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

describe("Criterion 6 — watch label override, parser pinning, and glob folding", () => {
  it("an explicit label is used verbatim for the sidebar row and TraceRiverLog.source", async () => {
    writeFixtureFile(dir!, "logs/worker.log", "");
    ts = await startDiscoveryTestServer({
      cwd: dir!,
      discovery: { enabled: false },
      watch: [{ path: "logs/worker.log", label: "local:worker" }],
    });

    const res = await fetch(`${ts.baseUrl}/api/sources`, { headers: { Authorization: `Bearer ${ts.token}` } });
    const { sources } = (await res.json()) as { sources: SourceDescriptor[] };
    const worker = sources.find((s) => s.id === "local:worker");
    expect(worker).toBeDefined();
    expect(worker!.label).toBe("local:worker");
    expect(worker!.local).toEqual({
      origin: "config",
      detector: null,
      targetPath: expect.stringContaining("worker.log"),
    });

    const ws = await connect(ts.wsUrl, ts.token);
    try {
      const entries = collect(ws, "entries");
      await sleep(150);
      appendFixtureFile(`${dir!}/logs/worker.log`, "hello from worker\n");
      await waitFor(() => entries.flatMap((m) => m.entries).some((e) => e.source === "local:worker"), 3000);
    } finally {
      closeAll(ws);
    }
  });

  it("a pinned parser is used without running detection, even for content that wouldn't otherwise score well against it", async () => {
    // Pin "clf" on content that looks nothing like a CLF access line — with
    // detection running normally this would lock onto `raw` instead; pinning
    // must bypass scoring entirely (docs/configuration.md: "a pinned parser
    // is used without running detection").
    writeFixtureFile(dir!, "logs/custom.log", "");
    ts = await startDiscoveryTestServer({
      cwd: dir!,
      discovery: { enabled: false },
      watch: [{ path: "logs/custom.log", label: "local:custom", parser: "jsonl" }],
    });

    const ws = await connect(ts.wsUrl, ts.token);
    try {
      const entries = collect(ws, "entries");
      await sleep(150);
      appendFixtureFile(`${dir!}/logs/custom.log`, `${JSON.stringify({ level: "warn", msg: "pinned jsonl" })}\n`);
      await waitFor(() => entries.flatMap((m) => m.entries).some((e) => e.source === "local:custom"), 3000);

      const entry = entries.flatMap((m) => m.entries).find((e) => e.source === "local:custom")!;
      expect(entry.message).toBe("pinned jsonl");
      expect(entry.level).toBe("WARN");
    } finally {
      closeAll(ws);
    }
  });

  it("logs a startup warning and falls back to auto-detection for an unknown pinned parser name", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      writeFixtureFile(dir!, "logs/custom.log", "");
      ts = await startDiscoveryTestServer({
        cwd: dir!,
        discovery: { enabled: false },
        watch: [{ path: "logs/custom.log", label: "local:custom", parser: "not-a-real-parser" }],
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('unknown parser "not-a-real-parser"'),
      );

      // Still tails normally (falls back to auto-detection, doesn't just die).
      const ws = await connect(ts.wsUrl, ts.token);
      try {
        const entries = collect(ws, "entries");
        await sleep(150);
        appendFixtureFile(`${dir!}/logs/custom.log`, "plain text line\n");
        await waitFor(() => entries.flatMap((m) => m.entries).some((e) => e.source === "local:custom"), 3000);
      } finally {
        closeAll(ws);
      }
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("a glob path folds every currently-matching file into one row, and a file added later extends the same source", async () => {
    writeFixtureFile(dir!, "sites/api/var/log/2026-07-19.log", "");
    writeFixtureFile(dir!, "sites/api/var/log/2026-07-20.log", "");
    ts = await startDiscoveryTestServer({
      cwd: dir!,
      discovery: { enabled: false },
      watch: [{ path: "sites/api/var/log/*.log", label: "local:api" }],
    });

    const res = await fetch(`${ts.baseUrl}/api/sources`, { headers: { Authorization: `Bearer ${ts.token}` } });
    const { sources } = (await res.json()) as { sources: SourceDescriptor[] };
    expect(sources.filter((s) => s.id === "local:api")).toHaveLength(1);

    const ws = await connect(ts.wsUrl, ts.token);
    try {
      const entries = collect(ws, "entries");
      await sleep(150);

      appendFixtureFile(`${dir!}/sites/api/var/log/2026-07-20.log`, "from day two\n");
      await waitFor(() => entries.flatMap((m) => m.entries).some((e) => e.message.includes("from day two")), 3000);

      // A file added later that matches the glob extends the same source —
      // no second row.
      writeFixtureFile(dir!, "sites/api/var/log/2026-07-21.log", "");
      await sleep(300);
      appendFixtureFile(`${dir!}/sites/api/var/log/2026-07-21.log`, "from day three\n");
      await waitFor(
        () => entries.flatMap((m) => m.entries).some((e) => e.message.includes("from day three")),
        3000,
      );

      const res2 = await fetch(`${ts!.baseUrl}/api/sources`, { headers: { Authorization: `Bearer ${ts!.token}` } });
      const { sources: sources2 } = (await res2.json()) as { sources: SourceDescriptor[] };
      expect(sources2.filter((s) => s.id === "local:api")).toHaveLength(1);
    } finally {
      closeAll(ws);
    }
  });
});

describe("Criterion 7 — config/discovery dedupe by resolved absolute path", () => {
  it("a watch entry naming the same resolved path as a detector produces exactly one SourceDescriptor, using the config label/parser", async () => {
    laravelProject(dir!, { withLogFile: true, logContent: "" });
    ts = await startDiscoveryTestServer({
      cwd: dir!,
      discovery: { enabled: true },
      watch: [{ path: "storage/logs/laravel.log", label: "local:custom-laravel-label" }],
    });

    const res = await fetch(`${ts.baseUrl}/api/sources`, { headers: { Authorization: `Bearer ${ts.token}` } });
    const { sources } = (await res.json()) as { sources: SourceDescriptor[] };

    // Not the detector's default id/label...
    expect(sources.find((s) => s.id === "local:laravel")).toBeUndefined();
    // ...exactly one row under the config's own id/label, with the detector
    // name retained for traceability per § API contract.
    const merged = sources.filter((s) => s.kind === "local");
    expect(merged).toHaveLength(1);
    const row = merged[0];
    expect(row.id).toBe("local:custom-laravel-label");
    expect(row.label).toBe("local:custom-laravel-label");
    expect(row.local).toEqual({
      origin: "config",
      detector: "laravel",
      targetPath: expect.stringContaining("laravel.log"),
    });
  });
});
