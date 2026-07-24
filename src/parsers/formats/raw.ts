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

// Any ASCII letter or digit — its presence means the line carries readable
// text and is therefore never decoration. Tested first as a cheap, allocation-
// free reject so ordinary log lines (the overwhelming majority) exit before the
// stripped-copy path below (keeps the `raw` parser's per-line hot path clean).
const HAS_ALNUM_RE = /[A-Za-z0-9]/;
// Box-drawing (U+2500–U+257F) and block-element (U+2580–U+259F) glyphs, with
// interior whitespace allowed — the alphabet startup banners/logos are drawn
// from (e.g. the `███` Redis/MariaDB splash).
const BOX_BLOCK_LINE_RE = /^[\s─-▟]+$/;
// A horizontal rule: 4+ repetitions of a single ASCII separator glyph (after
// interior whitespace is collapsed out).
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
  // Fast, non-allocating reject for the common case (real text present).
  if (HAS_ALNUM_RE.test(line)) return false;
  // Box/block art: match directly (whitespace permitted), no copy needed. The
  // `\S` guard requires at least one non-space glyph so a blank/whitespace line
  // isn't treated as decoration.
  if (/\S/.test(line) && BOX_BLOCK_LINE_RE.test(line)) return true;
  // Separator rule: only now (rare — the line is punctuation-only) collapse
  // interior whitespace and require 4+ of a single rule glyph.
  const stripped = line.replace(/\s+/g, "");
  return stripped.length >= 4 && ASCII_RULE_RE.test(stripped);
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
