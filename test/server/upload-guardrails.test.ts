/**
 * Upload guardrails — spec 001 acceptance criteria 5 (server-side 413 hard
 * cap, exercised via a non-browser client) and the duplicate-source-name 400
 * documented in the API contract's Errors list.
 */
import { describe, it, expect, afterEach } from "vitest";
import { request } from "node:http";
import { startTestServer, type TestServer } from "../helpers/server.js";

let ts: TestServer | undefined;

afterEach(async () => {
  await ts?.close();
  ts = undefined;
});

const HARD_CAP_BYTES = 500 * 1024 * 1024;

describe("POST /api/upload — 413 hard cap", () => {
  it("returns 413 { error: 'payload_too_large', limitBytes } when Content-Length declares > 500 MB, without requiring the full body", async () => {
    ts = await startTestServer();
    const { token, server } = ts;
    const port = server.app.server.address() && (server.app.server.address() as { port: number }).port;

    // A real >500MB upload isn't required to exercise this path: the route
    // checks the Content-Length header up front, before consuming any body
    // bytes (src/server/routes/upload.ts). We declare an oversized length via
    // a raw http.request (fetch/undici won't let us lie about Content-Length)
    // and only actually send a small amount of data.
    const result = await postWithDeclaredLength({
      port,
      path: "/api/upload?name=huge.log",
      token,
      declaredLength: HARD_CAP_BYTES + 1024,
      actualBody: Buffer.from("just a little data, not the full declared length\n"),
    });

    expect(result.statusCode).toBe(413);
    const body = JSON.parse(result.body) as { error: string; limitBytes: number };
    expect(body).toEqual({ error: "payload_too_large", limitBytes: HARD_CAP_BYTES });
  });
});

describe("POST /api/upload — duplicate source name", () => {
  it("returns 400 bad_request when a source with the same file:<name> id already exists", async () => {
    ts = await startTestServer();
    const { baseUrl, token } = ts;

    const first = await fetch(`${baseUrl}/api/upload?name=${encodeURIComponent("dup.log")}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
      body: "hello\n",
    });
    expect(first.status).toBe(200);

    const second = await fetch(`${baseUrl}/api/upload?name=${encodeURIComponent("dup.log")}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
      body: "hello again\n",
    });
    expect(second.status).toBe(400);
    const body = (await second.json()) as { error: string; message: string };
    expect(body.error).toBe("bad_request");
    expect(body.message).toContain("file:dup.log");
  });

  it("returns 400 bad_request when the name query parameter is missing", async () => {
    ts = await startTestServer();
    const { baseUrl, token } = ts;
    const res = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
      body: "hello\n",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("bad_request");
  });
});

function postWithDeclaredLength(opts: {
  port: number;
  path: string;
  token: string;
  declaredLength: number;
  actualBody: Buffer;
}): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port: opts.port,
        path: opts.path,
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.token}`,
          "Content-Type": "application/octet-stream",
          "Content-Length": opts.declaredLength,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({ statusCode: res.statusCode ?? -1, body: Buffer.concat(chunks).toString("utf8") });
        });
      },
    );
    req.on("error", (err) => {
      // A destroyed connection after the response is flushed can surface as
      // a socket error on some platforms; only reject if we truly never got
      // a response.
      reject(err);
    });
    req.write(opts.actualBody);
    req.end();
  });
}
