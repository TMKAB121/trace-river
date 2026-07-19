/**
 * Replay-on-connect (spec 001 criterion 17) and the `cleared` broadcast
 * protocol extension reaching every connected tab (spec 001 criterion 16 /
 * Decisions log #3).
 */
import { describe, it, expect, afterEach } from "vitest";
import { WebSocket } from "ws";
import { startTestServer, type TestServer } from "../helpers/server.js";
import type { ServerToClientMessage } from "../../src/shared/types.js";

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

function collectUntil(
  ws: WebSocket,
  predicate: (msgs: ServerToClientMessage[]) => boolean,
  timeoutMs = 5000,
): Promise<ServerToClientMessage[]> {
  return new Promise((resolve, reject) => {
    const all: ServerToClientMessage[] = [];
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error(`Timed out; collected ${all.length} messages: ${JSON.stringify(all.map((m) => m.type))}`));
    }, timeoutMs);
    function onMessage(data: Buffer) {
      const msg = JSON.parse(data.toString()) as ServerToClientMessage;
      all.push(msg);
      if (predicate(all)) {
        clearTimeout(timer);
        ws.off("message", onMessage);
        resolve(all);
      }
    }
    ws.on("message", onMessage);
  });
}

async function uploadFixture(baseUrl: string, token: string, name: string, bytes: string): Promise<void> {
  const res = await fetch(`${baseUrl}/api/upload?name=${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
    body: bytes,
  });
  expect(res.status).toBe(200);
}

describe("Replay-on-connect", () => {
  it("a fresh WS connection receives the current ring-buffer contents (entries), then sources, before any new live traffic", async () => {
    ts = await startTestServer();
    const { baseUrl, wsUrl, token } = ts;

    await uploadFixture(baseUrl, token, "a.log", "line one\nline two\nline three\n");

    // Give the server a beat to finish broadcasting/settling state from the
    // first upload before a second client connects — replay should already
    // reflect a fully-settled buffer.
    await new Promise((r) => setTimeout(r, 100));

    const ws2 = connectRaw(`${wsUrl}/ws?token=${encodeURIComponent(token)}`);
    const messages = await collectUntil(ws2, (all) => all.some((m) => m.type === "sources"));

    const entriesMsgs = messages.filter((m) => m.type === "entries") as Extract<
      ServerToClientMessage,
      { type: "entries" }
    >[];
    const sourcesIdx = messages.findIndex((m) => m.type === "sources");
    const lastEntriesIdx = messages.reduce((acc, m, i) => (m.type === "entries" ? i : acc), -1);

    expect(entriesMsgs.flatMap((m) => m.entries)).toHaveLength(3);
    // Replay order per spec: entries batches first, then sources.
    expect(lastEntriesIdx).toBeLessThan(sourcesIdx);

    ws2.close();
  });

  it("GET /api/replay?after=<id> backfills only entries newer than the cursor", async () => {
    ts = await startTestServer();
    const { baseUrl, token } = ts;
    await uploadFixture(baseUrl, token, "a.log", "one\ntwo\nthree\nfour\n");

    const all = await fetch(`${baseUrl}/api/replay?after=0`, { headers: { Authorization: `Bearer ${token}` } });
    const allBody = (await all.json()) as { entries: Array<{ id: number }> };
    expect(allBody.entries).toHaveLength(4);

    const cursor = allBody.entries[1].id;
    const partial = await fetch(`${baseUrl}/api/replay?after=${cursor}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const partialBody = (await partial.json()) as { entries: Array<{ id: number }> };
    expect(partialBody.entries).toHaveLength(2);
    expect(partialBody.entries.every((e) => e.id > cursor)).toBe(true);
  });
});

describe("`cleared` broadcast (approved protocol extension)", () => {
  it("reaches a second connected client, not just the tab that issued `clear`", async () => {
    ts = await startTestServer();
    const { baseUrl, wsUrl, token } = ts;
    await uploadFixture(baseUrl, token, "a.log", "one\ntwo\n");
    await new Promise((r) => setTimeout(r, 100));

    const wsA = await connect(wsUrl, token);
    const wsB = await connect(wsUrl, token);

    // Drain each socket's initial replay/sources burst before issuing clear.
    await new Promise((r) => setTimeout(r, 150));

    const bWaitsForCleared = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("client B never received `cleared`")), 5000);
      wsB.on("message", (data) => {
        const msg = JSON.parse(data.toString()) as ServerToClientMessage;
        if (msg.type === "cleared") {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    wsA.send(JSON.stringify({ type: "clear" }));

    await bWaitsForCleared;

    const statusRes = await fetch(`${baseUrl}/api/status`, { headers: { Authorization: `Bearer ${token}` } });
    const status = (await statusRes.json()) as { bufferUsed: number };
    expect(status.bufferUsed).toBe(0);

    wsA.close();
    wsB.close();
  });
});

function connectRaw(url: string): WebSocket {
  return new WebSocket(url);
}
