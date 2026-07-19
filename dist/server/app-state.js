import { RingBuffer } from "./ring-buffer.js";
import { Broadcaster } from "./broadcaster.js";
import { SourceRegistry } from "./sources.js";
export function createAppState(opts) {
    return {
        ringBuffer: new RingBuffer(opts.config.buffer),
        broadcaster: new Broadcaster(),
        sources: new SourceRegistry(),
        token: opts.token,
        port: opts.port,
        startedAt: Date.now(),
        config: opts.config,
        version: opts.version,
    };
}
//# sourceMappingURL=app-state.js.map