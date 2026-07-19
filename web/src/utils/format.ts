/** Zero-pad to at least `len` digits. */
function pad(n: number, len = 2): string {
  return String(n).padStart(len, "0");
}

/**
 * "YYYY-MM-DD HH:mm:ss" in the viewer's local time zone, matching the
 * wireframe (`2026-07-19 15:31:01`). Timestamps in TraceRiverLog are epoch
 * ms UTC; rendering in local time is the standard "when did this happen for
 * me" convention for a local dev tool.
 */
export function formatTimestamp(epochMs: number): string {
  const d = new Date(epochMs);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

export const BYTES_PER_MB = 1024 * 1024;
export const SOFT_WARN_BYTES = 50 * BYTES_PER_MB;
export const HARD_CAP_BYTES = 500 * BYTES_PER_MB;

/** Whole-MB display, matching wireframe copy ("This file is 118 MB..."). */
export function formatMB(bytes: number): number {
  return Math.round(bytes / BYTES_PER_MB);
}
