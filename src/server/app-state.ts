import { RingBuffer } from "./ring-buffer.js";
import { Broadcaster } from "./broadcaster.js";
import { SourceRegistry } from "./sources.js";
import type { ResolvedConfig } from "../shared/config.js";

/** Everything shared across REST routes, the WS endpoint, and ingest adapters. */
export interface AppState {
  readonly ringBuffer: RingBuffer;
  readonly broadcaster: Broadcaster;
  readonly sources: SourceRegistry;
  readonly token: string;
  /** Mutable only during startup's port-resolution retry loop (src/server/index.ts); stable once listening. */
  port: number;
  readonly startedAt: number;
  readonly config: ResolvedConfig;
  readonly version: string;
}

export function createAppState(opts: {
  token: string;
  port: number;
  config: ResolvedConfig;
  version: string;
}): AppState {
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
