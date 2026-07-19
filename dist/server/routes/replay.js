/** `GET /api/replay?after=<id>` — entries with id > after, bounded by the ring buffer. */
export function registerReplayRoute(fastify, state) {
    fastify.get("/api/replay", async (request) => {
        const rawAfter = request.query.after;
        const after = typeof rawAfter === "string" ? Number(rawAfter) : Number.NaN;
        const cursor = Number.isFinite(after) ? after : 0;
        return { entries: state.ringBuffer.after(cursor) };
    });
}
//# sourceMappingURL=replay.js.map