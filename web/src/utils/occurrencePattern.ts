/**
 * Mirrors the server's spike-detection constants (docs/specs/
 * 004-phase-4-error-intelligence.md § Interaction specs — Spike detection)
 * — duplicated client-side *only* for the ErrorGroup card sparkline's
 * decorative `title` tooltip text (§ Components & states — Sparkline: "the
 * sparkline's title attribute tooltip summarizing the same 'steady ~X/min…'
 * text the prompt itself generates"). The server remains the sole authority
 * for `group.spiking` and the AI prompt's own "Occurrence pattern" section —
 * this is never sent back to, or trusted by, the server.
 */
const SPIKE_MULTIPLIER_THRESHOLD = 5;
const SPIKE_MIN_ABSOLUTE_RATE_PER_MIN = 10;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * "steady ~X/min..." summary, following § API contract — Prompt assembly —
 * Occurrence pattern's algorithm. Assumes the histogram's last bucket is the
 * current (in-progress) minute — i.e. "now" — consistent with `perMinute`'s
 * "rolling ... oldest -> newest" description.
 */
export function describeOccurrencePattern(perMinute: number[]): string {
  if (perMinute.length === 0) return "No occurrences recorded yet.";

  const sum = perMinute.reduce((a, b) => a + b, 0);
  const rawAvg = sum / perMinute.length;
  const avg = Math.round(rawAvg);
  const avgText = avg === 0 && rawAvg > 0 ? "<1" : String(avg);

  let peakValue = perMinute[0];
  let peakIndex = 0;
  for (let i = 1; i < perMinute.length; i++) {
    if (perMinute[i] > peakValue) {
      peakValue = perMinute[i];
      peakIndex = i;
    }
  }

  if (peakValue >= SPIKE_MULTIPLIER_THRESHOLD * avg && peakValue >= SPIKE_MIN_ABSOLUTE_RATE_PER_MIN) {
    const minutesAgo = perMinute.length - 1 - peakIndex;
    const clockTime = new Date(Date.now() - minutesAgo * 60_000);
    const clockText = `${pad(clockTime.getHours())}:${pad(clockTime.getMinutes())}`;
    return `steady ~${avgText}/min for ${peakIndex} min, spiked to ${peakValue}/min at ${clockText}`;
  }
  return `steady ~${avgText}/min over the last ${perMinute.length} min`;
}
