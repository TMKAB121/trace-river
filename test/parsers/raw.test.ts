import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { rawParser } from "../../src/parsers/formats/raw.js";
import type { AggregatedEntry } from "../../src/parsers/formats/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readFixtureLines(name: string): string[] {
  const raw = readFileSync(join(__dirname, "..", "fixtures", name), "utf8");
  return raw.split("\n").filter((l) => l.length > 0);
}

function entry(line: string): AggregatedEntry {
  return { lines: [line], raw: line, truncated: false };
}

describe("rawParser — golden fixture (test/fixtures/raw.log)", () => {
  const lines = readFixtureLines("raw.log");

  it("always matches (fallback) but scores below the 0.8 auto-lock threshold", () => {
    for (const line of lines) {
      expect(rawParser.score(line)).toBeLessThan(0.8);
      expect(rawParser.score(line)).toBeGreaterThan(0);
    }
  });

  it("infers level via whole-word keyword scan", () => {
    const [starting, warning, error, fatal, heartbeat] = lines.map((l) => rawParser.parse(entry(l)));
    expect(starting.level).toBeNull();
    expect(warning.level).toBe("WARN");
    expect(error.level).toBe("ERROR");
    expect(fatal.level).toBe("FATAL");
    expect(heartbeat.level).toBeNull();
  });

  it("uses the whole line as the message and never extracts a timestamp/context", () => {
    const fields = rawParser.parse(entry(lines[1]));
    expect(fields.message).toBe("WARNING: disk space low");
    expect(fields.rawTimestamp).toBeNull();
    expect(fields.context).toBeNull();
  });

  it("does not match whole words as substrings (e.g. 'terror' should not trigger ERROR)", () => {
    const fields = rawParser.parse(entry("a terroir wine review, not an error report... wait it has error"));
    expect(fields.level).toBe("ERROR"); // contains the whole word "error" later in the line
    const noKeyword = rawParser.parse(entry("a terroir wine review with no matching keyword"));
    expect(noKeyword.level).toBeNull();
  });

  it("classifies pure-decoration lines as DEBUG so banners/rules sink below the default view (issue #8)", () => {
    // Block-glyph startup banner (Redis/MariaDB splash art).
    expect(rawParser.parse(entry("███████ ██  ██ ██   ████ ██████   ██████")).level).toBe("DEBUG");
    // Horizontal separator rules of a single repeated character.
    expect(rawParser.parse(entry("===============================================")).level).toBe("DEBUG");
    expect(rawParser.parse(entry("-----------------------------------------------")).level).toBe("DEBUG");
    expect(rawParser.parse(entry("###########")).level).toBe("DEBUG");
  });

  it("never treats readable text as decoration, even when it opens with a rule glyph", () => {
    // A comment or config line that merely starts with `#`/`=` still has words.
    expect(rawParser.parse(entry("# Based on https://www.nginx.com/resources/wiki/")).level).toBeNull();
    expect(rawParser.parse(entry("=== Starting server ===")).level).toBeNull();
    // Too short / mixed to be a rule.
    expect(rawParser.parse(entry("---")).level).toBeNull();
    expect(rawParser.parse(entry("=-=-=-=")).level).toBeNull();
  });
});
