/**
 * WS broadcaster: batches "entries" traffic (~75ms / 500-entry cap,
 * whichever first), tracks per-client source subscriptions, and drops
 * batches (with a `dropped` notice) for a client whose socket buffer is
 * backed up rather than let a slow client stall the whole broadcast.
 * See docs/architecture.md § "Transport: WebSocket".
 */
import type { WebSocket } from "ws";
import type {
  DetectedFramework,
  DockerStatus,
  ErrorGroup,
  ServerToClientMessage,
  SourceDescriptor,
  TraceRiverLog,
} from "../shared/types.js";

export const BATCH_INTERVAL_MS = 75;
export const BATCH_MAX_ENTRIES = 500;
/** Not specified to the byte by the spec — architecture.md just says "high-water
 *  mark (ws bufferedAmount)"; 1 MB is a reasonable default for a localhost socket. */
export const WS_HIGH_WATER_MARK_BYTES = 1_000_000;

export interface ClientConnection {
  readonly ws: WebSocket;
  /** Sources this client is currently excluded from delivery for — the
   *  live, effective per-connection filter `flush()` reads. Populated both
   *  by an explicit client `unsubscribe` message *and* by the connect-time
   *  default seed for a still-`pending`/environment source (`onConnection`,
   *  src/server/ws.ts); absence here == subscribed (clients are subscribed
   *  to all sources, including future ones, by default). */
  readonly excludedSourceIds: Set<string>;
  isSubscribed(sourceId: string): boolean;
}

class ClientConnectionImpl implements ClientConnection {
  readonly excludedSourceIds = new Set<string>();
  /** Subset of `excludedSourceIds` this connection put there itself via an
   *  explicit `{"type":"unsubscribe"}` message — as opposed to the
   *  connect-time default seed for a not-yet-live/environment source. Only
   *  this subset survives the one-time zero-config auto-subscribe courtesy
   *  (docs/specs/003-phase-3-auto-discovery.md § Interaction specs,
   *  Decision 4 — "never a standing override of an explicit unsubscribe"). */
  readonly explicitlyExcludedSourceIds = new Set<string>();
  constructor(readonly ws: WebSocket) {}
  isSubscribed(sourceId: string): boolean {
    return !this.excludedSourceIds.has(sourceId);
  }
}

/** Invoked once per flush tick, before entries are flushed — returns the
 *  full current ErrorGroup list only when it actually changed since the
 *  last call (see src/errors/error-store.ts `tick()`), or null otherwise. */
export type ErrorGroupsTickFn = () => ErrorGroup[] | null;

export class Broadcaster {
  private clients = new Set<ClientConnectionImpl>();
  private pendingEntries: TraceRiverLog[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private errorGroupsTick: ErrorGroupsTickFn | null = null;

  /** `onErrorGroupsTick` (docs/specs/004-phase-4-error-intelligence.md
   *  § API contract): called every flush tick so a purely time-driven group
   *  change (e.g. a spike clearing once the rate subsides, with no new
   *  occurrence to otherwise trigger a broadcast) still reaches clients at
   *  the same ~75ms cadence as `entries`. Optional so every pre-phase-4
   *  test's bare `broadcaster.start()` call keeps working unchanged. */
  start(onErrorGroupsTick?: ErrorGroupsTickFn): void {
    if (this.flushTimer) return;
    this.errorGroupsTick = onErrorGroupsTick ?? null;
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
    const impl = conn as ClientConnectionImpl;
    for (const id of sourceIds) {
      impl.excludedSourceIds.delete(id);
      impl.explicitlyExcludedSourceIds.delete(id);
    }
  }

  unsubscribe(conn: ClientConnection, sourceIds: string[]): void {
    const impl = conn as ClientConnectionImpl;
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
  autoSubscribeAll(sourceId: string): void {
    for (const conn of this.clients) {
      if (!conn.explicitlyExcludedSourceIds.has(sourceId)) {
        conn.excludedSourceIds.delete(sourceId);
      }
    }
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
    if (this.errorGroupsTick) {
      const groups = this.errorGroupsTick();
      if (groups) {
        for (const conn of this.clients) this.sendJson(conn.ws, { type: "errorGroups", groups });
      }
    }

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
    this.sendJson(conn.ws, { type: "sources", sources: this.personalize(conn, sources) });
  }

  broadcastSources(sources: SourceDescriptor[]): void {
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
  private personalize(conn: ClientConnection, sources: SourceDescriptor[]): SourceDescriptor[] {
    return sources.map((source) =>
      source.kind === "local" || source.kind === "file"
        ? { ...source, subscribed: conn.isSubscribed(source.id) }
        : source,
    );
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

  /** Sent once to a newly-connected client, third in the WS connection
   *  sequence (docs/specs/002-phase-2-docker.md § API contract) — only when
   *  Docker is enabled server-side. */
  sendDockerStatus(conn: ClientConnection, status: DockerStatus, detail: string | null): void {
    this.sendJson(conn.ws, { type: "dockerStatus", status, detail });
  }

  /** Broadcast whenever daemon connectivity status changes, in either
   *  direction (docs/specs/002-phase-2-docker.md § API contract). */
  broadcastDockerStatus(status: DockerStatus, detail: string | null): void {
    for (const conn of this.clients) this.sendJson(conn.ws, { type: "dockerStatus", status, detail });
  }

  /** Sent once to a newly-connected client, fourth in the WS connection
   *  sequence (docs/specs/003-phase-3-auto-discovery.md § API contract) —
   *  only when discovery is enabled server-side. Never rebroadcast
   *  mid-session (fingerprinting runs once, at startup). */
  sendDiscovery(conn: ClientConnection, frameworks: DetectedFramework[]): void {
    this.sendJson(conn.ws, { type: "discovery", frameworks });
  }

  /** Sent once to a newly-connected client, as the last step of the WS
   *  connection sequence (docs/specs/004-phase-4-error-intelligence.md
   *  § API contract) — unconditional, unlike `dockerStatus`/`discovery`
   *  (error grouping has no enable flag, Decision 6), sent even when the
   *  current group list is `[]`. */
  sendErrorGroups(conn: ClientConnection, groups: ErrorGroup[]): void {
    this.sendJson(conn.ws, { type: "errorGroups", groups });
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
