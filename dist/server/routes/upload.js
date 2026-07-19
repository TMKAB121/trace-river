import { ingestUpload, UPLOAD_HARD_CAP_BYTES, HardCapExceededError } from "../../ingest/upload.js";
/**
 * `POST /api/upload?name=<url-encoded filename>` — streaming upload.
 * See docs/specs/001-phase-1-core-console.md § "REST endpoints".
 */
export function registerUploadRoute(fastify, state) {
    fastify.post("/api/upload", async (request, reply) => {
        const rawName = request.query.name;
        const name = typeof rawName === "string" ? rawName.trim() : "";
        if (name === "") {
            return reply.code(400).send({ error: "bad_request", message: 'Missing or invalid "name" query parameter.' });
        }
        const contentLengthHeader = request.headers["content-length"];
        if (contentLengthHeader) {
            const contentLength = Number(contentLengthHeader);
            if (Number.isFinite(contentLength) && contentLength > UPLOAD_HARD_CAP_BYTES) {
                closeConnectionOnceFlushed(request, reply);
                return reply.code(413).send({ error: "payload_too_large", limitBytes: UPLOAD_HARD_CAP_BYTES });
            }
        }
        const sourceId = `file:${name}`;
        if (state.sources.has(sourceId)) {
            return reply.code(400).send({ error: "bad_request", message: `Source "${sourceId}" already exists.` });
        }
        const bodyStream = request.body;
        try {
            const source = await ingestUpload(state, sourceId, name, bodyStream);
            return reply.code(200).send({ source });
        }
        catch (err) {
            if (err instanceof HardCapExceededError) {
                // The body stream is still (partially) unread at this point — close
                // the connection once the 413 has actually been flushed, rather than
                // destroying the socket outright, so the client gets the documented
                // error body instead of a raw ECONNRESET/EPIPE.
                closeConnectionOnceFlushed(request, reply);
                return reply.code(413).send({ error: "payload_too_large", limitBytes: UPLOAD_HARD_CAP_BYTES });
            }
            request.log.error(err);
            return reply
                .code(500)
                .send({ error: "internal_error", message: err instanceof Error ? err.message : "Upload failed" });
        }
    });
}
function closeConnectionOnceFlushed(request, reply) {
    reply.header("Connection", "close");
    reply.raw.once("finish", () => {
        request.raw.destroy();
    });
}
//# sourceMappingURL=upload.js.map