/**
 * Upload ingest adapter: streams a raw request body into the parser
 * pipeline (never buffering the whole file), enforcing the 500 MB hard cap
 * as a running byte count for bodies of unknown length. A finished upload
 * becomes a normal toggleable `file:<name>` source.
 * See docs/log-schema.md and docs/specs/001-phase-1-core-console.md.
 */
import type { Readable } from "node:stream";
import { SourcePipeline } from "../parsers/pipeline.js";
import { ingestParsedEntries } from "../server/ingest-entries.js";
import type { AppState } from "../server/app-state.js";
import type { SourceDescriptor, TraceRiverLogInput } from "../shared/types.js";

export const UPLOAD_HARD_CAP_BYTES = 500 * 1024 * 1024;
export const UPLOAD_SOFT_WARNING_BYTES = 50 * 1024 * 1024;

export class HardCapExceededError extends Error {
  constructor() {
    super("Upload exceeded the 500 MB hard cap");
    this.name = "HardCapExceededError";
  }
}

/**
 * Ingests one uploaded file end-to-end: registers the source (live),
 * streams bytes through the pipeline broadcasting parsed entries as
 * they're produced, then settles the source to stopped/error and
 * broadcasts the final state. Resolves with the final SourceDescriptor on
 * success; rejects (HardCapExceededError or the underlying stream error)
 * on failure, after having already marked the source "error".
 */
export async function ingestUpload(
  state: AppState,
  sourceId: string,
  label: string,
  stream: Readable,
): Promise<SourceDescriptor> {
  state.sources.create(sourceId, "file", label);
  state.broadcaster.broadcastSources(state.sources.list());

  const pipeline = new SourcePipeline({ sourceId, mode: "file" });
  pipeline.on("entries", (entries: TraceRiverLogInput[]) => {
    ingestParsedEntries(state, sourceId, entries, pipeline.getLockedParserName());
  });

  try {
    await pumpStream(stream, pipeline);
  } catch (err) {
    pipeline.end();
    const message = err instanceof Error ? err.message : "Upload failed";
    state.sources.setState(sourceId, "error", message);
    state.broadcaster.broadcastSourceState(sourceId, "error", message);
    state.broadcaster.broadcastSources(state.sources.list());
    throw err;
  }

  pipeline.end();
  state.sources.setState(sourceId, "stopped", null);
  state.broadcaster.broadcastSourceState(sourceId, "stopped", null);
  state.broadcaster.broadcastSources(state.sources.list());
  return state.sources.get(sourceId)!;
}

function pumpStream(stream: Readable, pipeline: SourcePipeline): Promise<void> {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    let settled = false;

    const cleanup = () => {
      stream.off("data", onData);
      stream.off("end", onEnd);
      stream.off("error", onError);
    };

    const onData = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > UPLOAD_HARD_CAP_BYTES) {
        if (settled) return;
        settled = true;
        // Stop consuming (don't destroy) — for an HTTP/1.1 request the
        // readable request stream and the writable response share one
        // socket, so destroying it here would take the response down with
        // it and the client would see a raw connection error instead of a
        // clean 413. The route closes the connection itself once the 413
        // body has actually been flushed (see src/server/routes/upload.ts).
        stream.pause();
        cleanup();
        reject(new HardCapExceededError());
        return;
      }
      pipeline.feed(chunk);
    };
    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onError = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    stream.on("data", onData);
    stream.on("end", onEnd);
    stream.on("error", onError);
  });
}
