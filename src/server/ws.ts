/**
 * `GET /ws?token=<token>` upgrade handling, wired directly onto the raw
 * HTTP server (bypassing Fastify's router) so an invalid token rejects the
 * upgrade with HTTP 401 *before* completing the WebSocket handshake — not
 * accept-then-close. See docs/specs/001-phase-1-core-console.md § Auth.
 */
import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import type { AppState } from "./app-state.js";
import { isAllowedHost, isAllowedOrigin } from "./auth.js";
import { tokensMatch } from "./token.js";
import type { ClientToServerMessage } from "../shared/types.js";

export function setupWebSocketServer(server: HttpServer, state: AppState): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = safeParseUrl(req.url, req.headers.host);
    if (!url || url.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    const hostOk = isAllowedHost(req.headers.host, state.port);
    const originOk = isAllowedOrigin(req.headers.origin as string | undefined, state.port);
    const token = url.searchParams.get("token") ?? undefined;
    const tokenOk = tokensMatch(state.token, token);

    if (!hostOk || !originOk || !tokenOk) {
      const body = JSON.stringify({ error: "unauthorized" });
      socket.write(
        `HTTP/1.1 401 Unauthorized\r\n` +
          `Content-Type: application/json\r\n` +
          `Content-Length: ${Buffer.byteLength(body)}\r\n` +
          `Connection: close\r\n\r\n${body}`,
      );
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws: WebSocket) => onConnection(ws, state));

  return wss;
}

function onConnection(ws: WebSocket, state: AppState): void {
  const conn = state.broadcaster.addClient(ws);

  // Replay-on-connect, in order: buffered ring buffer contents, then the
  // current source list, then live traffic (handled by future broadcasts).
  state.broadcaster.sendReplay(conn, state.ringBuffer.all());
  state.broadcaster.sendSources(conn, state.sources.list());

  ws.on("message", (data) => {
    let message: ClientToServerMessage;
    try {
      message = JSON.parse(data.toString());
    } catch {
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

function safeParseUrl(rawUrl: string | undefined, host: string | undefined): URL | null {
  if (!rawUrl) return null;
  try {
    return new URL(rawUrl, `http://${host ?? "127.0.0.1"}`);
  } catch {
    return null;
  }
}
