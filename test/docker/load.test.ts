/**
 * ~5,000 lines/sec Docker container throughput — spec 002 acceptance
 * criterion 14. Verifies: the server stays responsive throughout (a proxy
 * for "doesn't freeze the browser tab" — same rationale as
 * test/e2e/memory.test.ts), server memory stays bounded (RSS ceiling,
 * measured in an isolated child process), and the ring buffer's eviction
 * mechanism keeps `bufferUsed` capped rather than growing unbounded — the
 * server-side signal the client's "Showing last N entries" notice is
 * computed from (`web/src/store/store.tsx`'s `useEvicted`).
 *
 * A small buffer capacity (2,000) is used so eviction is reached quickly
 * without needing a multi-minute run — the mechanism being tested (ring
 * buffer wraps once capacity is exceeded) doesn't depend on the capacity's
 * absolute size.
 */
import { describe, it, expect, afterEach } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { WebSocket } from "ws";
import { dockerAvailable, dockerRm } from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNNER_PATH = join(__dirname, "child-docker-runner.ts");
const TSX_BIN = join(__dirname, "..", "..", "node_modules", ".bin", "tsx");

const BUFFER_CAPACITY = 2000;
const RSS_CEILING_MB = 300; // same owner-accepted ceiling as test/e2e/memory.test.ts
const SPAM_NAME = "tr-qa-load-spam";

let child: ChildProcessWithoutNullStreams | undefined;
let cwd: string | undefined;

afterEach(async () => {
  if (child && !child.killed) {
    child.kill("SIGTERM");
    await new Promise((resolve) => child!.once("exit", resolve));
  }
  child = undefined;
  dockerRm([SPAM_NAME]);
  if (cwd) {
    rmSync(cwd, { recursive: true, force: true });
    cwd = undefined;
  }
});

interface ChildReady {
  pid: number;
  port: number;
  token: string;
}

function spawnChildServer(bufferCwd: string): Promise<{ proc: ChildProcessWithoutNullStreams; ready: ChildReady }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(TSX_BIN, [RUNNER_PATH, "load-test-token", String(BUFFER_CAPACITY), bufferCwd], {
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
        console.error("child docker server stderr:\n" + stderr);
      }
    });
  });
}

function rssMbOf(pid: number): number | null {
  try {
    const out = execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" });
    const kb = Number(out.trim());
    return Number.isFinite(kb) ? kb / 1024 : null;
  } catch {
    return null;
  }
}

describe.skipIf(!dockerAvailable())("Docker high-throughput streaming (spec 002 §14)", () => {
  it(
    "a container spamming lines doesn't freeze the server, RSS stays bounded, and the ring buffer evicts (bufferUsed caps at capacity)",
    async () => {
      cwd = mkdtempSync(join(tmpdir(), "tr-qa-load-"));
      dockerRm([SPAM_NAME]);
      // Tight loop, no sleep: as fast as the shell can emit lines. Alpine's
      // busybox `echo`/loop overhead realistically lands in the low
      // thousands of lines/sec, in the neighborhood of the spec's ~5k/s
      // figure and enough to exercise batching/eviction meaningfully.
      execFileSync(
        "docker",
        ["run", "-d", "--name", SPAM_NAME, "alpine", "sh", "-c", 'i=0; while true; do i=$((i+1)); echo "spam $i"; done'],
        { stdio: "ignore" },
      );

      const { proc, ready } = await spawnChildServer(cwd);
      child = proc;

      await new Promise((r) => setTimeout(r, 1500)); // discovery

      const ws = new WebSocket(`ws://127.0.0.1:${ready.port}/ws?token=${encodeURIComponent(ready.token)}`);
      await new Promise((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      });
      ws.on("message", () => {
        /* discard — just draining, mirroring a connected browser tab */
      });
      ws.send(JSON.stringify({ type: "subscribe", sourceIds: [`docker:${SPAM_NAME}`] }));

      const rssSamplesMb: number[] = [];
      const statusLatenciesMs: number[] = [];
      const statusFailures: string[] = [];
      const bufferUsedSamples: number[] = [];

      const rssTimer = setInterval(() => {
        const mb = rssMbOf(ready.pid);
        if (mb !== null) rssSamplesMb.push(mb);
      }, 250);

      const responsivenessTimer = setInterval(() => {
        const start = Date.now();
        fetch(`http://127.0.0.1:${ready.port}/api/status`, { headers: { Authorization: `Bearer ${ready.token}` } })
          .then(async (res) => {
            statusLatenciesMs.push(Date.now() - start);
            if (!res.ok) statusFailures.push(`status ${res.status}`);
            else {
              const body = (await res.json()) as { bufferUsed: number };
              bufferUsedSamples.push(body.bufferUsed);
            }
          })
          .catch((err) => statusFailures.push(String(err)));
      }, 300);

      await new Promise((r) => setTimeout(r, 10_000)); // let the spam run

      clearInterval(rssTimer);
      clearInterval(responsivenessTimer);
      await new Promise((r) => setTimeout(r, 500));
      ws.close();

      expect(statusFailures, `responsiveness probe failures: ${statusFailures.join("; ")}`).toEqual([]);
      expect(statusLatenciesMs.length).toBeGreaterThan(0);
      const maxLatencyMs = Math.max(...statusLatenciesMs);
      expect(maxLatencyMs).toBeLessThan(15_000); // stays responsive, not hung

      expect(rssSamplesMb.length).toBeGreaterThan(0);
      const peakRssMb = Math.max(...rssSamplesMb);

      expect(bufferUsedSamples.length).toBeGreaterThan(0);
      const maxBufferUsed = Math.max(...bufferUsedSamples);

      // eslint-disable-next-line no-console
      console.log(
        `[docker load test] peakRssMb=${peakRssMb.toFixed(1)} maxStatusLatencyMs=${maxLatencyMs} ` +
          `maxBufferUsed=${maxBufferUsed} capacity=${BUFFER_CAPACITY}`,
      );

      // Ring buffer eviction: bufferUsed must have reached (and stayed
      // capped at) the configured capacity, not grown past it unbounded —
      // the mechanism the client's "Showing last N entries" notice relies on.
      expect(maxBufferUsed).toBeLessThanOrEqual(BUFFER_CAPACITY);
      expect(maxBufferUsed).toBe(BUFFER_CAPACITY); // actually reached full/wrapped, not just started filling

      expect(peakRssMb, `peak RSS ${peakRssMb.toFixed(1)} MB vs the ${RSS_CEILING_MB} MB ceiling`).toBeLessThanOrEqual(
        RSS_CEILING_MB,
      );
    },
    60_000,
  );
});
