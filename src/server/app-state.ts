import { RingBuffer } from "./ring-buffer.js";
import { Broadcaster } from "./broadcaster.js";
import { SourceRegistry } from "./sources.js";
import { DockerManager } from "../ingest/docker.js";
import { TailManager } from "../ingest/tail.js";
import { runDiscovery } from "../discovery/index.js";
import type { ResolvedConfig } from "../shared/config.js";
import type { DetectedFramework } from "../shared/types.js";

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
  /** Always present; inert (never connects, never sends `dockerStatus`) when
   *  `config.docker.enabled` is false — docs/specs/002-phase-2-docker.md. */
  readonly docker: DockerManager;
  /** Always present; inert (empty target list, `enabled: false`) when
   *  `config.discovery.enabled` is false — docs/specs/003-phase-3-auto-
   *  discovery.md. `frameworks`/`enabled` are fixed at startup (fingerprinting
   *  runs once); `tail` is the live adapter that actually reads the files. */
  readonly discovery: { enabled: boolean; frameworks: DetectedFramework[] };
  readonly tail: TailManager;
}

export function createAppState(opts: {
  token: string;
  port: number;
  config: ResolvedConfig;
  version: string;
  /** Project root for compose-project filtering and framework fingerprinting
   *  (docs/configuration.md: "traceriver start treats the current working
   *  directory as the project root"). Defaults to the process's actual cwd. */
  cwd?: string;
}): AppState {
  const cwd = opts.cwd ?? process.cwd();

  const state = {
    ringBuffer: new RingBuffer(opts.config.buffer),
    broadcaster: new Broadcaster(),
    sources: new SourceRegistry(),
    token: opts.token,
    port: opts.port,
    startedAt: Date.now(),
    config: opts.config,
    version: opts.version,
  } as AppState;

  (state as { docker: DockerManager }).docker = new DockerManager(state, {
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
  (state as { discovery: AppState["discovery"] }).discovery = {
    enabled: discoveryResult.enabled,
    frameworks: discoveryResult.frameworks,
  };
  (state as { tail: TailManager }).tail = new TailManager(state, discoveryResult.targets);

  return state;
}
