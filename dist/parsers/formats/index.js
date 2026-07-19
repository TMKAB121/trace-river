import { monologParser } from "./monolog.js";
import { clfParser } from "./clf.js";
import { jsonlParser } from "./jsonl.js";
import { rawParser } from "./raw.js";
export { monologParser, clfParser, jsonlParser, rawParser };
/** Built-in chain, in order. Custom user parsers (traceriver.json) are
 *  inserted at the head by src/parsers/pipeline.ts when configured. */
export const BUILTIN_PARSER_CHAIN = [monologParser, clfParser, jsonlParser, rawParser];
//# sourceMappingURL=index.js.map