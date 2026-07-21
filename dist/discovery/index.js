/**
 * Discovery orchestration: runs the project-root + macOS environment
 * detectors, resolves `traceriver.json` `watch` entries, and dedupes the
 * two by resolved absolute path (config wins) — docs/specs/003-phase-3-
 * auto-discovery.md § Interaction specs "Config watch / discovery dedup".
 * Runs once, synchronously, at server startup (docs/phases/
 * phase-3-auto-discovery.md's detector model: "at startup," never re-run
 * mid-session). Pure orchestration — no filesystem *watching* happens here
 * (that's src/ingest/tail.ts); only the fingerprint/existence checks each
 * detector itself performs.
 */
import { PROJECT_DETECTORS } from "./detectors.js";
import { discoverEnvironmentSources } from "./environment.js";
import { patternsOverlap, resolvePattern } from "./pattern.js";
import { PARSER_BY_NAME } from "../parsers/formats/index.js";
/**
 * `config.discovery.enabled` is read as a strict boolean here (missing ->
 * off) rather than defaulting to `true` — the "default true" resolution
 * belongs solely to src/shared/config.ts's `resolveConfig()` (mirroring how
 * `docker.enabled` is resolved there); a raw `ResolvedConfig` literal built
 * elsewhere (test fixtures, src/server/index.ts's inert startServer()
 * fallback) that omits the field must never be silently activated.
 */
export function runDiscovery(cwd, config) {
    const disabled = new Set(config.discovery.disable ?? []);
    const enabled = config.discovery.enabled ?? false;
    // `watch` entries always resolve and tail regardless of `discovery.enabled`
    // — they're explicit user declarations, independent of the discovery
    // config section (docs/specs/003-phase-3-auto-discovery.md § Interaction
    // specs "discovery.enabled: false / discovery.disable").
    const watchTargets = resolveWatchEntries(config.watch, config.configDir);
    if (!enabled) {
        return { enabled: false, frameworks: [], targets: watchTargets.map((w) => w.target) };
    }
    const frameworks = [];
    const projectTargets = [];
    for (const detector of PROJECT_DETECTORS) {
        if (disabled.has(detector.name))
            continue;
        if (!detector.detect(cwd))
            continue;
        const rawTargets = detector.targets(cwd);
        const hasFileTarget = rawTargets.length > 0;
        frameworks.push({
            detector: detector.name,
            label: detector.label,
            hasFileTarget,
            note: hasFileTarget ? null : detector.note,
        });
        for (const rawPattern of rawTargets) {
            const absolutePattern = resolvePattern(rawPattern, cwd);
            // A watch entry naming the same resolved path wins outright — no
            // separate project-origin source is created for it; the config
            // target (below) is annotated with this detector's name for
            // traceability (docs/specs/003-phase-3-auto-discovery.md § API
            // contract: "detector... Present (non-null) even when origin ===
            // 'config'").
            const overridden = watchTargets.find((w) => patternsOverlap(w.absolutePattern, absolutePattern));
            if (overridden) {
                overridden.matchedDetector = detector.name;
                continue;
            }
            projectTargets.push({
                sourceId: `local:${detector.name}`,
                pattern: absolutePattern,
                local: { origin: "project", detector: detector.name, targetPath: absolutePattern },
            });
        }
    }
    const environmentTargets = [];
    for (const env of discoverEnvironmentSources()) {
        if (disabled.has(env.detector))
            continue;
        environmentTargets.push({
            sourceId: `${env.detector}:${env.slug}`,
            pattern: env.pattern,
            local: { origin: "environment", detector: env.detector, targetPath: env.pattern },
        });
    }
    const configTargets = watchTargets.map((w) => {
        if (w.matchedDetector) {
            w.target.local = { ...w.target.local, detector: w.matchedDetector };
        }
        return w.target;
    });
    return {
        enabled: true,
        frameworks,
        targets: [...projectTargets, ...configTargets, ...environmentTargets],
    };
}
function resolveWatchEntries(entries, configDir) {
    return entries.map((entry) => {
        const absolutePattern = resolvePattern(entry.path, configDir);
        let parserName;
        if (entry.parser) {
            if (PARSER_BY_NAME[entry.parser]) {
                parserName = entry.parser;
            }
            else {
                console.warn(`[traceriver] Warning: watch entry "${entry.label}" pins unknown parser "${entry.parser}" ` +
                    `(expected one of monolog/clf/jsonl/raw) — falling back to auto-detection.`);
            }
        }
        return {
            absolutePattern,
            matchedDetector: null,
            target: {
                sourceId: entry.label,
                pattern: absolutePattern,
                local: { origin: "config", detector: null, targetPath: absolutePattern },
                parserName,
            },
        };
    });
}
//# sourceMappingURL=index.js.map