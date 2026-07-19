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
    // current source list, then live traffic (handled by future broadcasts).
    state.broadcaster.sendReplay(conn, state.ringBuffer.all());
    state.broadcaster.sendSources(conn, state.sources.list());
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
                state.broadcaster.subscribe(conn, message.sourceIds);
                break;
            case "unsubscribe":
                state.broadcaster.unsubscribe(conn, message.sourceIds);
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