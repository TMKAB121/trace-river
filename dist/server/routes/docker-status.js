/**
 * `GET /api/docker/status` — convenience mirror of the WS-pushed
 * `dockerStatus` value (docs/specs/002-phase-2-docker.md § API contract).
 */
export function registerDockerStatusRoute(fastify, state) {
    fastify.get("/api/docker/status", async () => {
        return state.docker.getStatus();
    });
}
//# sourceMappingURL=docker-status.js.map