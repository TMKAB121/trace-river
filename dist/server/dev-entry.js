/**
 * Dev entrypoint for `npm run dev:server` (run via `tsx watch`). Starts the
 * real backend on the default port with no browser auto-open, so the Vite
 * dev server (`npm run dev:web`, owned by web/vite.config.ts) can proxy
 * `/api` and `/ws` to it while the frontend gets HMR. See
 * docs/phases/phase-1-core.md § 1.1 "Dev ergonomics".
 */
import { startServer } from "./index.js";
import { resolveConfig } from "../shared/config.js";
const config = resolveConfig({});
const server = await startServer({
    port: config.port,
    buffer: config.buffer,
    config,
});
console.log(`[traceriver:dev] backend listening on http://127.0.0.1:${server.port}`);
console.log(`[traceriver:dev] token: ${server.token}`);
console.log(`[traceriver:dev] direct URL: ${server.url}`);
console.log(`[traceriver:dev] point web/vite.config.ts's dev proxy at this port.`);
process.on("SIGINT", async () => {
    await server.close();
    process.exit(0);
});
process.on("SIGTERM", async () => {
    await server.close();
    process.exit(0);
});
//# sourceMappingURL=dev-entry.js.map