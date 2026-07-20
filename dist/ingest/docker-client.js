import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
const PING_TIMEOUT_MS = 2000;
export class DockerClient {
    docker = null;
    /** Tries each candidate socket in order; resolves to the connectivity
     *  classification. On success, subsequent calls use the connected
     *  instance until `resolve()` is called again. */
    async resolve() {
        const { default: DockerCtor } = await import("dockerode");
        const candidates = buildCandidates();
        const errors = [];
        for (const candidate of candidates) {
            const docker = new DockerCtor(candidate.options);
            try {
                await pingWithTimeout(docker);
                this.docker = docker;
                return { status: "connected" };
            }
            catch (err) {
                errors.push({ candidate, err: err });
            }
        }
        this.docker = null;
        return classifyFailure(errors);
    }
    isConnected() {
        return this.docker !== null;
    }
    async listContainers() {
        if (!this.docker)
            throw new Error("Docker client not connected");
        return this.docker.listContainers({ all: false });
    }
    async inspect(containerId) {
        if (!this.docker)
            throw new Error("Docker client not connected");
        return this.docker.getContainer(containerId).inspect();
    }
    async logs(containerId, opts) {
        if (!this.docker)
            throw new Error("Docker client not connected");
        return this.docker.getContainer(containerId).logs(opts);
    }
    async getEvents() {
        if (!this.docker)
            throw new Error("Docker client not connected");
        return this.docker.getEvents({
            filters: { type: ["container"], event: ["start", "stop", "die", "rename"] },
        });
    }
    /** Splits a non-TTY container's multiplexed log stream into separate
     *  stdout/stderr streams (docs/phases/phase-2-docker.md § 2.3). Read-only:
     *  operates on an already-open stream, makes no daemon call of its own. */
    demuxStream(stream, stdout, stderr) {
        if (!this.docker)
            throw new Error("Docker client not connected");
        this.docker.modem.demuxStream(stream, stdout, stderr);
    }
}
function pingWithTimeout(docker) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
    timer.unref?.();
    return docker.ping({ abortSignal: controller.signal }).finally(() => clearTimeout(timer));
}
function buildCandidates() {
    const candidates = [];
    const dockerHost = process.env.DOCKER_HOST;
    if (dockerHost) {
        const parsed = parseDockerHost(dockerHost);
        if (parsed)
            candidates.push({ label: `DOCKER_HOST (${dockerHost})`, ...parsed });
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
function parseDockerHost(value) {
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
        const protocol = url.protocol === "tcp:" ? "http" : url.protocol.replace(":", "");
        return {
            options: {
                host: url.hostname,
                port: url.port ? Number(url.port) : undefined,
                protocol,
            },
        };
    }
    catch {
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
function classifyFailure(errors) {
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
function permissionDeniedDetail(candidate) {
    const path = candidate.socketPath ?? "the Docker socket";
    if (process.platform === "linux") {
        return `TraceRiver can't access ${path} — add your user to the docker group (sudo usermod -aG docker $USER) and log back in.`;
    }
    return `TraceRiver can't access ${path} — check the socket's file permissions.`;
}
function isDockerCliOnPath() {
    try {
        execFileSync("docker", ["--version"], { stdio: "ignore", timeout: 2000 });
        return true;
    }
    catch (err) {
        return err?.code !== "ENOENT";
    }
}
//# sourceMappingURL=docker-client.js.map