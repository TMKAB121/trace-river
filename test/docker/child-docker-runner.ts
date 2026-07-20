/**
 * Standalone runner (separate process, so RSS can be measured in isolation —
 * see test/helpers/child-server-runner.ts for the rationale) with Docker
 * enabled and a small ring buffer, for the 5k-lines/sec load criterion
 * (spec 002 acceptance criterion 14). Protocol identical to
 * child-server-runner.ts: one JSON line `{ pid, port, token }` on stdout
 * once listening, stays up until SIGTERM.
 */
import { startServer } from "../../src/server/index.js";
import type { AddressInfo } from "node:net";
import type { ResolvedConfig } from "../../src/shared/config.js";

const token = process.argv[2] ?? "child-docker-token";
const buffer = process.argv[3] ? Number(process.argv[3]) : 5000;
const cwd = process.argv[4] ?? process.cwd();

const config: ResolvedConfig = {
  port: 0,
  buffer,
  open: false,
  configPath: null,
  watch: [],
  docker: { enabled: true, allContainers: false, include: [], exclude: [] },
  discovery: {},
  parsers: [],
};

const server = await startServer({ port: 0, strictPort: true, token, config, cwd });
const address = server.app.server.address() as AddressInfo;
server.state.port = address.port; // same port-0 readback workaround as the other harness helpers

process.stdout.write(JSON.stringify({ pid: process.pid, port: address.port, token }) + "\n");

process.on("SIGTERM", async () => {
  await server.close();
  process.exit(0);
});
