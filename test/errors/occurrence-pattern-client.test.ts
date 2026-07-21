/**
 * Regression test for defect 004-phase-4-error-intelligence-1: the
 * sparkline's client-side `describeOccurrencePattern` (web/src/utils/
 * occurrencePattern.ts) must choose the same spike-vs-steady sentence
 * template as the server's `buildOccurrencePatternSummary`
 * (src/errors/prompt.ts) for the same `perMinute` histogram — spec
 * docs/specs/004-phase-4-error-intelligence.md § Components & states —
 * Sparkline ("the sparkline's title attribute tooltip summarizing the same
 * 'steady ~X/min…' text the prompt itself generates") and § API contract —
 * Prompt assembly — Occurrence pattern.
 *
 * `web/src/utils/occurrencePattern.ts` is a plain TS module with no React/
 * DOM dependency, so it's importable directly here without any browser-
 * testing tooling.
 */
import { describe, it, expect } from "vitest";
import { describeOccurrencePattern } from "../../web/src/utils/occurrencePattern.js";

describe("describeOccurrencePattern — client/server parity (defect 004-phase-4-error-intelligence-1)", () => {
  it("[1,0,0,0,10]: rounds the average to 2 before the multiplier comparison, so it spike-words like the server (avgRounded=2, 5*2=10 <= peak 10)", () => {
    const result = describeOccurrencePattern([1, 0, 0, 0, 10]);
    // peakIndex is 4 (last bucket), so "for 4 min" before the spike.
    expect(result).toMatch(/^steady ~2\/min for 4 min, spiked to 10\/min at \d{2}:\d{2}$/);
    // Must NOT fall back to the raw-average (rawAvg=2.2, 5*2.2=11 > 10) steady-only wording.
    expect(result).not.toBe("steady ~2/min over the last 5 min");
  });

  it("stays steady-worded just below the rounded-average threshold ([1,0,0,0,9]: avgRounded=2, 5*2=10 > peak 9)", () => {
    const result = describeOccurrencePattern([1, 0, 0, 0, 9]);
    expect(result).toBe("steady ~2/min over the last 5 min");
  });

  it("uses the minimum-absolute-rate floor even when the multiplier alone would qualify (peak below 10/min never spike-words)", () => {
    // avg = 1, 5*1 = 5 <= peak 6, but peak(6) < SPIKE_MIN_ABSOLUTE_RATE_PER_MIN(10).
    const result = describeOccurrencePattern([0, 0, 0, 0, 6]);
    expect(result).toBe("steady ~1/min over the last 5 min");
  });
});
