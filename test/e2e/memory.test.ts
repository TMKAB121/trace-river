/**
 * Spec 001 acceptance criterion 7 / phase-1-core.md exit criterion: a 100 MB
 * real-world-shaped log file parses to completion, the Node **server**
 * process stays within the accepted RSS tolerance, and the server remains
 * responsive to other requests throughout the upload (a same-process proxy
 * for "the browser tab remains responsive" — see the test-plan notes for why
 * actual browser-tab responsiveness isn't reachable by this harness).
 *
 * The server is spawned as a *separate* process (via tsx) specifically so
 * its RSS can be measured in isolation from this test/client process, which
 * itself allocates memory generating and streaming the 100 MB upload body.
 *
 * RSS threshold: spec 001 criterion 7 / phase-1-core.md's exit criteria say
 * "~250 MB RSS". QA independently measured a peak of 263–292 MB across three
 * runs (see docs/qa/defects/001-phase-1-core-console-2.md) and filed it as a
 * defect; the product owner reviewed the measurement and ruled the ~263–292
 * MB range ACCEPTED as within the "~250 MB" tolerance for phase 1 (defect
 * closed as accepted-by-owner). The threshold below reflects that ruling,
 * later relaxed to 350 MB (owner-approved 2026-07-22) so it could serve as a
 * required CI gate: Node 20 on GitHub runners and Node 26 locally both peak
 * around 307 MB, and a ceiling pinned just above the phase-1 measurement was
 * too tight to survive machine-to-machine RSS variance without flaking. The
 * check still catches a genuine regression rather than asserting the exact
 * originally-quoted 250 MB (which would fail forever on the owner-accepted
 * baseline) or removing the check entirely — the ring buffer is bounded, so a
 * real leak balloons unboundedly past 350, not a few MB over.
 *
 * Responsiveness: the owner separately accepted the ~3s peak latency spike
 * observed on a trivial endpoint during the upload as fine for phase 1 (no
 * numeric criterion exists in the spec) — see the test plan's notes. The
 * assertion's ceiling was relaxed 15s → 45s (owner-approved 2026-07-22) so it
 * survives as a required CI gate: GitHub's shared macOS runners spike to ~15s,
 * which is slow hardware rather than a hang (a true hang blows the 180s test
 * timeout well before 45s).
 */
import { describe, it, expect, afterEach } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams, execFileSync } from "node:child_process";
import { request } from "node:http";
import { WebSocket } from "ws";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNNER_PATH = join(__dirname, "..", "helpers", "child-server-runner.ts");
const TSX_BIN = join(__dirname, "..", "..", "node_modules", ".bin", "tsx");

const TARGET_BYTES = 100 * 1024 * 1024; // 100 MB, per the spec's exit criterion.
// Owner-accepted ceiling (see module docstring). History: 250 (literal spec
// wording) → 300 (owner accepted the QA-measured 263-292 MB range) → 350.
// The 350 bump (owner-approved 2026-07-22) adds headroom for CI: Node 20 on
// GitHub runners and Node 26 locally measure ~307 MB, and a fixed ceiling
// this tight was flaky as a required merge gate. 350 still guards regressions
// — the ring buffer is bounded, so a genuine leak balloons unboundedly past
// any ceiling rather than nudging a few MB over.
const RSS_ACCEPTED_LIMIT_MB = 350;

let child: ChildProcessWithoutNullStreams | undefined;

afterEach(async () => {
  if (child && !child.killed) {
    child.kill("SIGTERM");
    await new Promise((resolve) => child!.once("exit", resolve));
  }
  child = undefined;
});

function pad(n: number, len = 2): string {
  return String(n).padStart(len, "0");
}

function formatMonologTs(baseMs: number, offsetSeconds: number): string {
  const d = new Date(baseMs + offsetSeconds * 1000);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** Streams ~realistic Laravel/Monolog-shaped content: mostly single-line
 *  entries, ~1 in 20 a small multi-line stack trace, until `targetBytes`. */
async function* generateLogLines(targetBytes: number): AsyncGenerator<string> {
  const baseMs = Date.now();
  let bytes = 0;
  let i = 0;
  const levels = ["INFO", "DEBUG", "WARN", "ERROR"];
  while (bytes < targetBytes) {
    i++;
    const ts = formatMonologTs(baseMs, i);
    if (i % 20 === 0) {
      const lines = [
        `[${ts}] production.ERROR: Something failed on request ${i} {"request_id":${i}} []`,
        `#0 /app/src/Handler.php(10): Handler->handle()`,
        `#1 /app/src/Kernel.php(55): Kernel->run()`,
        `Caused by: RuntimeException: nested failure ${i}`,
        `Stack trace:`,
        `#0 /app/src/Db.php(20): Db->connect()`,
        `#1 {main}`,
      ];
      for (const line of lines) {
        bytes += Buffer.byteLength(line) + 1;
        yield line + "\n";
      }
    } else {
      const level = levels[i % levels.length];
      const line = `[${ts}] local.${level}: Handling request ${i} for /api/resource/${i} {"request_id":${i},"duration_ms":${i % 500}} []`;
      bytes += Buffer.byteLength(line) + 1;
      yield line + "\n";
    }
  }
}

interface ChildReady {
  pid: number;
  port: number;
  token: string;
}

function spawnChildServer(): Promise<{ proc: ChildProcessWithoutNullStreams; ready: ChildReady }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(TSX_BIN, [RUNNER_PATH, "memory-test-token"], {
      cwd: join(__dirname, "..", ".."),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const rl = createInterface({ input: proc.stdout });
    const timer = setTimeout(() => reject(new Error("child server did not report ready in time")), 15000);
    rl.once("line", (line) => {
      clearTimeout(timer);
      try {
        resolve({ proc, ready: JSON.parse(line) as ChildReady });
      } catch (err) {
        reject(err);
      }
    });
    proc.once("error", reject);
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.once("exit", (code) => {
      if (code !== 0 && code !== null) {
        // eslint-disable-next-line no-console
        console.error("child server stderr:\n" + stderr);
      }
    });
  });
}

/** RSS of the child process in MB, via `ps` (portable across macOS/Linux, no new dependency). */
function rssMbOf(pid: number): number | null {
  try {
    const out = execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" });
    const kb = Number(out.trim());
    return Number.isFinite(kb) ? kb / 1024 : null;
  } catch {
    return null; // process may have already exited
  }
}

function streamUpload(port: number, token: string, name: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path: `/api/upload?name=${encodeURIComponent(name)}`,
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
          // No Content-Length -> exercises the chunked/unknown-length streaming path.
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ statusCode: res.statusCode ?? -1, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("error", reject);

    (async () => {
      for await (const line of generateLogLines(TARGET_BYTES)) {
        if (!req.write(line)) {
          await new Promise((resolve) => req.once("drain", resolve));
        }
      }
      req.end();
    })().catch(reject);
  });
}

describe("Memory & responsiveness — 100 MB upload (spec 001 criterion 7)", () => {
  it(
    "parses a 100 MB log to completion; reports peak server RSS vs the owner-accepted ceiling; server keeps answering other requests throughout",
    async () => {
      const { proc, ready } = await spawnChildServer();
      child = proc;

      // Drain the WS stream throughout, mirroring a real connected browser tab.
      const ws = new WebSocket(`ws://127.0.0.1:${ready.port}/ws?token=${encodeURIComponent(ready.token)}`);
      await new Promise((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      });
      ws.on("message", () => {
        /* discard — just preventing WS backpressure/high-water-mark drops */
      });

      const rssSamplesMb: number[] = [];
      const statusLatenciesMs: number[] = [];
      const statusFailures: string[] = [];

      const rssTimer = setInterval(() => {
        const mb = rssMbOf(ready.pid);
        if (mb !== null) rssSamplesMb.push(mb);
      }, 250);

      const responsivenessTimer = setInterval(() => {
        const start = Date.now();
        fetch(`http://127.0.0.1:${ready.port}/api/status`, {
          headers: { Authorization: `Bearer ${ready.token}` },
        })
          .then((res) => {
            statusLatenciesMs.push(Date.now() - start);
            if (!res.ok) statusFailures.push(`status ${res.status}`);
          })
          .catch((err) => statusFailures.push(String(err)));
      }, 400);

      const uploadResult = await streamUpload(ready.port, ready.token, "synthetic-100mb.log");

      clearInterval(rssTimer);
      clearInterval(responsivenessTimer);
      // Let any in-flight responsiveness probes settle.
      await new Promise((r) => setTimeout(r, 500));
      ws.close();

      expect(uploadResult.statusCode).toBe(200);
      const body = JSON.parse(uploadResult.body) as { source: { entryCount: number; state: string } };
      expect(body.source.state).toBe("stopped");
      expect(body.source.entryCount).toBeGreaterThan(0);

      expect(rssSamplesMb.length).toBeGreaterThan(0);
      const peakRssMb = Math.max(...rssSamplesMb);

      expect(statusFailures, `responsiveness probe failures: ${statusFailures.join("; ")}`).toEqual([]);
      expect(statusLatenciesMs.length).toBeGreaterThan(0);
      const maxLatencyMs = Math.max(...statusLatenciesMs);

      // eslint-disable-next-line no-console
      console.log(
        `[memory test] entries=${body.source.entryCount} peakRssMb=${peakRssMb.toFixed(1)} ` +
          `maxStatusLatencyMs=${maxLatencyMs} statusSamples=${statusLatenciesMs.length}`,
      );

      // The spec/phase doc require the server/tab to "stay responsive" during
      // the upload but define no numeric threshold. The product owner
      // reviewed QA's measured ~3s peak latency spike and accepted it for
      // phase 1 (see docs/qa/test-plans/001-phase-1-core-console.md) — this
      // assertion only catches a true hang/timeout, not a specific ms budget.
      // Ceiling raised 15s → 45s (owner-approved 2026-07-22) so it can gate CI:
      // GitHub's shared 2-core macOS runners spike to ~15s here (5x the dev-Mac
      // ~3s) under the 100 MB upload, which is slow hardware, not a hang — a
      // genuine hang blows this test's own 180s timeout long before 45s.
      expect(maxLatencyMs).toBeLessThan(45_000);

      // Owner-accepted RSS ceiling (see module docstring) — was the literal
      // spec wording (~250 MB) until the product owner reviewed QA's
      // measured 263-292 MB range and accepted it for phase 1.
      expect(
        peakRssMb,
        `peak RSS ${peakRssMb.toFixed(1)} MB vs the owner-accepted ${RSS_ACCEPTED_LIMIT_MB} MB ceiling`,
      ).toBeLessThanOrEqual(RSS_ACCEPTED_LIMIT_MB);
    },
    180_000,
  );
});
