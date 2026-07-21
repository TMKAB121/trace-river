/**
 * REST auth/404 behavior (criteria 14, 20) and WS connection-sequence
 * ordering (criterion 3, § API contract "sent once, right after discovery/
 * dockerStatus/sources... as the new last step").
 */
import { describe, it, expect, afterEach } from "vitest";
import { WebSocket } from "ws";
import { startTestServer, type TestServer } from "../helpers/server.js";
import { closeAll } from "../docker/helpers.js";
import type { ServerToClientMessage } from "../../src/shared/types.js";

let ts: TestServer | undefined;

/** Captures every message in arrival order from the moment the socket is
 *  constructed (listener attached inside the executor, before `open` can
 *  possibly fire) — needed here (unlike test/docker/helpers.ts's `connect`/
 *  `collect`, which key by message *type*) to assert strict cross-type
 *  ordering of the WS connect sequence. */
function connectRaw(wsUrl: string, token: string): Promise<{ ws: WebSocket; messages: ServerToClientMessage[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsUrl}/ws?token=${encodeURIComponent(token)}`);
    const messages: ServerToClientMessage[] = [];
    ws.on("message", (data: Buffer) => {
      messages.push(JSON.parse(data.toString()) as ServerToClientMessage);
    });
    ws.once("open", () => resolve({ ws, messages }));
    ws.once("error", reject);
  });
}

afterEach(async () => {
  await ts?.close();
  ts = undefined;
});

describe("GET /api/errors — auth (criterion 20's auth surface, mirrors every other /api/* route)", () => {
  it("401 without a token", async () => {
    ts = await startTestServer();
    const res = await fetch(`${ts.baseUrl}/api/errors`);
    expect(res.status).toBe(401);
  });

  it("401 with a wrong token", async () => {
    ts = await startTestServer();
    const res = await fetch(`${ts.baseUrl}/api/errors`, { headers: { Authorization: "Bearer wrong" } });
    expect(res.status).toBe(401);
  });

  it("200 { groups: [] } with the correct token and no groups yet", async () => {
    ts = await startTestServer();
    const res = await fetch(`${ts.baseUrl}/api/errors`, { headers: { Authorization: `Bearer ${ts.token}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ groups: [] });
  });
});

describe("GET /api/errors/:fingerprint/prompt — auth + 404 (criterion 14)", () => {
  it("401 without a token", async () => {
    ts = await startTestServer();
    const res = await fetch(`${ts.baseUrl}/api/errors/anything/prompt`);
    expect(res.status).toBe(401);
  });

  it("404 { error: 'not_found' } for a fingerprint that has never existed", async () => {
    ts = await startTestServer();
    const res = await fetch(`${ts.baseUrl}/api/errors/never-existed-fingerprint/prompt`, {
      headers: { Authorization: `Bearer ${ts.token}` },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});

describe("WS connection sequence — errorGroups is unconditional and last", () => {
  it("errorGroups arrives after sources on a fresh connection with no groups yet, and its payload is [] (presence, not emptiness, signals the feature ran)", async () => {
    ts = await startTestServer();
    const { ws, messages } = await connectRaw(ts.wsUrl, ts.token);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for errorGroups")), 4000);
      const check = () => {
        if (messages.some((m) => m.type === "errorGroups")) {
          clearTimeout(timer);
          ws.off("message", check);
          resolve();
        }
      };
      ws.on("message", check);
      check(); // in case it already arrived before this listener attached
    });

    const sourcesIdx = messages.findIndex((m) => m.type === "sources");
    const errorGroupsIdx = messages.findIndex((m) => m.type === "errorGroups");
    expect(sourcesIdx).toBeGreaterThanOrEqual(0);
    expect(errorGroupsIdx).toBeGreaterThan(sourcesIdx);
    // errorGroups is the very last connect-sequence message (nothing else
    // follows it in this captured prefix, until live traffic).
    const afterErrorGroups = messages.slice(errorGroupsIdx + 1);
    expect(afterErrorGroups.every((m) => m.type === "errorGroups")).toBe(true);

    const errorGroupsMsg = messages[errorGroupsIdx];
    expect(errorGroupsMsg).toMatchObject({ type: "errorGroups", groups: [] });
    closeAll(ws);
  });
});
