import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { bitnamiParser } from "../../src/parsers/formats/bitnami.js";
import type { AggregatedEntry } from "../../src/parsers/formats/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readFixtureLines(name: string): string[] {
  const raw = readFileSync(join(__dirname, "..", "fixtures", name), "utf8");
  return raw.split("\n").filter((l) => l.length > 0);
}

function entry(line: string): AggregatedEntry {
  return { lines: [line], raw: line, truncated: false };
}

describe("bitnamiParser — golden fixture (test/fixtures/bitnami.log)", () => {
  const lines = readFixtureLines("bitnami.log");

  it("scores every bitnami line above the 0.8 auto-lock threshold", () => {
    for (const line of lines) {
      expect(bitnamiParser.score(line)).toBeGreaterThanOrEqual(0.8);
    }
  });

  it("extracts the self-declared level from each line", () => {
    const levels = lines.map((l) => bitnamiParser.parse(entry(l)).level);
    expect(levels).toEqual(["INFO", "DEBUG", "INFO", "DEBUG", "DEBUG", "WARN", "ERROR", "INFO"]);
  });

  it("strips the module/time/level/marker prefix, leaving only the message", () => {
    const fields = bitnamiParser.parse(entry(lines[2]));
    expect(fields.message).toBe("Remapping ownership to handle docker volume sharing.");
  });

  it("discards the dateless wall-clock time (Docker's per-line timestamp wins downstream)", () => {
    const fields = bitnamiParser.parse(entry(lines[0]));
    expect(fields.rawTimestamp).toBeNull();
    expect(fields.context).toBeNull();
  });

  it("does not claim lines the other parsers own", () => {
    expect(bitnamiParser.score("[2026-07-19 15:31:15] production.ERROR: boom {} []")).toBe(0);
    expect(bitnamiParser.score('{"level":"info","msg":"hi"}')).toBe(0);
    expect(bitnamiParser.score("Starting worker process")).toBe(0);
    // A plausible-looking near-miss without the `==>` marker must not match.
    expect(bitnamiParser.score("redis 04:03:40.05 INFO starting up")).toBe(0);
  });
});
