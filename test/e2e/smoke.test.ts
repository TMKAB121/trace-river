/**
 * End-to-end smoke test — docs/phases/phase-1-core.md § 1.4 / § Exit
 * criteria, spec 001 acceptance criterion 19: start the server
 * programmatically, upload a fixture over HTTP, assert the WS stream
 * delivers the expected parsed entries.
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WebSocket } from "ws";
import { startTestServer, type TestServer } from "../helpers/server.js";
import type { ServerToClientMessage, TraceRiverLog } from "../../src/shared/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, "..", "fixtures", "monolog-laravel.log");

let ts: TestServer | undefined;

afterEach(async () => {
  await ts?.close();
  ts = undefined;
});

function connect(wsUrl: string, token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsUrl}/ws?token=${encodeURIComponent(token)}`);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function collectEntriesUntil(
  ws: WebSocket,
  predicate: (all: TraceRiverLog[]) => boolean,
  timeoutMs = 5000,
): Promise<TraceRiverLog[]> {
  return new Promise((resolve, reject) => {
    const all: TraceRiverLog[] = [];
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error(`Timed out waiting for entries; collected ${all.length} so far`));
    }, timeoutMs);

    function onMessage(data: Buffer) {
      const msg = JSON.parse(data.toString()) as ServerToClientMessage;
      if (msg.type === "entries") {
        all.push(...msg.entries);
        if (predicate(all)) {
          clearTimeout(timer);
          ws.off("message", onMessage);
          resolve(all);
        }
      }
    }
    ws.on("message", onMessage);
  });
}

describe("End-to-end smoke: start server -> upload via HTTP -> WS delivers parsed entries", () => {
  it("delivers all 5 parsed monolog entries over the already-open WebSocket as the upload streams in", async () => {
    ts = await startTestServer();
    const { baseUrl, wsUrl, token } = ts;

    // WS connects *before* the upload starts, matching the spec's flow (§ User
    // flow step 4: "the server broadcasts parsed entries over the already-open
    // WebSocket as they're produced").
    const ws = await connect(wsUrl, token);

    const fileBytes = readFileSync(FIXTURE_PATH);
    const uploadPromise = fetch(`${baseUrl}/api/upload?name=${encodeURIComponent("monolog-laravel.log")}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
      },
      body: fileBytes,
    });

    const entries = await collectEntriesUntil(ws, (all) => all.length >= 5);
    const uploadRes = await uploadPromise;
    expect(uploadRes.status).toBe(200);
    const uploadBody = (await uploadRes.json()) as { source: { id: string; entryCount: number; state: string } };
    expect(uploadBody.source).toMatchObject({
      id: "file:monolog-laravel.log",
      entryCount: 5,
      state: "stopped",
    });

    expect(entries).toHaveLength(5);
    expect(entries.map((e) => e.level)).toEqual(["INFO", "WARN", "DEBUG", "ERROR", "INFO"]);
    expect(entries.every((e) => e.source === "file:monolog-laravel.log")).toBe(true);
    // ids are monotonic and assigned by the server's ring buffer.
    const ids = entries.map((e) => e.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(new Set(ids).size).toBe(5);

    const stackEntry = entries[3];
    expect(stackEntry.multiline).toBe(true);
    expect(stackEntry.body).toContain("Caused by: RuntimeException");

    ws.close();
  });

  it("GET /api/sources reflects the completed upload after the WS confirms delivery", async () => {
    ts = await startTestServer();
    const { baseUrl, wsUrl, token } = ts;
    const ws = await connect(wsUrl, token);

    const fileBytes = readFileSync(FIXTURE_PATH);
    await fetch(`${baseUrl}/api/upload?name=${encodeURIComponent("monolog-laravel.log")}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
      body: fileBytes,
    });
    await collectEntriesUntil(ws, (all) => all.length >= 5);

    const sourcesRes = await fetch(`${baseUrl}/api/sources`, { headers: { Authorization: `Bearer ${token}` } });
    expect(sourcesRes.status).toBe(200);
    const { sources } = (await sourcesRes.json()) as { sources: Array<Record<string, unknown>> };
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      id: "file:monolog-laravel.log",
      kind: "file",
      label: "monolog-laravel.log",
      subscribed: true,
      entryCount: 5,
      state: "stopped",
    });

    ws.close();
  });
});
