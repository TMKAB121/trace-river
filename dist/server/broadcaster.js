export const BATCH_INTERVAL_MS = 75;
export const BATCH_MAX_ENTRIES = 500;
/** Not specified to the byte by the spec — architecture.md just says "high-water
 *  mark (ws bufferedAmount)"; 1 MB is a reasonable default for a localhost socket. */
export const WS_HIGH_WATER_MARK_BYTES = 1_000_000;
class ClientConnectionImpl {
    ws;
    excludedSourceIds = new Set();
    /** Subset of `excludedSourceIds` this connection put there itself via an
     *  explicit `{"type":"unsubscribe"}` message — as opposed to the
     *  connect-time default seed for a not-yet-live/environment source. Only
     *  this subset survives the one-time zero-config auto-subscribe courtesy
     *  (docs/specs/003-phase-3-auto-discovery.md § Interaction specs,
     *  Decision 4 — "never a standing override of an explicit unsubscribe"). */
    explicitlyExcludedSourceIds = new Set();
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
        const impl = conn;
        for (const id of sourceIds) {
            impl.excludedSourceIds.delete(id);
            impl.explicitlyExcludedSourceIds.delete(id);
        }
    }
    unsubscribe(conn, sourceIds) {
        const impl = conn;
        for (const id of sourceIds) {
            impl.excludedSourceIds.add(id);
            impl.explicitlyExcludedSourceIds.add(id);
        }
    }
    /** One-time zero-config auto-subscribe courtesy (docs/specs/003-phase-3-
     *  auto-discovery.md § Interaction specs, Decision 4): fired exactly once,
     *  by the tailer, on a local/config source's first-ever `pending`->`live`
     *  transition. Clears `sourceId` from every already-connected client's
     *  delivery filter *unless* that client explicitly unsubscribed from it
     *  itself — matching the registry-level `setSubscribed(id, true)` this is
     *  always called alongside, so an already-open tab actually starts
     *  receiving entries instead of just showing an updated checkbox (see
     *  docs/qa/defects/003-phase-3-auto-discovery-2.md, Symptom A). */
    autoSubscribeAll(sourceId) {
        for (const conn of this.clients) {
            if (!conn.explicitlyExcludedSourceIds.has(sourceId)) {
                conn.excludedSourceIds.delete(sourceId);
            }
        }
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
        this.sendJson(conn.ws, { type: "sources", sources: this.personalize(conn, sources) });
    }
    broadcastSources(sources) {
        for (const conn of this.clients) {
            this.sendJson(conn.ws, { type: "sources", sources: this.personalize(conn, sources) });
        }
    }
    /** `local`/`file` source subscription is per-connection, not server-global
     *  (docs/specs/003-phase-3-auto-discovery.md § API contract: "It is not
     *  server-global state" — unlike `docker`, spec 002 Decision 5). The
     *  registry's own `subscribed` field for those kinds is only ever a
     *  *default template* for a brand-new connection (`onConnection`,
     *  src/server/ws.ts) — every `sources` message actually sent must report
     *  each connection's own effective value instead of that shared default,
     *  or one client's checkbox state (and, more importantly, its unsubscribe
     *  choice) leaks into every other client's view. */
    personalize(conn, sources) {
        return sources.map((source) => source.kind === "local" || source.kind === "file"
            ? { ...source, subscribed: conn.isSubscribed(source.id) }
            : source);
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
    /** Sent once to a newly-connected client, third in the WS connection
     *  sequence (docs/specs/002-phase-2-docker.md § API contract) — only when
     *  Docker is enabled server-side. */
    sendDockerStatus(conn, status, detail) {
        this.sendJson(conn.ws, { type: "dockerStatus", status, detail });
    }
    /** Broadcast whenever daemon connectivity status changes, in either
     *  direction (docs/specs/002-phase-2-docker.md § API contract). */
    broadcastDockerStatus(status, detail) {
        for (const conn of this.clients)
            this.sendJson(conn.ws, { type: "dockerStatus", status, detail });
    }
    /** Sent once to a newly-connected client, fourth in the WS connection
     *  sequence (docs/specs/003-phase-3-auto-discovery.md § API contract) —
     *  only when discovery is enabled server-side. Never rebroadcast
     *  mid-session (fingerprinting runs once, at startup). */
    sendDiscovery(conn, frameworks) {
        this.sendJson(conn.ws, { type: "discovery", frameworks });
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