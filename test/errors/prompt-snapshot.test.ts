/**
 * AI prompt assembly + redaction — docs/specs/004-phase-4-error-
 * intelligence.md § API contract (Prompt assembly, Redaction) and
 * acceptance criteria 5, 6, 11, 14, 16. "Prompt snapshot tests: seeded ring
 * buffer -> generated prompt matches snapshot (proves redaction + context
 * selection deterministically)" per docs/phases/phase-4-error-
 * intelligence.md § 4.4.
 *
 * Builds a minimal but real `AppState` (real RingBuffer/SourceRegistry/
 * ErrorGroupStore — only the docker/tail/broadcaster fields prompt.ts never
 * touches are omitted) so the assembled prompt is produced by the actual
 * production code path, not a re-implementation.
 */
import { describe, it, expect } from "vitest";
import { RingBuffer } from "../../src/server/ring-buffer.js";
import { SourceRegistry } from "../../src/server/sources.js";
import { ErrorGroupStore } from "../../src/errors/error-store.js";
import { computeFingerprint } from "../../src/errors/fingerprint.js";
import { assemblePrompt } from "../../src/errors/prompt.js";
import type { AppState } from "../../src/server/app-state.js";
import type { TraceRiverLogInput } from "../../src/shared/types.js";

function makeState(opts: { bufferCapacity?: number; frameworks?: AppState["discovery"]["frameworks"] } = {}): {
  state: AppState;
  ringBuffer: RingBuffer;
  sources: SourceRegistry;
  errorGroups: ErrorGroupStore;
} {
  const ringBuffer = new RingBuffer(opts.bufferCapacity ?? 50_000);
  const sources = new SourceRegistry();
  const errorGroups = new ErrorGroupStore(ringBuffer);
  const state = {
    ringBuffer,
    sources,
    errorGroups,
    discovery: { enabled: (opts.frameworks?.length ?? 0) > 0, frameworks: opts.frameworks ?? [] },
    parserNames: new Map<string, string>(),
  } as unknown as AppState;
  return { state, ringBuffer, sources, errorGroups };
}

function log(overrides: Partial<TraceRiverLogInput> & { source: string; message: string }): TraceRiverLogInput {
  const level = overrides.level ?? "INFO";
  const fp =
    level === "ERROR" || level === "FATAL"
      ? computeFingerprint({ source: overrides.source, level, message: overrides.message, body: overrides.body ?? null })
      : null;
  return {
    timestamp: overrides.timestamp ?? Date.now(),
    rawTimestamp: null,
    source: overrides.source,
    level,
    message: overrides.message,
    body: overrides.body ?? null,
    context: null,
    raw: overrides.raw ?? overrides.message,
    multiline: false,
    fingerprint: fp ? fp.fingerprint : null,
    ...overrides,
  };
}

describe("assemblePrompt — structure and field mapping", () => {
  it("renders every documented template section in order, with title/count/sources/timestamps mapped correctly", () => {
    const { state, ringBuffer, errorGroups } = makeState();
    sourcesFor(state).create("docker:app", "docker", "app", { docker: { image: "php:8.3-fpm", composeProject: null, composeService: null, inCurrentProject: true } });
    state.parserNames.set("docker:app", "monolog");

    const base = 1_700_000_000_000;
    const input = log({ source: "docker:app", level: "ERROR", message: 'Undefined array key "id" in UserController.php:42', body: "production.ERROR: boom\n#0 /app/UserController.php(42): show()", timestamp: base });
    const entry = ringBuffer.push(input);
    const fp = computeFingerprint({ source: "docker:app", level: "ERROR", message: input.message, body: input.body })!;
    errorGroups.recordOccurrence(entry, fp.title);

    const prompt = assemblePrompt(state, fp.fingerprint)!;
    expect(prompt).toContain("I'm debugging an error in my local development environment.");
    expect(prompt).toContain("## Error");
    expect(prompt).toContain("occurred 1 times between");
    expect(prompt).toContain("from source(s): docker:app.");
    expect(prompt).toContain("## Stack trace (most recent occurrence)");
    expect(prompt).toContain("## Environment");
    expect(prompt).toContain("- Source: docker:app (image php:8.3-fpm)");
    expect(prompt).toContain("- Log format: monolog");
    expect(prompt).toContain("## Surrounding log context");
    expect(prompt).toContain("## Occurrence pattern");
    expect(prompt).toContain("Please: 1) identify the most likely root cause");
    // Order: Error section before Stack trace before Environment before Context before Occurrence pattern.
    const idxError = prompt.indexOf("## Error");
    const idxStack = prompt.indexOf("## Stack trace");
    const idxEnv = prompt.indexOf("## Environment");
    const idxContext = prompt.indexOf("## Surrounding log context");
    const idxPattern = prompt.indexOf("## Occurrence pattern");
    expect(idxError).toBeLessThan(idxStack);
    expect(idxStack).toBeLessThan(idxEnv);
    expect(idxEnv).toBeLessThan(idxContext);
    expect(idxContext).toBeLessThan(idxPattern);
  });

  it("Environment lists a non-docker source without the image annotation, and comma-joins detected frameworks", () => {
    const { state, ringBuffer, errorGroups } = makeState({
      frameworks: [
        { detector: "laravel", label: "Laravel", hasFileTarget: true, note: null },
        { detector: "nextjs", label: "Next.js", hasFileTarget: false, note: "no default target" },
      ],
    });
    sourcesFor(state).create("local:laravel", "local", "local:laravel");
    const input = log({ source: "local:laravel", level: "FATAL", message: "Out of memory" });
    const entry = ringBuffer.push(input);
    const fp = computeFingerprint({ source: "local:laravel", level: "FATAL", message: input.message, body: null })!;
    errorGroups.recordOccurrence(entry, fp.title);

    const prompt = assemblePrompt(state, fp.fingerprint)!;
    expect(prompt).toContain("- Source: local:laravel");
    expect(prompt).not.toContain("- Source: local:laravel (image");
    expect(prompt).toContain("- Project stack detected: Laravel, Next.js");
  });

  it("omits the 'Project stack detected' bullet entirely when discovery found nothing", () => {
    const { state, ringBuffer, errorGroups } = makeState({ frameworks: [] });
    const input = log({ source: "docker:app", level: "ERROR", message: "boom" });
    const entry = ringBuffer.push(input);
    const fp = computeFingerprint({ source: "docker:app", level: "ERROR", message: "boom", body: null })!;
    errorGroups.recordOccurrence(entry, fp.title);
    const prompt = assemblePrompt(state, fp.fingerprint)!;
    expect(prompt).not.toContain("Project stack detected");
  });

  it("widens the code fence to four backticks when the block itself contains a triple-backtick sequence", () => {
    const { state, ringBuffer, errorGroups } = makeState();
    const bodyWithFence = "boom\n```\nsome embedded fenced block\n```";
    const input = log({ source: "docker:app", level: "ERROR", message: "boom", body: bodyWithFence });
    const entry = ringBuffer.push(input);
    const fp = computeFingerprint({ source: "docker:app", level: "ERROR", message: "boom", body: bodyWithFence })!;
    errorGroups.recordOccurrence(entry, fp.title);
    const prompt = assemblePrompt(state, fp.fingerprint)!;
    expect(prompt).toContain("````");
  });

  it("returns null for a fingerprint that was never tracked (404 territory)", () => {
    const { state } = makeState();
    expect(assemblePrompt(state, "never-existed")).toBeNull();
  });
});

describe("assemblePrompt — cross-source context (criterion 5: nginx 500 caused by mysql going down)", () => {
  it("includes the mysql 'Connection refused' line(s) from before the first nginx-500 occurrence, even though it's a different source", () => {
    const { state, ringBuffer, errorGroups } = makeState();
    const base = 1_700_000_000_000;

    // Timeline: mysql goes down, nginx starts failing moments later.
    ringBuffer.push(log({ source: "docker:mysql", level: "INFO", message: "mysqld starting up", timestamp: base }));
    ringBuffer.push(
      log({ source: "docker:mysql", level: "FATAL", message: "Connection refused: mysql:3306", timestamp: base + 1000 }),
    );
    ringBuffer.push(log({ source: "docker:nginx", level: "INFO", message: "worker process started", timestamp: base + 1500 }));

    const nginxInput = log({
      source: "docker:nginx",
      level: "ERROR",
      message: "upstream connect failed while connecting to upstream",
      timestamp: base + 2000,
    });
    const nginxEntry = ringBuffer.push(nginxInput);
    const fp = computeFingerprint({ source: "docker:nginx", level: "ERROR", message: nginxInput.message, body: null })!;
    errorGroups.recordOccurrence(nginxEntry, fp.title);

    const prompt = assemblePrompt(state, fp.fingerprint)!;
    const contextSection = prompt.slice(prompt.indexOf("## Surrounding log context"), prompt.indexOf("## Occurrence pattern"));
    expect(contextSection).toContain("[docker:mysql]");
    expect(contextSection).toContain("Connection refused: mysql:⟨…⟩");
    // interleaved, timestamped, one line each
    expect(contextSection).toMatch(/\d{2}:\d{2}:\d{2} \[docker:mysql\] mysqld starting up/);
  });

  it("caps context at 15 entries immediately before the group's first occurrence, drawn from the full ring buffer regardless of source", () => {
    const { state, ringBuffer, errorGroups } = makeState();
    const base = 1_700_000_000_000;
    for (let i = 0; i < 20; i++) {
      ringBuffer.push(log({ source: "docker:noise", level: "INFO", message: `line ${i}`, timestamp: base + i * 100 }));
    }
    const input = log({ source: "docker:app", level: "ERROR", message: "boom", timestamp: base + 20 * 100 });
    const entry = ringBuffer.push(input);
    const fp = computeFingerprint({ source: "docker:app", level: "ERROR", message: "boom", body: null })!;
    errorGroups.recordOccurrence(entry, fp.title);

    const prompt = assemblePrompt(state, fp.fingerprint)!;
    const contextSection = prompt.slice(prompt.indexOf("## Surrounding log context"), prompt.indexOf("## Occurrence pattern"));
    const lineCount = (contextSection.match(/\[docker:noise\]/g) ?? []).length;
    expect(lineCount).toBe(15);
    // The 15 nearest to the first occurrence: lines 5..19 (0-indexed), i.e. not line 0.
    expect(contextSection).not.toContain("line 0\n");
    expect(contextSection).toContain("line 19");
  });
});

describe("assemblePrompt — redaction (criterion 5, 16)", () => {
  function fingerprintedGroup(state: AppState, ringBuffer: RingBuffer, errorGroups: ErrorGroupStore, message: string, body: string | null) {
    const input = log({ source: "docker:app", level: "ERROR", message, body });
    const entry = ringBuffer.push(input);
    const fp = computeFingerprint({ source: "docker:app", level: "ERROR", message, body })!;
    errorGroups.recordOccurrence(entry, fp.title);
    return fp.fingerprint;
  }

  it("redacts a Bearer token in the stack trace, preserving the 'Authorization: Bearer' prefix", () => {
    const { state, ringBuffer, errorGroups } = makeState();
    // Token shape kept provider-neutral so secret scanners (GitHub push
    // protection etc.) don't flag this fixture; the Bearer rule matches any
    // non-whitespace token, so the shape is irrelevant to the test.
    const secretBody = "boom\nAuthorization: Bearer FAKEBEARERTOKENxxxx1234567890";
    const fingerprint = fingerprintedGroup(state, ringBuffer, errorGroups, "boom", secretBody);
    const prompt = assemblePrompt(state, fingerprint)!;
    expect(prompt).toContain("Authorization: Bearer <redacted>");
    expect(prompt).not.toContain("FAKEBEARERTOKENxxxx1234567890");
  });

  it("redacts password=/passwd=/pwd= values, key preserved", () => {
    const { state, ringBuffer, errorGroups } = makeState();
    const secretBody = "boom\nDB connection failed: password=SuperSecret123!";
    const fingerprint = fingerprintedGroup(state, ringBuffer, errorGroups, "boom", secretBody);
    const prompt = assemblePrompt(state, fingerprint)!;
    expect(prompt).toContain("password=<redacted>");
    expect(prompt).not.toContain("SuperSecret123!");
  });

  it("redacts an AWS-style access key id", () => {
    const { state, ringBuffer, errorGroups } = makeState();
    const secretBody = "boom\ncredentials: AKIAABCDEFGHIJKLMNOP";
    const fingerprint = fingerprintedGroup(state, ringBuffer, errorGroups, "boom", secretBody);
    const prompt = assemblePrompt(state, fingerprint)!;
    expect(prompt).toContain("<redacted>");
    expect(prompt).not.toContain("AKIAABCDEFGHIJKLMNOP");
  });

  it("redacts a generic api_key/secret/token key-value assignment", () => {
    const { state, ringBuffer, errorGroups } = makeState();
    const secretBody = 'boom\n{"api_key": "shhh-do-not-log-me"}';
    const fingerprint = fingerprintedGroup(state, ringBuffer, errorGroups, "boom", secretBody);
    const prompt = assemblePrompt(state, fingerprint)!;
    expect(prompt).not.toContain("shhh-do-not-log-me");
  });

  it("redacts a secret wherever it appears, including in the surrounding-context section (line-by-line, defense-in-depth)", () => {
    const { state, ringBuffer, errorGroups } = makeState();
    const base = 1_700_000_000_000;
    ringBuffer.push(
      log({ source: "docker:auth", level: "INFO", message: "issued token Authorization: Bearer abc123secretvalue", timestamp: base }),
    );
    const input = log({ source: "docker:app", level: "ERROR", message: "boom", timestamp: base + 1000 });
    const entry = ringBuffer.push(input);
    const fp = computeFingerprint({ source: "docker:app", level: "ERROR", message: "boom", body: null })!;
    errorGroups.recordOccurrence(entry, fp.title);
    const prompt = assemblePrompt(state, fp.fingerprint)!;
    expect(prompt).not.toContain("abc123secretvalue");
  });

  it("full nginx-500-caused-by-mysql-down scenario: cross-source context present AND every seeded secret redacted everywhere in the output", () => {
    const { state, ringBuffer, errorGroups } = makeState();
    const base = 1_700_000_000_000;
    ringBuffer.push(
      log({
        source: "docker:mysql",
        level: "FATAL",
        message: "Connection refused: mysql:3306, password=hunter2secret",
        timestamp: base,
      }),
    );
    const nginxInput = log({
      source: "docker:nginx",
      level: "ERROR",
      message: "upstream connect failed",
      body: "upstream connect failed\nAuthorization: Bearer topsecrettoken123\ncredential AKIAABCDEFGHIJKLMNOP",
      timestamp: base + 1000,
    });
    const nginxEntry = ringBuffer.push(nginxInput);
    const fp = computeFingerprint({ source: "docker:nginx", level: "ERROR", message: nginxInput.message, body: nginxInput.body })!;
    errorGroups.recordOccurrence(nginxEntry, fp.title);

    const prompt = assemblePrompt(state, fp.fingerprint)!;
    // Cross-source context present.
    const contextSection = prompt.slice(prompt.indexOf("## Surrounding log context"), prompt.indexOf("## Occurrence pattern"));
    expect(contextSection).toContain("[docker:mysql]");
    expect(contextSection).toContain("Connection refused");
    // No literal secret value survives anywhere in the assembled text.
    expect(prompt).not.toContain("hunter2secret");
    expect(prompt).not.toContain("topsecrettoken123");
    expect(prompt).not.toContain("AKIAABCDEFGHIJKLMNOP");
  });
});

describe("assemblePrompt — eviction fallback (criterion 6)", () => {
  it("stack trace section falls back to the documented text once every sample has aged out", () => {
    const { state, ringBuffer, errorGroups } = makeState({ bufferCapacity: 2 });
    const input = log({ source: "docker:app", level: "ERROR", message: "aging bug" });
    const entry = ringBuffer.push(input);
    const fp = computeFingerprint({ source: "docker:app", level: "ERROR", message: "aging bug", body: null })!;
    errorGroups.recordOccurrence(entry, fp.title);
    // Evict past capacity.
    ringBuffer.push(log({ source: "docker:noise", level: "INFO", message: "1" }));
    ringBuffer.push(log({ source: "docker:noise", level: "INFO", message: "2" }));
    ringBuffer.push(log({ source: "docker:noise", level: "INFO", message: "3" }));

    const prompt = assemblePrompt(state, fp.fingerprint)!;
    expect(prompt).toContain(
      "(original stack trace no longer available — this group's occurrences have all aged out of the buffer.)",
    );
  });

  it("context section falls back to the oldest-still-resolvable anchor with the documented prefix when the true first occurrence is evicted", () => {
    const { state, ringBuffer, errorGroups } = makeState({ bufferCapacity: 10 });
    const fp = computeFingerprint({ source: "docker:app", level: "ERROR", message: "recurring", body: null })!;
    const first = ringBuffer.push(log({ source: "docker:app", level: "ERROR", message: "recurring" }));
    errorGroups.recordOccurrence(first, fp.title);
    for (let i = 0; i < 5; i++) {
      ringBuffer.push(log({ source: "docker:noise", level: "INFO", message: `pad ${i}` }));
    }
    const second = ringBuffer.push(log({ source: "docker:app", level: "ERROR", message: "recurring" }));
    errorGroups.recordOccurrence(second, fp.title);
    // Evict the true first occurrence, keep the group's second sample resolvable.
    for (let i = 0; i < 4; i++) {
      ringBuffer.push(log({ source: "docker:noise", level: "INFO", message: `flush ${i}` }));
    }
    expect(ringBuffer.get(first.id)).toBeUndefined();
    expect(ringBuffer.get(second.id)).toBeDefined();

    const prompt = assemblePrompt(state, fp.fingerprint)!;
    expect(prompt).toContain(
      "(first-occurrence context unavailable — showing context around the oldest retained occurrence instead.)",
    );
  });

  it("returns 200-shaped fallback text (not an error) when a group survives eviction but has zero resolvable context", () => {
    const { state, ringBuffer, errorGroups } = makeState({ bufferCapacity: 2 });
    const fp = computeFingerprint({ source: "docker:app", level: "ERROR", message: "totally gone", body: null })!;
    const entry = ringBuffer.push(log({ source: "docker:app", level: "ERROR", message: "totally gone" }));
    errorGroups.recordOccurrence(entry, fp.title);
    ringBuffer.push(log({ source: "docker:noise", level: "INFO", message: "a" }));
    ringBuffer.push(log({ source: "docker:noise", level: "INFO", message: "b" }));

    const prompt = assemblePrompt(state, fp.fingerprint);
    expect(prompt).not.toBeNull();
    expect(prompt).toContain(
      "(no surrounding context available — every entry near this group's occurrences has aged out of the buffer.)",
    );
  });
});

describe("assemblePrompt — occurrence pattern summary (deterministic)", () => {
  it("reports a steady rate with no spike text below threshold", () => {
    const { state, ringBuffer, errorGroups } = makeState();
    const now = Date.now();
    const currentMinute = Math.floor(now / 60_000) * 60_000;
    const fp = computeFingerprint({ source: "docker:app", level: "ERROR", message: "steady bug", body: null })!;
    for (let m = 0; m < 5; m++) {
      const e = ringBuffer.push(log({ source: "docker:app", level: "ERROR", message: "steady bug", timestamp: currentMinute - m * 60_000 }));
      errorGroups.recordOccurrence(e, fp.title);
    }
    const prompt = assemblePrompt(state, fp.fingerprint)!;
    expect(prompt).toMatch(/steady ~<?\d+\/min over the last 30 min/);
  });
});

/** Local helper — `AppState.sources` is a `SourceRegistry`, typed loosely
 *  here since `makeState()` casts through `unknown`. */
function sourcesFor(state: AppState): SourceRegistry {
  return state.sources as unknown as SourceRegistry;
}
