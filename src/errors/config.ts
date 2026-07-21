/**
 * Error-intelligence constants — one config object, per the phase doc's own
 * framing ("constants live in one config object", docs/phases/
 * phase-4-error-intelligence.md § 4.1/4.2) and this spec's restatement
 * (docs/specs/004-phase-4-error-intelligence.md § Spike detection). Not
 * user-tunable in v1 (spec's explicit out-of-scope list) — change here only,
 * deliberately not surfaced via traceriver.json.
 */
export const ERROR_INTELLIGENCE_CONFIG = {
  /** Max tracked ErrorGroups, LRU-evicted by lastSeen once exceeded. */
  groupCap: 500,
  /** Max ids retained in ErrorGroup.sampleEntryIds (1 pinned-oldest + up to
   *  sampleCap - 1 rolling most-recent). */
  sampleCap: 10,
  /** Width of the rolling per-minute occurrence histogram. */
  histogramWindowMinutes: 30,
  spike: {
    /** Current minute's rate must exceed this multiple of the trailing average. */
    multiplierThreshold: 5,
    /** ...AND be at least this many occurrences/minute, absolute. */
    minAbsoluteRatePerMin: 10,
  },
  /** Lines of cross-source context assembled before a group's first occurrence. */
  promptContextLines: 15,
} as const;
