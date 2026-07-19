/**
 * Per-source pipeline: line splitter → multi-line aggregator → format parser
 * chain (confidence-scored, sticky) → normalizer → TraceRiverLogInput.
 * See docs/log-schema.md.
 *
 * Two detection modes, per log-schema.md § "Detection with per-source
 * stickiness":
 *  - "file" (phase 1's only real source kind): detect on the first ~50 raw
 *    lines, then commit permanently for the whole file — no re-detection.
 *  - "live" (phase 2/3 docker/tail sources — not wired to any ingest
 *    adapter yet, kept here so those phases don't need to rebuild this):
 *    detect over the first ~20 entries, lock once a parser scores ≥0.8 on
 *    3 of them, and reset the lock if 10 consecutive entries fail to score
 *    well against it.
 */
import { EventEmitter } from "node:events";
import { LineSplitter } from "./line-splitter.js";
import { MultilineAggregator } from "./aggregator.js";
import { BUILTIN_PARSER_CHAIN, rawParser } from "./formats/index.js";
import { normalizeLevel, normalizeTimestamp } from "./normalize.js";
const FILE_DETECTION_LINE_CAP = 50;
const LIVE_DETECTION_ENTRY_CAP = 20;
const LIVE_LOCK_QUALIFYING_THRESHOLD = 3;
const LIVE_RELOCK_FAILURE_STREAK = 10;
const LOCK_SCORE_THRESHOLD = 0.8;
export class SourcePipeline extends EventEmitter {
    sourceId;
    mode;
    chain;
    lineSplitter = new LineSplitter();
    aggregator;
    locked = null;
    detecting = true;
    linesSeenForDetection = 0;
    sampleCounts = new Map();
    bufferedDetectionEntries = [];
    failureStreak = 0;
    constructor(options) {
        super();
        this.sourceId = options.sourceId;
        this.mode = options.mode ?? "file";
        this.chain = options.chain ?? BUILTIN_PARSER_CHAIN;
        for (const parser of this.chain) {
            this.sampleCounts.set(parser, { qualifying: 0, scoreSum: 0, scoredCount: 0 });
        }
        this.aggregator = new MultilineAggregator({
            onEntry: (entry) => this.handleAggregatedEntry(entry),
        });
    }
    /** Feed a raw byte chunk (from the upload stream / future tailer). */
    feed(chunk) {
        const lines = this.lineSplitter.push(chunk);
        for (const line of lines)
            this.aggregator.addLine(line);
    }
    /** Signal end-of-stream: flushes any pending partial line/entry and commits detection if still open. */
    end() {
        for (const line of this.lineSplitter.flush())
            this.aggregator.addLine(line);
        this.aggregator.flush();
        if (this.detecting)
            this.commitDetection();
        this.aggregator.dispose();
        this.emit("end");
    }
    handleAggregatedEntry(entry) {
        if (this.detecting) {
            this.bufferedDetectionEntries.push(entry);
            this.linesSeenForDetection += entry.lines.length;
            this.scoreEntry(entry);
            const budgetExhausted = this.mode === "file"
                ? this.linesSeenForDetection >= FILE_DETECTION_LINE_CAP
                : this.bufferedDetectionEntries.length >= LIVE_DETECTION_ENTRY_CAP;
            if (this.checkEarlyLock() || budgetExhausted) {
                this.commitDetection();
            }
            return;
        }
        this.emitLive(entry);
    }
    scoreEntry(entry) {
        const firstLine = entry.lines[0] ?? "";
        for (const parser of this.chain) {
            const score = safeScore(parser, firstLine);
            const stats = this.sampleCounts.get(parser);
            stats.scoreSum += score;
            stats.scoredCount += 1;
            if (score >= LOCK_SCORE_THRESHOLD)
                stats.qualifying += 1;
        }
    }
    checkEarlyLock() {
        for (const parser of this.chain) {
            const stats = this.sampleCounts.get(parser);
            if (stats.qualifying >= LIVE_LOCK_QUALIFYING_THRESHOLD)
                return parser;
        }
        return null;
    }
    commitDetection() {
        this.detecting = false;
        let winner = this.checkEarlyLock();
        if (!winner) {
            let bestAvg = -1;
            for (const parser of this.chain) {
                const stats = this.sampleCounts.get(parser);
                const avg = stats.scoredCount > 0 ? stats.scoreSum / stats.scoredCount : 0;
                if (avg > bestAvg) {
                    bestAvg = avg;
                    winner = parser;
                }
            }
        }
        this.lockTo(winner ?? this.chain[this.chain.length - 1]);
        const buffered = this.bufferedDetectionEntries;
        this.bufferedDetectionEntries = [];
        if (buffered.length > 0) {
            const logs = buffered.map((entry) => this.buildLog(entry, this.locked));
            this.emit("entries", logs);
        }
    }
    lockTo(parser) {
        this.locked = parser;
        this.failureStreak = 0;
        this.aggregator.entryStartTest = (line) => parser.entryStart.test(line);
    }
    unlock() {
        this.locked = null;
        this.detecting = true;
        this.linesSeenForDetection = 0;
        this.bufferedDetectionEntries = [];
        this.failureStreak = 0;
        for (const stats of this.sampleCounts.values()) {
            stats.qualifying = 0;
            stats.scoreSum = 0;
            stats.scoredCount = 0;
        }
        this.aggregator.entryStartTest = null;
    }
    emitLive(entry) {
        const locked = this.locked;
        let effectiveParser = locked;
        if (this.mode === "live") {
            const firstLine = entry.lines[0] ?? "";
            const scoresWell = safeScore(locked, firstLine) >= LOCK_SCORE_THRESHOLD;
            if (scoresWell) {
                this.failureStreak = 0;
            }
            else {
                this.failureStreak += 1;
                effectiveParser = rawParser;
            }
        }
        const log = this.buildLog(entry, effectiveParser);
        this.emit("entries", [log]);
        if (this.mode === "live" && this.failureStreak >= LIVE_RELOCK_FAILURE_STREAK) {
            this.unlock();
        }
    }
    buildLog(entry, parser) {
        let fields;
        try {
            fields = parser.parse(entry);
        }
        catch {
            fields = rawParser.parse(entry);
            parser = rawParser;
        }
        const level = normalizeLevel(fields.level);
        const { timestamp, rawTimestamp } = normalizeTimestamp(fields.rawTimestamp, parser.timestampHint);
        const multiline = entry.lines.length > 1;
        return {
            timestamp,
            rawTimestamp,
            source: this.sourceId,
            level,
            message: fields.message,
            body: multiline ? entry.raw : null,
            context: entry.truncated ? { ...(fields.context ?? {}), truncated: true } : fields.context,
            raw: entry.raw,
            multiline,
        };
    }
}
function safeScore(parser, line) {
    try {
        return parser.score(line);
    }
    catch {
        return 0;
    }
}
//# sourceMappingURL=pipeline.js.map