import { isGenericContinuationLine } from "./continuation-heuristic.js";
export const DEFAULT_MAX_LINES = 500;
export const DEFAULT_MAX_BYTES = 256 * 1024;
export const AGGREGATOR_IDLE_MS = 2000;
export class MultilineAggregator {
    /**
     * Tests whether `line` STARTS a new entry. Mutable: the pipeline swaps
     * this from the generic heuristic to a locked parser's `entryStart` once
     * detection commits. `null` means "use the generic continuation heuristic"
     * (the default, and also what `raw` effectively uses).
     */
    entryStartTest = null;
    maxLines;
    maxBytes;
    idleMs;
    onEntry;
    setTimeoutFn;
    clearTimeoutFn;
    pendingLines = [];
    pendingBytes = 0;
    idleTimer = null;
    constructor(options) {
        this.maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
        this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
        this.idleMs = options.idleMs ?? AGGREGATOR_IDLE_MS;
        this.onEntry = options.onEntry;
        this.setTimeoutFn = options.setTimeout ?? setTimeout;
        this.clearTimeoutFn = options.clearTimeout ?? clearTimeout;
    }
    addLine(line) {
        const isStart = this.pendingLines.length === 0 ? true : this.isEntryStart(line);
        if (isStart && this.pendingLines.length > 0) {
            this.finalizePending(false);
        }
        this.pendingLines.push(line);
        this.pendingBytes += Buffer.byteLength(line, "utf8") + 1;
        if (this.pendingLines.length > this.maxLines || this.pendingBytes > this.maxBytes) {
            this.finalizePending(true);
        }
        this.resetIdleTimer();
    }
    /** Finalize whatever is pending, e.g. at end-of-stream. No-op if nothing pending. */
    flush() {
        this.clearIdleTimer();
        if (this.pendingLines.length > 0)
            this.finalizePending(false);
    }
    dispose() {
        this.clearIdleTimer();
    }
    isEntryStart(line) {
        if (this.entryStartTest)
            return this.entryStartTest(line);
        return !isGenericContinuationLine(line);
    }
    finalizePending(truncated) {
        const lines = this.pendingLines;
        this.pendingLines = [];
        this.pendingBytes = 0;
        const entry = { lines, raw: lines.join("\n"), truncated };
        this.onEntry(entry);
    }
    resetIdleTimer() {
        this.clearIdleTimer();
        this.idleTimer = this.setTimeoutFn(() => {
            this.idleTimer = null;
            this.flush();
        }, this.idleMs);
        // Don't hold the process open just for an idle-flush timer.
        if (typeof this.idleTimer?.unref === "function") {
            this.idleTimer.unref();
        }
    }
    clearIdleTimer() {
        if (this.idleTimer !== null) {
            this.clearTimeoutFn(this.idleTimer);
            this.idleTimer = null;
        }
    }
}
//# sourceMappingURL=aggregator.js.map