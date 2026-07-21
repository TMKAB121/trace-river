/**
 * Config resolution: CLI flag > traceriver.json > built-in default.
 * See docs/configuration.md for the full field reference. Phase 1 only
 * *acts* on port / buffer / open (the only source kind is uploaded files),
 * but the shape is defined in full so later phases don't need to redefine
 * it out from under phase 1.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

export interface WatchEntry {
  path: string;
  label: string;
  parser?: string;
}

export interface CustomParserConfig {
  name: string;
  entryStart: string;
  timestampFormat?: string;
  levelMap?: Record<string, string>;
}

export interface DockerConfig {
  enabled?: boolean;
  allContainers?: boolean;
  include?: string[];
  exclude?: string[];
}

export interface DiscoveryConfig {
  enabled?: boolean;
  disable?: string[];
}

/** Raw shape of traceriver.json — every field optional, file itself optional. */
export interface TraceRiverFileConfig {
  port?: number;
  buffer?: number;
  open?: boolean;
  watch?: WatchEntry[];
  docker?: DockerConfig;
  discovery?: DiscoveryConfig;
  parsers?: CustomParserConfig[];
}

/** Fully resolved runtime config used to start the server. */
export interface ResolvedConfig {
  port: number;
  buffer: number;
  open: boolean;
  configPath: string | null;
  /** Directory `watch` entries' relative paths resolve against — the
   *  directory containing traceriver.json, or `cwd` when no config file was
   *  found (docs/configuration.md: "Paths are relative to this file's
   *  directory"). See src/discovery/index.ts. */
  configDir: string;
  watch: WatchEntry[];
  docker: DockerConfig;
  discovery: DiscoveryConfig;
  parsers: CustomParserConfig[];
}

export const DEFAULT_PORT = 7580;
export const DEFAULT_BUFFER = 50000;

const KNOWN_TOP_LEVEL_KEYS = new Set([
  "port",
  "buffer",
  "open",
  "watch",
  "docker",
  "discovery",
  "parsers",
]);

export interface CliFlags {
  port?: number;
  open?: boolean; // false when --no-open passed
  config?: string;
  buffer?: number;
  /** `--all-containers` — only forwarded when the flag was actually passed
   *  (see src/cli.ts), so CLI > file > built-in-default precedence holds. */
  allContainers?: boolean;
}

/**
 * Resolve the working config: CLI flags win, then traceriver.json (explicit
 * --config path, or ./traceriver.json if present), then built-in defaults.
 * Unknown top-level keys in the file warn (typo protection) but never abort.
 */
export function resolveConfig(flags: CliFlags, cwd: string = process.cwd()): ResolvedConfig {
  const configPath = flags.config ? resolve(cwd, flags.config) : resolve(cwd, "traceriver.json");

  let fileConfig: TraceRiverFileConfig = {};
  let resolvedConfigPath: string | null = null;

  if (existsSync(configPath)) {
    resolvedConfigPath = configPath;
    const raw = readFileSync(configPath, "utf8");
    try {
      fileConfig = JSON.parse(stripJsonComments(raw)) as TraceRiverFileConfig;
    } catch (err) {
      throw new Error(
        `Failed to parse config file at ${configPath}: ${(err as Error).message}`,
      );
    }
    for (const key of Object.keys(fileConfig)) {
      if (!KNOWN_TOP_LEVEL_KEYS.has(key)) {
        console.warn(`[traceriver] Warning: unknown config key "${key}" in ${configPath} (ignored)`);
      }
    }
  } else if (flags.config) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const port = flags.port ?? fileConfig.port ?? DEFAULT_PORT;
  const buffer = flags.buffer ?? fileConfig.buffer ?? DEFAULT_BUFFER;
  const open = flags.open ?? fileConfig.open ?? true;

  // docker.* is fully resolved here (unlike watch/discovery/parsers, left as
  // raw file-config passthrough) because phase 2 actually acts on it — see
  // docs/configuration.md § docker.
  const docker: DockerConfig = {
    enabled: fileConfig.docker?.enabled ?? true,
    allContainers: flags.allContainers ?? fileConfig.docker?.allContainers ?? false,
    include: fileConfig.docker?.include ?? [],
    exclude: fileConfig.docker?.exclude ?? [],
  };

  // discovery.* is fully resolved here (this phase actually acts on it —
  // src/discovery/) so a plain literal `{}` elsewhere in the codebase (test
  // fixtures built without going through resolveConfig()) is never
  // mistaken for "discovery on" — only this function's explicit `?? true`
  // default does that. See docs/specs/003-phase-3-auto-discovery.md § API
  // contract / src/discovery/index.ts.
  const discovery: DiscoveryConfig = {
    enabled: fileConfig.discovery?.enabled ?? true,
    disable: fileConfig.discovery?.disable ?? [],
  };

  return {
    port,
    buffer,
    open,
    configPath: resolvedConfigPath,
    configDir: resolvedConfigPath ? dirname(resolvedConfigPath) : cwd,
    watch: fileConfig.watch ?? [],
    docker,
    discovery,
    parsers: fileConfig.parsers ?? [],
  };
}

/** Minimal `//` and `/* *\/` comment stripper so traceriver.json can use JSONC. */
function stripJsonComments(input: string): string {
  let out = "";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const next = input[i + 1];
    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        out += ch;
      }
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += next;
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}
