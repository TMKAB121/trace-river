/**
 * Token auth — spec 001 acceptance criterion 1: missing/wrong token on any
 * /api/* call or the /ws upgrade returns 401 (the WS upgrade is rejected
 * *before* completing the handshake per the API contract's "Auth" section).
 */
import { describe, it, expect, afterEach } from "vitest";
import { WebSocket } from "ws";
import { startTestServer, type TestServer } from "../helpers/server.js";

let ts: TestServer | undefined;

afterEach(async () => {
  await ts?.close();
  ts = undefined;
});

describe("Token auth — REST", () => {
  it("GET /api/status without a token returns 401 { error: 'unauthorized' }", async () => {
    ts = await startTestServer();
    const res = await fetch(`${ts.baseUrl}/api/status`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("GET /api/status with a wrong token returns 401", async () => {
    ts = await startTestServer();
    const res = await fetch(`${ts.baseUrl}/api/status`, { headers: { Authorization: "Bearer not-the-token" } });
    expect(res.status).toBe(401);
  });

  it("GET /api/sources and /api/replay also enforce the token", async () => {
    ts = await startTestServer();
    const sourcesRes = await fetch(`${ts.baseUrl}/api/sources`);
    expect(sourcesRes.status).toBe(401);
    const replayRes = await fetch(`${ts.baseUrl}/api/replay?after=0`);
    expect(replayRes.status).toBe(401);
  });

  it("POST /api/upload without a token returns 401 before any upload processing", async () => {
    ts = await startTestServer();
    const res = await fetch(`${ts.baseUrl}/api/upload?name=x.log`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: "hello\n",
    });
    expect(res.status).toBe(401);
  });

  it("succeeds with the correct token", async () => {
    ts = await startTestServer();
    const res = await fetch(`${ts.baseUrl}/api/status`, { headers: { Authorization: `Bearer ${ts.token}` } });
    expect(res.status).toBe(200);
  });
});

describe("Token auth — WebSocket upgrade", () => {
  it("rejects an upgrade with a missing token with HTTP 401 before completing the handshake", async () => {
    ts = await startTestServer();
    const result = await attemptUpgrade(`${ts.wsUrl}/ws`);
    expect(result.kind).toBe("http-error");
    if (result.kind === "http-error") {
      expect(result.statusCode).toBe(401);
    }
  });

  it("rejects an upgrade with a wrong token with HTTP 401 before completing the handshake", async () => {
    ts = await startTestServer();
    const result = await attemptUpgrade(`${ts.wsUrl}/ws?token=wrong-token`);
    expect(result.kind).toBe("http-error");
    if (result.kind === "http-error") {
      expect(result.statusCode).toBe(401);
    }
  });

  it("accepts an upgrade with the correct token", async () => {
    ts = await startTestServer();
    const result = await attemptUpgrade(`${ts.wsUrl}/ws?token=${encodeURIComponent(ts.token)}`);
    expect(result.kind).toBe("open");
    if (result.kind === "open") result.ws.close();
  });
});

type UpgradeResult = { kind: "open"; ws: WebSocket } | { kind: "http-error"; statusCode: number };

/**
 * Attempts a WS upgrade and distinguishes "server sent an HTTP error status
 * before upgrading" (what `ws` calls "unexpected-response") from "the
 * handshake actually completed" — this is exactly the distinction the spec
 * requires the server to preserve (401 pre-handshake, not accept-then-close).
 */
function attemptUpgrade(url: string): Promise<UpgradeResult> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error("attemptUpgrade timed out")), 5000);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve({ kind: "open", ws });
    });
    ws.once("unexpected-response", (_req, res) => {
      clearTimeout(timer);
      resolve({ kind: "http-error", statusCode: res.statusCode ?? -1 });
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
