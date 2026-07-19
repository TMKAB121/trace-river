/**
 * End-to-end pipeline golden tests: fixture bytes in -> TraceRiverLogInput[]
 * out, exercising line-splitting, multi-line aggregation, format detection
 * (with per-source stickiness), and normalization together — not just the
 * isolated format-parser unit tests in this directory.
 *
 * Covers spec 001 acceptance criterion 18 (all four built-in parsers pass
 * golden fixture tests) and criterion 8 (multi-line PHP stack trace ->
 * exactly one entry with multiline: true, full body, and context).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SourcePipeline } from "../../src/parsers/pipeline.js";
import type { TraceRiverLogInput } from "../../src/shared/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "..", "fixtures");

function fixturePath(name: string): string {
  return join(FIXTURES_DIR, name);
}

/** Feeds a whole fixture file through a fresh SourcePipeline in one chunk. */
async function runPipeline(fixtureName: string): Promise<TraceRiverLogInput[]> {
  const bytes = readFileSync(fixturePath(fixtureName));
  const pipeline = new SourcePipeline({ sourceId: `file:${fixtureName}`, mode: "file" });
  const collected: TraceRiverLogInput[] = [];
  pipeline.on("entries", (entries) => collected.push(...entries));
  pipeline.feed(bytes);
  pipeline.end();
  return collected;
}

const FIXED_NOW = new Date("2026-07-19T12:00:00.000Z").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SourcePipeline golden — monolog-laravel.log", () => {
  it("produces 5 entries, detects monolog, and aggregates the PHP stack trace into one multiline entry", async () => {
    const entries = await runPipeline("monolog-laravel.log");
    expect(entries).toHaveLength(5);

    expect(entries.map((e) => e.level)).toEqual(["INFO", "WARN", "DEBUG", "ERROR", "INFO"]);
    expect(entries.every((e) => e.source === "file:monolog-laravel.log")).toBe(true);

    const stackEntry = entries[3];
    expect(stackEntry.multiline).toBe(true);
    expect(stackEntry.message).toBe("Undefined variable $foo");
    expect(stackEntry.body).not.toBeNull();
    expect(stackEntry.body).toContain("#0 /app/routes/api.php(42)");
    expect(stackEntry.body).toContain("Caused by: RuntimeException");
    expect(stackEntry.body).toContain("Stack trace:");
    expect(stackEntry.body!.split("\n")).toHaveLength(7);
    expect(stackEntry.context).toEqual({ context: { exception: "boom" } });
    expect(stackEntry.raw).toBe(stackEntry.body);

    // Non-multiline entries carry a null body per the TraceRiverLog contract.
    expect(entries[0].multiline).toBe(false);
    expect(entries[0].body).toBeNull();

    // Monolog timestamps have no zone info -> parsed as host-local time (log-schema.md).
    const expectedTs = new Date(2026, 6, 19, 9, 15, 1, 0).getTime();
    expect(entries[0].timestamp).toBe(expectedTs);
    expect(entries[0].rawTimestamp).toBe("2026-07-19 09:15:01");
  });
});

describe("SourcePipeline golden — nginx-access.log (CLF)", () => {
  it("produces 3 entries with status-derived levels and UTC-normalized timestamps", async () => {
    const entries = await runPipeline("nginx-access.log");
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.level)).toEqual(["INFO", "WARN", "ERROR"]);
    expect(entries.every((e) => e.multiline === false && e.body === null)).toBe(true);

    const expectedTs = Date.UTC(2026, 6, 19, 9, 20, 1);
    expect(entries[0].timestamp).toBe(expectedTs);
    expect(entries[0].context).toMatchObject({ method: "GET", path: "/api/users", status: 200 });
  });
});

describe("SourcePipeline golden — pino.jsonl", () => {
  it("produces 3 entries with pino numeric levels normalized to the 6-value enum", async () => {
    const entries = await runPipeline("pino.jsonl");
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.level)).toEqual(["INFO", "ERROR", "DEBUG"]);
    expect(entries[0].timestamp).toBe(1752915600000);
    expect(entries[0].message).toBe("server started");
  });
});

describe("SourcePipeline golden — raw.log (fallback)", () => {
  it("produces 5 single-line entries via the raw fallback, with keyword-inferred levels and arrival-time timestamps", async () => {
    const entries = await runPipeline("raw.log");
    expect(entries).toHaveLength(5);
    expect(entries.map((e) => e.level)).toEqual(["UNKNOWN", "WARN", "ERROR", "FATAL", "UNKNOWN"]);
    expect(entries.every((e) => e.rawTimestamp === null)).toBe(true);
    expect(entries.every((e) => e.timestamp === FIXED_NOW)).toBe(true);
  });
});

describe("SourcePipeline golden — nasty.log (ANSI, mixed formats, stack trace)", () => {
  it("strips ANSI codes before parsing and never crashes on mixed-format content", async () => {
    const entries = await runPipeline("nasty.log");
    expect(entries.length).toBeGreaterThan(0);
    // No raw ANSI escape byte should survive into any field.
    // eslint-disable-next-line no-control-regex
    const ansiRe = /\x1b\[[0-9;]*m/;
    for (const e of entries) {
      expect(ansiRe.test(e.message)).toBe(false);
      expect(ansiRe.test(e.raw)).toBe(false);
      if (e.body) expect(ansiRe.test(e.body)).toBe(false);
    }
    // The 17-line stack trace in the fixture should aggregate into one multiline entry.
    const stackEntry = entries.find((e) => e.message.includes("Query failed"));
    expect(stackEntry).toBeDefined();
    expect(stackEntry!.multiline).toBe(true);
    expect(stackEntry!.body).toContain("Caused by: PDOException");
  });
});
