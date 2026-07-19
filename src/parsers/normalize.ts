import type { LogLevel } from "../shared/types.js";

/** Source-value → normalized 6-value enum, per docs/log-schema.md § Normalization. */
const LEVEL_MAP: Record<string, LogLevel> = {
  debug: "DEBUG",
  trace: "DEBUG",
  verbose: "DEBUG",
  info: "INFO",
  notice: "INFO",
  warn: "WARN",
  warning: "WARN",
  error: "ERROR",
  err: "ERROR",
  critical: "FATAL",
  crit: "FATAL",
  alert: "FATAL",
  emergency: "FATAL",
  emerg: "FATAL",
  fatal: "FATAL",
  panic: "FATAL",
};

// pino numeric levels: 10=trace,20=debug,30=info,40=warn,50=error,60=fatal
const PINO_NUMERIC_MAP: Array<[number, LogLevel]> = [
  [60, "FATAL"],
  [50, "ERROR"],
  [40, "WARN"],
  [30, "INFO"],
  [20, "DEBUG"],
  [10, "DEBUG"],
];

export function normalizeLevel(rawLevel: string | null): LogLevel {
  if (rawLevel === null || rawLevel === undefined || rawLevel === "") return "UNKNOWN";

  const trimmed = rawLevel.trim();
  if (/^-?\d+$/.test(trimmed)) {
    const numeric = Number(trimmed);
    for (const [threshold, level] of PINO_NUMERIC_MAP) {
      if (numeric >= threshold) return level;
    }
    return "UNKNOWN";
  }

  const mapped = LEVEL_MAP[trimmed.toLowerCase()];
  return mapped ?? "UNKNOWN";
}

export type TimestampHint = "monolog" | "clf" | "iso-or-epoch" | "none";

const MONTH_ABBR: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

const MONOLOG_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/;
const CLF_RE = /^(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})\s+([+-]\d{4})$/;

function parseMonolog(raw: string): number | null {
  const m = raw.match(MONOLOG_RE);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, frac] = m;
  const ms = frac ? Math.round(Number(`0.${frac}`) * 1000) : 0;
  // No timezone info present: assumed to be the host's local zone (documented in log-schema.md).
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), ms);
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
}

function parseClf(raw: string): number | null {
  const m = raw.match(CLF_RE);
  if (!m) return null;
  const [, d, monAbbr, y, h, mi, s, offset] = m;
  const month = MONTH_ABBR[monAbbr.toLowerCase()];
  if (month === undefined) return null;
  const utcMs = Date.UTC(Number(y), month, Number(d), Number(h), Number(mi), Number(s));
  const sign = offset[0] === "-" ? -1 : 1;
  const offsetHours = Number(offset.slice(1, 3));
  const offsetMinutes = Number(offset.slice(3, 5));
  const offsetMs = sign * (offsetHours * 60 + offsetMinutes) * 60_000;
  return utcMs - offsetMs;
}

function parseIsoOrEpoch(raw: string): number | null {
  const trimmed = raw.trim();
  if (/^-?\d+$/.test(trimmed)) {
    const numeric = Number(trimmed);
    // Heuristic: >= 1e12 already ms, >= 1e9 seconds, otherwise treat as ms.
    if (Math.abs(numeric) >= 1e12) return numeric;
    if (Math.abs(numeric) >= 1e9) return numeric * 1000;
    return numeric;
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Normalize a raw timestamp string into epoch ms UTC, given a hint about
 * which parser produced it. Falls back to arrival time when unparseable or
 * absent, preserving `rawTimestamp` regardless (per docs/log-schema.md).
 */
export function normalizeTimestamp(
  raw: string | null,
  hint: TimestampHint,
  arrivalTimeMs: number = Date.now(),
): { timestamp: number; rawTimestamp: string | null } {
  if (raw === null || raw === "") {
    return { timestamp: arrivalTimeMs, rawTimestamp: null };
  }

  let parsed: number | null = null;
  switch (hint) {
    case "monolog":
      parsed = parseMonolog(raw);
      break;
    case "clf":
      parsed = parseClf(raw);
      break;
    case "iso-or-epoch":
      parsed = parseIsoOrEpoch(raw);
      break;
    case "none":
      parsed = null;
      break;
  }

  // Fall back to a generic attempt regardless of hint — a locked parser's
  // hint is a strong prior, not a guarantee (e.g. a raw-fallback entry that
  // happens to contain an ISO date some other way).
  if (parsed === null) parsed = parseMonolog(raw) ?? parseClf(raw) ?? parseIsoOrEpoch(raw);

  return { timestamp: parsed ?? arrivalTimeMs, rawTimestamp: raw };
}
