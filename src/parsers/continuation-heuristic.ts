/**
 * Generic continuation heuristic used by the multi-line aggregator before a
 * source's format is locked (and permanently by the `raw` fallback parser):
 * a line matching one of these patterns continues the previous entry rather
 * than starting a new one. See docs/log-schema.md § "Multi-line aggregation".
 */
const CONTINUATION_RE = /^(?:\s|at |#\d+|Traceback|Caused by|Stack trace:)/;

export function isGenericContinuationLine(line: string): boolean {
  return CONTINUATION_RE.test(line);
}

/** A line "starts a new entry" under the generic heuristic iff it is not a continuation. */
export const GENERIC_ENTRY_START: RegExp = /^(?!\s|at |#\d+|Traceback|Caused by|Stack trace:).*/;
