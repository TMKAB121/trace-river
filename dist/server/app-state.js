import { RingBuffer } from "./ring-buffer.js";
import { Broadcaster } from "./broadcaster.js";
import { SourceRegistry } from "./sources.js";
import { DockerManager } from "../ingest/docker.js";
export function createAppState(opts) {
    const state = {
        ringBuffer: new RingBuffer(opts.config.buffer),
        broadcaster: new Broadcaster(),
        sources: new SourceRegistry(),
        token: opts.token,
        port: opts.port,
        startedAt: Date.now(),
        config: opts.config,
        version: opts.version,
    };
    state.docker = new DockerManager(state, {
        enabled: opts.config.docker.enabled ?? true,
        include: opts.config.docker.include ?? [],
        exclude: opts.config.docker.exclude ?? [],
        cwd: opts.cwd ?? process.cwd(),
    });
    return state;
}
//# sourceMappingURL=app-state.js.map