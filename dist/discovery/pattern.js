/**
 * Path/glob resolution helpers shared by the project/environment detectors
 * and `traceriver.json` `watch`-entry resolution
 * (docs/specs/003-phase-3-auto-discovery.md § API contract, § Interaction
 * specs "Config watch / discovery dedup"). Pure string/path manipulation —
 * no filesystem access here (existence checks live in the detectors and in
 * src/ingest/tail.ts's chokidar watcher).
 */
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
/** Expands a leading `~` (home directory only — `~user` forms are left as-is). */
export function expandTilde(input) {
    if (input === "~")
        return homedir();
    if (input.startsWith("~/"))
        return join(homedir(), input.slice(2));
    return input;
}
/** True if the pattern contains a glob metacharacter this module understands. */
export function isGlobPattern(pattern) {
    return /[*?]/.test(pattern);
}
/**
 * Resolves a (possibly `~`- or glob-bearing) path/pattern to an absolute
 * string, relative to `baseDir` when not already absolute. Never touches the
 * filesystem — glob expansion against actual files happens later, at watch
 * time (chokidar) and discovery time (detectors' own existence checks).
 */
export function resolvePattern(pattern, baseDir) {
    const expanded = expandTilde(pattern);
    return isAbsolute(expanded) ? expanded : resolve(baseDir, expanded);
}
/**
 * Minimal glob -> RegExp translator (mirrors src/ingest/docker.ts's
 * `globToRegExp`: `*` -> "any characters", `?` -> "any one character",
 * everything else escaped and matched literally) applied to a full,
 * already-resolved absolute path string.
 */
export function globToRegExp(glob) {
    const escaped = glob
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".");
    return new RegExp(`^${escaped}$`);
}
/**
 * True when two resolved, absolute path patterns denote "the same declared
 * target" for config/discovery dedup purposes (docs/specs/
 * 003-phase-3-auto-discovery.md § Interaction specs — "Config watch /
 * discovery dedup"):
 *  - neither is a glob: exact string equality.
 *  - exactly one is a glob: overlap when the literal path matches the glob.
 *  - both are globs: exact string equality only (reconciling two arbitrary
 *    glob *patterns* as denoting an equivalent file set is out of scope —
 *    no acceptance criterion requires it).
 */
export function patternsOverlap(a, b) {
    const aIsGlob = isGlobPattern(a);
    const bIsGlob = isGlobPattern(b);
    if (!aIsGlob && !bIsGlob)
        return a === b;
    if (aIsGlob && bIsGlob)
        return a === b;
    const [glob, literal] = aIsGlob ? [a, b] : [b, a];
    return globToRegExp(glob).test(literal);
}
//# sourceMappingURL=pattern.js.map