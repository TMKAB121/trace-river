import { getStatus, ApiError } from "./rest";
import { token } from "./auth";
import type { ClientMessage, ServerMessage } from "../types";

/**
 * WS connection-state UI (spec 001 § API contract § WebSocket protocol):
 *  - "connecting": not yet connected — "Connecting…" banner.
 *  - "connected": live.
 *  - "disconnected": dropped after having connected — "Disconnected —
 *    retrying…" banner, automatic reconnect with exponential backoff.
 *  - "invalid-token": server rejected the upgrade (401) — terminal error
 *    state, no retry loop.
 */
export type ConnectionState = "connecting" | "connected" | "disconnected" | "invalid-token";

export interface SocketHandlers {
  onMessage: (msg: ServerMessage) => void;
  onStateChange: (state: ConnectionState) => void;
}

const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 10_000;

/**
 * Thin WS client with reconnect/backoff.
 *
 * Browsers do not expose the HTTP status code of a rejected WebSocket
 * upgrade to page JS (the spec used to fire is a generic close/error event
 * either way), so a failed-handshake 401 can't be distinguished from a
 * transient network drop purely from the WebSocket object. To satisfy the
 * spec's requirement to show a distinct terminal "invalid session" state for
 * a bad token vs. a retryable disconnect, we preflight-validate the token
 * with a REST call (`GET /api/status`, which the contract says requires the
 * same bearer token) before every connection attempt, including retries.
 */
export class TraceRiverSocket {
  private ws: WebSocket | null = null;
  private readonly handlers: SocketHandlers;
  private backoffMs = INITIAL_BACKOFF_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByClient = false;
  private hasConnectedOnce = false;

  constructor(handlers: SocketHandlers) {
    this.handlers = handlers;
  }

  start(): void {
    this.closedByClient = false;
    void this.attemptConnect();
  }

  private async attemptConnect(): Promise<void> {
    if (this.closedByClient) return;

    this.handlers.onStateChange(this.hasConnectedOnce ? "disconnected" : "connecting");

    if (!token) {
      this.handlers.onStateChange("invalid-token");
      return;
    }

    try {
      await getStatus();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        this.handlers.onStateChange("invalid-token");
        return;
      }
      // Any other failure (server still booting, transient network issue):
      // fall through and let the WS attempt + reconnect loop below drive it.
    }

    if (this.closedByClient) return;

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.hasConnectedOnce = true;
      this.backoffMs = INITIAL_BACKOFF_MS;
      this.handlers.onStateChange("connected");
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data as string) as ServerMessage;
        this.handlers.onMessage(msg);
      } catch {
        // Malformed frame — ignore rather than crash the connection.
      }
    };

    ws.onclose = () => {
      this.ws = null;
      if (this.closedByClient) return;
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose fires immediately after; reconnect scheduling happens there.
    };
  }

  private scheduleReconnect(): void {
    this.handlers.onStateChange("disconnected");
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
      void this.attemptConnect();
    }, this.backoffMs);
  }

  send(message: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  close(): void {
    this.closedByClient = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.ws?.close();
    this.ws = null;
  }
}
