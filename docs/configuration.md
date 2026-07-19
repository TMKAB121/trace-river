# Configuration

TraceRiver is zero-config by default. Configuration exists to override ports/limits and to declare bespoke log sources auto-discovery can't guess.

## CLI

```
traceriver start [options]

  --port <n>       Port to bind (default 7580; auto-increments if the default
                   is taken, but an explicitly passed port errors on conflict)
  --no-open        Don't open the browser automatically
  --config <path>  Path to a traceriver.json (default: ./traceriver.json if present)
  --buffer <n>     Ring buffer capacity in entries (default 50000)
  --all-containers Include Docker containers outside the current compose project

traceriver init

  Writes a commented starter traceriver.json to the current directory.
```

`traceriver start` treats **the current working directory as the project root**: it's what compose-project filtering (phase 2) and framework fingerprinting (phase 3) key off.

## `traceriver.json`

Looked up in the working directory (or via `--config`). Every field is optional; the file itself is optional.

```jsonc
{
  // Server
  "port": 7580,
  "buffer": 50000,
  "open": true,

  // Explicit file sources — for logs auto-discovery can't find.
  // Paths are relative to this file's directory; ~ and glob patterns allowed.
  "watch": [
    { "path": "storage/logs/laravel.log", "label": "local:laravel" },
    { "path": "~/Library/Logs/my-daemon/*.log", "label": "local:my-daemon" },
    {
      "path": "var/log/custom.log",
      "label": "local:custom",
      "parser": "custom-app"          // pin a parser instead of auto-detecting
    }
  ],

  // Docker source selection
  "docker": {
    "enabled": true,
    "allContainers": false,            // false = only current compose project
    "include": ["mysql", "nginx-*"],   // name globs; empty = all discovered
    "exclude": ["*-test"]
  },

  // Auto-discovery (phase 3)
  "discovery": {
    "enabled": true,
    "disable": ["herd"]                // opt out of specific detectors
  },

  // User-defined format parsers, inserted ahead of the built-in chain.
  // Named capture groups map into TraceRiverLog fields.
  "parsers": [
    {
      "name": "custom-app",
      // Must define at least <message>; <timestamp> and <level> are optional.
      "entryStart": "^\\[(?<timestamp>[^\\]]+)\\] (?<level>[A-Z]+) (?<message>.*)$",
      "timestampFormat": "yyyy-MM-dd HH:mm:ss",   // Luxon/date-fns tokens
      "levelMap": { "CRIT": "FATAL", "NOTICE": "INFO" }
    }
  ]
}
```

### Semantics

- **Precedence**: CLI flag > `traceriver.json` > built-in default.
- **`watch` entries** feed the same tailer as auto-discovery (start at EOF, rotation-aware — see [phase 3](phases/phase-3-auto-discovery.md)). A `watch` path that matches an auto-discovered path wins (its label/parser settings apply) rather than duplicating the source.
- **Custom parsers** participate in normal detection scoring via their `entryStart` regex unless a `watch` entry pins them with `"parser"`. Regexes are validated at startup with clear errors (bad pattern, missing `<message>` group) rather than failing silently at parse time.
- **Validation**: unknown keys warn (typo protection) but don't abort; the tool always prefers starting with a partial config over refusing to start.
- The file is read once at startup in v1. Live-reload of config is future work.
