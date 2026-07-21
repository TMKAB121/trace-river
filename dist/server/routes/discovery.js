/**
 * `GET /api/discovery` — convenience mirror of the WS-pushed `discovery`
 * message (docs/specs/003-phase-3-auto-discovery.md § API contract):
 *   - `discovery.enabled === false` -> `{ enabled: false, frameworks: [] }`
 *   - `discovery.enabled === true`  -> `{ enabled: true, frameworks: DetectedFramework[] }`
 * `state.discovery.frameworks` is already `[]` whenever discovery is
 * disabled (src/discovery/index.ts), so this can return it as-is.
 */
export function registerDiscoveryRoute(fastify, state) {
    fastify.get("/api/discovery", async () => {
        return state.discovery;
    });
}
//# sourceMappingURL=discovery.js.map