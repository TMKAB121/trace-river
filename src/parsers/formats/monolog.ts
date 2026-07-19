import type { AggregatedEntry, FormatParser, ParsedFields } from "./types.js";

// `[2026-07-19 15:31:15] production.ERROR: message {"ctx":1} []`
const MONOLOG_RE =
  /^\[(?<timestamp>\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?)\]\s+(?<channel>[\w.-]+)\.(?<level>[A-Z]+):\s+(?<rest>.*)$/;

// Monolog's default line formatter appends ` {context-json} [extra-json]` after
// the message; both are frequently `[]` / `{}` when empty.
const TRAILING_BLOBS_RE = /^(?<message>.*?)(?:\s+(?<context>\{.*\})\s+(?<extra>\[.*\]))?$/s;

function tryParseJson(text: string | undefined): unknown | undefined {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export const monologParser: FormatParser = {
  name: "monolog",
  entryStart: MONOLOG_RE,
  timestampHint: "monolog",

  score(line: string): number {
    return MONOLOG_RE.test(line) ? 0.9 : 0;
  },

  parse(entry: AggregatedEntry): ParsedFields {
    const firstLine = entry.lines[0] ?? "";
    const match = firstLine.match(MONOLOG_RE);
    if (!match || !match.groups) {
      return { level: null, rawTimestamp: null, message: firstLine, context: null };
    }
    const { timestamp, level, rest } = match.groups;
    let message = rest ?? "";
    let context: Record<string, unknown> | null = null;

    const blobMatch = (rest ?? "").match(TRAILING_BLOBS_RE);
    if (blobMatch?.groups?.context !== undefined) {
      // Matched the trailing ` {context} [extra]` pair (Monolog always appends
      // both, even when empty) — strip it from the displayed message regardless,
      // and only surface non-empty blobs in `context`.
      const msgPart = blobMatch.groups.message ?? rest ?? "";
      const contextJson = tryParseJson(blobMatch.groups.context);
      const extraJson = tryParseJson(blobMatch.groups.extra);
      const contextObj =
        contextJson && typeof contextJson === "object" && Object.keys(contextJson as object).length > 0
          ? (contextJson as Record<string, unknown>)
          : undefined;
      const extraObj =
        Array.isArray(extraJson) && extraJson.length === 0
          ? undefined
          : extraJson && typeof extraJson === "object" && Object.keys(extraJson as object).length > 0
            ? (extraJson as Record<string, unknown>)
            : undefined;
      message = msgPart.trimEnd();
      if (contextObj || extraObj) {
        context = { ...(contextObj ? { context: contextObj } : {}), ...(extraObj ? { extra: extraObj } : {}) };
      }
    }

    // Continuation lines (stack trace etc.) beyond the first are not re-parsed,
    // they simply extend `body` at the normalization stage via entry.raw.

    return { level: level ?? null, rawTimestamp: timestamp ?? null, message, context };
  },
};
