/**
 * Shapes mirrored from docs/log-schema.md and
 * docs/specs/001-phase-1-core-console.md § API contract.
 *
 * These are intentionally re-declared here (not imported from src/shared)
 * because web/ is a self-contained lane per .claude/lanes.json — it does not
 * reach into src/. Keep in sync with the backend contract by hand.
 */

/** Normalized log levels, ordered by severity. */
export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL" | "UNKNOWN";

export const LOG_LEVELS: LogLevel[] = ["DEBUG", "INFO", "WARN", "ERROR", "FATAL", "UNKNOWN"];

export interface TraceRiverLog {
  /** Monotonic server-assigned id — also the replay cursor and React list key. */
  id: number;
  /** Normalized timestamp, epoch milliseconds UTC. */
  timestamp: number;
  /** The timestamp string exactly as it appeared in the source, if any. */
  rawTimestamp: string | null;
  /** Namespaced source id: "docker:mysql", "local:laravel", "file:dump.log". */
  source: string;
  level: LogLevel;
  /** First line of the entry — what the collapsed stream row displays. */
  message: string;
  /** Full multi-line body when the entry spans multiple raw lines. */
  body: string | null;
  /** Structured extras a parser extracted. */
  context: Record<string, unknown> | null;
  /** The untouched raw text of the entry (post ANSI-strip, pre-parse). */
  raw: string;
  /** True when body holds aggregated continuation lines. */
  multiline: boolean;
}

/** Phase-1 generic SourceDescriptor shape (spec 001 § API contract),
 *  extended by spec 002 § API contract with the optional `docker` field. */
export interface SourceDescriptor {
  /** Namespaced id, matches TraceRiverLog.source exactly, e.g. "file:dump.log". */
  id: string;
  /** Phase 1 only ever produces "file"; phase 2 adds "docker"; "local" reserved for phase 3. */
  kind: "file" | "docker" | "local";
  /** Display name, e.g. "dump.log". */
  label: string;
  /** Checkbox state. For "docker" sources this is server-global state, shared
   *  across every connected tab (spec 002 § Interaction specs — Decision 5),
   *  not a per-connection delivery flag as it is for files. */
  subscribed: boolean;
  /** Toggle state — client-side only, purely filters rendering. */
  visible: boolean;
  /** Authoritative total as of this message. */
  entryCount: number;
  /** "live" while streaming/parsing; "stopped" once complete; "error" if failed. */
  state: "live" | "stopped" | "error";
  /** Human-readable detail for "error" (and optionally "stopped") states. */
  detail: string | null;
  /** Epoch ms — sidebar sort order (oldest first). */
  createdAt: number;
  /** Present only when kind === "docker" (spec 002 § API contract).
   *  `inCurrentProject` drives the default "Show all containers" render
   *  filter — a purely client-side decision, never a discovery-time exclusion. */
  docker?: {
    image: string;
    composeProject: string | null;
    composeService: string | null;
    inCurrentProject: boolean;
  };
}

/** Docker daemon connectivity, mirrored WS-push + `GET /api/docker/status`
 *  (spec 002 § API contract). */
export type DockerStatus = "not_installed" | "not_running" | "permission_denied" | "connected";

/** Server -> client WS message shapes (architecture.md + spec 001/002 extensions). */
export type ServerMessage =
  | { type: "entries"; entries: TraceRiverLog[] }
  | { type: "sources"; sources: SourceDescriptor[] }
  | { type: "sourceState"; id: string; state: SourceDescriptor["state"]; detail?: string | null }
  | { type: "dropped"; count: number }
  | { type: "cleared" }
  | { type: "dockerStatus"; status: DockerStatus; detail: string | null };

/** Client -> server WS message shapes. */
export type ClientMessage =
  | { type: "subscribe"; sourceIds: string[] }
  | { type: "unsubscribe"; sourceIds: string[] }
  | { type: "clear" };

export interface StatusResponse {
  version: string;
  port: number;
  bufferCapacity: number;
  bufferUsed: number;
  uptimeMs: number;
  /** Resolved `docker.allContainers` config / `--all-containers` flag —
   *  seeds the "Show all containers" toggle's initial state (spec 002). */
  dockerAllContainersDefault: boolean;
}
