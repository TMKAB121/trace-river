/**
 * Fastify server wiring: bind to 127.0.0.1, token + Host/Origin auth on
 * every route, serve the pre-built SPA from dist/web, wire the REST
 * surface and the /ws upgrade. See docs/architecture.md and
 * docs/specs/001-phase-1-core-console.md.
 */
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Readable } from "node:stream";

import { createAppState, type AppState } from "./app-state.js";
import { generateSessionToken } from "./token.js";
import { extractBearerToken, isAllowedHost, isAllowedOrigin } from "./auth.js";
import { tokensMatch } from "./token.js";
import { setupWebSocketServer } from "./ws.js";
import { registerUploadRoute } from "./routes/upload.js";
import { registerSourcesRoute } from "./routes/sources.js";
import { registerStatusRoute } from "./routes/status.js";
import { registerReplayRoute } from "./routes/replay.js";
import { registerDockerStatusRoute } from "./routes/docker-status.js";
import { UPLOAD_HARD_CAP_BYTES } from "../ingest/upload.js";
import { DEFAULT_BUFFER, DEFAULT_PORT, type ResolvedConfig } from "../shared/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_WEB_DIST = join(__dirname, "..", "web");

export interface StartServerOptions {
  /** Desired port. Auto-increments (up to +20) unless strictPort is set. */
  port?: number;
  /** true when the port was explicitly requested (--port): conflict is a hard error, not auto-increment. */
  strictPort?: boolean;
  buffer?: number;
  /** Injectable for tests; otherwise a fresh crypto-random token is generated. */
  token?: string;
  version?: string;
  config?: ResolvedConfig;
  /** Directory containing the built SPA (index.html, JS/CSS). Defaults to dist/web next to this module. */
  webDist?: string;
  /** Project root for Docker compose-project filtering. Defaults to
   *  process.cwd(). See docs/configuration.md. */
  cwd?: string;
}

export interface StartedServer {
  app: FastifyInstance;
  state: AppState;
  port: number;
  token: string;
  url: string;
  close(): Promise<void>;
}

const MAX_PORT_ATTEMPTS = 21; // default + 20 increments, per docs/architecture.md § Port strategy

export async function startServer(options: StartServerOptions = {}): Promise<StartedServer> {
  const desiredPort = options.port ?? DEFAULT_PORT;
  const strictPort = options.strictPort ?? false;
  const token = options.token ?? generateSessionToken();
  const version = options.version ?? "0.2.0";
  const webDist = options.webDist ?? DEFAULT_WEB_DIST;

  const config: ResolvedConfig =
    options.config ??
    ({
      port: desiredPort,
      buffer: options.buffer ?? DEFAULT_BUFFER,
      open: true,
      configPath: null,
      watch: [],
      // Docker off by default when no explicit config is supplied — this
      // fallback is only ever reached by test/dev harnesses that omit
      // `config` (cli.ts/dev-entry.ts always resolve one via
      // src/shared/config.ts, whose own default is `docker.enabled: true`).
      // Keeping it off here keeps every pre-phase-2 test's `startServer()`
      // call fully inert (no socket probing/timeouts), matching phase 1's
      // shipped behavior exactly.
      docker: { enabled: false },
      discovery: {},
      parsers: [],
    } satisfies ResolvedConfig);

  const state = createAppState({ token, port: desiredPort, config, version, cwd: options.cwd });
  state.broadcaster.start();

  let port = desiredPort;
  let app: FastifyInstance | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < (strictPort ? 1 : MAX_PORT_ATTEMPTS); attempt++) {
    const candidatePort = desiredPort + attempt;
    state.port = candidatePort;
    const candidateApp = buildApp(state, webDist);
    try {
      await candidateApp.listen({ port: candidatePort, host: "127.0.0.1" });
      // Read back the port the OS actually bound — candidatePort may be 0
      // ("pick any free port"), in which case the real port only exists on
      // the listening socket's address, not in the request we made.
      const boundPort = (candidateApp.server.address() as AddressInfo).port;
      state.port = boundPort;
      app = candidateApp;
      port = boundPort;
      break;
    } catch (err) {
      lastError = err;
      await candidateApp.close();
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "EADDRINUSE" || strictPort) {
        state.broadcaster.stop();
        throw err;
      }
    }
  }

  if (!app) {
    state.broadcaster.stop();
    throw lastError ?? new Error("Unable to bind to any port");
  }

  setupWebSocketServer(app.server, state);

  // Resolved *before* returning (and therefore before the CLI opens the
  // browser / any WS client connects) so the very first `dockerStatus`
  // message any client receives already reflects the real, stable
  // connectivity state — required for "no card/toast on a normal,
  // always-worked-fine startup" (docs/specs/002-phase-2-docker.md
  // § Components & states / Decision 3), which depends on the first message
  // never needing a follow-up correction.
  await state.docker.start();

  const url = `http://127.0.0.1:${port}/?token=${token}`;

  return {
    app,
    state,
    port,
    token,
    url,
    async close() {
      state.docker.stop();
      state.broadcaster.stop();
      await app!.close();
    },
  };
}

function buildApp(state: AppState, webDist: string): FastifyInstance {
  const app = Fastify({
    logger: false,
    // Our own routes enforce the documented 500 MB hard cap with the documented
    // error shape; this is just a generous backstop so Fastify's own bodyLimit
    // handling (different response shape) doesn't fire first.
    bodyLimit: UPLOAD_HARD_CAP_BYTES + 1024 * 1024,
  });

  // Pass the raw request stream straight through for octet-stream uploads —
  // never buffer the whole file. See src/ingest/upload.ts.
  app.addContentTypeParser("application/octet-stream", (_request, payload, done) => {
    done(null, payload as unknown as Readable);
  });

  app.addHook("onRequest", async (request, reply) => {
    const hostOk = isAllowedHost(request.headers.host, state.port);
    const originOk = isAllowedOrigin(request.headers.origin as string | undefined, state.port);
    if (!hostOk || !originOk) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    if (request.raw.url?.startsWith("/api/")) {
      const bearer = extractBearerToken(request.headers.authorization);
      if (!tokensMatch(state.token, bearer)) {
        return reply.code(401).send({ error: "unauthorized" });
      }
    }
  });

  registerUploadRoute(app, state);
  registerSourcesRoute(app, state);
  registerStatusRoute(app, state);
  registerReplayRoute(app, state);
  registerDockerStatusRoute(app, state);

  if (existsSync(webDist)) {
    app.register(fastifyStatic, { root: webDist });
  }

  return app;
}
