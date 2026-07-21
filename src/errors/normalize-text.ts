/**
 * Shared text-normalization rules used by both fingerprinting (docs/specs/
 * 004-phase-4-error-intelligence.md § Interaction specs — Fingerprinting &
 * grouping) and the AI-prompt redaction pass's "placeholder normalization
 * re-run" (§ Redaction, step 1). One set of rules, two call sites, so the
 * two passes never drift apart.
 *
 * Two-stage design:
 *   1. `normalizeToTypedPlaceholders` replaces variable segments with typed
 *      tokens (`<ts>`, `<id>`, `<val>`, `<n>`) — kept distinct internally so
 *      two messages that differ only in *what kind* of variable sits in the
 *      same position don't spuriously merge (conservative-by-design, per
 *      the phase doc's "false merges are worse than false splits").
 *   2. `renderPlaceholders` collapses every typed token down to the single
 *      user-facing glyph `⟨…⟩` the spec's `title`/redaction output uses —
 *      deliberately distinct from the ASCII `<redacted>` marker the secret
 *      scrubbing pass (src/errors/redact.ts) uses; the two passes are
 *      unrelated even though they can touch overlapping text.
 *
 * Rules err conservative (§ Interaction specs): under-normalizing merely
 * risks a false split (acceptable); over-normalizing risks eating literal,
 * meaningful text into a placeholder and causing a false merge (not
 * acceptable) — so every rule below requires a fairly specific shape before
 * it fires.
 *
 * Performance note: this runs on every ERROR/FATAL entry's message + top
 * stack frame at ingestion time (src/server/ingest-entries.ts) — a hot path
 * under sustained error-heavy load. The category rules below are merged
 * into as few `.replace()` passes as correctness allows (one for paths, one
 * combined alternation for everything digit/quote/hex-shaped, one for the
 * case-insensitive keyword-number rule) rather than one pass per rule, to
 * keep per-entry string-allocation churn down (see docs/qa's memory test —
 * this module's allocation rate directly affects measured peak RSS on a
 * sustained, error-heavy upload).
 */

const TYPED_PLACEHOLDER_RE = /<ts>|<id>|<val>|<n>/g;

/** Absolute/relative file paths with at least two segments: keep only the
 *  last two segments (spec's own worked example:
 *  `/Users/x/project/app/Foo.php` -> `app/Foo.php`). Runs first, before any
 *  digit-oriented rule, so a kept static tail's own digits (e.g. a
 *  filename like "v2") are never re-mangled by a later, more generic rule. */
const UNIX_PATH_RE = /(?:\.{0,2}\/)?(?:[\w.\-]+\/)+[\w.\-]+/g;
const WINDOWS_PATH_RE = /[A-Za-z]:\\(?:[\w.\-]+\\)+[\w.\-]+/g;

function collapsePath(path: string, sep: string): string {
  const segments = path.split(sep).filter((s) => s.length > 0 && s !== "." && s !== "..");
  if (segments.length <= 2) return segments.join(sep);
  return segments.slice(-2).join(sep);
}

function normalizePaths(text: string): string {
  let out = text.replace(WINDOWS_PATH_RE, (match) => collapsePath(match, "\\"));
  out = out.replace(UNIX_PATH_RE, (match) => collapsePath(match, "/"));
  return out;
}

// Sub-patterns below are combined into one alternation (`COMBINED_RE`) so a
// single `.replace()` pass handles all of them, in the same effective
// precedence order a sequential multi-pass approach would give (regex
// alternation tries earlier alternatives first at each scan position, and a
// later alternative — `longint` — only ever wins where nothing more
// specific already claimed that span): most-specific first, the
// long-bare-integer catch-all last.
const ISO_TIMESTAMP_SRC = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/.source;
const DATE_ONLY_SRC = /\d{4}-\d{2}-\d{2}/.source;
const TIME_ONLY_SRC = /\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?/.source;
const UUID_SRC = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/.source;
/** Memory addresses (`0x...`). Always wins over `hex` for a `0x`-prefixed
 *  token since `x` is never itself a valid hex digit, so `hex`'s own `\b`
 *  boundary can never bridge across it — ordering between the two doesn't
 *  actually matter for correctness, only listed first for readability. */
const MEMORY_ADDRESS_SRC = /0x[0-9a-fA-F]+/.source;
/** Durations (`342ms`, `1.5s`). */
const DURATION_SRC = /\d+(?:\.\d+)?\s?(?:ms|ns|us|µs|s)/.source;
/** A trailing `:<port>` immediately after a hostname-shaped token. */
const PORT_SRC = /(?<=[A-Za-z0-9_.\-]):\d{2,5}\b/.source;
/** Quoted string/number literals anywhere (`id = 'abc'`). */
const QUOTED_SRC = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/.source;
/** Bare hex strings ≥ 8 chars (git SHAs, request/trace ids, etc). */
const HEX_ID_SRC = /[0-9a-fA-F]{8,}/.source;
/** Long bare integers — catch-all, must stay last in the alternation. */
const LONG_INT_SRC = /\d{6,}/.source;

const COMBINED_RE = new RegExp(
  `\\b(?<ts>${ISO_TIMESTAMP_SRC}|${DATE_ONLY_SRC}|${TIME_ONLY_SRC})\\b` +
    `|\\b(?<uuid>${UUID_SRC})\\b` +
    `|\\b(?<mem>${MEMORY_ADDRESS_SRC})\\b` +
    `|\\b(?<dur>${DURATION_SRC})\\b` +
    `|(?<port>${PORT_SRC})` +
    `|(?<quoted>${QUOTED_SRC})` +
    `|\\b(?<hex>${HEX_ID_SRC})\\b` +
    `|\\b(?<longint>${LONG_INT_SRC})\\b`,
  "g",
);

/** A common "keyword number" position -> `<val>` (`user 12345`). Keeps the
 *  keyword (meaningful) and replaces only the number. Kept as its own pass
 *  (rather than folded into `COMBINED_RE`) since it's case-insensitive
 *  while every other rule above is case-sensitive by construction (hex/UUID
 *  char classes already spell out both cases explicitly) — a single shared
 *  `i` flag would make those rules needlessly (and slightly less
 *  conservatively) case-insensitive too. */
const KEYWORD_NUMBER_RE =
  /\b(user|uid|pid|id|order|order_id|request|request_id|session|session_id)\b(\s*[:=]?\s*)\d+/gi;

function replaceCombined(text: string): string {
  return text.replace(COMBINED_RE, (match: string, ...rest: unknown[]) => {
    const groups = rest[rest.length - 1] as Record<string, string | undefined>;
    if (groups.ts) return "<ts>";
    if (groups.uuid) return "<id>";
    if (groups.mem) return "<n>";
    if (groups.dur) return "<n>";
    if (groups.port) return ":<n>";
    if (groups.quoted) return "<val>";
    if (groups.hex) return "<id>";
    if (groups.longint) return "<id>";
    return match;
  });
}

/**
 * Normalizes a raw text fragment (a log message, a stack-trace frame, an
 * arbitrary block of raw log lines) by replacing variable segments with
 * typed placeholder tokens. Pure, deterministic, side-effect free — safe to
 * call repeatedly (fingerprinting at ingestion time, redaction at
 * prompt-assembly time re-run this fresh rather than reusing a cached pass,
 * per docs/specs/004-phase-4-error-intelligence.md § Redaction).
 */
export function normalizeToTypedPlaceholders(text: string): string {
  let out = normalizePaths(text);
  out = replaceCombined(out);
  out = out.replace(KEYWORD_NUMBER_RE, (_match, keyword: string, sep: string) => `${keyword}${sep}<val>`);
  return out;
}

/** Collapses every typed placeholder token down to the single user-facing
 *  `⟨…⟩` glyph (docs/specs/004-phase-4-error-intelligence.md § Interaction
 *  specs — Fingerprinting & grouping, step 4). */
export function renderPlaceholders(normalizedTyped: string): string {
  return normalizedTyped.replace(TYPED_PLACEHOLDER_RE, "⟨…⟩");
}

/** Convenience: normalize then render in one pass — what fingerprinting's
 *  `title` and the prompt redaction's "placeholder normalization re-run"
 *  both actually want to display. */
export function normalizeAndRender(text: string): string {
  return renderPlaceholders(normalizeToTypedPlaceholders(text));
}
