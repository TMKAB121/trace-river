/**
 * Fastify server wiring: bind to 127.0.0.1, token + Host/Origin auth on
 * every route, serve the pre-built SPA from dist/web, wire the REST
 * surface and the /ws upgrade. See docs/architecture.md and
 * docs/specs/001-phase-1-core-console.md.
 */
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createAppState } from "./app-state.js";
import { generateSessionToken } from "./token.js";
import { extractBearerToken, isAllowedHost, isAllowedOrigin } from "./auth.js";
import { tokensMatch } from "./token.js";
import { setupWebSocketServer } from "./ws.js";
import { registerUploadRoute } from "./routes/upload.js";
import { registerSourcesRoute } from "./routes/sources.js";
import { registerStatusRoute } from "./routes/status.js";
import { registerReplayRoute } from "./routes/replay.js";
import { registerDockerStatusRoute } from "./routes/docker-status.js";
import { registerDiscoveryRoute } from "./routes/discovery.js";
import { registerErrorsRoute } from "./routes/errors.js";
import { UPLOAD_HARD_CAP_BYTES } from "../ingest/upload.js";
import { DEFAULT_BUFFER, DEFAULT_PORT } from "../shared/config.js";
const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_WEB_DIST = join(__dirname, "..", "web");
const MAX_PORT_ATTEMPTS = 21; // default + 20 increments, per docs/architecture.md § Port strategy
export async function startServer(options = {}) {
    const desiredPort = options.port ?? DEFAULT_PORT;
    const strictPort = options.strictPort ?? false;
    const token = options.token ?? generateSessionToken();
    const version = options.version ?? "0.2.0";
    const webDist = options.webDist ?? DEFAULT_WEB_DIST;
    const config = options.config ??
        {
            port: desiredPort,
            buffer: options.buffer ?? DEFAULT_BUFFER,
            open: true,
            configPath: null,
            configDir: options.cwd ?? process.cwd(),
            watch: [],
            // Docker/discovery off by default when no explicit config is supplied
            // — this fallback is only ever reached by test/dev harnesses that
            // omit `config` (cli.ts/dev-entry.ts always resolve one via
            // src/shared/config.ts, whose own defaults are `docker.enabled: true`
            // / `discovery.enabled: true`). Keeping both off here keeps every
            // pre-phase-2/3 test's `startServer()` call fully inert (no socket
            // probing/timeouts, no fingerprinting the test's actual cwd or this
            // machine's real environment tooling), matching phase 1's shipped
            // behavior exactly.
            docker: { enabled: false },
            discovery: { enabled: false },
            parsers: [],
        };
    const state = createAppState({ token, port: desiredPort, config, version, cwd: options.cwd });
    // Error-groups recompute/broadcast is driven from the same ~75ms flush
    // tick as `entries` (docs/specs/004-phase-4-error-intelligence.md § API
    // contract — Cadence), so a purely time-driven change (a spike clearing
    // with no new occurrence) still reaches clients without a separate timer.
    state.broadcaster.start(() => state.errorGroups.tick());
    let port = desiredPort;
    let app = null;
    let lastError = null;
    for (let attempt = 0; attempt < (strictPort ? 1 : MAX_PORT_ATTEMPTS); attempt++) {
        const candidatePort = desiredPort + attempt;
        state.port = candidatePort;
        const candidateApp = buildApp(state, webDist);
        try {
            await candidateApp.listen({ port: candidatePort, host: "127.0.0.1" });
            // Read back the port the OS actually bound — candidatePort may be 0
            // ("pick any free port"), in which case the real port only exists on
            // the listening socket's address, not in the request we made.
            const boundPort = candidateApp.server.address().port;
            state.port = boundPort;
            app = candidateApp;
            port = boundPort;
            break;
        }
        catch (err) {
            lastError = err;
            await candidateApp.close();
            const code = err?.code;
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
    // Same reasoning as docker.start() above, for local sources: every tailed
    // target's chokidar watcher has completed its initial existence scan (so
    // `state.sources` already holds the correct pending-vs-live state) before
    // any client can connect — "Discovery runs once, before any client
    // connects" (docs/specs/003-phase-3-auto-discovery.md § Interaction
    // specs).
    await state.tail.start();
    const url = `http://127.0.0.1:${port}/?token=${token}`;
    return {
        app,
        state,
        port,
        token,
        url,
        async close() {
            state.tail.stop();
            state.docker.stop();
            state.broadcaster.stop();
            await app.close();
        },
    };
}
function buildApp(state, webDist) {
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
        done(null, payload);
    });
    app.addHook("onRequest", async (request, reply) => {
        const hostOk = isAllowedHost(request.headers.host, state.port);
        const originOk = isAllowedOrigin(request.headers.origin, state.port);
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
    registerDiscoveryRoute(app, state);
    registerErrorsRoute(app, state);
    if (existsSync(webDist)) {
        app.register(fastifyStatic, { root: webDist });
    }
    return app;
}
//# sourceMappingURL=index.js.map