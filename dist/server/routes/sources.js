/** `GET /api/sources` — convenience snapshot; the WS connection already pushes this on connect/change. */
export function registerSourcesRoute(fastify, state) {
    fastify.get("/api/sources", async () => {
        return { sources: state.sources.list() };
    });
}
//# sourceMappingURL=sources.js.map