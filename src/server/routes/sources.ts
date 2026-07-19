import type { FastifyInstance } from "fastify";
import type { AppState } from "../app-state.js";

/** `GET /api/sources` — convenience snapshot; the WS connection already pushes this on connect/change. */
export function registerSourcesRoute(fastify: FastifyInstance, state: AppState): void {
  fastify.get("/api/sources", async () => {
    return { sources: state.sources.list() };
  });
}
