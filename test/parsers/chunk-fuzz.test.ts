/**
 * Chunk-boundary fuzz test — log-schema.md § Testing strategy: "re-feed each
 * fixture split at random byte offsets and assert output is identical to
 * feeding it whole — this single test catches most partial-line and demux
 * bugs." Covers spec 001 acceptance criterion 18.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SourcePipeline } from "../../src/parsers/pipeline.js";
import type { TraceRiverLogInput } from "../../src/shared/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "..", "fixtures");

const FIXTURES = [
  "monolog-laravel.log",
  "nginx-access.log",
  "nginx-error.log",
  "pino.jsonl",
  "raw.log",
  "nasty.log",
];

const TRIALS_PER_FIXTURE = 15;
const FIXED_NOW = new Date("2026-07-19T12:00:00.000Z").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

/** Deterministic PRNG (mulberry32) so a failing seed is reproducible from the printed value. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Splits `bytes` into a random number of chunks at random byte offsets (including possibly-empty chunks). */
function randomChunks(bytes: Buffer, rand: () => number): Buffer[] {
  const numCuts = Math.floor(rand() * 8); // 0-7 cuts -> 1-8 chunks
  const cuts = new Set<number>();
  for (let i = 0; i < numCuts; i++) {
    cuts.add(1 + Math.floor(rand() * Math.max(1, bytes.length - 1)));
  }
  const offsets = [0, ...Array.from(cuts).sort((a, b) => a - b), bytes.length];
  const chunks: Buffer[] = [];
  for (let i = 0; i < offsets.length - 1; i++) {
    chunks.push(bytes.subarray(offsets[i], offsets[i + 1]));
  }
  return chunks;
}

async function feedWhole(bytes: Buffer, sourceId: string): Promise<TraceRiverLogInput[]> {
  const pipeline = new SourcePipeline({ sourceId, mode: "file" });
  const collected: TraceRiverLogInput[] = [];
  pipeline.on("entries", (entries) => collected.push(...entries));
  pipeline.feed(bytes);
  pipeline.end();
  return collected;
}

async function feedChunked(bytes: Buffer, sourceId: string, chunks: Buffer[]): Promise<TraceRiverLogInput[]> {
  const pipeline = new SourcePipeline({ sourceId, mode: "file" });
  const collected: TraceRiverLogInput[] = [];
  pipeline.on("entries", (entries) => collected.push(...entries));
  for (const chunk of chunks) pipeline.feed(chunk);
  pipeline.end();
  return collected;
}

describe("Chunk-boundary fuzz — output is identical regardless of how fixture bytes are chunked", () => {
  for (const fixtureName of FIXTURES) {
    describe(fixtureName, () => {
      const bytes = readFileSync(join(FIXTURES_DIR, fixtureName));

      it(`matches whole-file output across ${TRIALS_PER_FIXTURE} random chunkings`, async () => {
        const sourceId = `file:fuzz-${fixtureName}`;
        const wholeOutput = await feedWhole(bytes, sourceId);
        expect(wholeOutput.length).toBeGreaterThan(0);

        for (let trial = 0; trial < TRIALS_PER_FIXTURE; trial++) {
          const seed = hashSeed(fixtureName, trial);
          const rand = mulberry32(seed);
          const chunks = randomChunks(bytes, rand);
          const chunkedOutput = await feedChunked(bytes, sourceId, chunks);

          expect(
            chunkedOutput,
            `seed=${seed} trial=${trial} fixture=${fixtureName} chunkSizes=${chunks.map((c) => c.length).join(",")}`,
          ).toEqual(wholeOutput);
        }
      });
    });
  }
});

function hashSeed(name: string, trial: number): number {
  let h = 2166136261 ^ trial;
  for (let i = 0; i < name.length; i++) {
    h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}
