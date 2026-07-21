/**
 * Zero-config Laravel tail — docs/specs/003-phase-3-auto-discovery.md
 * acceptance criteria 1 and 2.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
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

const MONOLOG_EXCEPTION = readFileSync(
  new URL("../fixtures/monolog-laravel.log", import.meta.url),
  "utf8",
);

describe("Criterion 1 — pre-existing laravel.log tails with zero config", () => {
  it("local:laravel starts checked, full opacity (subscribed), live, no user action", async () => {
    laravelProject(dir!, { withLogFile: true, logContent: "" });
    ts = await startDiscoveryTestServer({ cwd: dir! });

    const res = await fetch(`${ts.baseUrl}/api/sources`, {
      headers: { Authorization: `Bearer ${ts.token}` },
    });
    const { sources } = (await res.json()) as { sources: SourceDescriptor[] };
    const laravel = sources.find((s) => s.id === "local:laravel");
    expect(laravel).toBeDefined();
    expect(laravel!.subscribed).toBe(true);
    expect(laravel!.state).toBe("live");
    expect(laravel!.detail).toBeNull();
    expect(laravel!.local).toEqual({
      origin: "project",
      detector: "laravel",
      targetPath: expect.stringContaining("laravel.log"),
    });
  });

  it("an exception's multi-line PHP stack trace arrives as exactly one multiline:true entry within ~1s", async () => {
    laravelProject(dir!, { withLogFile: true, logContent: "" });
    ts = await startDiscoveryTestServer({ cwd: dir! });

    const ws = await connect(ts.wsUrl, ts.token);
    try {
      const entries = collect(ws, "entries");
      await sleep(150); // drain the (empty) initial replay

      const target = `${dir!}/storage/logs/laravel.log`;
      appendFixtureFile(target, MONOLOG_EXCEPTION);

      await waitFor(() => entries.some((m) => m.entries.length > 0), 2000);
      await sleep(300); // let the 2s idle-flush window's early batches settle further

      const all = entries.flatMap((m) => m.entries);
      const exceptionEntry = all.find((e) => e.multiline && e.body?.includes("Stack trace:"));
      expect(exceptionEntry).toBeDefined();
      expect(exceptionEntry!.source).toBe("local:laravel");
      expect(exceptionEntry!.body).toContain("Caused by: RuntimeException");
      // Exactly one multiline entry for the whole trace block, not one per line.
      expect(all.filter((e) => e.multiline)).toHaveLength(1);
    } finally {
      closeAll(ws);
    }
  });
});

describe("Criterion 2 — laravel.log does not exist yet at startup", () => {
  it("local:laravel starts unchecked, dimmed (subscribed:false), state pending, WAITING detail, entryCount 0", async () => {
    laravelProject(dir!, { withLogFile: false });
    ts = await startDiscoveryTestServer({ cwd: dir! });

    const res = await fetch(`${ts.baseUrl}/api/sources`, {
      headers: { Authorization: `Bearer ${ts.token}` },
    });
    const { sources } = (await res.json()) as { sources: SourceDescriptor[] };
    const laravel = sources.find((s) => s.id === "local:laravel");
    expect(laravel).toBeDefined();
    expect(laravel!.subscribed).toBe(false);
    expect(laravel!.state).toBe("pending");
    expect(laravel!.entryCount).toBe(0);
    expect(laravel!.detail).toMatch(/^Waiting for .*laravel\*?\.log to be created\.$/);
  });

  it("creating the file flips the row to checked + live via the sources broadcast, no user action", async () => {
    laravelProject(dir!, { withLogFile: false });
    ts = await startDiscoveryTestServer({ cwd: dir! });

    const ws = await connect(ts.wsUrl, ts.token);
    try {
      const sourcesMsgs = collect(ws, "sources");
      const stateMsgs = collect(ws, "sourceState");
      await sleep(150);

      writeFixtureFile(dir!, "storage/logs/laravel.log", "[2026-07-20 10:00:00] local.INFO: first line {} []\n");

      await waitFor(
        () => stateMsgs.some((m) => m.id === "local:laravel" && m.state === "live"),
        3000,
      );
      await sleep(150);

      const lastSources = sourcesMsgs[sourcesMsgs.length - 1].sources;
      const laravel = lastSources.find((s) => s.id === "local:laravel")!;
      expect(laravel.subscribed).toBe(true);
      expect(laravel.state).toBe("live");
      expect(laravel.detail).toBeNull();
    } finally {
      closeAll(ws);
    }
  });

  it("REGRESSION CHECK (see defect 003-phase-3-auto-discovery-2): the tab that was already connected while pending actually receives entries after the auto-subscribe flip, not just an updated checkbox", async () => {
    laravelProject(dir!, { withLogFile: false });
    ts = await startDiscoveryTestServer({ cwd: dir! });

    // Connect BEFORE the file exists — this connection's per-connection
    // delivery filter is seeded from subscribed:false at connect time
    // (src/server/ws.ts onConnection).
    const ws = await connect(ts.wsUrl, ts.token);
    try {
      const stateMsgs = collect(ws, "sourceState");
      const entryMsgs = collect(ws, "entries");
      await sleep(150);

      writeFixtureFile(dir!, "storage/logs/laravel.log", "");
      await waitFor(
        () => stateMsgs.some((m) => m.id === "local:laravel" && m.state === "live"),
        3000,
      );

      // Now that the source has auto-subscribed server-side, write a line and
      // confirm THIS already-open connection actually receives it — per spec
      // 003's acceptance criterion 2 ("no page refresh and no user action"),
      // the zero-config promise is about the row actually streaming, not
      // just the checkbox re-rendering as checked.
      const target = `${dir!}/storage/logs/laravel.log`;
      appendFixtureFile(target, "[2026-07-20 10:00:01] local.INFO: after auto-subscribe {} []\n");

      await waitFor(() => entryMsgs.some((m) => m.entries.some((e) => e.source === "local:laravel")), 3000);
      const delivered = entryMsgs.flatMap((m) => m.entries).filter((e) => e.source === "local:laravel");
      expect(delivered.length).toBeGreaterThan(0);
    } finally {
      closeAll(ws);
    }
  });
});
