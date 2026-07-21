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

/** "pending" added by spec 003 § API contract — produced only by
 *  `kind: "local"` sources whose target file doesn't exist yet. Docker and
 *  file-upload sources never use it; their existing three-value lifecycles
 *  are unchanged. */
export type SourceState = "live" | "stopped" | "error" | "pending";

/** Phase-1 generic SourceDescriptor shape (spec 001 § API contract),
 *  extended by spec 002 § API contract with the optional `docker` field, and
 *  by spec 003 § API contract with the optional `local` field + the
 *  `"pending"` state value. */
export interface SourceDescriptor {
  /** Namespaced id, matches TraceRiverLog.source exactly, e.g. "file:dump.log". */
  id: string;
  /** Phase 1 only ever produces "file"; phase 2 adds "docker"; phase 3 activates "local". */
  kind: "file" | "docker" | "local";
  /** Display name, e.g. "dump.log". */
  label: string;
  /** Checkbox state. For "docker" sources this is server-global state, shared
   *  across every connected tab (spec 002 § Interaction specs — Decision 5),
   *  not a per-connection delivery flag as it is for files and `kind: "local"`
   *  sources (spec 003 § API contract — local subscription is per-connection,
   *  like files, with one carve-out: `local.origin === "environment"` sources
   *  start unsubscribed on every fresh connection). */
  subscribed: boolean;
  /** Toggle state — client-side only, purely filters rendering. */
  visible: boolean;
  /** Authoritative total as of this message. */
  entryCount: number;
  /** "live" while streaming/parsing; "stopped" once complete/disappeared;
   *  "error" if failed; "pending" (local sources only) while waiting for the
   *  target file to be created. */
  state: SourceState;
  /** Human-readable detail for "error" (and optionally "stopped"/"pending") states. */
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
  /** Present only when kind === "local" (spec 003 § API contract). Drives
   *  sidebar section placement (Files vs Environment) and the row tooltip. */
  local?: {
    /** "project"/"config" render in Files; "environment" renders in Environment. */
    origin: "project" | "environment" | "config";
    /** Matched detector name, e.g. "laravel", "herd" — null for a bespoke
     *  traceriver.json watch entry with no matching detector. */
    detector: string | null;
    /** Resolved absolute path this source tails. */
    targetPath: string;
  };
}

/** Docker daemon connectivity, mirrored WS-push + `GET /api/docker/status`
 *  (spec 002 § API contract). */
export type DockerStatus = "not_installed" | "not_running" | "permission_denied" | "connected";

/** A fingerprint match from server-startup discovery (spec 003 § API
 *  contract). Every matched detector appears here, including ones with
 *  `hasFileTarget: true` (whose `SourceDescriptor` row already covers the
 *  UI — this array entry exists for completeness / phase 4). */
export interface DetectedFramework {
  detector: "laravel" | "symfony" | "nextjs" | "go" | "rails" | "django" | "wordpress";
  /** Display name, e.g. "Next.js", "Go". */
  label: string;
  /** False for a detector matched but with no default file target
   *  (nextjs/go/django per the phase doc) — drives the Files-section
   *  no-file-target informational note. */
  hasFileTarget: boolean;
  /** Guidance copy, present only when hasFileTarget is false. */
  note: string | null;
}

/** Server -> client WS message shapes (architecture.md + spec 001/002/003 extensions). */
export type ServerMessage =
  | { type: "entries"; entries: TraceRiverLog[] }
  | { type: "sources"; sources: SourceDescriptor[] }
  | { type: "sourceState"; id: string; state: SourceState; detail?: string | null }
  | { type: "dropped"; count: number }
  | { type: "cleared" }
  | { type: "dockerStatus"; status: DockerStatus; detail: string | null }
  | { type: "discovery"; frameworks: DetectedFramework[] };

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
