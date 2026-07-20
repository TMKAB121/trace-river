/**
 * Stage 2 — multi-line aggregation. See docs/log-schema.md § "Multi-line
 * aggregation". Groups raw lines into `AggregatedEntry` objects using a
 * continuation heuristic that's swappable at runtime (the generic heuristic
 * before a format is locked, then the locked parser's `entryStart` regex).
 */
import type { AggregatedEntry } from "./formats/types.js";
import { isGenericContinuationLine } from "./continuation-heuristic.js";

export const DEFAULT_MAX_LINES = 500;
export const DEFAULT_MAX_BYTES = 256 * 1024;
export const AGGREGATOR_IDLE_MS = 2000;

export interface AggregatorOptions {
  maxLines?: number;
  maxBytes?: number;
  idleMs?: number;
  onEntry: (entry: AggregatedEntry) => void;
  /** Wall-clock timer factories, overridable for tests. */
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
}

export class MultilineAggregator {
  /**
   * Tests whether `line` STARTS a new entry. Mutable: the pipeline swaps
   * this from the generic heuristic to a locked parser's `entryStart` once
   * detection commits. `null` means "use the generic continuation heuristic"
   * (the default, and also what `raw` effectively uses).
   */
  entryStartTest: ((line: string) => boolean) | null = null;

  private readonly maxLines: number;
  private readonly maxBytes: number;
  private readonly idleMs: number;
  private readonly onEntry: (entry: AggregatedEntry) => void;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;

  private pendingLines: string[] = [];
  private pendingTimestamps: Array<string | null> = [];
  private pendingBytes = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: AggregatorOptions) {
    this.maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.idleMs = options.idleMs ?? AGGREGATOR_IDLE_MS;
    this.onEntry = options.onEntry;
    this.setTimeoutFn = options.setTimeout ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeout ?? clearTimeout;
  }

  /**
   * @param sourceTimestamp Optional out-of-band timestamp for this specific
   *   line (docker sources only — see `AggregatedEntry.sourceTimestamp`).
   *   Only the first line's value is retained per finalized entry.
   */
  addLine(line: string, sourceTimestamp: string | null = null): void {
    const isStart = this.pendingLines.length === 0 ? true : this.isEntryStart(line);

    if (isStart && this.pendingLines.length > 0) {
      this.finalizePending(false);
    }

    this.pendingLines.push(line);
    this.pendingTimestamps.push(sourceTimestamp);
    this.pendingBytes += Buffer.byteLength(line, "utf8") + 1;

    if (this.pendingLines.length > this.maxLines || this.pendingBytes > this.maxBytes) {
      this.finalizePending(true);
    }

    this.resetIdleTimer();
  }

  /** Finalize whatever is pending, e.g. at end-of-stream. No-op if nothing pending. */
  flush(): void {
    this.clearIdleTimer();
    if (this.pendingLines.length > 0) this.finalizePending(false);
  }

  dispose(): void {
    this.clearIdleTimer();
  }

  private isEntryStart(line: string): boolean {
    if (this.entryStartTest) return this.entryStartTest(line);
    return !isGenericContinuationLine(line);
  }

  private finalizePending(truncated: boolean): void {
    const lines = this.pendingLines;
    const timestamps = this.pendingTimestamps;
    this.pendingLines = [];
    this.pendingTimestamps = [];
    this.pendingBytes = 0;
    const entry: AggregatedEntry = {
      lines,
      raw: lines.join("\n"),
      truncated,
      sourceTimestamp: timestamps[0] ?? null,
    };
    this.onEntry(entry);
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = this.setTimeoutFn(() => {
      this.idleTimer = null;
      this.flush();
    }, this.idleMs);
    // Don't hold the process open just for an idle-flush timer.
    if (typeof (this.idleTimer as unknown as { unref?: () => void })?.unref === "function") {
      (this.idleTimer as unknown as { unref: () => void }).unref();
    }
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      this.clearTimeoutFn(this.idleTimer);
      this.idleTimer = null;
    }
  }
}
