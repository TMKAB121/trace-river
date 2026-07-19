import type { FastifyInstance } from "fastify";
import type { AppState } from "../app-state.js";

/** `GET /api/status` */
export function registerStatusRoute(fastify: FastifyInstance, state: AppState): void {
  fastify.get("/api/status", async () => {
    return {
      version: state.version,
      port: state.port,
      bufferCapacity: state.ringBuffer.getCapacity(),
      bufferUsed: state.ringBuffer.size(),
      uptimeMs: Date.now() - state.startedAt,
    };
  });
}
