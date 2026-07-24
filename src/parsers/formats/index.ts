import type { FormatParser } from "./types.js";
import { monologParser } from "./monolog.js";
import { clfParser } from "./clf.js";
import { jsonlParser } from "./jsonl.js";
import { bitnamiParser } from "./bitnami.js";
import { rawParser } from "./raw.js";

export type { FormatParser, AggregatedEntry, ParsedFields } from "./types.js";
export { monologParser, clfParser, jsonlParser, bitnamiParser, rawParser };

/** Built-in chain, in order. Custom user parsers (traceriver.json) are
 *  inserted at the head by src/parsers/pipeline.ts when configured. `bitnami`
 *  sits just ahead of the `raw` fallback: it's a narrow, high-signal match
 *  (the `==>` marker) that only ever fires on genuine Bitnami lines the other
 *  parsers don't claim, rescuing their self-declared level before `raw` would
 *  drop it (issue #8). */
export const BUILTIN_PARSER_CHAIN: FormatParser[] = [
  monologParser,
  clfParser,
  jsonlParser,
  bitnamiParser,
  rawParser,
];

/**
 * Built-in parsers keyed by name, for a `traceriver.json` `watch` entry's
 * `"parser"` pin (docs/configuration.md, docs/phases/phase-3-auto-
 * discovery.md § 3.4 example: `"parser": "monolog"`) to look up without
 * running detection. Regex-based user-defined parsers (the config file's
 * separate `parsers` array) are not part of this phase's scope — see
 * src/discovery/index.ts.
 */
export const PARSER_BY_NAME: Record<string, FormatParser> = {
  monolog: monologParser,
  clf: clfParser,
  jsonl: jsonlParser,
  bitnami: bitnamiParser,
  raw: rawParser,
};
