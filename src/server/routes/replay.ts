import type { FastifyInstance } from "fastify";
import type { AppState } from "../app-state.js";

/** `GET /api/replay?after=<id>` — entries with id > after, bounded by the ring buffer. */
export function registerReplayRoute(fastify: FastifyInstance, state: AppState): void {
  fastify.get("/api/replay", async (request) => {
    const rawAfter = (request.query as Record<string, unknown>).after;
    const after = typeof rawAfter === "string" ? Number(rawAfter) : Number.NaN;
    const cursor = Number.isFinite(after) ? after : 0;
    return { entries: state.ringBuffer.after(cursor) };
  });
}
