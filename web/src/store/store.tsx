import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { TraceRiverSocket, type ConnectionState } from "../api/ws";
import { getReplay, getStatus, uploadFile as restUploadFile, ApiError } from "../api/rest";
import {
  LOG_LEVELS,
  type DetectedFramework,
  type DockerStatus,
  type LogLevel,
  type ServerMessage,
  type SourceDescriptor,
  type TraceRiverLog,
} from "../types";
import { HARD_CAP_BYTES, SOFT_WARN_BYTES, formatMB } from "../utils/format";

/** Default ring-buffer capacity (architecture.md § Memory model) — used
 *  until GET /api/status resolves with the authoritative value. */
const DEFAULT_BUFFER_CAPACITY = 50_000;

/** How often (ms) the freeze-accumulation count is announced to the
 *  visually-hidden live region while frozen — "at most every few seconds,
 *  not per-entry" (spec 001 § Accessibility). */
const FREEZE_ANNOUNCE_INTERVAL_MS = 4000;

const TOAST_AUTO_DISMISS_MS = 2000;

const DOCKER_FAILURE_STATUSES: DockerStatus[] = ["not_installed", "not_running", "permission_denied"];

/** Grace window (ms), started once the WS reaches "connected", to wait for
 *  either Docker-enabled signal (a `dockerStatus` message or a `kind:
 *  "docker"` source) before concluding Docker is disabled server-side. The
 *  server always sends the source list immediately on connect and, when
 *  `docker.enabled`, the `dockerStatus` message right behind it in the same
 *  handler (see `src/server/ws.ts` `onConnection`) — both land within one
 *  network round trip of each other, so this only needs to be long enough to
 *  absorb that jitter, not to wait out anything user-perceptible. Design
 *  review 002 Finding 2: without this, a fresh connection with zero matching
 *  containers and no file sources had no signal to distinguish "still
 *  finding out" from "disabled," so the sidebar rendered phase‑1's flat
 *  fallback instead of the spec'd sectioned "Checking Docker…" state. */
const DOCKER_SETTLE_GUARD_MS = 400;

/** Same "absence-means-disabled" guard, applied to spec 003's `discovery`
 *  WS message (§ WS connection sequence: sent right after `dockerStatus`,
 *  within the same connection handler / network round trip). Mirrors
 *  `DOCKER_SETTLE_GUARD_MS`'s rationale exactly — long enough to absorb
 *  normal jitter, not to wait out anything user-perceptible. */
const DISCOVERY_SETTLE_GUARD_MS = 400;

function dockerStatusAnnouncement(status: DockerStatus): string {
  switch (status) {
    case "not_installed":
      return "Docker not detected.";
    case "not_running":
      return "Docker not running.";
    case "permission_denied":
      return "Docker permission denied.";
    case "connected":
      return "";
  }
}

/** Mirrors `--debounce-search` (design-system.md § Motion) — CSS custom
 *  properties aren't readable as plain numbers from JS, so this is kept in
 *  sync by hand. */
const SEARCH_DEBOUNCE_MS = 250;

export interface UploadProgress {
  id: string;
  filename: string;
  loadedBytes: number;
  totalBytes: number;
}

interface ToastState {
  id: number;
  message: string;
  /** Auto-dismiss after this many ms; omit for toasts dismissed explicitly
   *  (e.g. the dropped-entries resync toast, dismissed once resync completes). */
  autoDismissMs?: number;
}

export interface AppState {
  connection: ConnectionState;
  entries: TraceRiverLog[];
  sources: Record<string, SourceDescriptor>;
  sourceOrder: string[];
  expandedIds: Set<number>;
  searchInput: string;
  searchQuery: string;
  activeLevels: Set<LogLevel>;
  frozen: boolean;
  frozenAt: number | null;
  pinned: boolean;
  bufferCapacity: number;
  toast: ToastState | null;
  announcement: string;
  uploads: Record<string, UploadProgress>;
  /** `null` until the first `dockerStatus` message ever arrives (or a
   *  docker-kind source is seen in `sources`) — see `useDockerAvailability`.
   *  Absence of both signals for the life of the connection means
   *  `docker.enabled: false` server-side (spec 002 § Layout). */
  dockerStatus: DockerStatus | null;
  dockerStatusDetail: string | null;
  /** Tri-state read of whether Docker is enabled server-side, inferred
   *  purely from the two signals the protocol already sends (no new API
   *  field — design review 002 explicitly ratified inference over an
   *  explicit flag): "unknown" until either a `dockerStatus` message or a
   *  `kind: "docker"` source has been seen, or the post-connect settle guard
   *  gives up waiting for both (see `DOCKER_SETTLE_GUARD_MS`); "enabled"/
   *  "disabled" are terminal for the life of the page (`docker.enabled`
   *  can't change at runtime) — see `useDockerAvailability`. */
  dockerAvailability: "unknown" | "enabled" | "disabled";
  /** Status-card dismissals are per-status-value and session-only, never
   *  sent to the server (spec 002 § Components & states — Docker status card). */
  dismissedDockerStatuses: Set<DockerStatus>;
  /** "Show all containers" — purely client-side render filter (spec 002
   *  Decision 1); seeded once from `GET /api/status`'s
   *  `dockerAllContainersDefault`, then left alone once the user toggles it. */
  showAllContainers: boolean;
  showAllContainersTouched: boolean;
  /** Populated by the WS `discovery` message (spec 003 § API contract) —
   *  empty until it arrives (indistinguishable, by design, from "discovery
   *  ran and found nothing"; see `useFrameworks`). */
  frameworks: DetectedFramework[];
  /** Tri-state read of whether discovery is enabled server-side, inferred
   *  the same way as `dockerAvailability`: "unknown" until either a
   *  `discovery` message has been seen or the post-connect settle guard
   *  gives up waiting for one (see `DISCOVERY_SETTLE_GUARD_MS`); "enabled"/
   *  "disabled" are terminal for the life of the page. */
  discoveryAvailability: "unknown" | "enabled" | "disabled";
}

const initialState: AppState = {
  connection: "connecting",
  entries: [],
  sources: {},
  sourceOrder: [],
  expandedIds: new Set(),
  searchInput: "",
  searchQuery: "",
  activeLevels: new Set(LOG_LEVELS),
  frozen: false,
  frozenAt: null,
  pinned: true,
  bufferCapacity: DEFAULT_BUFFER_CAPACITY,
  toast: null,
  announcement: "",
  uploads: {},
  dockerStatus: null,
  dockerStatusDetail: null,
  dockerAvailability: "unknown",
  dismissedDockerStatuses: new Set(),
  showAllContainers: false,
  showAllContainersTouched: false,
  frameworks: [],
  discoveryAvailability: "unknown",
};

type Action =
  | { type: "SET_CONNECTION"; state: ConnectionState }
  | { type: "MERGE_ENTRIES"; entries: TraceRiverLog[] }
  | { type: "REPLACE_SOURCES"; sources: SourceDescriptor[] }
  | { type: "UPSERT_SOURCE"; source: SourceDescriptor }
  | { type: "SOURCE_STATE"; id: string; state: SourceDescriptor["state"]; detail: string | null }
  | { type: "CLEAR_STREAM" }
  | { type: "SET_BUFFER_CAPACITY"; capacity: number }
  | { type: "SET_SEARCH_INPUT"; value: string }
  | { type: "SET_SEARCH_QUERY"; value: string }
  | { type: "TOGGLE_LEVEL"; level: LogLevel }
  | { type: "RESET_FILTERS" }
  | { type: "SET_SOURCE_SUBSCRIBED"; id: string; subscribed: boolean }
  | { type: "SET_SOURCE_VISIBLE"; id: string; visible: boolean }
  | { type: "TOGGLE_EXPANDED"; id: number }
  | { type: "FREEZE" }
  | { type: "UNFREEZE" }
  | { type: "SET_PINNED"; pinned: boolean }
  | { type: "SHOW_TOAST"; message: string; autoDismissMs?: number }
  | { type: "DISMISS_TOAST" }
  | { type: "SET_ANNOUNCEMENT"; message: string }
  | { type: "UPLOAD_STARTED"; id: string; filename: string; totalBytes: number }
  | { type: "UPLOAD_PROGRESS"; id: string; loadedBytes: number; totalBytes: number }
  | { type: "UPLOAD_SETTLED"; id: string }
  | { type: "SET_DOCKER_STATUS"; status: DockerStatus; detail: string | null }
  | { type: "SET_SHOW_ALL_CONTAINERS_DEFAULT"; value: boolean }
  | { type: "TOGGLE_SHOW_ALL_CONTAINERS" }
  | { type: "DISMISS_DOCKER_STATUS_CARD"; status: DockerStatus }
  | { type: "SETTLE_DOCKER_AVAILABILITY"; value: "enabled" | "disabled" }
  | { type: "SET_DISCOVERY"; frameworks: DetectedFramework[] }
  | { type: "SETTLE_DISCOVERY_AVAILABILITY"; value: "enabled" | "disabled" };

function sortedSourceOrder(sources: Record<string, SourceDescriptor>): string[] {
  return Object.values(sources)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((s) => s.id);
}

/** `dockerAvailability` only ever moves out of "unknown" once, in whichever
 *  direction is learned first — `docker.enabled` can't flip at runtime, so
 *  neither a later `dockerStatus` message nor the settle-guard timeout
 *  should ever override an already-settled value (see `useDockerAvailability`). */
function withDockerAvailabilityFromSources(
  current: AppState["dockerAvailability"],
  sources: Record<string, SourceDescriptor>,
): AppState["dockerAvailability"] {
  if (current !== "unknown") return current;
  return Object.values(sources).some((s) => s.kind === "docker") ? "enabled" : current;
}

/** Merge new entries, deduping against anything already stored by id (a
 *  fresh WS connection always replays the ring buffer from the top, so a
 *  reconnect after a drop will re-deliver entries we already have), then
 *  trims from the front to the client-side buffer cap (architecture.md §
 *  Memory model: "Client store: mirrors the same cap"). */
function mergeEntries(
  existing: TraceRiverLog[],
  incoming: TraceRiverLog[],
  capacity: number,
): TraceRiverLog[] {
  if (incoming.length === 0) return existing;
  const lastId = existing.length > 0 ? existing[existing.length - 1].id : -Infinity;
  const fresh = incoming.filter((e) => e.id > lastId);
  if (fresh.length === 0) return existing;
  const merged = existing.length > 0 ? existing.concat(fresh) : fresh;
  if (merged.length <= capacity) return merged;
  return merged.slice(merged.length - capacity);
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "SET_CONNECTION":
      return { ...state, connection: action.state };

    case "MERGE_ENTRIES": {
      const entries = mergeEntries(state.entries, action.entries, state.bufferCapacity);
      if (entries === state.entries) return state;
      return { ...state, entries };
    }

    case "REPLACE_SOURCES": {
      const sources: Record<string, SourceDescriptor> = {};
      for (const incoming of action.sources) {
        const prior = state.sources[incoming.id];
        if (!prior) {
          sources[incoming.id] = incoming;
          continue;
        }
        // `visible` is client-rendering-only state the server protocol has
        // no message to push updates for (see store/store.tsx header note
        // near TraceRiverSocket usage) — preserve our local value across
        // authoritative source-list refreshes so a toggle isn't clobbered.
        //
        // entryCount: while unsubscribed, freeze the displayed count rather
        // than taking the server's value verbatim — acceptance criterion 14
        // ("the count for that source stops climbing") is a client-visible
        // guarantee; entryCount resumes tracking the server value once
        // re-subscribed.
        sources[incoming.id] = {
          ...incoming,
          visible: prior.visible,
          entryCount: incoming.subscribed ? incoming.entryCount : prior.entryCount,
        };
      }
      return {
        ...state,
        sources,
        sourceOrder: sortedSourceOrder(sources),
        dockerAvailability: withDockerAvailabilityFromSources(state.dockerAvailability, sources),
      };
    }

    case "UPSERT_SOURCE": {
      const prior = state.sources[action.source.id];
      const merged = prior
        ? {
            ...action.source,
            visible: prior.visible,
            entryCount: action.source.subscribed ? action.source.entryCount : prior.entryCount,
          }
        : action.source;
      const sources = { ...state.sources, [action.source.id]: merged };
      return {
        ...state,
        sources,
        sourceOrder: sortedSourceOrder(sources),
        dockerAvailability: withDockerAvailabilityFromSources(state.dockerAvailability, sources),
      };
    }

    case "SOURCE_STATE": {
      const prior = state.sources[action.id];
      if (!prior) return state;
      const sources = {
        ...state.sources,
        [action.id]: { ...prior, state: action.state, detail: action.detail },
      };
      return { ...state, sources };
    }

    case "CLEAR_STREAM":
      return {
        ...state,
        entries: [],
        expandedIds: new Set(),
        frozen: false,
        frozenAt: null,
        pinned: true,
      };

    case "SET_BUFFER_CAPACITY":
      return { ...state, bufferCapacity: action.capacity };

    case "SET_SEARCH_INPUT":
      return { ...state, searchInput: action.value };

    case "SET_SEARCH_QUERY":
      return { ...state, searchQuery: action.value };

    case "TOGGLE_LEVEL": {
      const next = new Set(state.activeLevels);
      if (next.has(action.level)) next.delete(action.level);
      else next.add(action.level);
      return { ...state, activeLevels: next };
    }

    case "RESET_FILTERS":
      return {
        ...state,
        searchInput: "",
        searchQuery: "",
        activeLevels: new Set(LOG_LEVELS),
      };

    case "SET_SOURCE_SUBSCRIBED": {
      const prior = state.sources[action.id];
      if (!prior) return state;
      const sources = { ...state.sources, [action.id]: { ...prior, subscribed: action.subscribed } };
      return { ...state, sources };
    }

    case "SET_SOURCE_VISIBLE": {
      const prior = state.sources[action.id];
      if (!prior || !prior.subscribed) return state;
      const sources = { ...state.sources, [action.id]: { ...prior, visible: action.visible } };
      return { ...state, sources };
    }

    case "TOGGLE_EXPANDED": {
      const next = new Set(state.expandedIds);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      return { ...state, expandedIds: next };
    }

    case "FREEZE":
      return { ...state, frozen: true, frozenAt: state.entries.length };

    case "UNFREEZE":
      return { ...state, frozen: false, frozenAt: null, pinned: true };

    case "SET_PINNED":
      return { ...state, pinned: action.pinned };

    case "SHOW_TOAST":
      return {
        ...state,
        toast: { id: Date.now(), message: action.message, autoDismissMs: action.autoDismissMs },
      };

    case "DISMISS_TOAST":
      return { ...state, toast: null };

    case "SET_ANNOUNCEMENT":
      return { ...state, announcement: action.message };

    case "UPLOAD_STARTED":
      return {
        ...state,
        uploads: {
          ...state.uploads,
          [action.id]: { id: action.id, filename: action.filename, loadedBytes: 0, totalBytes: action.totalBytes },
        },
      };

    case "UPLOAD_PROGRESS": {
      const prior = state.uploads[action.id];
      if (!prior) return state;
      return {
        ...state,
        uploads: {
          ...state.uploads,
          [action.id]: { ...prior, loadedBytes: action.loadedBytes, totalBytes: action.totalBytes },
        },
      };
    }

    case "UPLOAD_SETTLED": {
      if (!(action.id in state.uploads)) return state;
      const uploads = { ...state.uploads };
      delete uploads[action.id];
      return { ...state, uploads };
    }

    case "SET_DOCKER_STATUS":
      return {
        ...state,
        dockerStatus: action.status,
        dockerStatusDetail: action.detail,
        dockerAvailability: "enabled",
      };

    case "SETTLE_DOCKER_AVAILABILITY":
      if (state.dockerAvailability !== "unknown") return state;
      return { ...state, dockerAvailability: action.value };

    case "SET_SHOW_ALL_CONTAINERS_DEFAULT":
      if (state.showAllContainersTouched) return state;
      return { ...state, showAllContainers: action.value };

    case "TOGGLE_SHOW_ALL_CONTAINERS":
      return { ...state, showAllContainers: !state.showAllContainers, showAllContainersTouched: true };

    case "DISMISS_DOCKER_STATUS_CARD": {
      const next = new Set(state.dismissedDockerStatuses);
      next.add(action.status);
      return { ...state, dismissedDockerStatuses: next };
    }

    case "SET_DISCOVERY":
      return { ...state, frameworks: action.frameworks, discoveryAvailability: "enabled" };

    case "SETTLE_DISCOVERY_AVAILABILITY":
      if (state.discoveryAvailability !== "unknown") return state;
      return { ...state, discoveryAvailability: action.value };

    default:
      return state;
  }
}

export interface AppActions {
  setSearchInput: (value: string) => void;
  clearSearch: () => void;
  toggleLevel: (level: LogLevel) => void;
  resetFilters: () => void;
  setSourceSubscribed: (id: string, subscribed: boolean) => void;
  setSourceVisible: (id: string, visible: boolean) => void;
  toggleExpanded: (id: number) => void;
  freeze: () => void;
  unfreeze: () => void;
  setPinned: (pinned: boolean) => void;
  clearLogs: () => void;
  dismissToast: () => void;
  startUpload: (file: File) => Promise<void>;
  toggleShowAllContainers: () => void;
  dismissDockerStatusCard: (status: DockerStatus) => void;
}

interface AppStoreContextValue {
  state: AppState;
  actions: AppActions;
}

const AppStoreContext = createContext<AppStoreContextValue | null>(null);

function describeUploadError(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string; message?: string; limitBytes?: number } | null;
    if (body?.error === "payload_too_large") {
      return "This file is over the 500 MB limit and can't be loaded.";
    }
    if (body?.error === "bad_request") {
      return body.message ?? "The upload was rejected.";
    }
    if (body?.error === "unauthorized") {
      return "Invalid or expired session.";
    }
    return `Upload failed (${err.status}).`;
  }
  return "Upload failed.";
}

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const socketRef = useRef<TraceRiverSocket | null>(null);
  const lastIdRef = useRef<number>(-Infinity);
  const resyncInFlightRef = useRef(false);
  const resyncPendingRef = useRef(false);
  // Mirrors state.sources, updated after every render — read inside the WS
  // message handler (whose closure is fixed at mount) to know a source's
  // *prior* value when a docker sourceState/dockerStatus transition arrives
  // (spec 002 § Accessibility — announce transitions, not steady states).
  const sourcesRef = useRef<Record<string, SourceDescriptor>>({});
  const dockerStatusRef = useRef<DockerStatus | null>(null);
  // Mirrors state.dockerAvailability — read (and cleared) from the settle-
  // guard timeout below, whose closure is fixed at mount (design review 002
  // Finding 2 / see DOCKER_SETTLE_GUARD_MS).
  const dockerAvailabilityRef = useRef<AppState["dockerAvailability"]>("unknown");
  const dockerSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirrors state.discoveryAvailability — same purpose as the docker refs
  // above, applied to spec 003's `discovery` message settle guard.
  const discoveryAvailabilityRef = useRef<AppState["discoveryAvailability"]>("unknown");
  const discoverySettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    lastIdRef.current = state.entries.length > 0 ? state.entries[state.entries.length - 1].id : -Infinity;
  }, [state.entries]);

  useEffect(() => {
    sourcesRef.current = state.sources;
  }, [state.sources]);

  useEffect(() => {
    dockerAvailabilityRef.current = state.dockerAvailability;
    // Once settled (in either direction), the guard timer has nothing left
    // to do — clear it so it can't fire a no-op after unmount races.
    if (state.dockerAvailability !== "unknown" && dockerSettleTimerRef.current) {
      clearTimeout(dockerSettleTimerRef.current);
      dockerSettleTimerRef.current = null;
    }
  }, [state.dockerAvailability]);

  useEffect(() => {
    discoveryAvailabilityRef.current = state.discoveryAvailability;
    if (state.discoveryAvailability !== "unknown" && discoverySettleTimerRef.current) {
      clearTimeout(discoverySettleTimerRef.current);
      discoverySettleTimerRef.current = null;
    }
  }, [state.discoveryAvailability]);

  // --- WS connection lifecycle -------------------------------------------
  useEffect(() => {
    // Resyncs against the latest known id at call time. If a second
    // `dropped` notice arrives while a resync is already in flight, it's
    // queued (not dropped) so the gap it describes still gets backfilled
    // once the current request finishes.
    function runResync() {
      resyncInFlightRef.current = true;
      const after = lastIdRef.current === -Infinity ? 0 : lastIdRef.current;
      getReplay(after)
        .then((res) => {
          dispatch({ type: "MERGE_ENTRIES", entries: res.entries });
        })
        .catch(() => {
          // Another attempt will run on the next `dropped` notice or
          // reconnect; nothing else actionable client-side.
        })
        .finally(() => {
          resyncInFlightRef.current = false;
          if (resyncPendingRef.current) {
            resyncPendingRef.current = false;
            runResync();
          } else {
            dispatch({ type: "DISMISS_TOAST" });
          }
        });
    }

    const socket = new TraceRiverSocket({
      onStateChange: (connState: ConnectionState) => {
        dispatch({ type: "SET_CONNECTION", state: connState });
        // Design review 002 Finding 2: once the WS has actually connected,
        // the server sends `sources` (always) and, if `docker.enabled`,
        // `dockerStatus` right behind it — both arrive within one round
        // trip of each other. If dockerAvailability is still "unknown"
        // DOCKER_SETTLE_GUARD_MS after connecting, no dockerStatus is
        // coming and no docker source exists, so `docker.enabled: false`
        // is the only remaining explanation — settle to "disabled" so the
        // sidebar falls back to the flat phase-1 layout instead of getting
        // stuck showing "Checking Docker…" forever (including against a
        // stale phase-1 build that never sends `dockerStatus` at all).
        if (connState === "connected" && dockerAvailabilityRef.current === "unknown") {
          if (dockerSettleTimerRef.current) clearTimeout(dockerSettleTimerRef.current);
          dockerSettleTimerRef.current = setTimeout(() => {
            dockerSettleTimerRef.current = null;
            dispatch({ type: "SETTLE_DOCKER_AVAILABILITY", value: "disabled" });
          }, DOCKER_SETTLE_GUARD_MS);
        }
        // Same guard, applied to spec 003's `discovery` message — its
        // absence for the life of the connection means `discovery.enabled:
        // false` server-side (§ WS connection sequence).
        if (connState === "connected" && discoveryAvailabilityRef.current === "unknown") {
          if (discoverySettleTimerRef.current) clearTimeout(discoverySettleTimerRef.current);
          discoverySettleTimerRef.current = setTimeout(() => {
            discoverySettleTimerRef.current = null;
            dispatch({ type: "SETTLE_DISCOVERY_AVAILABILITY", value: "disabled" });
          }, DISCOVERY_SETTLE_GUARD_MS);
        }
      },
      onMessage: (msg: ServerMessage) => {
        switch (msg.type) {
          case "entries":
            dispatch({ type: "MERGE_ENTRIES", entries: msg.entries });
            break;
          case "sources":
            dispatch({ type: "REPLACE_SOURCES", sources: msg.sources });
            break;
          case "sourceState": {
            // Look up the *prior* value before dispatching — needed to
            // detect a subscribed docker source's live<->stopped transition
            // for the live-region announcement (spec 002 § Accessibility).
            const prior = sourcesRef.current[msg.id];
            dispatch({ type: "SOURCE_STATE", id: msg.id, state: msg.state, detail: msg.detail ?? null });
            if (prior && prior.kind === "docker" && prior.subscribed && prior.state !== msg.state) {
              if (msg.state === "stopped" && prior.state === "live") {
                dispatch({ type: "SET_ANNOUNCEMENT", message: `${prior.label} stopped.` });
              } else if (msg.state === "live" && prior.state === "stopped") {
                dispatch({ type: "SET_ANNOUNCEMENT", message: `${prior.label} restarted.` });
              }
            }
            // Spec 003 § Accessibility — a *subscribed* local source's
            // pending->live (first-ever appearance) or stopped->live (file
            // reappearing) transition, and its live->stopped transition, are
            // announced; unsubscribed sources' lifecycle is never announced.
            if (prior && prior.kind === "local" && prior.subscribed && prior.state !== msg.state) {
              if (msg.state === "live" && (prior.state === "pending" || prior.state === "stopped")) {
                dispatch({ type: "SET_ANNOUNCEMENT", message: `${prior.label} started streaming.` });
              } else if (msg.state === "stopped" && prior.state === "live") {
                dispatch({ type: "SET_ANNOUNCEMENT", message: `${prior.label} stopped — file not found.` });
              }
            }
            break;
          }
          case "dockerStatus": {
            const prevStatus = dockerStatusRef.current;
            dockerStatusRef.current = msg.status;
            dispatch({ type: "SET_DOCKER_STATUS", status: msg.status, detail: msg.detail ?? null });

            if (msg.status === "connected") {
              // "Docker connected" toast + announcement only on a
              // mid-session recovery transition (spec 002 Decision 3) —
              // silent on a normal first connect (prevStatus === null).
              if (prevStatus !== null && DOCKER_FAILURE_STATUSES.includes(prevStatus)) {
                const count = Object.values(sourcesRef.current).filter((s) => s.kind === "docker").length;
                const message = `Docker connected — ${count} container(s) found`;
                dispatch({ type: "SHOW_TOAST", message, autoDismissMs: TOAST_AUTO_DISMISS_MS });
                dispatch({ type: "SET_ANNOUNCEMENT", message });
              }
            } else if (prevStatus !== msg.status) {
              // Transition *into* a (new) failure status — announce once,
              // not on every 10s poll tick that repeats the same value.
              dispatch({ type: "SET_ANNOUNCEMENT", message: dockerStatusAnnouncement(msg.status) });
            }
            break;
          }
          case "discovery":
            // Sent once, at connect time, never rebroadcast mid-session
            // (spec 003 § WS connection sequence) — no announcement/toast on
            // arrival (spec 003 Decision 6: silence is correct here too).
            dispatch({ type: "SET_DISCOVERY", frameworks: msg.frameworks });
            break;
          case "dropped":
            dispatch({ type: "SHOW_TOAST", message: `${msg.count} entries dropped — resyncing…` });
            dispatch({ type: "SET_ANNOUNCEMENT", message: `${msg.count} entries dropped, resyncing` });
            if (resyncInFlightRef.current) {
              resyncPendingRef.current = true;
            } else {
              runResync();
            }
            break;
          case "cleared":
            dispatch({ type: "CLEAR_STREAM" });
            dispatch({ type: "SHOW_TOAST", message: "Logs cleared", autoDismissMs: TOAST_AUTO_DISMISS_MS });
            dispatch({ type: "SET_ANNOUNCEMENT", message: "Logs cleared" });
            break;
        }
      },
    });
    socketRef.current = socket;
    socket.start();
    return () => {
      socket.close();
      if (dockerSettleTimerRef.current) {
        clearTimeout(dockerSettleTimerRef.current);
        dockerSettleTimerRef.current = null;
      }
      if (discoverySettleTimerRef.current) {
        clearTimeout(discoverySettleTimerRef.current);
        discoverySettleTimerRef.current = null;
      }
    };
  }, []);

  // --- Initial buffer capacity + "Show all containers" default -----------
  useEffect(() => {
    getStatus()
      .then((status) => {
        dispatch({ type: "SET_BUFFER_CAPACITY", capacity: status.bufferCapacity });
        dispatch({ type: "SET_SHOW_ALL_CONTAINERS_DEFAULT", value: status.dockerAllContainersDefault });
      })
      .catch(() => {
        // Keep the architecture.md default; connection state UI already
        // surfaces auth/connectivity failures.
      });
  }, []);

  // --- Debounced search commit --------------------------------------------
  useEffect(() => {
    const timer = setTimeout(() => {
      dispatch({ type: "SET_SEARCH_QUERY", value: state.searchInput });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [state.searchInput]);

  // --- Toast auto-dismiss ---------------------------------------------------
  useEffect(() => {
    if (!state.toast || state.toast.autoDismissMs === undefined) return;
    const timer = setTimeout(() => dispatch({ type: "DISMISS_TOAST" }), state.toast.autoDismissMs);
    return () => clearTimeout(timer);
  }, [state.toast]);

  // --- Freeze accumulation announcements ------------------------------------
  useEffect(() => {
    if (!state.frozen) return;
    const interval = setInterval(() => {
      const newCount = state.entries.length - (state.frozenAt ?? state.entries.length);
      if (newCount > 0) {
        dispatch({ type: "SET_ANNOUNCEMENT", message: `${newCount} new entries available` });
      }
    }, FREEZE_ANNOUNCE_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.frozen, state.frozenAt, state.entries.length]);

  const actions = useMemo<AppActions>(
    () => ({
      setSearchInput: (value) => dispatch({ type: "SET_SEARCH_INPUT", value }),
      clearSearch: () => {
        dispatch({ type: "SET_SEARCH_INPUT", value: "" });
        dispatch({ type: "SET_SEARCH_QUERY", value: "" });
      },
      toggleLevel: (level) => dispatch({ type: "TOGGLE_LEVEL", level }),
      resetFilters: () => dispatch({ type: "RESET_FILTERS" }),
      setSourceSubscribed: (id, subscribed) => {
        dispatch({ type: "SET_SOURCE_SUBSCRIBED", id, subscribed });
        socketRef.current?.send({ type: subscribed ? "subscribe" : "unsubscribe", sourceIds: [id] });
      },
      setSourceVisible: (id, visible) => dispatch({ type: "SET_SOURCE_VISIBLE", id, visible }),
      toggleExpanded: (id) => dispatch({ type: "TOGGLE_EXPANDED", id }),
      freeze: () => dispatch({ type: "FREEZE" }),
      unfreeze: () => dispatch({ type: "UNFREEZE" }),
      setPinned: (pinned) => dispatch({ type: "SET_PINNED", pinned }),
      clearLogs: () => {
        // The server broadcasts `cleared` to every connected tab, including
        // this one (spec 001 § WebSocket protocol) — the store empties and
        // the toast shows from that broadcast handler above, not here, so
        // behavior is identical whether this tab or another tab clicked.
        socketRef.current?.send({ type: "clear" });
      },
      dismissToast: () => dispatch({ type: "DISMISS_TOAST" }),
      toggleShowAllContainers: () => dispatch({ type: "TOGGLE_SHOW_ALL_CONTAINERS" }),
      dismissDockerStatusCard: (status) => dispatch({ type: "DISMISS_DOCKER_STATUS_CARD", status }),
      startUpload: async (file: File) => {
        if (file.size > HARD_CAP_BYTES) {
          window.alert("This file is over the 500 MB limit and can't be loaded.");
          return;
        }
        if (file.size > SOFT_WARN_BYTES) {
          const mb = formatMB(file.size);
          const proceed = window.confirm(
            `This file is ${mb} MB and will occupy most of the ring buffer — continue?`,
          );
          if (!proceed) return;
        }

        const id = `file:${file.name}`;
        const now = Date.now();
        dispatch({
          type: "UPSERT_SOURCE",
          source: {
            id,
            kind: "file",
            label: file.name,
            subscribed: true,
            visible: true,
            entryCount: 0,
            state: "live",
            detail: null,
            createdAt: now,
          },
        });
        dispatch({ type: "UPLOAD_STARTED", id, filename: file.name, totalBytes: file.size });

        const handle = restUploadFile(file, (loadedBytes, totalBytes) => {
          dispatch({ type: "UPLOAD_PROGRESS", id, loadedBytes, totalBytes });
        });

        try {
          const { source } = await handle.promise;
          dispatch({ type: "UPSERT_SOURCE", source });
        } catch (err) {
          dispatch({
            type: "UPSERT_SOURCE",
            source: {
              id,
              kind: "file",
              label: file.name,
              subscribed: true,
              visible: true,
              entryCount: 0,
              state: "error",
              detail: describeUploadError(err),
              createdAt: now,
            },
          });
        } finally {
          dispatch({ type: "UPLOAD_SETTLED", id });
        }
      },
    }),
    [],
  );

  const value = useMemo<AppStoreContextValue>(() => ({ state, actions }), [state, actions]);

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>;
}

export function useAppStore(): AppStoreContextValue {
  const ctx = useContext(AppStoreContext);
  if (!ctx) throw new Error("useAppStore must be used within AppStoreProvider");
  return ctx;
}

/** Entries after the freeze snapshot boundary (if frozen) and the active
 *  search/level/source-visibility filters — all three intersect (AND),
 *  per spec 001 § Interaction specs § Search & filtering. */
export function useVisibleEntries(): TraceRiverLog[] {
  const { state } = useAppStore();
  return useMemo(() => {
    const base = state.frozen && state.frozenAt !== null ? state.entries.slice(0, state.frozenAt) : state.entries;
    const q = state.searchQuery.trim().toLowerCase();
    return base.filter((entry) => {
      if (!state.activeLevels.has(entry.level)) return false;
      const source = state.sources[entry.source];
      if (source && !source.visible) return false;
      if (q) {
        const haystack = `${entry.message}\n${entry.body ?? ""}\n${entry.raw}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [state.entries, state.frozen, state.frozenAt, state.searchQuery, state.activeLevels, state.sources]);
}

/** True once the sum of sources' lifetime entry counts exceeds the ring
 *  buffer capacity — i.e. some entries are known to have been evicted.
 *  (See store/store.tsx module notes: the WS protocol has no explicit
 *  "eviction happened" signal, so this is inferred from SourceDescriptor
 *  .entryCount vs. GET /api/status's bufferCapacity — flagged as an
 *  interpretation in the frontend handoff.) */
export function useEvicted(): boolean {
  const { state } = useAppStore();
  return useMemo(() => {
    const total = Object.values(state.sources).reduce((sum, s) => sum + s.entryCount, 0);
    return total > state.bufferCapacity;
  }, [state.sources, state.bufferCapacity]);
}

export function useOrderedSources(): SourceDescriptor[] {
  const { state } = useAppStore();
  return useMemo(() => state.sourceOrder.map((id) => state.sources[id]).filter(Boolean), [state.sourceOrder, state.sources]);
}

/** Tri-state read of `state.dockerAvailability` (see `AppState` and the
 *  reducer's `withDockerAvailabilityFromSources`/`SETTLE_DOCKER_AVAILABILITY`
 *  handling): "enabled"/"disabled" are inferred purely from the two signals
 *  the protocol already sends — a `dockerStatus` message or a `kind:
 *  "docker"` source — never a new API field (design review 002 ratified
 *  inference over an explicit flag). "unknown" covers the brief window
 *  before either signal (or the settle-guard timeout) has resolved it; the
 *  Sidebar treats "unknown" the same as "enabled" (sectioned layout, with
 *  ContainersSection's own loading copy) so it never flashes phase-1's flat
 *  fallback before genuinely learning Docker is disabled (design review 002
 *  Finding 2). */
export function useDockerAvailability(): AppState["dockerAvailability"] {
  const { state } = useAppStore();
  return state.dockerAvailability;
}

export function useContainerSources(): SourceDescriptor[] {
  const ordered = useOrderedSources();
  return useMemo(() => ordered.filter((s) => s.kind === "docker"), [ordered]);
}

/** "Files" sub-section sources (spec 003 § Components & states): uploaded
 *  files plus `kind: "local"` sources whose `local.scope` is "project" or
 *  "config" — everything except environment-scope local sources. */
export function useFileSources(): SourceDescriptor[] {
  const ordered = useOrderedSources();
  return useMemo(
    () => ordered.filter((s) => s.kind === "file" || (s.kind === "local" && s.local?.origin !== "environment")),
    [ordered],
  );
}

/** "Environment" sub-section sources (spec 003 § Components & states):
 *  `kind: "local"` sources whose `local.scope` is "environment". */
export function useEnvironmentSources(): SourceDescriptor[] {
  const ordered = useOrderedSources();
  return useMemo(() => ordered.filter((s) => s.kind === "local" && s.local?.origin === "environment"), [ordered]);
}

/** The most recent `discovery` WS message's `frameworks` array — empty
 *  until it arrives, indistinguishable by design from "discovery ran and
 *  found nothing" (spec 003 § WS connection sequence: presence of the
 *  message, not the array's length, signals "discovery is on", and this
 *  frontend doesn't need to draw that distinction anywhere — see
 *  `useDiscoveryAvailability` for the one place it does). */
export function useFrameworks(): DetectedFramework[] {
  const { state } = useAppStore();
  return state.frameworks;
}

/** Tri-state read of `state.discoveryAvailability` — see `AppState` and the
 *  reducer's `SET_DISCOVERY`/`SETTLE_DISCOVERY_AVAILABILITY` handling.
 *  Consumed only by the sidebar's flat-vs-sectioned gate (spec 003 §
 *  Components & states — "Environment renders only when discovery.enabled
 *  is true and at least one environment-scope source was discovered" is
 *  otherwise fully derivable from `useEnvironmentSources` alone, since an
 *  environment-scope source can only exist when discovery is enabled). */
export function useDiscoveryAvailability(): AppState["discoveryAvailability"] {
  const { state } = useAppStore();
  return state.discoveryAvailability;
}
