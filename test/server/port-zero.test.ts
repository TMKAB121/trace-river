/**
 * Regression test for a confirmed defect (see
 * docs/qa/defects/001-phase-1-core-console-1.md): `startServer({ port: 0 })`
 * — the standard Node/Fastify idiom for "let the OS assign an ephemeral
 * port" — never reads back the actual bound port after `listen()`.
 * `server.port` / `server.url` / `state.port` are left at the *requested*
 * port (0), which in turn makes every request 401 (Host header reports the
 * real port; `isAllowedHost` compares it against `state.port === 0`).
 *
 * This is written directly against `startServer` (no test-helper workaround)
 * so it fails honestly until the defect is fixed.
 */
import { describe, it, expect, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import { startServer, type StartedServer } from "../../src/server/index.js";

let server: StartedServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("startServer({ port: 0 }) — ephemeral port readback", () => {
  it("server.port matches the OS-assigned port actually bound", async () => {
    server = await startServer({ port: 0, strictPort: true, token: "port-zero-token" });
    const actualPort = (server.app.server.address() as AddressInfo).port;
    expect(actualPort).toBeGreaterThan(0);
    expect(server.port).toBe(actualPort);
  });

  it("a request to the actual bound port, with the correct token, is accepted (not 401'd by a stale Host check)", async () => {
    server = await startServer({ port: 0, strictPort: true, token: "port-zero-token" });
    const actualPort = (server.app.server.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${actualPort}/api/status`, {
      headers: { Authorization: "Bearer port-zero-token" },
    });
    expect(res.status).toBe(200);
  });
});
