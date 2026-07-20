/** Format parser chain — see docs/log-schema.md § "Format parsers". */

/** A group of raw lines the multi-line aggregator has decided belong to one entry. */
export interface AggregatedEntry {
  /** Raw lines, in order, ANSI-stripped. */
  lines: string[];
  /** lines.join("\n") — the untouched raw text of the entry. */
  raw: string;
  /** Set by the aggregator when the per-entry cap (lines/bytes) was exceeded. */
  truncated: boolean;
  /**
   * The ingest adapter's own reliable timestamp for the entry's first raw
   * line, if it supplied one out-of-band (docker sources: Docker's
   * RFC3339Nano `timestamps: true` prefix, stripped before the line reached
   * the format-parser chain — see src/ingest/docker.ts and
   * docs/phases/phase-2-docker.md § 2.3). `null`/absent for file sources.
   * Used by the pipeline as a fallback only when the format parser didn't
   * find its own timestamp in the entry's text.
   */
  sourceTimestamp?: string | null;
}

export interface ParsedFields {
  /** Raw level token as found in the source (e.g. "ERROR", "warn", "50"); normalized later. */
  level: string | null;
  /** Raw timestamp string as found in the source, if any (pre-normalization). */
  rawTimestamp: string | null;
  /** First line / summary — what the collapsed row displays. */
  message: string;
  /** Structured extras extracted by the parser, or null. */
  context: Record<string, unknown> | null;
}

export interface FormatParser {
  name: "monolog" | "clf" | "jsonl" | "raw" | string;

  /** Used by the aggregator to decide whether a line starts a new entry once this
   *  source's format is known (locked). */
  entryStart: RegExp;

  /** 0 = no match, 1 = certain. Called on candidate entry-start lines during detection. */
  score(line: string): number;

  /** Parse a fully-aggregated entry into its structured fields. */
  parse(entry: AggregatedEntry): ParsedFields;

  /** Timestamp format hint consumed by the normalizer (see src/parsers/normalize.ts). */
  timestampHint: "monolog" | "clf" | "iso-or-epoch" | "none";
}
