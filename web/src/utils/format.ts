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

/**
 * Card-density timestamp (docs/specs/004-phase-4-error-intelligence.md §
 * Components & states — ErrorGroup card First/last seen): "YYYY-MM-DD
 * HH:mm:ss", or just "HH:mm:ss" when the date is today — extending
 * `formatTimestamp`'s convention minimally for the card's denser layout.
 */
export function formatShortTimestamp(epochMs: number): string {
  const d = new Date(epochMs);
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  if (isToday) return time;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`;
}

/**
 * Fixed-breakpoint relative time, no unit suffix (docs/specs/
 * 004-phase-4-error-intelligence.md § Components & states — ErrorGroup card
 * First/last seen): < 60s → "<n>s"; < 60min → "<n>m"; < 24h → "<n>h"; else →
 * "<n>d". Callers append " ago".
 */
export function formatRelativeShort(epochMs: number): string {
  const diffMs = Math.max(0, Date.now() - epochMs);
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

export const BYTES_PER_MB = 1024 * 1024;
export const SOFT_WARN_BYTES = 50 * BYTES_PER_MB;
export const HARD_CAP_BYTES = 500 * BYTES_PER_MB;

/** Whole-MB display, matching wireframe copy ("This file is 118 MB..."). */
export function formatMB(bytes: number): number {
  return Math.round(bytes / BYTES_PER_MB);
}
