/**
 * Standalone runner spawned as a *separate* Node process (via `tsx`) so its
 * RSS can be measured in isolation from the test/client process — the spec's
 * "the Node process stays under ~250 MB RSS" criterion is about the server
 * process specifically (docs/architecture.md § Process model: "a single
 * Node.js process"), and measuring `process.memoryUsage()` in-process here
 * would conflate it with the test harness's own memory (generating/holding
 * the upload body, running vitest, etc).
 *
 * Protocol: prints one line of JSON `{ pid, port, token }` to stdout once
 * listening, then stays up until it receives SIGTERM.
 */
import { startServer } from "../../src/server/index.js";
import type { AddressInfo } from "node:net";

const token = process.argv[2] ?? "child-server-token";
const buffer = process.argv[3] ? Number(process.argv[3]) : undefined;

const server = await startServer({ port: 0, strictPort: true, token, buffer });
const address = server.app.server.address() as AddressInfo;
// Same port-0 readback workaround as test/helpers/server.ts (see that file's
// docstring / the filed defect) — corrects state.port from the real bound port.
server.state.port = address.port;

process.stdout.write(JSON.stringify({ pid: process.pid, port: address.port, token }) + "\n");

process.on("SIGTERM", async () => {
  await server.close();
  process.exit(0);
});
