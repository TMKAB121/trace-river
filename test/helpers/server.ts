/**
 * Shared test harness: starts the real server on an OS-assigned ephemeral
 * port ("listen(0)") and returns a ready-to-use base URL + token.
 *
 * NOTE — works around a confirmed backend defect (see
 * docs/qa/defects/001-phase-1-core-console-1.md): `startServer({ port: 0 })`
 * does not read back the OS-assigned port after `listen()` — `server.port`
 * / `server.url` / `state.port` are left at the *requested* port (0), which
 * in turn makes `isAllowedHost` reject every request (Host header reports
 * the real port, `state.port` is still 0). This helper corrects `state.port`
 * from the actual bound address so the rest of this test suite isn't
 * blocked on that fix landing — no product code is modified.
 */
import type { AddressInfo } from "node:net";
import { startServer, type StartedServer } from "../../src/server/index.js";

export interface TestServer {
  server: StartedServer;
  baseUrl: string;
  wsUrl: string;
  token: string;
  close: () => Promise<void>;
}

export async function startTestServer(
  opts: { token?: string; buffer?: number } = {},
): Promise<TestServer> {
  const token = opts.token ?? "test-token-" + Math.random().toString(16).slice(2);
  const server = await startServer({ port: 0, strictPort: true, token, buffer: opts.buffer });

  const address = server.app.server.address() as AddressInfo;
  const actualPort = address.port;
  // Work around the port-0 readback defect (see module docstring above).
  server.state.port = actualPort;

  const baseUrl = `http://127.0.0.1:${actualPort}`;
  const wsUrl = `ws://127.0.0.1:${actualPort}`;

  return {
    server,
    baseUrl,
    wsUrl,
    token,
    close: () => server.close(),
  };
}
