/**
 * Minimal local type surface for the small slice of the `dockerode` API this
 * project touches.
 *
 * `dockerode` ships no bundled TypeScript declarations (verified: its
 * published tarball contains only `.js` files under `lib/`), and
 * `@types/dockerode` is not on the dependency allowlist (`.claude/lanes.json`
 * — see CLAUDE.md § Dependency policy). Per the task's explicit fallback
 * guidance ("prefer a minimal local type surface... if adequate"), this
 * hand-written ambient module declaration covers ONLY the read-only surface
 * routed through `src/ingest/docker-client.ts` (listContainers, inspect,
 * logs, getEvents, ping, and the demux helper on `.modem`) — it is
 * intentionally not a general-purpose dockerode type definition, and no
 * create/exec/remove method is declared here (matching the hard rule that no
 * such call exists anywhere in the codebase).
 */
declare module "dockerode" {
  import type { Readable } from "node:stream";

  export interface DockerOptions {
    socketPath?: string;
    host?: string;
    port?: number | string;
    protocol?: "http" | "https" | "ssh";
    timeout?: number;
  }

  export interface ContainerInfo {
    Id: string;
    Names: string[];
    Image: string;
    Labels: Record<string, string>;
    State: string;
    Status: string;
    Created: number;
  }

  export interface ContainerInspectInfo {
    Id: string;
    Name: string;
    State: {
      Status: string;
      Running: boolean;
    };
    Config: {
      Image: string;
      Tty: boolean;
      Labels: Record<string, string>;
    };
  }

  export interface ContainerLogsOptions {
    follow?: boolean;
    stdout?: boolean;
    stderr?: boolean;
    tail?: number | string;
    timestamps?: boolean;
    /**
     * Unix epoch seconds, optionally with a fractional-nanosecond suffix
     * (e.g. `"1784548312.017379761"`) — the Docker Engine API accepts this
     * higher-precision string form in addition to a plain integer, which
     * `src/ingest/docker.ts` relies on to scope a restart-recovery reattach's
     * `since` filter to nanosecond precision (docs/qa/defects/
     * 002-phase-2-docker-3.md).
     */
    since?: number | string;
    abortSignal?: AbortSignal;
  }

  export interface ListContainersOptions {
    all?: boolean;
  }

  export interface DockerEventsOptions {
    filters?: Record<string, string[]>;
    since?: number;
    abortSignal?: AbortSignal;
  }

  export interface PingOptions {
    abortSignal?: AbortSignal;
  }

  export class DockerModem {
    demuxStream(stream: Readable, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream): void;
  }

  export class DockerContainer {
    constructor(modem: DockerModem, id: string);
    id: string;
    inspect(): Promise<ContainerInspectInfo>;
    logs(opts: ContainerLogsOptions): Promise<Readable>;
  }

  export default class Docker {
    constructor(options?: DockerOptions);
    modem: DockerModem;
    listContainers(opts?: ListContainersOptions): Promise<ContainerInfo[]>;
    getContainer(id: string): DockerContainer;
    getEvents(opts?: DockerEventsOptions): Promise<Readable>;
    ping(opts?: PingOptions): Promise<Buffer | string>;
  }
}
