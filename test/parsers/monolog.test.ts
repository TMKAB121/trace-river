import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { monologParser } from "../../src/parsers/formats/monolog.js";
import type { AggregatedEntry } from "../../src/parsers/formats/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "..", "fixtures", "monolog-laravel.log");

function entry(lines: string[], truncated = false): AggregatedEntry {
  return { lines, raw: lines.join("\n"), truncated };
}

describe("monologParser — golden fixture (test/fixtures/monolog-laravel.log)", () => {
  const raw = readFileSync(FIXTURE, "utf8");
  const rawLines = raw.split("\n").filter((_, i, arr) => !(i === arr.length - 1 && arr[i] === ""));

  it("scores the fixture's entry-start lines >= 0.8 (would lock in the real pipeline)", () => {
    expect(monologParser.score(rawLines[0])).toBeGreaterThanOrEqual(0.8);
    expect(monologParser.score(rawLines[1])).toBeGreaterThanOrEqual(0.8);
    expect(monologParser.entryStart.test(rawLines[0])).toBe(true);
  });

  it("does not treat PHP stack-trace continuation lines as entry starts", () => {
    // Line 5 (`#0 /app/routes/api.php(42): ...`) is a continuation of the ERROR entry.
    const continuationLine = rawLines[4];
    expect(continuationLine.startsWith("#0")).toBe(true);
    expect(monologParser.entryStart.test(continuationLine)).toBe(false);
  });

  it("parses a simple single-line entry: level, message, and non-empty-blob context", () => {
    const fields = monologParser.parse(entry([rawLines[0]]));
    expect(fields.level).toBe("INFO");
    expect(fields.rawTimestamp).toBe("2026-07-19 09:15:01");
    expect(fields.message).toBe("User logged in");
    expect(fields.context).toEqual({ context: { user_id: 42 } });
  });

  it("parses a single-line entry whose trailing blobs are both empty ({} []) as null context", () => {
    const fields = monologParser.parse(entry([rawLines[1]]));
    expect(fields.level).toBe("WARNING");
    expect(fields.message).toBe("Deprecated function called");
    expect(fields.context).toBeNull();
  });

  it("parses the multi-line PHP stack-trace entry: message from line 1 only, context from trailing blob", () => {
    // Entry: line index 3 ("...ERROR: Undefined variable $foo...") through index 9 ("#1 {main}").
    const stackLines = rawLines.slice(3, 10);
    expect(stackLines.length).toBe(7);
    const fields = monologParser.parse(entry(stackLines));
    expect(fields.level).toBe("ERROR");
    expect(fields.message).toBe("Undefined variable $foo");
    expect(fields.context).toEqual({ context: { exception: "boom" } });
  });
});
