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
import { LineSplitter, stripAnsi } from "./line-splitter.js";
import { MultilineAggregator } from "./aggregator.js";
import { BUILTIN_PARSER_CHAIN, rawParser } from "./formats/index.js";
import type { AggregatedEntry, FormatParser, ParsedFields } from "./formats/types.js";
import { normalizeLevel, normalizeTimestamp } from "./normalize.js";
import type { LogLevel, TraceRiverLogInput } from "../shared/types.js";

export type PipelineMode = "file" | "live";

export interface SourcePipelineOptions {
  sourceId: string;
  mode?: PipelineMode;
  chain?: FormatParser[];
  /**
   * Floors a normalized level up to at least this value when the entry's own
   * level couldn't be determined (`UNKNOWN`) — used for a non-TTY docker
   * container's stderr stream (docs/phases/phase-2-docker.md § 2.3: "stderr
   * lines get a level floor of WARN when the app didn't specify one").
   * Never downgrades a level the parser actually found.
   */
  levelFloor?: LogLevel;
}

interface ParserSampleStats {
  qualifying: number;
  scoreSum: number;
  scoredCount: number;
}

const FILE_DETECTION_LINE_CAP = 50;
const LIVE_DETECTION_ENTRY_CAP = 20;
const LIVE_LOCK_QUALIFYING_THRESHOLD = 3;
const LIVE_RELOCK_FAILURE_STREAK = 10;
const LOCK_SCORE_THRESHOLD = 0.8;

export interface SourcePipelineEvents {
  entries: (entries: TraceRiverLogInput[]) => void;
  end: () => void;
}

export class SourcePipeline extends EventEmitter {
  private readonly sourceId: string;
  private readonly mode: PipelineMode;
  private readonly chain: FormatParser[];
  private readonly levelFloor?: LogLevel;

  private readonly lineSplitter = new LineSplitter();
  private readonly aggregator: MultilineAggregator;

  private locked: FormatParser | null = null;
  private detecting = true;
  private linesSeenForDetection = 0;
  /** Entries scored so far during live-mode detection — the "live" analog of
   *  `linesSeenForDetection`'s file-mode budget check (see
   *  `handleAggregatedEntry`). Unused in "file" mode. */
  private liveEntriesScored = 0;
  private readonly sampleCounts = new Map<FormatParser, ParserSampleStats>();
  private bufferedDetectionEntries: AggregatedEntry[] = [];
  private failureStreak = 0;

  constructor(options: SourcePipelineOptions) {
    super();
    this.sourceId = options.sourceId;
    this.mode = options.mode ?? "file";
    this.chain = options.chain ?? BUILTIN_PARSER_CHAIN;
    this.levelFloor = options.levelFloor;
    for (const parser of this.chain) {
      this.sampleCounts.set(parser, { qualifying: 0, scoreSum: 0, scoredCount: 0 });
    }
    this.aggregator = new MultilineAggregator({
      onEntry: (entry) => this.handleAggregatedEntry(entry),
    });
  }

  /** Feed a raw byte chunk (from the upload stream / future tailer). */
  feed(chunk: Buffer | Uint8Array): void {
    const lines = this.lineSplitter.push(chunk);
    for (const line of lines) this.aggregator.addLine(line);
  }

  /**
   * Feed one already-newline-delimited raw line directly into the
   * aggregator, bypassing the byte-oriented `LineSplitter` — used by
   * live/docker sources whose ingest adapter does its own per-stream
   * partial-line buffering (src/ingest/docker.ts) so it can strip Docker's
   * own timestamp prefix per line before the format-parser chain ever sees
   * it. Still ANSI-strips, matching `feed()`'s guarantee.
   */
  feedLine(rawLine: string, sourceTimestamp: string | null = null): void {
    const withoutCr = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    this.aggregator.addLine(stripAnsi(withoutCr), sourceTimestamp);
  }

  /** Signal end-of-stream: flushes any pending partial line/entry and commits detection if still open. */
  end(): void {
    for (const line of this.lineSplitter.flush()) this.aggregator.addLine(line);
    this.aggregator.flush();
    if (this.detecting) this.commitDetection();
    this.aggregator.dispose();
    this.emit("end");
  }

  private handleAggregatedEntry(entry: AggregatedEntry): void {
    if (this.detecting) {
      this.linesSeenForDetection += entry.lines.length;
      this.scoreEntry(entry);

      if (this.mode === "live") {
        // Never withhold a live entry while detection is still open (defect
        // 002-phase-2-docker-1, spec 002 criterion 5: subscribing must show
        // entries "within one broadcast interval"). Emit immediately,
        // provisionally tagged with whatever parser has already earned an
        // early lock this call (usually none yet, so `rawParser`) — the
        // sticky-per-source-parser guarantee (docs/log-schema.md) still
        // holds for every entry from the point detection actually commits
        // onward; only these first few, already-visible entries keep
        // whatever provisional tag they were shown with rather than being
        // retroactively re-tagged.
        this.liveEntriesScored += 1;
        const provisional = this.checkEarlyLock() ?? rawParser;
        this.emit("entries", [this.buildLog(entry, provisional)]);
      } else {
        this.bufferedDetectionEntries.push(entry);
      }

      const budgetExhausted =
        this.mode === "file"
          ? this.linesSeenForDetection >= FILE_DETECTION_LINE_CAP
          : this.liveEntriesScored >= LIVE_DETECTION_ENTRY_CAP;

      if (this.checkEarlyLock() || budgetExhausted) {
        this.commitDetection();
      }
      return;
    }

    this.emitLive(entry);
  }

  private scoreEntry(entry: AggregatedEntry): void {
    const firstLine = entry.lines[0] ?? "";
    for (const parser of this.chain) {
      const score = safeScore(parser, firstLine);
      const stats = this.sampleCounts.get(parser)!;
      stats.scoreSum += score;
      stats.scoredCount += 1;
      if (score >= LOCK_SCORE_THRESHOLD) stats.qualifying += 1;
    }
  }

  private checkEarlyLock(): FormatParser | null {
    for (const parser of this.chain) {
      const stats = this.sampleCounts.get(parser)!;
      if (stats.qualifying >= LIVE_LOCK_QUALIFYING_THRESHOLD) return parser;
    }
    return null;
  }

  private commitDetection(): void {
    this.detecting = false;
    let winner = this.checkEarlyLock();
    if (!winner) {
      let bestAvg = -1;
      for (const parser of this.chain) {
        const stats = this.sampleCounts.get(parser)!;
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
      const logs = buffered.map((entry) => this.buildLog(entry, this.locked!));
      this.emit("entries", logs);
    }
  }

  private lockTo(parser: FormatParser): void {
    this.locked = parser;
    this.failureStreak = 0;
    this.aggregator.entryStartTest = (line) => parser.entryStart.test(line);
  }

  private unlock(): void {
    this.locked = null;
    this.detecting = true;
    this.linesSeenForDetection = 0;
    this.liveEntriesScored = 0;
    this.bufferedDetectionEntries = [];
    this.failureStreak = 0;
    for (const stats of this.sampleCounts.values()) {
      stats.qualifying = 0;
      stats.scoreSum = 0;
      stats.scoredCount = 0;
    }
    this.aggregator.entryStartTest = null;
  }

  private emitLive(entry: AggregatedEntry): void {
    const locked = this.locked!;
    let effectiveParser = locked;

    if (this.mode === "live") {
      const firstLine = entry.lines[0] ?? "";
      const scoresWell = safeScore(locked, firstLine) >= LOCK_SCORE_THRESHOLD;
      if (scoresWell) {
        this.failureStreak = 0;
      } else {
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

  private buildLog(entry: AggregatedEntry, parser: FormatParser): TraceRiverLogInput {
    let fields: ParsedFields;
    try {
      fields = parser.parse(entry);
    } catch {
      fields = rawParser.parse(entry);
      parser = rawParser;
    }

    let level = normalizeLevel(fields.level);
    if (level === "UNKNOWN" && this.levelFloor) level = this.levelFloor;

    // Docker's own per-line RFC3339Nano timestamp (stripped by the ingest
    // adapter into entry.sourceTimestamp) is a fallback: an app-level
    // timestamp the format parser actually found in the text always wins.
    let rawTimestampInput = fields.rawTimestamp;
    let timestampHint = parser.timestampHint;
    if ((rawTimestampInput === null || rawTimestampInput === undefined) && entry.sourceTimestamp) {
      rawTimestampInput = entry.sourceTimestamp;
      timestampHint = "iso-or-epoch";
    }

    const { timestamp, rawTimestamp } = normalizeTimestamp(rawTimestampInput, timestampHint);
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

function safeScore(parser: FormatParser, line: string): number {
  try {
    return parser.score(line);
  } catch {
    return 0;
  }
}
