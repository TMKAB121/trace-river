/**
 * WS subscribe/unsubscribe protocol — spec 001 acceptance criterion 14:
 * unsubscribing stops new entries for that source from being pushed to this
 * client at all (server-side effect, independent of client-side display
 * logic, which is covered separately by static review in the test plan).
 */
import { describe, it, expect, afterEach } from "vitest";
import { request } from "node:http";
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

function entriesFrom(ws: WebSocket): { count: number } {
  const state = { count: 0 };
  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString()) as ServerToClientMessage;
    if (msg.type === "entries") state.count += msg.entries.length;
  });
  return state;
}

/** Streams `numChunks` chunks of `linesPerChunk` lines each, `delayMs` apart,
 *  to a slow-uploading source — long enough to unsubscribe mid-stream. */
function slowUpload(port: number, token: string, name: string, numChunks: number, linesPerChunk: number, delayMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path: `/api/upload?name=${encodeURIComponent(name)}`,
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(res.statusCode ?? -1));
      },
    );
    req.on("error", reject);

    (async () => {
      for (let c = 0; c < numChunks; c++) {
        let text = "";
        for (let l = 0; l < linesPerChunk; l++) text += `line chunk=${c} n=${l}\n`;
        req.write(text);
        await new Promise((r) => setTimeout(r, delayMs));
      }
      req.end();
    })().catch(reject);
  });
}

describe("WS subscribe/unsubscribe", () => {
  it("unsubscribing mid-upload stops further entries for that client, while a still-subscribed client keeps receiving them", async () => {
    ts = await startTestServer();
    const { baseUrl, wsUrl, token, server } = ts;
    const port = (server.app.server.address() as { port: number }).port;

    const clientA = await connect(wsUrl, token); // will unsubscribe partway through
    const clientB = await connect(wsUrl, token); // stays subscribed throughout
    await new Promise((r) => setTimeout(r, 100)); // let both drain their initial (empty) replay/sources

    const statsA = entriesFrom(clientA);
    const statsB = entriesFrom(clientB);

    const sourceId = "file:slow.log";
    const uploadPromise = slowUpload(port, token, "slow.log", 8, 20, 150);

    // Unsubscribe A partway through the upload.
    await new Promise((r) => setTimeout(r, 300));
    clientA.send(JSON.stringify({ type: "unsubscribe", sourceIds: [sourceId] }));
    const countAAtUnsubscribe = statsA.count;

    const statusCode = await uploadPromise;
    expect(statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 300)); // let final batches flush (broadcaster: ~75ms cadence)

    // B (still subscribed) received the full set; the server-side authoritative count agrees.
    const sourcesRes = await fetch(`${baseUrl}/api/sources`, { headers: { Authorization: `Bearer ${token}` } });
    const { sources } = (await sourcesRes.json()) as { sources: Array<{ id: string; entryCount: number }> };
    const total = sources.find((s) => s.id === sourceId)!.entryCount;
    expect(total).toBe(8 * 20);
    expect(statsB.count).toBe(total);

    // A stopped receiving new entries for this source right after unsubscribing —
    // its count should not have grown past what it had at unsubscribe time.
    expect(statsA.count).toBe(countAAtUnsubscribe);
    expect(statsA.count).toBeLessThan(total);

    clientA.close();
    clientB.close();
  });

  it("resubscribing restores the flow of new entries for a subsequently-uploaded source", async () => {
    ts = await startTestServer();
    const { baseUrl, wsUrl, token } = ts;
    const client = await connect(wsUrl, token);
    await new Promise((r) => setTimeout(r, 100));
    const stats = entriesFrom(client);

    const sourceIdA = "file:a.log";
    client.send(JSON.stringify({ type: "unsubscribe", sourceIds: [sourceIdA] }));
    await new Promise((r) => setTimeout(r, 50));

    await fetch(`${baseUrl}/api/upload?name=a.log`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
      body: "one\ntwo\n",
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(stats.count).toBe(0); // unsubscribed before any entries existed -> none delivered

    client.send(JSON.stringify({ type: "subscribe", sourceIds: [sourceIdA] }));
    await new Promise((r) => setTimeout(r, 50));

    await fetch(`${baseUrl}/api/upload?name=b.log`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
      body: "three\nfour\nfive\n",
    });
    await new Promise((r) => setTimeout(r, 300));

    expect(stats.count).toBe(3); // resubscribed -> new source's entries flow normally

    client.close();
  });
});
