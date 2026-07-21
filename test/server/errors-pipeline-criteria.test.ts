/**
 * Error-intelligence acceptance criteria exercised through the real
 * ingestion pipeline (upload -> parse -> fingerprint -> group -> broadcast),
 * per docs/specs/004-phase-4-error-intelligence.md acceptance criteria 1,
 * 2, 3, 6, 7, 13, 15 and docs/phases/phase-4-error-intelligence.md's exit
 * criteria. Uses the real HTTP upload endpoint (not a direct
 * `ErrorGroupStore` call) so parser-pipeline wiring (src/server/
 * ingest-entries.ts) is exercised end-to-end, matching criterion 1's own
 * wording ("Feeding 400 occurrences... through the pipeline").
 */
import { describe, it, expect, afterEach } from "vitest";
import { startTestServer, type TestServer } from "../helpers/server.js";
import { connect, collect, waitFor, closeAll, sleep } from "../docker/helpers.js";
import type { ErrorGroup, TraceRiverLog } from "../../src/shared/types.js";

let ts: TestServer | undefined;

afterEach(async () => {
  await ts?.close();
  ts = undefined;
});

function monologLine(ts: string, level: string, message: string): string {
  return `[${ts}] production.${level}: ${message} {} []`;
}

/** 400 occurrences of the same Laravel exception (identical message + top
 *  stack frame), each timestamped a second apart so every line is a
 *  distinct, well-formed monolog entry-start. */
function laravel400RepsFixture(): string {
  const lines: string[] = [];
  const base = new Date("2026-07-19T09:15:00Z");
  for (let i = 0; i < 400; i++) {
    const t = new Date(base.getTime() + i * 1000).toISOString().replace("T", " ").slice(0, 19);
    lines.push(monologLine(t, "ERROR", `Undefined array key "id" in UserController.php:42`));
    lines.push(`#0 /app/app/Http/Controllers/UserController.php(42): App\\Http\\Controllers\\UserController->show()`);
    lines.push(`#1 {main}`);
  }
  lines.push(monologLine("2026-07-19 09:22:00", "INFO", "Request completed"));
  return lines.join("\n") + "\n";
}

/** Two exceptions sharing identical message text but different top stack
 *  frames (different file/line). */
function laravelTwoDistinctFixture(): string {
  const lines: string[] = [
    monologLine("2026-07-19 09:15:00", "ERROR", `Undefined array key "id" in UserController.php:42`),
    `#0 /app/app/Http/Controllers/UserController.php(42): App\\Http\\Controllers\\UserController->show()`,
    `#1 {main}`,
    monologLine("2026-07-19 09:15:05", "ERROR", `Undefined array key "id" in UserController.php:42`),
    `#0 /app/app/Services/ReportBuilder.php(88): App\\Services\\ReportBuilder->build()`,
    `#1 {main}`,
    monologLine("2026-07-19 09:15:10", "INFO", "Request completed"),
  ];
  return lines.join("\n") + "\n";
}

/** Mixed-level fixture for criterion 7. */
function mixedLevelFixture(): string {
  return [
    monologLine("2026-07-19 09:15:00", "INFO", "User logged in"),
    monologLine("2026-07-19 09:15:01", "WARNING", "Deprecated function called"),
    monologLine("2026-07-19 09:15:02", "DEBUG", "Cache hit"),
    monologLine("2026-07-19 09:15:03", "ERROR", "Something broke"),
    monologLine("2026-07-19 09:15:04", "CRITICAL", "Fatal condition"),
  ].join("\n") + "\n";
}

async function upload(baseUrl: string, token: string, name: string, body: string): Promise<Response> {
  return fetch(`${baseUrl}/api/upload?name=${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
    body,
  });
}

describe("Criterion 1 — 400 repetitions collapse into exactly one ErrorGroup with count 400", () => {
  it("uploads a 400-occurrence Laravel exception fixture through the real pipeline", async () => {
    ts = await startTestServer();
    const { baseUrl, token } = ts;
    const res = await upload(baseUrl, token, "laravel-400.log", laravel400RepsFixture());
    expect(res.status).toBe(200);

    await waitFor(async () => {
      const r = await fetch(`${baseUrl}/api/errors`, { headers: { Authorization: `Bearer ${token}` } });
      const body = (await r.json()) as { groups: ErrorGroup[] };
      return body.groups.length === 1 && body.groups[0].count === 400;
    });

    const r = await fetch(`${baseUrl}/api/errors`, { headers: { Authorization: `Bearer ${token}` } });
    const { groups } = (await r.json()) as { groups: ErrorGroup[] };
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(400);
    expect(groups[0].level).toBe("ERROR");
    expect(groups[0].sources).toEqual(["file:laravel-400.log"]);
    expect(groups[0].title).toContain("Undefined array key");
  });
});

describe("Criterion 2 — same message, different top stack frame -> separate groups", () => {
  it("produces two distinct ErrorGroups, each count 1", async () => {
    ts = await startTestServer();
    const { baseUrl, token } = ts;
    await upload(baseUrl, token, "laravel-two.log", laravelTwoDistinctFixture());

    await waitFor(async () => {
      const r = await fetch(`${baseUrl}/api/errors`, { headers: { Authorization: `Bearer ${token}` } });
      const body = (await r.json()) as { groups: ErrorGroup[] };
      return body.groups.length === 2;
    });

    const r = await fetch(`${baseUrl}/api/errors`, { headers: { Authorization: `Bearer ${token}` } });
    const { groups } = (await r.json()) as { groups: ErrorGroup[] };
    expect(groups).toHaveLength(2);
    expect(groups[0].fingerprint).not.toBe(groups[1].fingerprint);
    expect(groups.every((g) => g.count === 1)).toBe(true);
  });
});

describe("Criterion 7 — entry.fingerprint non-null only for ERROR/FATAL", () => {
  it("a mixed-level fixture yields fingerprint on exactly the ERROR/CRITICAL(FATAL) entries", async () => {
    ts = await startTestServer();
    const { baseUrl, wsUrl, token } = ts;
    const ws = await connect(wsUrl, token);
    const entriesMsgs = collect(ws, "entries");
    await upload(baseUrl, token, "mixed.log", mixedLevelFixture());
    await waitFor(() => entriesMsgs.flatMap((m) => m.entries).length >= 5);

    const all: TraceRiverLog[] = entriesMsgs.flatMap((m) => m.entries);
    const byLevel = new Map(all.map((e) => [e.level, e.fingerprint]));
    expect(byLevel.get("INFO")).toBeNull();
    expect(byLevel.get("WARN")).toBeNull();
    expect(byLevel.get("DEBUG")).toBeNull();
    expect(byLevel.get("ERROR")).not.toBeNull();
    expect(byLevel.get("FATAL")).not.toBeNull(); // CRITICAL normalizes to FATAL
    closeAll(ws);
  });
});

describe("Criterion 3 — live errorGroups updates during a live stream, no page refresh required", () => {
  it("the errorGroups WS message grows count as new occurrences stream in on an already-open connection", async () => {
    ts = await startTestServer();
    const { baseUrl, wsUrl, token } = ts;
    const ws = await connect(wsUrl, token);
    const groupMsgs = collect(ws, "errorGroups");

    await waitFor(() => groupMsgs.length >= 1); // connect-sequence errorGroups ([] when no groups yet)
    expect(groupMsgs[0].groups).toEqual([]);

    await upload(baseUrl, token, "live-errors.log", laravel400RepsFixture());

    await waitFor(() => {
      const latest = groupMsgs[groupMsgs.length - 1];
      return latest.groups.length === 1 && latest.groups[0].count === 400;
    });
    closeAll(ws);
  });
});

describe("Criterion 13 — Errors panel data is not filtered by any per-connection subscription state", () => {
  it("a client that unsubscribes from the source still receives full errorGroups updates for it", async () => {
    ts = await startTestServer();
    const { baseUrl, wsUrl, token } = ts;
    const ws = await connect(wsUrl, token);
    const groupMsgs = collect(ws, "errorGroups");
    await waitFor(() => groupMsgs.length >= 1);

    await upload(baseUrl, token, "scoped.log", laravel400RepsFixture());
    await waitFor(() => groupMsgs[groupMsgs.length - 1].groups.length === 1);

    // Unsubscribe from the source (would hide it from the *stream*) — the
    // error-group list must still reflect it in full (spec Decision 4).
    ws.send(JSON.stringify({ type: "unsubscribe", sourceIds: ["file:scoped.log"] }));
    await sleep(150);

    const r = await fetch(`${baseUrl}/api/errors`, { headers: { Authorization: `Bearer ${token}` } });
    const { groups } = (await r.json()) as { groups: ErrorGroup[] };
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(400);
    closeAll(ws);
  });
});

describe("Criterion 15 — GET /api/errors mirrors the most recent WS errorGroups payload", () => {
  it("REST and WS report the identical group content after live updates settle", async () => {
    ts = await startTestServer();
    const { baseUrl, wsUrl, token } = ts;
    const ws = await connect(wsUrl, token);
    const groupMsgs = collect(ws, "errorGroups");
    await waitFor(() => groupMsgs.length >= 1);

    await upload(baseUrl, token, "mirror.log", laravelTwoDistinctFixture());
    await waitFor(() => groupMsgs[groupMsgs.length - 1].groups.length === 2);
    await sleep(150); // let the tick settle fully quiescent

    const r = await fetch(`${baseUrl}/api/errors`, { headers: { Authorization: `Bearer ${token}` } });
    const { groups: restGroups } = (await r.json()) as { groups: ErrorGroup[] };
    const wsGroups = groupMsgs[groupMsgs.length - 1].groups;

    const sortByFp = (a: ErrorGroup, b: ErrorGroup) => a.fingerprint.localeCompare(b.fingerprint);
    expect([...restGroups].sort(sortByFp)).toEqual([...wsGroups].sort(sortByFp));
    closeAll(ws);
  });
});

describe("Criterion 6 — groups survive ring-buffer eviction (small --buffer harness)", () => {
  it("a group's count/firstSeen/lastSeen survive its raw entries aging out, rawEntriesEvicted flips true, samples marked evicted", async () => {
    ts = await startTestServer({ buffer: 20 }); // small cap so the fixture below evicts easily
    const { baseUrl, token } = ts;

    // Seed a low-frequency error early, then flood with unrelated INFO
    // entries well past the buffer cap so the seeded error's raw entries age out.
    const seedLines = [
      monologLine("2026-07-19 09:00:00", "ERROR", "Old low-frequency bug"),
      `#0 /app/app/Old.php(1): App\\Old->run()`,
    ];
    await upload(baseUrl, token, "seed.log", seedLines.join("\n") + "\n");

    await waitFor(async () => {
      const r = await fetch(`${baseUrl}/api/errors`, { headers: { Authorization: `Bearer ${token}` } });
      const body = (await r.json()) as { groups: ErrorGroup[] };
      return body.groups.length === 1;
    });
    const before = await fetch(`${baseUrl}/api/errors`, { headers: { Authorization: `Bearer ${token}` } });
    const { groups: beforeGroups } = (await before.json()) as { groups: ErrorGroup[] };
    expect(beforeGroups[0].rawEntriesEvicted).toBe(false);
    const { firstSeen, lastSeen, count } = beforeGroups[0];

    const floodLines: string[] = [];
    for (let i = 0; i < 60; i++) {
      floodLines.push(monologLine(`2026-07-19 09:0${Math.floor(i / 60)}:${String(i % 60).padStart(2, "0")}`, "INFO", `noise ${i}`));
    }
    await upload(baseUrl, token, "flood.log", floodLines.join("\n") + "\n");

    await waitFor(async () => {
      const r = await fetch(`${baseUrl}/api/errors`, { headers: { Authorization: `Bearer ${token}` } });
      const body = (await r.json()) as { groups: ErrorGroup[] };
      return body.groups.length === 1 && body.groups[0].rawEntriesEvicted === true;
    });

    const after = await fetch(`${baseUrl}/api/errors`, { headers: { Authorization: `Bearer ${token}` } });
    const { groups: afterGroups } = (await after.json()) as { groups: ErrorGroup[] };
    expect(afterGroups).toHaveLength(1);
    expect(afterGroups[0].count).toBe(count);
    expect(afterGroups[0].firstSeen).toBe(firstSeen);
    expect(afterGroups[0].lastSeen).toBe(lastSeen);
    expect(afterGroups[0].rawEntriesEvicted).toBe(true);
    // Its raw sample id has aged out of the (tiny) buffer, so no resolvable samples remain.
    expect(afterGroups[0].sampleEntryIds).toEqual([]);

    // Prompt generation still succeeds (200) with the documented graceful fallback.
    const promptRes = await fetch(`${baseUrl}/api/errors/${afterGroups[0].fingerprint}/prompt`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(promptRes.status).toBe(200);
    const { prompt } = (await promptRes.json()) as { prompt: string };
    expect(prompt).toContain("original stack trace no longer available");
  });
});
