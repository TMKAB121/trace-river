export const BATCH_INTERVAL_MS = 75;
export const BATCH_MAX_ENTRIES = 500;
/** Not specified to the byte by the spec — architecture.md just says "high-water
 *  mark (ws bufferedAmount)"; 1 MB is a reasonable default for a localhost socket. */
export const WS_HIGH_WATER_MARK_BYTES = 1_000_000;
class ClientConnectionImpl {
    ws;
    excludedSourceIds = new Set();
    constructor(ws) {
        this.ws = ws;
    }
    isSubscribed(sourceId) {
        return !this.excludedSourceIds.has(sourceId);
    }
}
export class Broadcaster {
    clients = new Set();
    pendingEntries = [];
    flushTimer = null;
    start() {
        if (this.flushTimer)
            return;
        this.flushTimer = setInterval(() => this.flush(), BATCH_INTERVAL_MS);
        this.flushTimer.unref?.();
    }
    stop() {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = null;
        }
    }
    addClient(ws) {
        const conn = new ClientConnectionImpl(ws);
        this.clients.add(conn);
        return conn;
    }
    removeClient(conn) {
        this.clients.delete(conn);
    }
    subscribe(conn, sourceIds) {
        for (const id of sourceIds)
            conn.excludedSourceIds.delete(id);
    }
    unsubscribe(conn, sourceIds) {
        for (const id of sourceIds)
            conn.excludedSourceIds.add(id);
    }
    /** Queue an entry for the next batched flush. */
    enqueueEntry(entry) {
        this.pendingEntries.push(entry);
        if (this.pendingEntries.length >= BATCH_MAX_ENTRIES)
            this.flush();
    }
    /** Queue several entries at once (e.g. a burst of buffered detection-window entries). */
    enqueueEntries(entries) {
        for (const entry of entries)
            this.enqueueEntry(entry);
    }
    flush() {
        if (this.pendingEntries.length === 0)
            return;
        const batch = this.pendingEntries;
        this.pendingEntries = [];
        for (const conn of this.clients) {
            const filtered = batch.filter((e) => conn.isSubscribed(e.source));
            if (filtered.length === 0)
                continue;
            if (conn.ws.bufferedAmount > WS_HIGH_WATER_MARK_BYTES) {
                this.sendJson(conn.ws, { type: "dropped", count: filtered.length });
                continue;
            }
            this.sendJson(conn.ws, { type: "entries", entries: filtered });
        }
    }
    /** Send the current ring buffer contents to one newly connected client, chunked at
     *  the same ≤500-entry cap used for live traffic — never one giant frame. */
    sendReplay(conn, entries) {
        for (let i = 0; i < entries.length; i += BATCH_MAX_ENTRIES) {
            const chunk = entries.slice(i, i + BATCH_MAX_ENTRIES);
            this.sendJson(conn.ws, { type: "entries", entries: chunk });
        }
    }
    sendSources(conn, sources) {
        this.sendJson(conn.ws, { type: "sources", sources });
    }
    broadcastSources(sources) {
        for (const conn of this.clients)
            this.sendJson(conn.ws, { type: "sources", sources });
    }
    broadcastSourceState(id, state, detail) {
        for (const conn of this.clients) {
            this.sendJson(conn.ws, { type: "sourceState", id, state, detail: detail ?? undefined });
        }
    }
    /** Approved protocol extension — see docs/specs/001-phase-1-core-console.md § WebSocket protocol. */
    broadcastCleared() {
        for (const conn of this.clients)
            this.sendJson(conn.ws, { type: "cleared" });
    }
    clientCount() {
        return this.clients.size;
    }
    sendJson(ws, message) {
        if (ws.readyState !== ws.OPEN)
            return;
        try {
            ws.send(JSON.stringify(message));
        }
        catch {
            // Best-effort — a send failure here means the socket is on its way out;
            // the 'close' handler will clean up the client entry.
        }
    }
}
//# sourceMappingURL=broadcaster.js.map