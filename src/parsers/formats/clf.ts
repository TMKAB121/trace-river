import type { AggregatedEntry, FormatParser, ParsedFields } from "./types.js";

// Combined/Common Log Format access line:
// 127.0.0.1 - - [19/Jul/2026:15:31:01 +0000] "GET /api/users HTTP/1.1" 200 1234 "ref" "ua"
const ACCESS_RE =
  /^(?<ip>\S+) (?<ident>\S+) (?<user>\S+) \[(?<timestamp>[^\]]+)\] "(?<method>[A-Z]+) (?<path>\S+)(?: (?<protocol>[^"]+))?" (?<status>\d{3}) (?<size>\S+)(?: "(?<referer>[^"]*)" "(?<ua>[^"]*)")?/;

// Nginx/Apache error-log format:
// [Wed Oct 11 14:32:52 2026] [error] [client 1.2.3.4] message
const ERROR_RE = /^\[(?<timestamp>[^\]]+)\]\s+\[(?<level>\w+)\](?:\s+\[[^\]]*\])*\s+(?<message>.*)$/;

// `entryStart` only detects an entry boundary; it never reads capture groups
// (field extraction uses ACCESS_RE/ERROR_RE directly in parse()). Strip the
// named groups before combining so the alternation doesn't declare <timestamp>
// twice: duplicate named capture groups only became legal in V8 12.4 / Node 22,
// and TraceRiver supports Node >=20 (package.json engines), where the combined
// pattern throws "Duplicate capture group name" at module load. Non-capturing
// groups match identically, so detection behavior is unchanged.
const stripGroupNames = (src: string): string =>
  src.replace(/\(\?<[A-Za-z_$][\w$]*>/g, "(?:");
const ENTRY_START_RE = new RegExp(
  `(?:${stripGroupNames(ACCESS_RE.source)})|(?:${stripGroupNames(ERROR_RE.source)})`,
);

const ERROR_LEVEL_MAP: Record<string, string> = {
  emerg: "FATAL",
  alert: "FATAL",
  crit: "FATAL",
  error: "ERROR",
  warn: "WARN",
  notice: "INFO",
  info: "INFO",
  debug: "DEBUG",
};

function levelFromStatus(status: number): string {
  if (status >= 500) return "ERROR";
  if (status >= 400) return "WARN";
  return "INFO";
}

export const clfParser: FormatParser = {
  name: "clf",
  entryStart: ENTRY_START_RE,
  timestampHint: "clf",

  score(line: string): number {
    if (ACCESS_RE.test(line)) return 0.9;
    if (ERROR_RE.test(line)) return 0.85;
    return 0;
  },

  parse(entry: AggregatedEntry): ParsedFields {
    const firstLine = entry.lines[0] ?? "";

    const access = firstLine.match(ACCESS_RE);
    if (access?.groups) {
      const g = access.groups;
      const status = Number(g.status);
      const context: Record<string, unknown> = {
        ip: g.ip,
        method: g.method,
        path: g.path,
        protocol: g.protocol ?? null,
        status,
        size: g.size === "-" ? null : Number(g.size) || g.size,
      };
      if (g.referer !== undefined) context.referer = g.referer;
      if (g.ua !== undefined) context.userAgent = g.ua;
      return {
        level: levelFromStatus(status),
        rawTimestamp: g.timestamp ?? null,
        message: `${g.method} ${g.path} - ${g.status}`,
        context,
      };
    }

    const errorMatch = firstLine.match(ERROR_RE);
    if (errorMatch?.groups) {
      const g = errorMatch.groups;
      const normalizedLevel = ERROR_LEVEL_MAP[g.level.toLowerCase()] ?? null;
      return {
        level: normalizedLevel,
        rawTimestamp: g.timestamp ?? null,
        message: g.message ?? firstLine,
        context: null,
      };
    }

    return { level: null, rawTimestamp: null, message: firstLine, context: null };
  },
};
