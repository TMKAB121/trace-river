/**
 * WS broadcaster: batches "entries" traffic (~75ms / 500-entry cap,
 * whichever first), tracks per-client source subscriptions, and drops
 * batches (with a `dropped` notice) for a client whose socket buffer is
 * backed up rather than let a slow client stall the whole broadcast.
 * See docs/architecture.md § "Transport: WebSocket".
 */
import type { WebSocket } from "ws";
import type { ServerToClientMessage, SourceDescriptor, TraceRiverLog } from "../shared/types.js";

export const BATCH_INTERVAL_MS = 75;
export const BATCH_MAX_ENTRIES = 500;
/** Not specified to the byte by the spec — architecture.md just says "high-water
 *  mark (ws bufferedAmount)"; 1 MB is a reasonable default for a localhost socket. */
export const WS_HIGH_WATER_MARK_BYTES = 1_000_000;

export interface ClientConnection {
  readonly ws: WebSocket;
  /** Sources this client has explicitly unsubscribed from. Absence here == subscribed
   *  (clients are subscribed to all sources, including future ones, by default). */
  readonly excludedSourceIds: Set<string>;
  isSubscribed(sourceId: string): boolean;
}

class ClientConnectionImpl implements ClientConnection {
  readonly excludedSourceIds = new Set<string>();
  constructor(readonly ws: WebSocket) {}
  isSubscribed(sourceId: string): boolean {
    return !this.excludedSourceIds.has(sourceId);
  }
}

export class Broadcaster {
  private clients = new Set<ClientConnectionImpl>();
  private pendingEntries: TraceRiverLog[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => this.flush(), BATCH_INTERVAL_MS);
    this.flushTimer.unref?.();
  }

  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  addClient(ws: WebSocket): ClientConnection {
    const conn = new ClientConnectionImpl(ws);
    this.clients.add(conn);
    return conn;
  }

  removeClient(conn: ClientConnection): void {
    this.clients.delete(conn as ClientConnectionImpl);
  }

  subscribe(conn: ClientConnection, sourceIds: string[]): void {
    for (const id of sourceIds) conn.excludedSourceIds.delete(id);
  }

  unsubscribe(conn: ClientConnection, sourceIds: string[]): void {
    for (const id of sourceIds) conn.excludedSourceIds.add(id);
  }

  /** Queue an entry for the next batched flush. */
  enqueueEntry(entry: TraceRiverLog): void {
    this.pendingEntries.push(entry);
    if (this.pendingEntries.length >= BATCH_MAX_ENTRIES) this.flush();
  }

  /** Queue several entries at once (e.g. a burst of buffered detection-window entries). */
  enqueueEntries(entries: TraceRiverLog[]): void {
    for (const entry of entries) this.enqueueEntry(entry);
  }

  private flush(): void {
    if (this.pendingEntries.length === 0) return;
    const batch = this.pendingEntries;
    this.pendingEntries = [];

    for (const conn of this.clients) {
      const filtered = batch.filter((e) => conn.isSubscribed(e.source));
      if (filtered.length === 0) continue;

      if (conn.ws.bufferedAmount > WS_HIGH_WATER_MARK_BYTES) {
        this.sendJson(conn.ws, { type: "dropped", count: filtered.length });
        continue;
      }

      this.sendJson(conn.ws, { type: "entries", entries: filtered });
    }
  }

  /** Send the current ring buffer contents to one newly connected client, chunked at
   *  the same ≤500-entry cap used for live traffic — never one giant frame. */
  sendReplay(conn: ClientConnection, entries: TraceRiverLog[]): void {
    for (let i = 0; i < entries.length; i += BATCH_MAX_ENTRIES) {
      const chunk = entries.slice(i, i + BATCH_MAX_ENTRIES);
      this.sendJson(conn.ws, { type: "entries", entries: chunk });
    }
  }

  sendSources(conn: ClientConnection, sources: SourceDescriptor[]): void {
    this.sendJson(conn.ws, { type: "sources", sources });
  }

  broadcastSources(sources: SourceDescriptor[]): void {
    for (const conn of this.clients) this.sendJson(conn.ws, { type: "sources", sources });
  }

  broadcastSourceState(id: string, state: SourceDescriptor["state"], detail: string | null): void {
    for (const conn of this.clients) {
      this.sendJson(conn.ws, { type: "sourceState", id, state, detail: detail ?? undefined });
    }
  }

  /** Approved protocol extension — see docs/specs/001-phase-1-core-console.md § WebSocket protocol. */
  broadcastCleared(): void {
    for (const conn of this.clients) this.sendJson(conn.ws, { type: "cleared" });
  }

  clientCount(): number {
    return this.clients.size;
  }

  private sendJson(ws: WebSocket, message: ServerToClientMessage): void {
    if (ws.readyState !== ws.OPEN) return;
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // Best-effort — a send failure here means the socket is on its way out;
      // the 'close' handler will clean up the client entry.
    }
  }
}
