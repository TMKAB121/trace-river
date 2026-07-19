/**
 * Shared data contract types — TraceRiverLog, SourceDescriptor, and the WS
 * message shapes. Imported by both the backend (src/server, src/parsers,
 * src/ingest) and, at build time, by web/ so protocol drift becomes a
 * compile error rather than a runtime surprise.
 *
 * See docs/log-schema.md and docs/specs/001-phase-1-core-console.md
 * (API contract section) for the authoritative definitions this file
 * implements.
 */

/** Normalized log levels, ordered by severity. */
export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL" | "UNKNOWN";

export interface TraceRiverLog {
  /** Monotonic server-assigned id — also the replay cursor. */
  id: number;

  /** Normalized timestamp, epoch milliseconds UTC. Falls back to arrival time. */
  timestamp: number;

  /** The timestamp string exactly as it appeared in the source, if any. */
  rawTimestamp: string | null;

  /** Namespaced source id: "docker:mysql", "local:laravel", "file:imported_dump.log". */
  source: string;

  level: LogLevel;

  /** First line of the entry — what the stream row displays. */
  message: string;

  /**
   * Full multi-line body (stack trace, continuation lines) when the entry
   * spans multiple raw lines; null for single-line entries.
   */
  body: string | null;

  /** Structured extras a parser extracted (e.g. Monolog context/extra JSON, CLF fields). */
  context: Record<string, unknown> | null;

  /** The untouched raw text of the entry (post ANSI-strip, pre-parse). */
  raw: string;

  /** True when body holds aggregated continuation lines. */
  multiline: boolean;
}

/** A `TraceRiverLog` before the ring buffer assigns its monotonic `id`. */
export type TraceRiverLogInput = Omit<TraceRiverLog, "id">;

export type SourceKind = "file" | "docker" | "local";
export type SourceState = "live" | "stopped" | "error";

export interface SourceDescriptor {
  /** Namespaced id, matches TraceRiverLog.source exactly, e.g. "file:dump.log". */
  id: string;

  /** Phase 1 only ever produces "file". "docker" / "local" are reserved
   *  for phases 2/3 so the sidebar component needs no rework later. */
  kind: SourceKind;

  /** Display name, e.g. "dump.log" (the id's prefix implies the kind icon;
   *  the label is the part after the colon). */
  label: string;

  /** Checkbox state. Server stops sending this source's entries to a
   *  client that has unsubscribed (see WS protocol below). */
  subscribed: boolean;

  /** Toggle state. Client-side only — does not affect what the server
   *  sends; purely filters rendering. Included here so a fresh page load
   *  / reconnect restores the same visibility a previous tab had... */
  visible: boolean;

  /** Authoritative total as of this message. Phase-1 files are static:
   *  once state moves to "stopped" this number is final. */
  entryCount: number;

  /** "live" while the upload is still streaming/parsing; "stopped" once
   *  parsing is complete (the whole point of a phase-1 file source);
   *  "error" if the upload/parse failed. */
  state: SourceState;

  /** Human-readable detail for "error" (and optionally "stopped") states. */
  detail: string | null;

  /** Epoch ms — sidebar sort order (oldest first, matching upload order). */
  createdAt: number;
}

// ---------------------------------------------------------------------------
// WebSocket protocol
// ---------------------------------------------------------------------------

export type ServerToClientMessage =
  | { type: "entries"; entries: TraceRiverLog[] }
  | { type: "sources"; sources: SourceDescriptor[] }
  | { type: "sourceState"; id: string; state: SourceState; detail?: string | null }
  | { type: "dropped"; count: number }
  | { type: "cleared" };

export type ClientToServerMessage =
  | { type: "subscribe"; sourceIds: string[] }
  | { type: "unsubscribe"; sourceIds: string[] }
  | { type: "clear" };
