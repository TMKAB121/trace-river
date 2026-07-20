/**
 * Docker ingest adapter — discovery, global subscription, live stream
 * attachment/demultiplexing, and lifecycle (start/stop/restart/rename),
 * wired into the same Uniform Parser Pipeline every other source uses.
 * See docs/specs/002-phase-2-docker.md and docs/phases/phase-2-docker.md.
 *
 * One `DockerManager` per server process, created regardless of
 * `docker.enabled` (so the rest of the server always has something to call)
 * but only ever connects/discovers/streams when enabled — when disabled, no
 * socket connection is attempted and no `dockerStatus` message is ever sent
 * (docs/specs/002-phase-2-docker.md § Config surface consumed).
 */
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { Writable } from "node:stream";
import { DockerClient } from "./docker-client.js";
import { SourcePipeline } from "../parsers/pipeline.js";
const POLL_INTERVAL_MS = 10_000;
const EVENTS_RECONNECT_BASE_MS = 1000;
const EVENTS_RECONNECT_MAX_MS = 30_000;
const PARTIAL_LINE_IDLE_MS = 2000; // mirrors src/parsers/line-splitter.ts's LINE_SPLITTER_IDLE_MS intent.
// Docker's `timestamps: true` prefix: RFC3339Nano, always UTC ("Z"), one
// space before the actual log content.
const DOCKER_TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z) (.*)$/;
export class DockerManager {
    state;
    enabled;
    includeGlobs;
    excludeGlobs;
    projectName;
    client = new DockerClient();
    containers = new Map();
    // Neutral placeholder until the first connect attempt resolves; never
    // broadcast on its own (only real transitions are). GET /api/docker/status
    // before that first attempt (or when docker.enabled is false) returns this.
    status = "not_installed";
    detail = null;
    pollTimer = null;
    eventsReconnectAttempt = 0;
    eventsReconnectTimer = null;
    eventsStream = null;
    stopped = false;
    constructor(state, opts) {
        this.state = state;
        this.enabled = opts.enabled;
        this.includeGlobs = opts.include;
        this.excludeGlobs = opts.exclude;
        this.projectName = resolveProjectName(opts.cwd);
    }
    async start() {
        if (!this.enabled)
            return;
        await this.attemptConnect();
    }
    /** Stops all polling/reconnect timers and destroys every open stream —
     *  called on server shutdown so nothing outlives the process. */
    stop() {
        this.stopped = true;
        this.stopPoll();
        if (this.eventsReconnectTimer) {
            clearTimeout(this.eventsReconnectTimer);
            this.eventsReconnectTimer = null;
        }
        if (this.eventsStream) {
            this.eventsStream.destroy();
            this.eventsStream = null;
        }
        for (const sourceId of this.containers.keys())
            this.detach(sourceId);
    }
    getStatus() {
        return { status: this.status, detail: this.detail };
    }
    /** Server-global subscribe/unsubscribe for a `docker:<name>` source id —
     *  see docs/specs/002-phase-2-docker.md § Interaction specs, Decision 5.
     *  No-op for unknown/non-docker ids (routing happens in src/server/ws.ts). */
    async setSubscribed(sourceId, subscribed) {
        const source = this.state.sources.get(sourceId);
        if (!source || source.kind !== "docker")
            return;
        if (source.subscribed === subscribed)
            return;
        this.state.sources.setSubscribed(sourceId, subscribed);
        this.state.broadcaster.broadcastSources(this.state.sources.list());
        if (subscribed) {
            await this.attach(sourceId);
        }
        else {
            this.detach(sourceId);
        }
    }
    // -- Connectivity -----------------------------------------------------
    async attemptConnect() {
        if (this.stopped)
            return;
        const result = await this.client.resolve();
        if (this.stopped)
            return;
        if (result.status === "connected") {
            this.setStatus("connected", null);
            this.stopPoll();
            await this.discoverAll();
            this.watchEvents();
        }
        else {
            this.setStatus(result.status, result.detail);
            this.startPoll();
        }
    }
    setStatus(status, detail) {
        if (this.status === status && this.detail === detail)
            return;
        this.status = status;
        this.detail = detail;
        this.state.broadcaster.broadcastDockerStatus(status, detail);
    }
    startPoll() {
        if (this.pollTimer || this.stopped)
            return;
        this.pollTimer = setInterval(() => {
            void this.attemptConnect();
        }, POLL_INTERVAL_MS);
        this.pollTimer.unref?.();
    }
    stopPoll() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }
    // -- Discovery ----------------------------------------------------------
    async discoverAll() {
        let infos;
        try {
            infos = await this.client.listContainers();
        }
        catch {
            // Lost connectivity between the ping that just succeeded and this
            // call — treat as a connectivity drop and let the poll recover it.
            this.setStatus("not_running", null);
            this.startPoll();
            return;
        }
        if (this.stopped)
            return;
        const seenIds = new Set();
        for (const info of infos) {
            const name = primaryName(info);
            if (!passesFilters(name, this.includeGlobs, this.excludeGlobs))
                continue;
            const sourceId = `docker:${name}`;
            seenIds.add(sourceId);
            const composeProject = info.Labels?.["com.docker.compose.project"] ?? null;
            const composeService = info.Labels?.["com.docker.compose.service"] ?? null;
            const inCurrentProject = composeProject !== null && composeProject.toLowerCase() === this.projectName.toLowerCase();
            const dockerMeta = {
                image: info.Image,
                composeProject,
                composeService,
                inCurrentProject,
            };
            if (!this.state.sources.has(sourceId)) {
                this.state.sources.create(sourceId, "docker", name, {
                    subscribed: false,
                    state: "live",
                    detail: null,
                    docker: dockerMeta,
                });
                this.containers.set(sourceId, { containerId: info.Id, attachment: null, lastTimestampNanos: null });
            }
            else {
                this.state.sources.updateDockerMeta(sourceId, dockerMeta);
                const managed = this.containers.get(sourceId);
                if (managed)
                    managed.containerId = info.Id;
                const existing = this.state.sources.get(sourceId);
                if (existing.state !== "live") {
                    this.state.sources.setState(sourceId, "live", null);
                    this.state.broadcaster.broadcastSourceState(sourceId, "live", null);
                }
                // Restart of a subscribed container: re-attach automatically, no
                // duplicate history (docs/specs/002-phase-2-docker.md § Interaction
                // specs — Container lifecycle).
                if (existing.subscribed && managed && !managed.attachment) {
                    void this.attach(sourceId);
                }
            }
        }
        // Anything previously known but no longer listed (stopped, removed, or
        // renamed away) settles to `stopped` permanently, history intact — a
        // rename produces exactly this outcome for the old name (Decision 4).
        for (const source of this.state.sources.list()) {
            if (source.kind !== "docker")
                continue;
            if (!seenIds.has(source.id) && source.state !== "stopped") {
                this.settleStopped(source.id);
            }
        }
        this.state.broadcaster.broadcastSources(this.state.sources.list());
    }
    settleStopped(sourceId) {
        this.detach(sourceId);
        const source = this.state.sources.get(sourceId);
        if (!source || source.state === "stopped")
            return;
        this.state.sources.setState(sourceId, "stopped", null);
        this.state.broadcaster.broadcastSourceState(sourceId, "stopped", null);
    }
    // -- Attach / detach ------------------------------------------------------
    async attach(sourceId) {
        const managed = this.containers.get(sourceId);
        if (!managed || managed.attachment)
            return;
        try {
            const info = await this.client.inspect(managed.containerId);
            const tty = info.Config.Tty;
            // A first attach for this source uses `tail: 50` per spec 002
            // criterion 5; a restart-recovery reattach (managed.lastTimestampNanos
            // still set from before the stream ended) instead scopes `since` to
            // just past the last line we actually read, so it never re-reads
            // history the `json-file` log driver keeps across a restart (docs/qa/
            // defects/002-phase-2-docker-3.md).
            const logsOptions = managed.lastTimestampNanos !== null
                ? { since: sinceParam(managed.lastTimestampNanos + 1n) }
                : { tail: 50 };
            const rawStream = await this.client.logs(managed.containerId, {
                follow: true,
                stdout: true,
                stderr: true,
                timestamps: true,
                ...logsOptions,
            });
            if (this.stopped) {
                rawStream.destroy();
                return;
            }
            const onEntries = (entries) => {
                const inserted = entries.map((e) => this.state.ringBuffer.push(e));
                this.state.sources.incrementCount(sourceId, inserted.length);
                this.state.broadcaster.enqueueEntries(inserted);
            };
            // Tracks the newest Docker per-line timestamp actually read off this
            // attachment's stream(s), so a future restart-recovery reattach can
            // resume just past it (see `lastTimestampNanos` on `ManagedContainer`).
            const recordTimestamp = (ts) => {
                const nanos = parseTimestampNanos(ts);
                if (nanos !== null && (managed.lastTimestampNanos === null || nanos > managed.lastTimestampNanos)) {
                    managed.lastTimestampNanos = nanos;
                }
            };
            let pipelines;
            if (tty) {
                // TTY containers are never demultiplexed — the stream is already
                // plain text; demuxing it would corrupt it (docs/phases/
                // phase-2-docker.md § 2.3).
                const pipeline = new SourcePipeline({ sourceId, mode: "live" });
                pipeline.on("entries", onEntries);
                const feeder = new DockerLineFeeder(pipeline, recordTimestamp);
                rawStream.on("data", (chunk) => feeder.push(chunk));
                rawStream.on("close", () => feeder.dispose());
                pipelines = [pipeline];
            }
            else {
                // Non-TTY: stdout/stderr are multiplexed with an 8-byte frame header
                // per chunk; demux into two independent line splitters/pipelines.
                // stderr gets a WARN level floor for entries the app didn't level
                // itself (docs/phases/phase-2-docker.md § 2.3).
                const stdoutPipeline = new SourcePipeline({ sourceId, mode: "live" });
                const stderrPipeline = new SourcePipeline({ sourceId, mode: "live", levelFloor: "WARN" });
                stdoutPipeline.on("entries", onEntries);
                stderrPipeline.on("entries", onEntries);
                const stdoutFeeder = new DockerLineFeeder(stdoutPipeline, recordTimestamp);
                const stderrFeeder = new DockerLineFeeder(stderrPipeline, recordTimestamp);
                const stdoutSink = new Writable({
                    write(chunk, _enc, callback) {
                        stdoutFeeder.push(chunk);
                        callback();
                    },
                });
                const stderrSink = new Writable({
                    write(chunk, _enc, callback) {
                        stderrFeeder.push(chunk);
                        callback();
                    },
                });
                this.client.demuxStream(rawStream, stdoutSink, stderrSink);
                rawStream.on("close", () => {
                    stdoutFeeder.dispose();
                    stderrFeeder.dispose();
                });
                pipelines = [stdoutPipeline, stderrPipeline];
            }
            const attachment = { stream: rawStream, pipelines };
            managed.attachment = attachment;
            rawStream.on("end", () => this.handleStreamEnded(sourceId, attachment));
            rawStream.on("error", () => this.handleStreamEnded(sourceId, attachment));
            const source = this.state.sources.get(sourceId);
            if (source && source.state !== "live") {
                this.state.sources.setState(sourceId, "live", null);
                this.state.broadcaster.broadcastSourceState(sourceId, "live", null);
            }
        }
        catch (err) {
            const message = err instanceof Error ? err.message : "Failed to attach to container";
            this.state.sources.setState(sourceId, "error", message);
            this.state.broadcaster.broadcastSourceState(sourceId, "error", message);
        }
    }
    /** Destroys the active stream for a source, if any — idempotent. Used both
     *  for an explicit unsubscribe (`stream.destroy()`, no orphaned daemon
     *  connections — docs/phases/phase-2-docker.md § 2.4) and internally
     *  before settling a source to stopped. */
    detach(sourceId) {
        const managed = this.containers.get(sourceId);
        if (!managed?.attachment)
            return;
        const attachment = managed.attachment;
        managed.attachment = null;
        // An explicit detach (unsubscribe, or settling permanently to stopped)
        // means any future attach is a fresh subscribe, not a restart-recovery
        // reattach — always backfill with `tail: 50` again (spec 002 criterion
        // 5), never `since`. Only a stream that ended on its own (container
        // stop/restart) while still subscribed preserves this for the automatic
        // reattach in `discoverAll()`.
        managed.lastTimestampNanos = null;
        for (const pipeline of attachment.pipelines)
            pipeline.removeAllListeners("entries");
        attachment.stream.destroy();
    }
    /** The log stream ended/errored on its own (container stopped) — as
     *  opposed to us having destroyed it ourselves via `detach()`, which
     *  clears `managed.attachment` first, making this a no-op in that case. */
    handleStreamEnded(sourceId, attachment) {
        const managed = this.containers.get(sourceId);
        if (!managed || managed.attachment !== attachment)
            return; // already detached intentionally
        managed.attachment = null;
        for (const pipeline of attachment.pipelines)
            pipeline.removeAllListeners("entries");
        const source = this.state.sources.get(sourceId);
        if (source && source.state !== "stopped") {
            this.state.sources.setState(sourceId, "stopped", null);
            this.state.broadcaster.broadcastSourceState(sourceId, "stopped", null);
        }
    }
    // -- Events (lifecycle) --------------------------------------------------
    watchEvents() {
        void this.connectEvents();
    }
    async connectEvents() {
        if (this.stopped || this.status !== "connected")
            return;
        let stream;
        try {
            stream = await this.client.getEvents();
        }
        catch {
            this.scheduleEventsReconnect();
            return;
        }
        if (this.stopped) {
            stream.destroy();
            return;
        }
        this.eventsStream = stream;
        this.eventsReconnectAttempt = 0;
        let buffer = "";
        stream.on("data", (chunk) => {
            buffer += chunk.toString("utf8");
            let idx;
            while ((idx = buffer.indexOf("\n")) !== -1) {
                const line = buffer.slice(0, idx);
                buffer = buffer.slice(idx + 1);
                if (line.trim() === "")
                    continue;
                // Any container start/stop/die/rename event: re-list to resync
                // rather than hand-track individual event payloads (robust against
                // any event shape/ordering quirk, and cheap at typical container
                // counts) — see docs/phases/phase-2-docker.md § 2.4.
                void this.discoverAll();
            }
        });
        stream.on("end", () => {
            this.eventsStream = null;
            this.scheduleEventsReconnect();
        });
        stream.on("error", () => {
            this.eventsStream = null;
            this.scheduleEventsReconnect();
        });
    }
    scheduleEventsReconnect() {
        if (this.stopped || this.status !== "connected")
            return; // the connectivity poll owns reconnection once disconnected
        this.eventsReconnectAttempt += 1;
        const delay = Math.min(EVENTS_RECONNECT_BASE_MS * 2 ** this.eventsReconnectAttempt, EVENTS_RECONNECT_MAX_MS);
        if (this.eventsReconnectTimer)
            clearTimeout(this.eventsReconnectTimer);
        this.eventsReconnectTimer = setTimeout(() => {
            this.eventsReconnectTimer = null;
            void this.connectEvents().then(() => this.discoverAll());
        }, delay);
        this.eventsReconnectTimer.unref?.();
    }
}
/** Per-stream partial-line buffering + Docker timestamp-prefix stripping —
 *  the docker-specific analog of src/parsers/line-splitter.ts's LineSplitter,
 *  needed here (rather than reusing LineSplitter directly) because each line
 *  carries its own out-of-band timestamp that must be extracted before the
 *  line reaches the format-parser chain (docs/phases/phase-2-docker.md
 *  § 2.3 — "frame/chunk boundaries still don't align with newlines"). */
class DockerLineFeeder {
    pipeline;
    onTimestamp;
    buffer = "";
    idleTimer = null;
    constructor(pipeline, onTimestamp) {
        this.pipeline = pipeline;
        this.onTimestamp = onTimestamp;
    }
    push(chunk) {
        this.buffer += chunk.toString("utf8");
        let idx;
        while ((idx = this.buffer.indexOf("\n")) !== -1) {
            const line = this.buffer.slice(0, idx);
            this.buffer = this.buffer.slice(idx + 1);
            this.feedLine(line);
        }
        this.resetIdleTimer();
    }
    /** Flushes any trailing partial line (stream ended/closed) or clears the
     *  idle timer without disposing pending state further. */
    dispose() {
        this.clearIdleTimer();
        if (this.buffer.length > 0) {
            this.feedLine(this.buffer);
            this.buffer = "";
        }
    }
    feedLine(line) {
        // A TTY-allocated container's stream uses `\r\n` line endings (Docker
        // pty behavior); strip the trailing `\r` *before* running the timestamp
        // regex against it — `(.*)$` without the `/m` flag can never consume a
        // trailing `\r` itself, so leaving it in place made the regex fail for
        // every TTY line, letting the raw timestamp prefix leak into the
        // rendered message (docs/qa/defects/002-phase-2-docker-2.md). A non-TTY
        // stream's lines never carry a trailing `\r`, so this is a no-op there.
        const withoutCr = line.endsWith("\r") ? line.slice(0, -1) : line;
        const match = DOCKER_TIMESTAMP_RE.exec(withoutCr);
        if (match) {
            this.onTimestamp?.(match[1]);
            this.pipeline.feedLine(match[2], match[1]);
        }
        else {
            this.pipeline.feedLine(withoutCr, null);
        }
    }
    resetIdleTimer() {
        this.clearIdleTimer();
        this.idleTimer = setTimeout(() => {
            this.idleTimer = null;
            if (this.buffer.length > 0) {
                this.feedLine(this.buffer);
                this.buffer = "";
            }
        }, PARTIAL_LINE_IDLE_MS);
        this.idleTimer.unref?.();
    }
    clearIdleTimer() {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
    }
}
/**
 * Parses a Docker RFC3339Nano timestamp (e.g.
 * `"2026-07-20T11:59:50.256384218Z"`, or with fewer/no fractional digits —
 * Go's `time.RFC3339Nano` formatter trims trailing zeros) into nanoseconds
 * since the Unix epoch, or `null` if it doesn't match. Used to track "the
 * last Docker log line actually read" precisely enough to scope a
 * restart-recovery reattach's `since` filter without re-reading history
 * (docs/qa/defects/002-phase-2-docker-3.md).
 */
function parseTimestampNanos(rfc3339Nano) {
    const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/.exec(rfc3339Nano);
    if (!match)
        return null;
    const [, base, fracRaw] = match;
    const epochMs = Date.parse(`${base}Z`);
    if (Number.isNaN(epochMs))
        return null;
    const fracDigits = (fracRaw ?? "").padEnd(9, "0").slice(0, 9);
    return BigInt(Math.floor(epochMs / 1000)) * 1000000000n + BigInt(fracDigits);
}
/**
 * Formats nanoseconds-since-epoch as the epoch-seconds-with-fractional-
 * nanoseconds string Docker's `logs` `since` query param accepts (e.g.
 * `"1784548312.017379761"`) — verified against a real daemon that this form
 * is accepted and that `since` is inclusive of an exact-match timestamp
 * (moby's log reader skips only entries strictly *before* `since`), which is
 * why callers pass `lastTimestampNanos + 1n` rather than the raw value.
 */
function sinceParam(nanos) {
    const seconds = nanos / 1000000000n;
    const remainder = nanos % 1000000000n;
    return `${seconds}.${remainder.toString().padStart(9, "0")}`;
}
function primaryName(info) {
    const raw = info.Names?.[0] ?? info.Id.slice(0, 12);
    return raw.startsWith("/") ? raw.slice(1) : raw;
}
function globToRegExp(glob) {
    const escaped = glob
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".");
    return new RegExp(`^${escaped}$`);
}
function passesFilters(name, include, exclude) {
    if (include.length > 0 && !include.some((g) => globToRegExp(g).test(name)))
        return false;
    if (exclude.some((g) => globToRegExp(g).test(name)))
        return false;
    return true;
}
const COMPOSE_FILE_CANDIDATES = ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"];
const COMPOSE_NAME_RE = /^name:\s*['"]?([^'"\s#]+)['"]?\s*$/m;
/**
 * Resolves the "current compose project" name: the `name:` field of a local
 * compose file if present (more reliable — docs/phases/phase-2-docker.md
 * § 2.2), else the working directory's basename, normalized the way Compose
 * itself normalizes a default project name (lowercased, invalid characters
 * stripped). This is a minimal top-level-key scan, not a full YAML parser —
 * a YAML-parsing dependency isn't on the allowlist and a full parser isn't
 * needed for this one field.
 */
function resolveProjectName(cwd) {
    for (const filename of COMPOSE_FILE_CANDIDATES) {
        const path = `${cwd}/${filename}`;
        if (!existsSync(path))
            continue;
        try {
            const text = readFileSync(path, "utf8");
            const match = COMPOSE_NAME_RE.exec(text);
            if (match)
                return match[1];
        }
        catch {
            // Unreadable compose file — fall through to the directory-basename default.
        }
    }
    return basename(cwd).toLowerCase().replace(/[^a-z0-9_-]/g, "");
}
//# sourceMappingURL=docker.js.map