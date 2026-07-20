import { WebSocketServer } from "ws";
import { isAllowedHost, isAllowedOrigin } from "./auth.js";
import { tokensMatch } from "./token.js";
export function setupWebSocketServer(server, state) {
    const wss = new WebSocketServer({ noServer: true });
    server.on("upgrade", (req, socket, head) => {
        const url = safeParseUrl(req.url, req.headers.host);
        if (!url || url.pathname !== "/ws") {
            socket.destroy();
            return;
        }
        const hostOk = isAllowedHost(req.headers.host, state.port);
        const originOk = isAllowedOrigin(req.headers.origin, state.port);
        const token = url.searchParams.get("token") ?? undefined;
        const tokenOk = tokensMatch(state.token, token);
        if (!hostOk || !originOk || !tokenOk) {
            const body = JSON.stringify({ error: "unauthorized" });
            socket.write(`HTTP/1.1 401 Unauthorized\r\n` +
                `Content-Type: application/json\r\n` +
                `Content-Length: ${Buffer.byteLength(body)}\r\n` +
                `Connection: close\r\n\r\n${body}`);
            socket.destroy();
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit("connection", ws, req);
        });
    });
    wss.on("connection", (ws) => onConnection(ws, state));
    return wss;
}
function onConnection(ws, state) {
    const conn = state.broadcaster.addClient(ws);
    // Replay-on-connect, in order: buffered ring buffer contents, then the
    // current source list, then (if Docker is enabled) the current daemon
    // connectivity status, then live traffic (handled by future broadcasts).
    // See docs/specs/002-phase-2-docker.md § "WS connection sequence".
    state.broadcaster.sendReplay(conn, state.ringBuffer.all());
    state.broadcaster.sendSources(conn, state.sources.list());
    if (state.config.docker.enabled ?? true) {
        const { status, detail } = state.docker.getStatus();
        state.broadcaster.sendDockerStatus(conn, status, detail);
    }
    ws.on("message", (data) => {
        let message;
        try {
            message = JSON.parse(data.toString());
        }
        catch {
            return;
        }
        switch (message.type) {
            case "subscribe":
                handleSubscribeToggle(state, conn, message.sourceIds, true);
                break;
            case "unsubscribe":
                handleSubscribeToggle(state, conn, message.sourceIds, false);
                break;
            case "clear":
                state.ringBuffer.clear();
                state.broadcaster.broadcastCleared();
                break;
            default:
                break;
        }
    });
    const cleanup = () => state.broadcaster.removeClient(conn);
    ws.on("close", cleanup);
    ws.on("error", cleanup);
}
/**
 * `subscribe`/`unsubscribe` reuse the same message shape for every source
 * kind, but the *effect* differs (docs/specs/002-phase-2-docker.md
 * § Interaction specs, Decision 5): a file-source id is a per-connection
 * delivery filter (unchanged from spec 001); a `docker:<name>` id flips the
 * shared `SourceDescriptor.subscribed` flag server-globally and actually
 * starts/stops that container's log stream, broadcast to every client.
 */
function handleSubscribeToggle(state, conn, sourceIds, subscribe) {
    const dockerIds = [];
    const otherIds = [];
    for (const id of sourceIds) {
        const kind = state.sources.get(id)?.kind ?? (id.startsWith("docker:") ? "docker" : undefined);
        if (kind === "docker")
            dockerIds.push(id);
        else
            otherIds.push(id);
    }
    if (otherIds.length > 0) {
        if (subscribe)
            state.broadcaster.subscribe(conn, otherIds);
        else
            state.broadcaster.unsubscribe(conn, otherIds);
    }
    for (const id of dockerIds) {
        void state.docker.setSubscribed(id, subscribe);
    }
}
function safeParseUrl(rawUrl, host) {
    if (!rawUrl)
        return null;
    try {
        return new URL(rawUrl, `http://${host ?? "127.0.0.1"}`);
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=ws.js.map