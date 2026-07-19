import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { jsonlParser } from "../../src/parsers/formats/jsonl.js";
import type { AggregatedEntry } from "../../src/parsers/formats/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readFixtureLines(name: string): string[] {
  const raw = readFileSync(join(__dirname, "..", "fixtures", name), "utf8");
  return raw.split("\n").filter((l) => l.length > 0);
}

function entry(line: string): AggregatedEntry {
  return { lines: [line], raw: line, truncated: false };
}

describe("jsonlParser — golden fixture (test/fixtures/pino.jsonl)", () => {
  const lines = readFixtureLines("pino.jsonl");

  it("scores every JSON-object line >= 0.8", () => {
    for (const line of lines) {
      expect(jsonlParser.score(line)).toBeGreaterThanOrEqual(0.8);
    }
  });

  it("maps pino numeric levels via the normalizer's PINO_NUMERIC_MAP downstream, preserving the raw numeric string here", () => {
    const [info, error, debug] = lines.map((l) => jsonlParser.parse(entry(l)));
    expect(info.level).toBe("30");
    expect(error.level).toBe("50");
    expect(debug.level).toBe("20");
  });

  it("maps msg -> message, time -> rawTimestamp, and puts unmapped keys into context", () => {
    const fields = jsonlParser.parse(entry(lines[0]));
    expect(fields.message).toBe("server started");
    expect(fields.rawTimestamp).toBe("1752915600000");
    expect(fields.context).toEqual({ pid: 1234 });
  });

  it("returns null context when no unmapped keys remain", () => {
    const fields = jsonlParser.parse(entry(lines[2]));
    expect(fields.message).toBe("debug tick");
    expect(fields.context).toBeNull();
  });

  it("does not match a non-JSON line", () => {
    expect(jsonlParser.score("plain text line")).toBe(0);
  });
});
