import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { clfParser } from "../../src/parsers/formats/clf.js";
import type { AggregatedEntry } from "../../src/parsers/formats/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readFixtureLines(name: string): string[] {
  const raw = readFileSync(join(__dirname, "..", "fixtures", name), "utf8");
  return raw.split("\n").filter((l) => l.length > 0);
}

function entry(line: string): AggregatedEntry {
  return { lines: [line], raw: line, truncated: false };
}

describe("clfParser — golden fixture (test/fixtures/nginx-access.log)", () => {
  const lines = readFixtureLines("nginx-access.log");

  it("scores CLF access lines >= 0.8", () => {
    for (const line of lines) {
      expect(clfParser.score(line)).toBeGreaterThanOrEqual(0.8);
    }
  });

  it("derives level from HTTP status: 200 -> INFO, 404 -> WARN, 500 -> ERROR", () => {
    const [ok, notFound, serverError] = lines.map((l) => clfParser.parse(entry(l)));
    expect(ok.level).toBe("INFO");
    expect(notFound.level).toBe("WARN");
    expect(serverError.level).toBe("ERROR");
  });

  it("extracts method/path/status/size into context and a summary message", () => {
    const fields = clfParser.parse(entry(lines[0]));
    expect(fields.message).toBe("GET /api/users - 200");
    expect(fields.context).toMatchObject({
      method: "GET",
      path: "/api/users",
      status: 200,
      size: 512,
    });
    expect(fields.rawTimestamp).toBe("19/Jul/2026:09:20:01 +0000");
  });
});

describe("clfParser — golden fixture (test/fixtures/nginx-error.log)", () => {
  const lines = readFixtureLines("nginx-error.log");

  it("maps nginx/apache error-log level markers to normalized tokens via ERROR_LEVEL_MAP", () => {
    const [errorLine, warnLine, noticeLine] = lines.map((l) => clfParser.parse(entry(l)));
    expect(errorLine.level).toBe("ERROR");
    expect(warnLine.level).toBe("WARN");
    expect(noticeLine.level).toBe("INFO");
  });

  it("extracts the message with leading [timestamp] [level] markers stripped", () => {
    const fields = clfParser.parse(entry(lines[0]));
    expect(fields.message).toBe("File does not exist: /var/www/favicon.ico");
    expect(fields.rawTimestamp).toBe("Wed Oct 11 14:32:52 2026");
  });
});
