/**
 * AI-prompt redaction (docs/specs/004-phase-4-error-intelligence.md
 * § Redaction). Two independent passes, both re-run fresh at prompt-assembly
 * time (never reused from ingestion-time fingerprint normalization):
 *
 *   1. Placeholder normalization (`normalizeAndRenderBlock`) — the same
 *      generalization rules fingerprinting uses (src/errors/normalize-text.ts),
 *      applied to the stack-trace/context blocks specifically. Uses `⟨…⟩`.
 *   2. Secret-pattern scrubbing (`redactSecrets`) — applied to the *entire*
 *      assembled prompt string as the last step before it's returned. Uses
 *      the ASCII `<redacted>` marker, deliberately distinct from `⟨…⟩`
 *      above: one means "generalized for grouping," the other means
 *      "scrubbed for safety."
 */
import { normalizeAndRender } from "./normalize-text.js";
/** Placeholder-normalizes a stack-trace/context block (§ Redaction step 1). */
export function normalizeBlockForPrompt(block) {
    return normalizeAndRender(block);
}
const REDACTED = "<redacted>";
/** `Authorization: Bearer <token>` -> `Authorization: Bearer <redacted>`. */
const BEARER_RE = /(Authorization:\s*Bearer\s+)\S+/gi;
// Value charclass deliberately excludes backtick/parens/brackets/pipe too,
// not just quotes/whitespace/`,;&` — the assembled prompt is markdown (code
// fences, a backtick-wrapped title), so a value-matching group with too
// permissive a boundary can swallow trailing markdown syntax right after a
// redacted value (e.g. the title's closing "`"). Requires >=1 char so a
// bare `key:` with nothing after it is never rewritten into a spurious
// `key: <redacted>`.
const SECRET_VALUE_CHARS = "[^\"'\\s,;&`()[\\]|]+";
/** `password=`/`passwd=`/`pwd=` (any case) key-value, `=`/`:`, optionally
 *  quoted key and/or value (covers both bare `password=x` and JSON
 *  `"password": "x"` forms) -> value replaced, key preserved. */
const PASSWORD_KV_RE = new RegExp(`(["']?)\\b(password|passwd|pwd)\\b\\1(\\s*[:=]\\s*)(["']?)(${SECRET_VALUE_CHARS})\\4`, "gi");
/** AWS-style access key ids. */
const AWS_ACCESS_KEY_RE = /\bAKIA[0-9A-Z]{16}\b/g;
/** Generic `api[_-]?key`/`secret`/`token` key-value assignments — `=`, `:`,
 *  or `"key": "value"` JSON form. The key itself may or may not be quoted;
 *  only the value is replaced. */
const GENERIC_SECRET_KV_RE = new RegExp(`(["']?)\\b(api[_-]?key|secret|token)\\b\\1(\\s*[:=]\\s*)(["']?)(${SECRET_VALUE_CHARS})\\4`, "gi");
/**
 * Line-by-line, value-only secret scrubbing (§ Redaction step 2). Applied
 * to the fully-assembled prompt string as the final step before it leaves
 * the server — this is what the user sees in the preview modal.
 */
export function redactSecrets(text) {
    let out = text.replace(BEARER_RE, (_m, prefix) => `${prefix}${REDACTED}`);
    out = out.replace(PASSWORD_KV_RE, (_m, keyQuote, key, sep, valueQuote) => `${keyQuote}${key}${keyQuote}${sep}${valueQuote}${REDACTED}${valueQuote}`);
    out = out.replace(AWS_ACCESS_KEY_RE, REDACTED);
    out = out.replace(GENERIC_SECRET_KV_RE, (_m, keyQuote, key, sep, valueQuote) => `${keyQuote}${key}${keyQuote}${sep}${valueQuote}${REDACTED}${valueQuote}`);
    return out;
}
//# sourceMappingURL=redact.js.map