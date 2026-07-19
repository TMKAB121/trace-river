# Phase 3 — Auto-Discovery

**Objective:** Automatically detect non-Docker local setups (native PHP/Laravel, Next.js, Go services, Herd/Valet, native nginx) by fingerprinting the project directory, and tail their log files into the stream. After this phase, `traceriver start` in a Laravel project tails `storage/logs/laravel.log` with zero configuration.

## 3.1 Technology fingerprinting

A detector module scans the working directory (the project root) at startup. Each detector is a small `{ name, detect(root): boolean, sources(root): WatchTarget[] }` — adding a framework is adding one entry.

| Detector | Fingerprint (all must exist) | Default watch targets |
|---|---|---|
| `laravel` | `composer.json` + `artisan` | `storage/logs/laravel.log`, `storage/logs/*.log` (daily rotation) |
| `symfony` | `composer.json` + `symfony.lock` or `config/bundles.php` | `var/log/dev.log` |
| `nextjs` | `package.json` + `next.config.{js,mjs,ts}` | `.next/trace` is noise — Next logs to stdout, so this detector only *labels* the project; no default file target |
| `go` | `go.mod` | none by default (Go logs to stdout); detector enables label + custom-path hinting |
| `rails` | `Gemfile` + `config/application.rb` | `log/development.log` |
| `django` | `manage.py` | none by default (console logging is Django's default) |
| `wordpress` | `wp-config.php` | `wp-content/debug.log` |

Notes:

- Detectors that yield no file target still matter: they inform the UI ("Next.js detected — its output is on stdout; run it under Docker or add a file target in traceriver.json") and phase 4's AI-prompt metadata.
- Multiple detectors can match (a repo with a Laravel API + Next frontend); all matched sources are offered.
- Discovered sources appear in the sidebar **unchecked but visible** when the file doesn't exist yet, checked and tailing when it does — so the Laravel entry lights up the moment the first log line is ever written.

## 3.2 Environment-level detection (macOS extras)

Conditional detectors that look outside the project root, macOS-only, each individually disableable via `discovery.disable` ([configuration.md](../configuration.md)):

- **Laravel Herd**: if `~/Library/Application Support/Herd/` exists, offer Herd's service logs (nginx/PHP-FPM per-site logs under Herd's log directory) as `herd:*` sources.
- **Valet**: `~/.config/valet/Log/` → nginx error log.
- **Native nginx/PHP-FPM** (Homebrew): `/opt/homebrew/var/log/nginx/*.log`, `/opt/homebrew/var/log/php-fpm.log` when present.

These are offered unchecked by default — environment logs are noisy and shared across projects; the user opts in per session. Linux equivalents (`/var/log/nginx/`) are future work (permission handling differs).

## 3.3 Dynamic file tailing

One tailer implementation serves auto-discovered targets and explicit `watch` entries from config. `chokidar` provides change events; the tailer owns the read logic:

- **Start at EOF.** On first attach, seek to end and remember the offset — never ingest a 500 MB history file into the ring buffer. (An explicit "load last N KB" action per source is a nice-to-have for context.)
- **Offset-tracked incremental reads.** On change: `stat` the file; read from stored offset to new EOF; feed bytes to the pipeline (the phase-1 line splitter holds partial trailing lines); advance offset.
- **Rotation & truncation** — Laravel rotates daily, and `> laravel.log` truncation is common:
  - size < stored offset → file was truncated or replaced: reset offset to 0, read from start.
  - watched glob picks up a new file (e.g. `laravel-2026-07-20.log`) → new source or continuation under the same label per detector policy (Laravel daily files continue the `local:laravel` source).
  - file deleted → keep watching the path; resume at offset 0 if it reappears.
- **Watcher reliability**: use chokidar with `usePolling: false` default, but auto-fall back to polling (1 s) for paths where fsevents/inotify are known-unreliable (network mounts, some Docker bind-mount setups). Detect by: a `stat` on interval disagrees with the absence of events.
- Sources are tagged `local:<detector>` (e.g. `local:laravel`) or the label from config; parser stickiness applies per source as usual.

## 3.4 Explicit configuration fallback

Bespoke setups declare paths in `traceriver.json` — full schema in [configuration.md](../configuration.md):

```jsonc
{
  "watch": [
    { "path": "storage/logs/worker.log", "label": "local:worker" },
    { "path": "~/sites/api/var/log/*.log", "label": "local:api", "parser": "monolog" }
  ]
}
```

Config `watch` entries and auto-discovered targets dedupe by resolved absolute path (config wins and supplies the label/parser).

## Exit criteria

- [ ] `traceriver start` in a fresh Laravel app tails `laravel.log` with zero config; triggering an exception in the app shows the full multi-line trace within a second.
- [ ] Laravel daily-rotation rollover at midnight continues streaming into the same source without restart.
- [ ] `echo -n > laravel.log` (truncation) doesn't break the tail; subsequent writes appear.
- [ ] A 500 MB pre-existing log file attaches instantly (EOF start) with no memory spike.
- [ ] `watch` globs, label overrides, and parser pinning from `traceriver.json` behave per configuration.md.
- [ ] Herd detection on a macOS machine with Herd installed offers its service logs, unchecked by default.
