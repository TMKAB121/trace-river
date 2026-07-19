/** Format parser chain — see docs/log-schema.md § "Format parsers". */

/** A group of raw lines the multi-line aggregator has decided belong to one entry. */
export interface AggregatedEntry {
  /** Raw lines, in order, ANSI-stripped. */
  lines: string[];
  /** lines.join("\n") — the untouched raw text of the entry. */
  raw: string;
  /** Set by the aggregator when the per-entry cap (lines/bytes) was exceeded. */
  truncated: boolean;
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
