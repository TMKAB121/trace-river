/**
 * File tailer — one implementation serves both auto-discovered targets and
 * explicit `traceriver.json` `watch` entries (docs/phases/
 * phase-3-auto-discovery.md § 3.3, docs/specs/003-phase-3-auto-discovery.md
 * § API contract / Interaction specs). `chokidar` supplies filesystem
 * change events (including native glob-pattern watching); this module owns
 * the read logic: start-at-EOF for pre-existing files, offset-tracked
 * incremental reads, truncation reset, rotation continuation, and
 * deleted-file resume — all funneled into one Uniform Parser Pipeline
 * instance per source, matching every other ingest adapter's shape.
 *
 * Reliability: chokidar's native fsevents/inotify events drive low-latency
 * reads; a 1s reconciliation poll independently re-checks every tracked
 * file's size against its stored offset and catches up on anything a native
 * watcher missed (phase doc § 3.3's "auto-fall back to polling... for paths
 * where fsevents/inotify are known-unreliable" — implemented here as an
 * always-on backstop rather than a mode the watcher switches into, which is
 * simpler and gives the same user-visible guarantee: no missed writes,
 * whichever mechanism actually catches a given change first).
 */
import { createReadStream, statSync } from "node:fs";
import type { Stats } from "node:fs";
import { dirname, basename, join } from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { SourcePipeline } from "../parsers/pipeline.js";
import { PARSER_BY_NAME } from "../parsers/formats/index.js";
import type { AppState } from "../server/app-state.js";
import type { SourceDescriptor, SourceState, TraceRiverLogInput } from "../shared/types.js";

const RECONCILE_POLL_MS = 1000;

/** Characters with special meaning in a glob (picomatch, chokidar's
 *  matcher) — deliberately narrow (matches the metacharacters this
 *  codebase's own detectors/config actually emit, e.g. laravel's
 *  `storage/logs/laravel*.log`) rather than every extglob token, so a
 *  literal path that happens to contain an unrelated character like `(` or
 *  `!` isn't misclassified as a glob. */
const GLOB_METACHARS = /[*?[\]{}]/;

/** Bracket-class characters that would break (or change the meaning of) a
 *  single-character `[x]` wrap if `x` were one of them. */
const UNSAFE_BRACKET_CHARS = new Set(["]", "^", "!", "-", "\\"]);

function isGlobPattern(pattern: string): boolean {
  return GLOB_METACHARS.test(pattern);
}

/**
 * chokidar's fsevents/inotify-backed watching of a *glob* pattern reliably
 * fires `"add"` when a matching file is later created — verified even when
 * the file (or its containing directory) doesn't exist yet at watch-setup
 * time. Watching a *literal, non-glob* path for a file that doesn't exist
 * yet never fires `"add"` when that file is later created, no matter how
 * long you wait (docs/qa/defects/003-phase-3-auto-discovery-1.md's isolated
 * bare-chokidar repro). Every project-root detector except Laravel's default
 * target is a literal path (Symfony/Rails/WordPress), as is every `watch`
 * config entry and the Valet/Homebrew environment-tier targets — so this
 * rewrites a literal pattern into a syntactically-a-glob pattern that still
 * matches exactly one path (a single character of the basename wrapped in a
 * `[..]` bracket class), routing it through chokidar's known-reliable
 * glob-watching code path while leaving every other assumption in this file
 * (one file per literal target, `winningPath` bookkeeping, etc.) unaffected
 * — the actual paths chokidar reports back are unchanged either way. A
 * pattern that's already a glob (e.g. Laravel's `storage/logs/laravel*.log`)
 * passes through unchanged.
 */
function toChokidarWatchPattern(pattern: string): string {
  if (isGlobPattern(pattern)) return pattern;
  const dir = dirname(pattern);
  const base = basename(pattern);
  const idx = [...base].findIndex((ch) => !UNSAFE_BRACKET_CHARS.has(ch));
  if (idx === -1) return pattern; // no safe character to bracket-wrap (e.g. an all-symbol basename) — fall back to the literal.
  const bracketed = `${base.slice(0, idx)}[${base[idx]}]${base.slice(idx + 1)}`;
  return join(dir, bracketed);
}

export interface TailTargetSpec {
  /** Full source id — "local:laravel", "herd:nginx-mysite.test", or the
   *  exact label from a traceriver.json watch entry. */
  sourceId: string;
  /** Absolute glob pattern or literal absolute path to watch. */
  pattern: string;
  local: NonNullable<SourceDescriptor["local"]>;
  /** Built-in parser name pinned by a config watch entry's "parser" field
   *  (already validated against the known built-in names — see
   *  src/discovery/index.ts); undefined runs normal per-source detection. */
  parserName?: string;
}

interface TrackedFile {
  offset: number;
  mtimeMs: number;
}

/** `kind: "local"` sources deliberately break from file/docker's "label is
 *  the part after the colon" convention (src/shared/types.ts
 *  SourceDescriptor.label doc comment): the label is the full id itself,
 *  prefix included, so the sidebar row's *visible text* reads
 *  "local:laravel" / "herd:nginx-mysite.test" (docs/specs/003-phase-3-
 *  auto-discovery.md § Layout wireframes and Overview literally render this
 *  form; design-reviews/003-phase-3-auto-discovery.md Finding 1). This holds
 *  for all three origins without special-casing: a project/environment
 *  detector's sourceId is already built as `<prefix>:<name>` (src/discovery/
 *  index.ts), and a traceriver.json watch entry's sourceId is the user's own
 *  already-prefixed `label` field (configuration.md's existing convention,
 *  e.g. "local:worker") — so this also guarantees a config-supplied label
 *  always wins verbatim, with no override logic needed. */
function deriveLabel(id: string): string {
  return id;
}

class TailedSource {
  private readonly state: AppState;
  private readonly target: TailTargetSpec;
  private readonly pipeline: SourcePipeline;

  private watcher: FSWatcher | null = null;
  private readonly files = new Map<string, TrackedFile>();
  private winningPath: string | null = null;
  private ready = false;
  private everLive = false;
  private stopped = false;
  private watcherErrorMessage: string | null = null;
  private readQueue: Promise<void> = Promise.resolve();
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(state: AppState, target: TailTargetSpec) {
    this.state = state;
    this.target = target;

    const pinnedParser = target.parserName ? PARSER_BY_NAME[target.parserName] : undefined;
    this.pipeline = new SourcePipeline({ sourceId: target.sourceId, mode: "live", pinnedParser });
    this.pipeline.on("entries", (entries: TraceRiverLogInput[]) => {
      const inserted = entries.map((e) => this.state.ringBuffer.push(e));
      this.state.sources.incrementCount(target.sourceId, inserted.length);
      this.state.broadcaster.enqueueEntries(inserted);
    });
  }

  async start(): Promise<void> {
    await this.initWatcher();
    if (this.stopped) return;

    const hasFile = this.files.size > 0;
    this.everLive = hasFile;
    const isEnvironment = this.target.local.origin === "environment";
    const subscribed = isEnvironment ? false : hasFile;
    const state: SourceState = hasFile ? "live" : "pending";
    const local = this.buildLocalMeta();
    const detail = hasFile ? null : `Waiting for ${local.targetPath} to be created.`;

    this.state.sources.create(this.target.sourceId, "local", deriveLabel(this.target.sourceId), {
      subscribed,
      state,
      detail,
      local,
    });

    if (this.watcherErrorMessage) {
      this.state.sources.setState(this.target.sourceId, "error", this.watcherErrorMessage);
    }

    this.pollTimer = setInterval(() => this.reconcileAll(), RECONCILE_POLL_MS);
    this.pollTimer.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    void this.watcher?.close();
    this.pipeline.end();
  }

  private initWatcher(): Promise<void> {
    return new Promise((resolveReady) => {
      const watcher = chokidar.watch(toChokidarWatchPattern(this.target.pattern), {
        persistent: true,
        ignoreInitial: false,
        alwaysStat: true,
        usePolling: false,
      });
      this.watcher = watcher;

      watcher.on("add", (path: string, stats?: Stats) => this.handleAdd(path, stats));
      watcher.on("change", (path: string, stats?: Stats) => this.handleChange(path, stats));
      watcher.on("unlink", (path: string) => this.handleUnlink(path));
      watcher.on("error", (err: unknown) => this.handleWatcherError(err));
      watcher.once("ready", () => {
        this.ready = true;
        resolveReady();
      });
    });
  }

  // -- Filesystem event handlers -----------------------------------------

  private handleAdd(path: string, stats?: Stats): void {
    const size = stats?.size ?? statSafe(path)?.size ?? 0;
    const mtimeMs = stats?.mtimeMs ?? statSafe(path)?.mtimeMs ?? Date.now();

    if (!this.ready) {
      // Pre-existing file discovered during the initial scan: attach at
      // EOF — never ingest history (docs/phases/phase-3-auto-discovery.md
      // § 3.3 "Start at EOF").
      this.files.set(path, { offset: size, mtimeMs });
      this.recomputeWinningPath();
      return;
    }

    // A file appearing after the initial scan is always brand new from this
    // source's point of view — the first-ever creation of a "pending" file,
    // a rotation continuation, or a reappearance after deletion. None of
    // these carry pre-existing history to skip (docs/specs/003-phase-3-
    // auto-discovery.md § Interaction specs: "no EOF-skip concern here —
    // the file is brand new" / "resumes at offset 0").
    const tracked: TrackedFile = { offset: 0, mtimeMs };
    this.files.set(path, tracked);
    this.recomputeWinningPath();
    if (size > 0) {
      // Claim the range before the async read resolves (same pattern as
      // `reconcileTrackedFile`) so a `change` event or poll tick racing this
      // read doesn't re-read the same bytes a second time.
      tracked.offset = size;
      void this.enqueueRead(path, 0, size);
    }
    this.evaluateFilesChanged();
  }

  private handleChange(path: string, stats?: Stats): void {
    const tracked = this.files.get(path);
    if (!tracked) {
      this.handleAdd(path, stats);
      return;
    }
    this.reconcileTrackedFile(path, tracked, stats);
  }

  private handleUnlink(path: string): void {
    this.files.delete(path);
    this.recomputeWinningPath();
    this.evaluateFilesChanged();
  }

  private handleWatcherError(err: unknown): void {
    const message = err instanceof Error ? err.message : "Watcher error";
    this.watcherErrorMessage = message;
    if (this.state.sources.has(this.target.sourceId)) {
      this.state.sources.setState(this.target.sourceId, "error", message);
      this.state.broadcaster.broadcastSourceState(this.target.sourceId, "error", message);
      this.state.broadcaster.broadcastSources(this.state.sources.list());
    }
  }

  // -- Reconciliation (native event or 1s poll backstop) -------------------

  private reconcileAll(): void {
    for (const [path, tracked] of this.files) {
      this.reconcileTrackedFile(path, tracked);
    }
  }

  private reconcileTrackedFile(path: string, tracked: TrackedFile, stats?: Stats): void {
    const resolvedStats = stats ?? statSafe(path);
    if (!resolvedStats) return; // vanished between events — the unlink handler owns removal.

    if (resolvedStats.size < tracked.offset) {
      // Truncated or replaced — reset and read from the start (docs/phases/
      // phase-3-auto-discovery.md § 3.3).
      tracked.offset = 0;
    }
    tracked.mtimeMs = resolvedStats.mtimeMs;

    if (resolvedStats.size > tracked.offset) {
      const from = tracked.offset;
      const to = resolvedStats.size;
      tracked.offset = to; // claim the range before the read resolves so a concurrent poll tick doesn't re-read it.
      void this.enqueueRead(path, from, to);
    }
    this.recomputeWinningPath();
  }

  // -- Reads ----------------------------------------------------------------

  private enqueueRead(path: string, from: number, to: number): Promise<void> {
    this.readQueue = this.readQueue.then(() => this.readRange(path, from, to)).catch((err) => {
      this.handleReadError(path, err);
    });
    return this.readQueue;
  }

  private readRange(path: string, from: number, to: number): Promise<void> {
    if (this.stopped || to <= from) return Promise.resolve();
    return new Promise((res, rej) => {
      const stream = createReadStream(path, { start: from, end: to - 1 });
      stream.on("data", (chunk: string | Buffer) => {
        this.pipeline.feed(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      });
      stream.on("end", () => res());
      stream.on("error", (err) => rej(err));
    });
  }

  private handleReadError(path: string, err: unknown): void {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return; // raced with deletion — the unlink handler owns that transition.
    const message = err instanceof Error ? err.message : `Failed to read ${path}`;
    if (this.state.sources.has(this.target.sourceId)) {
      this.state.sources.setState(this.target.sourceId, "error", message);
      this.state.broadcaster.broadcastSourceState(this.target.sourceId, "error", message);
      this.state.broadcaster.broadcastSources(this.state.sources.list());
    }
  }

  // -- Derived state ---------------------------------------------------------

  private recomputeWinningPath(): void {
    let winner: string | null = null;
    let bestMtime = -Infinity;
    for (const [path, tracked] of this.files) {
      if (tracked.mtimeMs >= bestMtime) {
        bestMtime = tracked.mtimeMs;
        winner = path;
      }
    }
    this.winningPath = winner;
  }

  private buildLocalMeta(): NonNullable<SourceDescriptor["local"]> {
    return {
      origin: this.target.local.origin,
      detector: this.target.local.detector,
      targetPath: this.winningPath ?? this.target.pattern,
    };
  }

  /** Applies the pending<->live<->stopped transition rules (docs/specs/
   *  003-phase-3-auto-discovery.md § Interaction specs) whenever the set of
   *  currently-existing tracked files changes. */
  private evaluateFilesChanged(): void {
    const current = this.state.sources.get(this.target.sourceId);
    if (!current) return; // still inside start()'s initial scan — nothing to update yet.

    const hasFile = this.files.size > 0;

    if (hasFile) {
      this.state.sources.updateLocalMeta(this.target.sourceId, this.buildLocalMeta());
      if (current.state !== "live") {
        const isFirstEverAppearance = !this.everLive;
        this.everLive = true;
        this.state.sources.setState(this.target.sourceId, "live", null);
        if (isFirstEverAppearance && this.target.local.origin !== "environment") {
          // One-time zero-config auto-subscribe courtesy on first discovery
          // — never a standing override of an explicit unsubscribe made
          // later (Decision 4). A later stopped->live reappearance leaves
          // `subscribed` untouched. Flips both the registry default (for
          // any future connection) and every already-open connection's own
          // per-connection delivery filter (docs/qa/defects/003-phase-3-
          // auto-discovery-2.md, Symptom A) — the registry alone would only
          // ever fix the checkbox, not the actual data flow.
          this.state.sources.setSubscribed(this.target.sourceId, true);
          this.state.broadcaster.autoSubscribeAll(this.target.sourceId);
        }
        this.state.broadcaster.broadcastSourceState(this.target.sourceId, "live", null);
        this.state.broadcaster.broadcastSources(this.state.sources.list());
      }
    } else if (this.everLive && current.state === "live") {
      const detail = "File not found — waiting for it to reappear.";
      this.state.sources.setState(this.target.sourceId, "stopped", detail);
      this.state.broadcaster.broadcastSourceState(this.target.sourceId, "stopped", detail);
      this.state.broadcaster.broadcastSources(this.state.sources.list());
    }
  }
}

function statSafe(path: string): Stats | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

/**
 * Owns every tailed source (auto-discovered + config `watch` entries) for
 * the life of the process — the phase-3 analog of `DockerManager`
 * (src/ingest/docker.ts). Constructed with its full target list up front;
 * `start()` is awaited before the server accepts its first WS connection so
 * "Discovery runs once, before any client connects" holds exactly
 * (docs/specs/003-phase-3-auto-discovery.md § Interaction specs).
 */
export class TailManager {
  private readonly state: AppState;
  private readonly targets: TailTargetSpec[];
  private readonly sources = new Map<string, TailedSource>();
  private started = false;

  constructor(state: AppState, targets: TailTargetSpec[]) {
    this.state = state;
    this.targets = targets;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await Promise.all(
      this.targets.map(async (target) => {
        const tailed = new TailedSource(this.state, target);
        this.sources.set(target.sourceId, tailed);
        await tailed.start();
      }),
    );
  }

  /** Stops every watcher/poll timer and flushes pending pipeline state —
   *  called on server shutdown so nothing outlives the process. */
  stop(): void {
    for (const tailed of this.sources.values()) tailed.stop();
  }
}
