import type { FastifyInstance } from "fastify";
import type { AppState } from "../app-state.js";

/**
 * `GET /api/docker/status` — convenience mirror of the WS-pushed
 * `dockerStatus` value (docs/specs/002-phase-2-docker.md § API contract).
 */
export function registerDockerStatusRoute(fastify: FastifyInstance, state: AppState): void {
  fastify.get("/api/docker/status", async () => {
    return state.docker.getStatus();
  });
}
