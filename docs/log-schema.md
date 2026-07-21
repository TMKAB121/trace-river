# Log Schema & Parser Pipeline

Everything the UI renders is a `TraceRiverLog`. The parser pipeline's job is to turn arbitrary raw bytes from any source into this shape, reliably, at streaming speed.

## The `TraceRiverLog` schema

```ts
/** Normalized log levels, ordered by severity. */
type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL" | "UNKNOWN";

interface TraceRiverLog {
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

  /**
   * ErrorGroup fingerprint (phase 4). Non-null only for ERROR/FATAL entries,
   * assigned at ingestion in the same tick as the entry itself — never as a
   * later update to an already-broadcast entry. null for every other level.
   */
  fingerprint: string | null;
}
```

Design notes:

- `id` is assigned by the server ring buffer, strictly increasing — it drives replay (`give me everything after id N`) and React list keys.
- `message` vs `body`: the virtualized stream renders `message` only; expanding a row reveals `body` in the syntax-highlighted viewport. Keeping them separate means row rendering never touches large strings.
- `raw` is preserved so search can match text a parser discarded, and so "copy raw" is always exact.

## Pipeline stages

Raw chunks flow through four stages. Stages 1–2 are per-source and stateful; 3–4 are pure functions.

```
chunk ──▶ 1. line splitter ──▶ 2. multi-line aggregator ──▶ 3. format parser ──▶ 4. normalizer ──▶ TraceRiverLog
```

### 1. Line splitting (partial-line buffering)

Stream chunks from Docker or file reads **never align with newlines**. Each source keeps a remainder buffer: split incoming chunk on `\n`, emit complete lines, hold the tail fragment until the next chunk (or flush on stream end / 2s idle timeout). ANSI escape sequences (`\x1b[...m` and friends) are stripped here, before any regex sees the line — colored dev output otherwise breaks every format matcher.

### 2. Multi-line aggregation

Stack traces are the whole point of this tool, and they arrive as many raw lines. The aggregator uses a **continuation heuristic**:

> A line that does **not** match the source's established entry-start pattern (typically its timestamp prefix) is appended to the previous entry's `body` rather than emitted as a new entry.

- Each format parser (below) exports an `entryStart: RegExp` used for this test once the source's format is known.
- Before a format is established (or for the raw fallback), the heuristic is: lines starting with whitespace, `at `, `#\d+`, `Traceback`, `Caused by`, or `Stack trace:` continue the previous entry.
- An aggregation cap (default 500 lines / 256 KB per entry) prevents a pathological source from building one infinite entry; overflow starts a new entry flagged in `context.truncated`.
- A 2-second idle flush emits a pending aggregate even if no new entry-start has arrived.

### 3. Format parsers (ordered chain, confidence-scored)

Each parser implements:

```ts
interface FormatParser {
  name: string;                       // "monolog" | "clf" | "jsonl" | "raw"
  entryStart: RegExp;                 // used by the aggregator
  /** 0 = no match, 1 = certain. Called on candidate lines during detection. */
  score(line: string): number;
  parse(entry: AggregatedEntry): ParsedFields; // level, timestamps, message, context
}
```

Initial chain, in order:

| Parser | Matches | Notes |
|--------|---------|-------|
| `monolog` | `[2026-07-19 15:31:15] production.ERROR: message {ctx} []` | Laravel/Symfony/Monolog. Channel + level captured; trailing JSON blobs parsed into `context`. |
| `clf` | Nginx/Apache access + error formats | Access lines: method/path/status into `context`, level derived from status (5xx→ERROR, 4xx→WARN). Error-log format handled separately (`[error]`, `[warn]` markers). |
| `jsonl` | Line parses as a JSON object | Maps common key aliases: `level`/`severity`/`lvl`, `msg`/`message`, `time`/`ts`/`timestamp`/`@timestamp`. Covers pino, winston, bunyan, zap, logrus. |
| `raw` | Always (fallback) | Level inferred by keyword scan (`error`, `exception`, `fatal`, `warn` as whole words); timestamp = arrival time. Never fails. |

**Detection with per-source stickiness.** Running every parser against every line is wasted work and causes flapping. Instead:

1. For a new source, run the chain's `score()` on each of the first ~20 entries; once a parser scores ≥ 0.8 on 3 entries, it is **locked** for that source.
2. A locked source runs only its parser. If 10 consecutive entries fail to parse (fall through to raw), the lock resets and detection re-runs — handles a container whose app logs JSON but whose startup banner is plain text, or a source that changes format mid-stream.
3. Uploaded files detect on their first 50 lines, then commit for the whole file.

Custom user-defined regex parsers from `traceriver.json` (see [configuration.md](configuration.md)) are inserted at the head of the chain.

### 4. Normalization

- **Levels** map onto the 6-value enum:

  | Source value | Normalized |
  |---|---|
  | `debug`, `trace`, `verbose`, pino ≤ 20 | DEBUG |
  | `info`, `notice`, pino 30 | INFO |
  | `warn`, `warning`, pino 40 | WARN |
  | `error`, `err`, HTTP 5xx, pino 50 | ERROR |
  | `critical`, `alert`, `emergency`, `fatal`, `panic`, pino 60 | FATAL |
  | anything else / absent | UNKNOWN |

- **Timestamps** parse from the format the matched parser expects (Monolog `Y-m-d H:i:s`, CLF `dd/MMM/yyyy:HH:mm:ss Z`, ISO-8601, epoch seconds/millis) into **epoch ms UTC**. A timestamp with no zone info is assumed to be in the host's local zone — correct for local dev logs, and documented as such. Unparseable or absent → arrival time, with `rawTimestamp` preserved.
- **Ordering policy**: the stream displays **arrival order** (append-only — cheap and honest for live tails). A sort-by-timestamp toggle exists for reading uploaded files or interleaving sources; the UI notes that container clock skew can make cross-source timestamp ordering lie.

## Testing strategy

The pipeline is the highest-value test target in the project and is built to be tested: stages 3–4 are pure, and stages 1–2 are deterministic state machines.

- `test/fixtures/` holds **real captured samples** per format: `laravel.log`, `nginx-access.log`, `nginx-error.log`, `pino.jsonl`, a Docker-multiplexed binary capture, and a "nasty" file (ANSI codes, interleaved partial writes, a 300-line PHP stack trace, mixed formats).
- Golden tests: fixture in → expected `TraceRiverLog[]` JSON out. Adding support for a new framework = drop in a fixture + expected output.
- Chunk-boundary fuzz: re-feed each fixture split at random byte offsets and assert output is identical to feeding it whole — this single test catches most partial-line and demux bugs.
