/**
 * Thin, read-only wrapper around `dockerode`. Exposes exactly `listContainers`,
 * `inspect`, `logs`, and `getEvents` — plus a narrowly-scoped connectivity
 * probe (`resolve`, backed by the read-only `/_ping` endpoint) used only to
 * classify daemon status — and nothing else. No create/exec/remove call
 * exists in this module or anywhere else in the codebase, per
 * docs/architecture.md § Security model and docs/phases/phase-2-docker.md
 * § 2.1.
 *
 * Socket resolution order (docs/phases/phase-2-docker.md § 2.1):
 *   1. `DOCKER_HOST` env var, if set.
 *   2. Platform default (`/var/run/docker.sock` macOS/Linux,
 *      `//./pipe/docker_engine` Windows).
 *   3. Podman-compatible socket (`$XDG_RUNTIME_DIR/podman/podman.sock`),
 *      best-effort.
 * Each candidate is tried in order (a short-timeout `/_ping`) until one
 * responds; the first reachable daemon wins.
 */
// `dockerode` (and its transitive dependency graph — @grpc/grpc-js,
// protobufjs, tar-fs — several MB of module code) is imported *lazily*,
// inside `resolve()`, rather than at module scope: this is a type-only
// import (fully erased at compile time — no runtime `require`/`import` is
// emitted for it), so a server run with `docker.enabled: false` (or one that
// simply hasn't reached its first connect attempt yet) never loads any of
// that module graph into memory. Verified against the memory/RSS budget in
// docs/architecture.md § Packaging & distribution and test/e2e/memory.test.ts
// — eagerly importing dockerode here regressed that test's measured peak RSS
// from the owner-accepted ~263-292 MB range to ~304 MB.
import type Docker from "dockerode";
import type { ContainerInfo, ContainerInspectInfo, ContainerLogsOptions } from "dockerode";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import type { Readable } from "node:stream";
import type { DockerStatus } from "../shared/types.js";

const PING_TIMEOUT_MS = 2000;

export type DockerConnectivity =
  | { status: "connected" }
  | { status: "not_installed"; detail: null }
  | { status: "not_running"; detail: null }
  | { status: "permission_denied"; detail: string };

interface Candidate {
  label: string;
  options: ConstructorParameters<typeof Docker>[0];
  /** Local filesystem path to check for existence when classifying a
   *  failure (unix-socket candidates only; absent for TCP candidates). */
  socketPath?: string;
}

export class DockerClient {
  private docker: Docker | null = null;

  /** Tries each candidate socket in order; resolves to the connectivity
   *  classification. On success, subsequent calls use the connected
   *  instance until `resolve()` is called again. */
  async resolve(): Promise<DockerConnectivity> {
    const { default: DockerCtor } = await import("dockerode");
    const candidates = buildCandidates();
    const errors: Array<{ candidate: Candidate; err: NodeJS.ErrnoException }> = [];

    for (const candidate of candidates) {
      const docker = new DockerCtor(candidate.options);
      try {
        await pingWithTimeout(docker);
        this.docker = docker;
        return { status: "connected" };
      } catch (err) {
        errors.push({ candidate, err: err as NodeJS.ErrnoException });
      }
    }

    this.docker = null;
    return classifyFailure(errors);
  }

  isConnected(): boolean {
    return this.docker !== null;
  }

  async listContainers(): Promise<ContainerInfo[]> {
    if (!this.docker) throw new Error("Docker client not connected");
    return this.docker.listContainers({ all: false });
  }

  async inspect(containerId: string): Promise<ContainerInspectInfo> {
    if (!this.docker) throw new Error("Docker client not connected");
    return this.docker.getContainer(containerId).inspect();
  }

  async logs(containerId: string, opts: ContainerLogsOptions): Promise<Readable> {
    if (!this.docker) throw new Error("Docker client not connected");
    return this.docker.getContainer(containerId).logs(opts);
  }

  async getEvents(): Promise<Readable> {
    if (!this.docker) throw new Error("Docker client not connected");
    return this.docker.getEvents({
      filters: { type: ["container"], event: ["start", "stop", "die", "rename"] },
    });
  }

  /** Splits a non-TTY container's multiplexed log stream into separate
   *  stdout/stderr streams (docs/phases/phase-2-docker.md § 2.3). Read-only:
   *  operates on an already-open stream, makes no daemon call of its own. */
  demuxStream(stream: Readable, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream): void {
    if (!this.docker) throw new Error("Docker client not connected");
    this.docker.modem.demuxStream(stream, stdout, stderr);
  }
}

function pingWithTimeout(docker: Docker): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  (timer as unknown as { unref?: () => void }).unref?.();
  return docker.ping({ abortSignal: controller.signal }).finally(() => clearTimeout(timer));
}

function buildCandidates(): Candidate[] {
  const candidates: Candidate[] = [];

  const dockerHost = process.env.DOCKER_HOST;
  if (dockerHost) {
    const parsed = parseDockerHost(dockerHost);
    if (parsed) candidates.push({ label: `DOCKER_HOST (${dockerHost})`, ...parsed });
  }

  const platformDefault = process.platform === "win32" ? "//./pipe/docker_engine" : "/var/run/docker.sock";
  candidates.push({
    label: `platform default (${platformDefault})`,
    options: { socketPath: platformDefault },
    socketPath: process.platform === "win32" ? undefined : platformDefault,
  });

  const xdgRuntimeDir = process.env.XDG_RUNTIME_DIR;
  if (xdgRuntimeDir) {
    const podmanSocket = `${xdgRuntimeDir}/podman/podman.sock`;
    candidates.push({ label: `podman (${podmanSocket})`, options: { socketPath: podmanSocket }, socketPath: podmanSocket });
  }

  return candidates;
}

function parseDockerHost(value: string): { options: Candidate["options"]; socketPath?: string } | null {
  if (value.startsWith("unix://")) {
    const socketPath = value.slice("unix://".length);
    return { options: { socketPath }, socketPath };
  }
  if (value.startsWith("npipe://")) {
    const socketPath = value.slice("npipe://".length);
    return { options: { socketPath } };
  }
  try {
    const url = new URL(value.includes("://") ? value : `tcp://${value}`);
    const protocol = url.protocol === "tcp:" ? "http" : (url.protocol.replace(":", "") as "http" | "https" | "ssh");
    return {
      options: {
        host: url.hostname,
        port: url.port ? Number(url.port) : undefined,
        protocol,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Classifies a fully-exhausted candidate list into one of the three failure
 * statuses. dockerode/docker-modem surface plain Node socket errors (`code`),
 * which is the only signal available to distinguish these cases:
 *   - EACCES on any candidate  -> permission_denied (a real, fixable problem).
 *   - Otherwise, best-effort "installed?" check (a resolved socket file
 *     exists, or the `docker` CLI is on PATH) -> not_running; else
 *     not_installed. This is a heuristic — dockerode has no direct
 *     "daemon absent vs. daemon down" signal — documented here rather than
 *     asserted as exact.
 */
function classifyFailure(errors: Array<{ candidate: Candidate; err: NodeJS.ErrnoException }>): DockerConnectivity {
  const permissionDenied = errors.find((e) => e.err?.code === "EACCES");
  if (permissionDenied) {
    return { status: "permission_denied", detail: permissionDeniedDetail(permissionDenied.candidate) };
  }

  const anySocketExists = errors.some((e) => e.candidate.socketPath && existsSync(e.candidate.socketPath));
  if (anySocketExists || isDockerCliOnPath()) {
    return { status: "not_running", detail: null };
  }
  return { status: "not_installed", detail: null };
}

function permissionDeniedDetail(candidate: Candidate): string {
  const path = candidate.socketPath ?? "the Docker socket";
  if (process.platform === "linux") {
    return `TraceRiver can't access ${path} — add your user to the docker group (sudo usermod -aG docker $USER) and log back in.`;
  }
  return `TraceRiver can't access ${path} — check the socket's file permissions.`;
}

function isDockerCliOnPath(): boolean {
  try {
    execFileSync("docker", ["--version"], { stdio: "ignore", timeout: 2000 });
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code !== "ENOENT";
  }
}

export type { DockerStatus };
