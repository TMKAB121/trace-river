/**
 * Project-root fingerprint detectors — docs/phases/phase-3-auto-discovery.md
 * § 3.1's table, one entry per framework. Each `detect()` checks for its
 * fingerprint files directly in the working directory the server was
 * started from — never subdirectories (docs/specs/003-phase-3-auto-
 * discovery.md § User flow step 6). `targets()` returns the default watch
 * target(s) as glob patterns relative to that same root ([] for a detector
 * whose output only ever goes to stdout, per the phase doc's table).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DetectedFramework } from "../shared/types.js";

export interface ProjectDetector {
  name: DetectedFramework["detector"];
  label: string;
  detect(root: string): boolean;
  /** Glob pattern(s) relative to `root`; empty when the detector has no
   *  default file target (nextjs/go/django). */
  targets(root: string): string[];
  /** Guidance copy for a no-target detector — exact wording per
   *  docs/specs/003-phase-3-auto-discovery.md § API contract. */
  note: string | null;
}

function exists(root: string, ...segments: string[]): boolean {
  return existsSync(join(root, ...segments));
}

export const PROJECT_DETECTORS: ProjectDetector[] = [
  {
    name: "laravel",
    label: "Laravel",
    detect: (root) => exists(root, "composer.json") && exists(root, "artisan"),
    // `storage/logs/laravel.log` is itself matched by this glob, so one
    // target covers both the primary file and its daily-rotation siblings
    // (docs/phases/phase-3-auto-discovery.md § 3.1/3.3) under one source id.
    // Scoped to the `laravel*.log` prefix (Laravel's actual daily-rotation
    // filenames are `laravel-<date>.log`) rather than a bare `*.log` —
    // `storage/logs/` commonly also holds unrelated app logs (e.g. a
    // `traceriver.json`-declared `storage/logs/worker.log`, docs/specs/
    // 003-phase-3-auto-discovery.md's own walkthrough example), which must
    // stay a distinct source, not get swept into this one.
    targets: () => ["storage/logs/laravel*.log"],
    note: null,
  },
  {
    name: "symfony",
    label: "Symfony",
    detect: (root) =>
      exists(root, "composer.json") && (exists(root, "symfony.lock") || exists(root, "config/bundles.php")),
    targets: () => ["var/log/dev.log"],
    note: null,
  },
  {
    name: "nextjs",
    label: "Next.js",
    detect: (root) =>
      exists(root, "package.json") &&
      (exists(root, "next.config.js") || exists(root, "next.config.mjs") || exists(root, "next.config.ts")),
    targets: () => [],
    note: "Next.js detected — output is on stdout; run under Docker or add a file target in traceriver.json.",
  },
  {
    name: "go",
    label: "Go",
    detect: (root) => exists(root, "go.mod"),
    targets: () => [],
    note: "Go project detected — output is on stdout; run under Docker or add a file target in traceriver.json.",
  },
  {
    name: "rails",
    label: "Rails",
    detect: (root) => exists(root, "Gemfile") && exists(root, "config/application.rb"),
    targets: () => ["log/development.log"],
    note: null,
  },
  {
    name: "django",
    label: "Django",
    detect: (root) => exists(root, "manage.py"),
    targets: () => [],
    note: "Django project detected — output is on stdout (console logging is Django's default); run under Docker or add a file target in traceriver.json.",
  },
  {
    name: "wordpress",
    label: "WordPress",
    detect: (root) => exists(root, "wp-config.php"),
    targets: () => ["wp-content/debug.log"],
    note: null,
  },
];
