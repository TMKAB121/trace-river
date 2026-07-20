/**
 * Shared harness for the Docker integration suite (spec 002 acceptance
 * criteria). These tests exercise `src/ingest/docker.ts` against a REAL
 * local Docker daemon and real throwaway containers (created/destroyed by
 * each test file, all named with the `tr-qa-` prefix per the QA run's
 * environment directive — never touching any other container on the host).
 *
 * The whole suite no-ops (via `describe.skipIf`) when no Docker daemon is
 * reachable, so `npm test` still passes on a machine without Docker.
 */
import { execFileSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { startServer, type StartedServer } from "../../src/server/index.js";
import type { ResolvedConfig, DockerConfig } from "../../src/shared/config.js";
import type { ServerToClientMessage } from "../../src/shared/types.js";

let cachedAvailable: boolean | null = null;

/** True iff a Docker (or Docker-API-compatible) daemon answers on this host. */
export function dockerAvailable(): boolean {
  if (cachedAvailable !== null) return cachedAvailable;
  try {
    execFileSync("docker", ["info"], { stdio: "ignore", timeout: 5000 });
    cachedAvailable = true;
  } catch {
    cachedAvailable = false;
  }
  return cachedAvailable;
}

export interface DockerTestServer {
  server: StartedServer;
  baseUrl: string;
  wsUrl: string;
  token: string;
  close: () => Promise<void>;
}

/** Starts the real server with Docker enabled, pointed at `cwd` for
 *  compose-project filtering (docs/specs/002-phase-2-docker.md § API
 *  contract). Mirrors `test/helpers/server.ts`'s ephemeral-port pattern. */
export async function startDockerTestServer(opts: {
  cwd: string;
  docker?: Partial<DockerConfig>;
  buffer?: number;
}): Promise<DockerTestServer> {
  const token = "test-token-" + Math.random().toString(16).slice(2);
  const config: ResolvedConfig = {
    port: 0,
    buffer: opts.buffer ?? 50000,
    open: false,
    configPath: null,
    watch: [],
    docker: {
      enabled: true,
      allContainers: false,
      include: [],
      exclude: [],
      ...opts.docker,
    },
    discovery: {},
    parsers: [],
  };

  const server = await startServer({ port: 0, strictPort: true, token, config, cwd: opts.cwd });
  const address = server.app.server.address() as AddressInfo;
  const actualPort = address.port;
  server.state.port = actualPort; // same port-0 readback workaround as test/helpers/server.ts

  const baseUrl = `http://127.0.0.1:${actualPort}`;
  const wsUrl = `ws://127.0.0.1:${actualPort}`;

  return { server, baseUrl, wsUrl, token, close: () => server.close() };
}

/** Every message ever received on a given socket, buffered from the moment
 *  the socket is constructed (not from `open`) — the server pushes replay
 *  entries/sources/dockerStatus immediately on connect, and on localhost
 *  those can arrive in the same tick as the client's own `open` event, so a
 *  listener attached only *after* `connect()` resolves can race and miss
 *  them. Keyed by socket so `collect()` can seed itself from anything
 *  already buffered, not just messages from here on. */
const allMessages = new WeakMap<WebSocket, ServerToClientMessage[]>();

export function connect(wsUrl: string, token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsUrl}/ws?token=${encodeURIComponent(token)}`);
    const buffered: ServerToClientMessage[] = [];
    allMessages.set(ws, buffered);
    ws.on("message", (data) => {
      try {
        buffered.push(JSON.parse(data.toString()) as ServerToClientMessage);
      } catch {
        /* ignore unparsable frames */
      }
    });
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

/** Collects every message of a given type received on `ws`, including any
 *  already buffered before this call (see `allMessages` above), plus every
 *  matching message from here on. */
export function collect<T extends ServerToClientMessage["type"]>(
  ws: WebSocket,
  type: T,
): Array<Extract<ServerToClientMessage, { type: T }>> {
  const buffered = allMessages.get(ws) ?? [];
  const out = buffered.filter((m) => m.type === type) as Array<Extract<ServerToClientMessage, { type: T }>>;
  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString()) as ServerToClientMessage;
    if (msg.type === type) out.push(msg as Extract<ServerToClientMessage, { type: T }>);
  });
  return out;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Closes every given WS client, best-effort. Fastify's `app.close()` waits
 *  for open connections to drain, so a test that throws mid-body (skipping
 *  its own explicit `ws.close()` calls) can otherwise hang the `afterEach`
 *  teardown indefinitely — always call this in a `finally` block. */
export function closeAll(...sockets: WebSocket[]): void {
  for (const ws of sockets) {
    try {
      ws.close();
    } catch {
      /* best-effort */
    }
  }
}

/** Polls `check` every `intervalMs` until it returns true or `timeoutMs` elapses. */
export async function waitFor(check: () => boolean, timeoutMs = 15000, intervalMs = 100): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await sleep(intervalMs);
  }
}

export function dockerRun(args: string[]): void {
  execFileSync("docker", ["run", ...args], { stdio: "ignore" });
}

export function dockerRm(names: string[]): void {
  try {
    execFileSync("docker", ["rm", "-f", ...names], { stdio: "ignore" });
  } catch {
    // best-effort cleanup
  }
}
