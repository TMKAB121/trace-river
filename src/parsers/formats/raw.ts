import type { AggregatedEntry, FormatParser, ParsedFields } from "./types.js";
import { GENERIC_ENTRY_START } from "../continuation-heuristic.js";

// Whole-word keyword scan, case-insensitive, per docs/log-schema.md.
const KEYWORD_LEVEL_TESTS: Array<[RegExp, string]> = [
  [/\bfatal\b/i, "FATAL"],
  [/\bexception\b/i, "ERROR"],
  [/\berror\b/i, "ERROR"],
  [/\bwarn(?:ing)?\b/i, "WARN"],
];

function keywordLevel(line: string): string | null {
  for (const [re, level] of KEYWORD_LEVEL_TESTS) {
    if (re.test(line)) return level;
  }
  return null;
}

// Box-drawing (U+2500–U+257F) and block-element (U+2580–U+259F) glyphs — the
// alphabet startup banners/logos are drawn from (e.g. the `███` Redis/MariaDB
// splash).
const BOX_BLOCK_ONLY_RE = /^[─-▟]+$/;
// A horizontal rule: 4+ repetitions of a single ASCII separator glyph.
const ASCII_RULE_RE = /^([=\-_~*#+])\1{3,}$/;

/**
 * A pure-decoration line — startup-banner ASCII art or a separator rule, with
 * no readable message. Bitnami/Redis/MariaDB images emit a lot of these on
 * their startup streams; left alone they surface as their own UNKNOWN rows
 * (or, on a stderr stream carrying a WARN floor, as spurious WARN rows) and
 * read as noise/warnings (issue #8). We only match when *every* non-whitespace
 * character is decoration — a line with any letter or digit (e.g. a comment
 * like `# Based on https://…`) is never treated as decoration.
 */
function isDecorationLine(line: string): boolean {
  const stripped = line.replace(/\s+/g, "");
  if (stripped.length < 3) return false;
  return BOX_BLOCK_ONLY_RE.test(stripped) || ASCII_RULE_RE.test(stripped);
}

/**
 * The `raw` fallback parser. Always matches — it's the last link in the
 * chain — but its `score()` deliberately stays below the 0.8 auto-lock
 * threshold so it's only ever the *committed* choice when nothing else
 * scores meaningfully, never something that "wins" a lock race.
 */
export const rawParser: FormatParser = {
  name: "raw",
  entryStart: GENERIC_ENTRY_START,
  timestampHint: "none",

  score(): number {
    return 0.05;
  },

  parse(entry: AggregatedEntry): ParsedFields {
    const firstLine = entry.lines[0] ?? "";
    // A decoration line self-classifies as DEBUG so it sinks below the default
    // view instead of surfacing as an UNKNOWN/floored-WARN noise row — and,
    // being non-UNKNOWN, it is never lifted by a stream's level floor.
    const level = isDecorationLine(firstLine) ? "DEBUG" : keywordLevel(firstLine);
    return {
      level,
      rawTimestamp: null,
      message: firstLine,
      context: null,
    };
  },
};
