import { RingBuffer } from "./ring-buffer.js";
import { Broadcaster } from "./broadcaster.js";
import { SourceRegistry } from "./sources.js";
import { DockerManager } from "../ingest/docker.js";
import { TailManager } from "../ingest/tail.js";
import { runDiscovery } from "../discovery/index.js";
import { ErrorGroupStore } from "../errors/error-store.js";
export function createAppState(opts) {
    const cwd = opts.cwd ?? process.cwd();
    const ringBuffer = new RingBuffer(opts.config.buffer);
    const state = {
        ringBuffer,
        broadcaster: new Broadcaster(),
        sources: new SourceRegistry(),
        token: opts.token,
        port: opts.port,
        startedAt: Date.now(),
        config: opts.config,
        version: opts.version,
        errorGroups: new ErrorGroupStore(ringBuffer),
        parserNames: new Map(),
    };
    state.docker = new DockerManager(state, {
        enabled: opts.config.docker.enabled ?? true,
        include: opts.config.docker.include ?? [],
        exclude: opts.config.docker.exclude ?? [],
        cwd,
    });
    // Fingerprinting/dedup is synchronous (fast fs.existsSync checks — see
    // src/discovery/); only actually watching the resolved targets
    // (TailManager.start(), awaited by src/server/index.ts before the WS
    // endpoint accepts connections) is async.
    const discoveryResult = runDiscovery(cwd, opts.config);
    state.discovery = {
        enabled: discoveryResult.enabled,
        frameworks: discoveryResult.frameworks,
    };
    state.tail = new TailManager(state, discoveryResult.targets);
    return state;
}
//# sourceMappingURL=app-state.js.map