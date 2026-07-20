#!/usr/bin/env node
/**
 * `traceriver start` — CLI entry. Startup sequence per docs/architecture.md
 * and docs/phases/phase-1-core.md § 1.1: resolve config → resolve port →
 * generate session token → start Fastify bound to 127.0.0.1 → serve
 * dist/web → open the browser at the tokenized URL.
 */
import { Command, InvalidArgumentError } from "commander";
import { resolveConfig } from "./shared/config.js";
import { startServer } from "./server/index.js";
import { openBrowser } from "./cli/open-browser.js";
function parseIntArg(value) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
        throw new InvalidArgumentError(`"${value}" is not a valid integer.`);
    }
    return parsed;
}
const program = new Command();
program.name("traceriver").description("Local log console").version("0.0.1");
const startCommand = program
    .command("start")
    .description("Start the TraceRiver console")
    .option("--port <n>", "Port to bind (default 7580; auto-increments if the default is taken, but an explicitly passed port errors on conflict)", parseIntArg)
    .option("--no-open", "Don't open the browser automatically")
    .option("--config <path>", "Path to a traceriver.json (default: ./traceriver.json if present)")
    .option("--buffer <n>", "Ring buffer capacity in entries (default 50000)", parseIntArg)
    .option("--all-containers", "Include Docker containers outside the current compose project")
    .action(async (opts) => {
    try {
        // commander always yields a definite boolean for --no-open-style flags
        // (default true); only forward it when the user actually passed the flag,
        // so file-config / built-in-default precedence (CLI > file > default)
        // is preserved correctly.
        const openExplicit = startCommand.getOptionValueSource("open") === "cli";
        const config = resolveConfig({
            port: opts.port,
            open: openExplicit ? opts.open : undefined,
            config: opts.config,
            buffer: opts.buffer,
            allContainers: opts.allContainers,
        });
        const strictPort = opts.port !== undefined;
        const server = await startServer({
            port: config.port,
            strictPort,
            buffer: config.buffer,
            config,
        });
        if (config.port !== server.port) {
            console.log(`Port ${config.port} was in use — bound to ${server.port} instead.`);
        }
        console.log(`traceriver listening on http://127.0.0.1:${server.port}`);
        console.log(`Session URL: ${server.url}`);
        if (config.open) {
            openBrowser(server.url);
        }
        else {
            console.log("(--no-open passed — open the Session URL above manually)");
        }
        const shutdown = async () => {
            console.log("\nShutting down...");
            await server.close();
            process.exit(0);
        };
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
    }
    catch (err) {
        console.error(`traceriver failed to start: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
    }
});
await program.parseAsync(process.argv);
//# sourceMappingURL=cli.js.map