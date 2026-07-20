/** `GET /api/status` */
export function registerStatusRoute(fastify, state) {
    fastify.get("/api/status", async () => {
        return {
            version: state.version,
            port: state.port,
            bufferCapacity: state.ringBuffer.getCapacity(),
            bufferUsed: state.ringBuffer.size(),
            uptimeMs: Date.now() - state.startedAt,
            dockerAllContainersDefault: state.config.docker.allContainers ?? false,
        };
    });
}
//# sourceMappingURL=status.js.map