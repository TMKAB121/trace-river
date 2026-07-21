/**
 * Shared harness for the phase-3 auto-discovery suite (docs/specs/
 * 003-phase-3-auto-discovery.md). Every test builds a throwaway fixture
 * project under a fresh `mkdtemp` directory (never a real project on this
 * machine) and starts the real server against it with `discovery.enabled`
 * on. Mirrors `test/docker/helpers.ts`'s shape; `connect`/`collect`/`sleep`/
 * `waitFor`/`closeAll` are re-exported from there rather than duplicated.
 */
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, truncateSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import type { AddressInfo } from "node:net";
import { startServer, type StartedServer } from "../../src/server/index.js";
import type { ResolvedConfig, DiscoveryConfig, WatchEntry } from "../../src/shared/config.js";

export { connect, collect, sleep, waitFor, closeAll } from "../docker/helpers.js";

/** A fresh, empty throwaway directory under the OS temp dir. */
export function mkFixtureDir(prefix = "tr-qa-discovery-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function writeFixtureFile(root: string, relPath: string, content: string): string {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  return full;
}

export function appendFixtureFile(fullPath: string, content: string): void {
  appendFileSync(fullPath, content);
}

export function truncateFixtureFile(fullPath: string): void {
  truncateSync(fullPath, 0);
}

export function removeFixtureFile(fullPath: string): void {
  unlinkSync(fullPath);
}

export function rmFixtureDir(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

/** Scaffolds a Laravel fingerprint (`composer.json` + `artisan`) in `root`,
 *  optionally with `storage/logs/laravel.log` already present. Real Laravel
 *  skeletons (`laravel new` / `composer create-project laravel/laravel`)
 *  always ship a `storage/logs/.gitignore` placeholder, so `storage/logs/`
 *  itself exists from the very first `composer install` even before the app
 *  ever logs anything — this helper mirrors that by always creating the
 *  directory, with or without the log file, matching every real-world
 *  Laravel project this detector will ever see. See `laravelProjectNoLogDir`
 *  for the (rarer, but spec-relevant) case where even the parent directory
 *  doesn't exist yet. */
export function laravelProject(root: string, opts: { withLogFile?: boolean; logContent?: string } = {}): void {
  writeFixtureFile(root, "composer.json", JSON.stringify({ name: "acme/laravel-app" }));
  writeFixtureFile(root, "artisan", "#!/usr/bin/env php\n");
  if (opts.withLogFile) {
    writeFixtureFile(root, "storage/logs/laravel.log", opts.logContent ?? "");
  } else {
    mkdirSync(join(root, "storage/logs"), { recursive: true });
  }
}

/** Same Laravel fingerprint, but deliberately withOUT even creating
 *  `storage/logs/` — used only by the defect repro for the "target's parent
 *  directory doesn't exist yet" case (docs/qa/defects — see test plan). */
export function laravelProjectNoLogDir(root: string): void {
  writeFixtureFile(root, "composer.json", JSON.stringify({ name: "acme/laravel-app" }));
  writeFixtureFile(root, "artisan", "#!/usr/bin/env php\n");
}

export function nextjsProject(root: string): void {
  writeFixtureFile(root, "package.json", JSON.stringify({ name: "acme-web" }));
  writeFixtureFile(root, "next.config.js", "module.exports = {};\n");
}

export function goProject(root: string): void {
  writeFixtureFile(root, "go.mod", "module acme.dev/svc\n\ngo 1.22\n");
}

export function djangoProject(root: string): void {
  writeFixtureFile(root, "manage.py", "#!/usr/bin/env python\n");
}

export interface DiscoveryTestServer {
  server: StartedServer;
  baseUrl: string;
  wsUrl: string;
  token: string;
  close: () => Promise<void>;
}

/** Detector names for the three macOS environment-level detectors
 *  (src/discovery/environment.ts). Disabled by default in
 *  `startDiscoveryTestServer` (see below) so project/config-tier tests stay
 *  self-contained regardless of what's actually installed on the host
 *  running the suite — this dev machine has a real Homebrew install, whose
 *  `homebrew:php-fpm` source would otherwise leak into every discovery-
 *  enabled fixture's source list. Tests that specifically exercise
 *  environment-tier detection opt back in per-detector via `discovery.disable`. */
const ENVIRONMENT_DETECTOR_NAMES = ["herd", "valet", "homebrew"];

/** Starts the real server with discovery enabled, pointed at `cwd` (a
 *  fixture project root). Mirrors `test/docker/helpers.ts`'s
 *  `startDockerTestServer` ephemeral-port pattern. */
export async function startDiscoveryTestServer(opts: {
  cwd: string;
  discovery?: Partial<DiscoveryConfig>;
  watch?: WatchEntry[];
  buffer?: number;
}): Promise<DiscoveryTestServer> {
  const token = "test-token-" + Math.random().toString(16).slice(2);
  const config: ResolvedConfig = {
    port: 0,
    buffer: opts.buffer ?? 50000,
    open: false,
    configPath: null,
    configDir: opts.cwd,
    watch: opts.watch ?? [],
    docker: { enabled: false },
    discovery: {
      enabled: true,
      disable: [...ENVIRONMENT_DETECTOR_NAMES],
      ...opts.discovery,
    },
    parsers: [],
  };

  const server = await startServer({ port: 0, strictPort: true, token, config, cwd: opts.cwd });
  const address = server.app.server.address() as AddressInfo;
  const actualPort = address.port;
  server.state.port = actualPort; // same port-0 readback workaround as test/helpers/server.ts

  const baseUrl = `http://127.0.0.1:${actualPort}`;
  const wsUrl = `ws://127.0.0.1:${actualPort}`;

  return { server, baseUrl, wsUrl, token, close: () => server.close() };
}
