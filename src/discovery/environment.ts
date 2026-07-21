/**
 * macOS environment-level detectors — docs/phases/phase-3-auto-discovery.md
 * § 3.2. Each offered source is always `local.origin: "environment"` and
 * always `subscribed: false` regardless of whether its target file already
 * has content (docs/specs/003-phase-3-auto-discovery.md § Interaction
 * specs, Decision 5). No-op on non-macOS platforms. Linux equivalents
 * (`/var/log/nginx/`) are explicitly out of scope for this phase (permission
 * handling differs — phase doc § 3.2).
 */
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";

export interface EnvironmentSource {
  /** Detector name, for `discovery.disable` filtering — "herd" | "valet" | "homebrew". */
  detector: string;
  /** Combines with `detector` for the `<detector>:<slug>` id convention. */
  slug: string;
  /** Absolute path this source tails. */
  pattern: string;
}

const HOMEBREW_LOG_DIR = "/opt/homebrew/var/log";

export function discoverEnvironmentSources(): EnvironmentSource[] {
  if (process.platform !== "darwin") return [];
  return [...discoverHerd(), ...discoverValet(), ...discoverHomebrew()];
}

function listLogFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".log"));
  } catch {
    return [];
  }
}

/** Herd's per-site nginx/PHP-FPM logs — offered as `herd:<slug>` for every
 *  `*.log` file found under Herd's log directory. */
function discoverHerd(): EnvironmentSource[] {
  const logDir = join(homedir(), "Library", "Application Support", "Herd", "Log");
  if (!existsSync(logDir)) return [];
  return listLogFiles(logDir).map((file) => ({
    detector: "herd",
    slug: basename(file, extname(file)),
    pattern: join(logDir, file),
  }));
}

/** Valet's nginx error log — the one target the phase doc names explicitly. */
function discoverValet(): EnvironmentSource[] {
  const logDir = join(homedir(), ".config", "valet", "Log");
  if (!existsSync(logDir)) return [];
  return [{ detector: "valet", slug: "nginx-error", pattern: join(logDir, "nginx-error.log") }];
}

/** Homebrew-installed nginx/PHP-FPM logs under the Apple Silicon default
 *  prefix (docs/phases/phase-3-auto-discovery.md § 3.2 names this exact
 *  path). */
function discoverHomebrew(): EnvironmentSource[] {
  if (!existsSync(HOMEBREW_LOG_DIR)) return [];
  const sources: EnvironmentSource[] = [];

  const nginxDir = join(HOMEBREW_LOG_DIR, "nginx");
  if (existsSync(nginxDir)) {
    for (const file of listLogFiles(nginxDir)) {
      sources.push({
        detector: "homebrew",
        slug: `nginx-${basename(file, extname(file))}`,
        pattern: join(nginxDir, file),
      });
    }
  }

  sources.push({ detector: "homebrew", slug: "php-fpm", pattern: join(HOMEBREW_LOG_DIR, "php-fpm.log") });

  return sources;
}
