const LEVEL_KEYS = ["level", "severity", "lvl"];
const MESSAGE_KEYS = ["msg", "message"];
const TIME_KEYS = ["time", "ts", "timestamp", "@timestamp"];
const LOOKS_LIKE_JSON_RE = /^\s*\{/;
function firstDefined(obj, keys) {
    for (const key of keys) {
        if (obj[key] !== undefined)
            return obj[key];
    }
    return undefined;
}
function tryParseObject(line) {
    if (!LOOKS_LIKE_JSON_RE.test(line))
        return null;
    try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed;
        }
        return null;
    }
    catch {
        return null;
    }
}
export const jsonlParser = {
    name: "jsonl",
    entryStart: LOOKS_LIKE_JSON_RE,
    timestampHint: "iso-or-epoch",
    score(line) {
        return tryParseObject(line) ? 0.95 : 0;
    },
    parse(entry) {
        const firstLine = entry.lines[0] ?? "";
        const obj = tryParseObject(firstLine);
        if (!obj) {
            return { level: null, rawTimestamp: null, message: firstLine, context: null };
        }
        const levelRaw = firstDefined(obj, LEVEL_KEYS);
        const messageRaw = firstDefined(obj, MESSAGE_KEYS);
        const timeRaw = firstDefined(obj, TIME_KEYS);
        const mappedKeys = new Set([...LEVEL_KEYS, ...MESSAGE_KEYS, ...TIME_KEYS]);
        const rest = {};
        for (const [key, value] of Object.entries(obj)) {
            if (!mappedKeys.has(key))
                rest[key] = value;
        }
        return {
            level: levelRaw === undefined || levelRaw === null ? null : String(levelRaw),
            rawTimestamp: timeRaw === undefined || timeRaw === null ? null : String(timeRaw),
            message: messageRaw === undefined || messageRaw === null ? firstLine : String(messageRaw),
            context: Object.keys(rest).length > 0 ? rest : null,
        };
    },
};
//# sourceMappingURL=jsonl.js.map