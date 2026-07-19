import { GENERIC_ENTRY_START } from "../continuation-heuristic.js";
// Whole-word keyword scan, case-insensitive, per docs/log-schema.md.
const KEYWORD_LEVEL_TESTS = [
    [/\bfatal\b/i, "FATAL"],
    [/\bexception\b/i, "ERROR"],
    [/\berror\b/i, "ERROR"],
    [/\bwarn(?:ing)?\b/i, "WARN"],
];
function keywordLevel(line) {
    for (const [re, level] of KEYWORD_LEVEL_TESTS) {
        if (re.test(line))
            return level;
    }
    return null;
}
/**
 * The `raw` fallback parser. Always matches — it's the last link in the
 * chain — but its `score()` deliberately stays below the 0.8 auto-lock
 * threshold so it's only ever the *committed* choice when nothing else
 * scores meaningfully, never something that "wins" a lock race.
 */
export const rawParser = {
    name: "raw",
    entryStart: GENERIC_ENTRY_START,
    timestampHint: "none",
    score() {
        return 0.05;
    },
    parse(entry) {
        const firstLine = entry.lines[0] ?? "";
        return {
            level: keywordLevel(firstLine),
            rawTimestamp: null,
            message: firstLine,
            context: null,
        };
    },
};
//# sourceMappingURL=raw.js.map