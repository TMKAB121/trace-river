import type { AggregatedEntry, FormatParser, ParsedFields } from "./types.js";

/**
 * Bitnami container-library log line, emitted by the `liblog.sh` helper every
 * Bitnami image's entrypoint/setup scripts use:
 *
 *   <module> <HH:MM:SS.ff> <LEVEL> ==> <message>
 *   e.g.  postgresql 15:31:15.42 INFO  ==> Starting PostgreSQL setup
 *
 * The layout is `printf "%s %s %-5.5s ==> %s"` — module name, a bare wall-clock
 * time (no date), a 5-width left-justified level, the literal `==>` marker, and
 * the message. These scripts write to **stderr**, so without recognizing the
 * self-declared level here every line is left UNKNOWN and then floored up to
 * WARN by the docker adapter's stderr level floor — turning self-declared
 * INFO/DEBUG bootstrap chatter into a wall of spurious warnings (issue #8).
 *
 * The embedded time carries no date and cannot be trusted for ordering, so it
 * is deliberately discarded (`rawTimestamp: null`, `timestampHint: "none"`) —
 * the pipeline falls back to Docker's per-line RFC3339 timestamp instead.
 */
const BITNAMI_RE =
  /^(?<module>[a-z][a-z0-9._-]*)\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?\s+(?<level>DEBUG|INFO|WARN|ERROR)\s+==>\s?(?<message>.*)$/;

export const bitnamiParser: FormatParser = {
  name: "bitnami",
  entryStart: BITNAMI_RE,
  timestampHint: "none",

  score(line: string): number {
    return BITNAMI_RE.test(line) ? 0.9 : 0;
  },

  parse(entry: AggregatedEntry): ParsedFields {
    const firstLine = entry.lines[0] ?? "";
    const match = firstLine.match(BITNAMI_RE);
    if (!match?.groups) {
      return { level: null, rawTimestamp: null, message: firstLine, context: null };
    }
    return {
      level: match.groups.level,
      rawTimestamp: null,
      message: match.groups.message,
      context: null,
    };
  },
};
