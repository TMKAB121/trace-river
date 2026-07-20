/**
 * TTY vs. non-TTY stream handling — spec 002 acceptance criterion 7 /
 * docs/phases/phase-2-docker.md § 2.3. A non-TTY container's stdout/stderr
 * are multiplexed with an 8-byte frame header per chunk and must be
 * demultiplexed with no binary garbage in any rendered entry; a TTY
 * container's output is already plain text and must render unmodified;
 * stderr lines lacking their own level are floored to WARN.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  dockerAvailable,
  startDockerTestServer,
  connect,
  collect,
  waitFor,
  sleep,
  closeAll,
  dockerRm,
  type DockerTestServer,
} from "./helpers.js";

const NOTTY = "tr-qa-demux-notty";
const TTY = "tr-qa-demux-tty";
const STDERR_ONLY = "tr-qa-demux-stderr";

// Control character / frame-header bytes that would leak through if the
// 8-byte Docker multiplex header were fed straight into the parser without
// demuxing (docs/phases/phase-2-docker.md § 2.3's "binary garbage" failure
// mode). \x00-\x02 are the stream-type byte values Docker uses.
const BINARY_GARBAGE_RE = /[\x00-\x08]/;

describe.skipIf(!dockerAvailable())("Docker TTY/non-TTY demux + stderr WARN floor (spec 002 §7)", () => {
  let ts: DockerTestServer | undefined;
  let cwd: string;

  beforeAll(async () => {
    cwd = mkdtempSync(join(tmpdir(), "tr-qa-demux-"));
    execFileSync(
      "docker",
      ["run", "-d", "--name", NOTTY, "alpine", "sh", "-c", 'i=0; while true; do i=$((i+1)); echo "notty plain line $i"; sleep 0.05; done'],
      { stdio: "ignore" },
    );
    execFileSync(
      "docker",
      ["run", "-d", "-t", "--name", TTY, "alpine", "sh", "-c", 'i=0; while true; do i=$((i+1)); echo "tty plain line $i"; sleep 0.05; done'],
      { stdio: "ignore" },
    );
    execFileSync(
      "docker",
      [
        "run",
        "-d",
        "--name",
        STDERR_ONLY,
        "alpine",
        "sh",
        "-c",
        'i=0; while true; do i=$((i+1)); echo "unlabeled stderr line $i" 1>&2; sleep 0.05; done',
      ],
      { stdio: "ignore" },
    );
    await sleep(2500); // backlog past the live-detection buffering threshold (see defect 002-phase-2-docker-1)
  }, 45000);

  afterEach(async () => {
    await ts?.close();
    ts = undefined;
  });

  afterAll(() => {
    dockerRm([NOTTY, TTY, STDERR_ONLY]);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("a non-TTY container's demuxed entries contain no binary frame-header garbage", async () => {
    ts = await startDockerTestServer({ cwd });
    await sleep(1500);
    const sourceId = `docker:${NOTTY}`;
    const client = await connect(ts.wsUrl, ts.token);
    try {
      const entries = collect(client, "entries");
      client.send(JSON.stringify({ type: "subscribe", sourceIds: [sourceId] }));
      await waitFor(() => entries.some((m) => m.entries.some((e) => e.source === sourceId)), 10000);

      const mine = entries.flatMap((m) => m.entries).filter((e) => e.source === sourceId);
      expect(mine.length).toBeGreaterThan(0);
      for (const entry of mine) {
        expect(entry.raw).not.toMatch(BINARY_GARBAGE_RE);
        expect(entry.message).not.toMatch(BINARY_GARBAGE_RE);
        expect(entry.message).toMatch(/^notty plain line \d+$/);
      }
    } finally {
      closeAll(client);
    }
  }, 20000);

  it("a TTY container's plain-text output renders unmodified (never demuxed)", async () => {
    ts = await startDockerTestServer({ cwd });
    await sleep(1500);
    const sourceId = `docker:${TTY}`;
    const client = await connect(ts.wsUrl, ts.token);
    try {
      const entries = collect(client, "entries");
      client.send(JSON.stringify({ type: "subscribe", sourceIds: [sourceId] }));
      await waitFor(() => entries.some((m) => m.entries.some((e) => e.source === sourceId)), 10000);

      const mine = entries.flatMap((m) => m.entries).filter((e) => e.source === sourceId);
      expect(mine.length).toBeGreaterThan(0);
      for (const entry of mine) {
        expect(entry.raw).not.toMatch(BINARY_GARBAGE_RE);
        expect(entry.message).toMatch(/^tty plain line \d+$/);
      }
    } finally {
      closeAll(client);
    }
  }, 20000);

  it("stderr lines without their own level are floored to WARN", async () => {
    ts = await startDockerTestServer({ cwd });
    await sleep(1500);
    const sourceId = `docker:${STDERR_ONLY}`;
    const client = await connect(ts.wsUrl, ts.token);
    try {
      const entries = collect(client, "entries");
      client.send(JSON.stringify({ type: "subscribe", sourceIds: [sourceId] }));
      await waitFor(() => entries.some((m) => m.entries.some((e) => e.source === sourceId)), 10000);

      const mine = entries.flatMap((m) => m.entries).filter((e) => e.source === sourceId);
      expect(mine.length).toBeGreaterThan(0);
      for (const entry of mine) {
        expect(entry.level).toBe("WARN");
        expect(entry.message).toMatch(/^unlabeled stderr line \d+$/);
      }
    } finally {
      closeAll(client);
    }
  }, 20000);
});
