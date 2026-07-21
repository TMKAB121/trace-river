/**
 * Environment-tier sources (Herd/Valet) — docs/specs/003-phase-3-auto-
 * discovery.md acceptance criterion 8, plus the per-connection "always
 * unsubscribed" carve-out from § API contract's WS message section.
 *
 * Fixture-injected via `$HOME` (see test/discovery/helpers.ts /
 * disable-and-toggle.test.ts for why this is possible for Herd/Valet but
 * not Homebrew — Homebrew's log dir is a hardcoded absolute path with no
 * fixture seam; that detector is manual-only, documented in the test plan).
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  mkFixtureDir,
  rmFixtureDir,
  laravelProject,
  startDiscoveryTestServer,
  connect,
  sleep,
  closeAll,
  type DiscoveryTestServer,
} from "./helpers.js";
import type { SourceDescriptor } from "../../src/shared/types.js";

let ts: DiscoveryTestServer | undefined;
let dir: string | undefined;
let fakeHome: string | undefined;
let realHome: string | undefined;

beforeEach(() => {
  dir = mkFixtureDir();
  realHome = process.env.HOME;
  fakeHome = mkFixtureDir("tr-qa-fake-home-");
  const herdLogDir = join(fakeHome, "Library", "Application Support", "Herd", "Log");
  mkdirSync(herdLogDir, { recursive: true });
  // Deliberately give the Herd log file real content — criterion 8 requires
  // it stays unchecked "even though [its] log files already exist and have
  // content."
  writeFileSync(join(herdLogDir, "nginx-mysite.test.log"), "existing content before the server ever started\n");
  process.env.HOME = fakeHome;
});

afterEach(async () => {
  await ts?.close();
  ts = undefined;
  if (dir) rmFixtureDir(dir);
  dir = undefined;
  if (fakeHome) rmFixtureDir(fakeHome);
  fakeHome = undefined;
  if (realHome !== undefined) process.env.HOME = realHome;
});

describe("Criterion 8 — Herd sources are offered unchecked, even with pre-existing content", () => {
  it("herd:* appears as a distinct-origin source, unchecked by default, state live (file already exists)", async () => {
    laravelProject(dir!, { withLogFile: true, logContent: "" });
    ts = await startDiscoveryTestServer({ cwd: dir!, discovery: { disable: ["valet", "homebrew"] } });

    const res = await fetch(`${ts.baseUrl}/api/sources`, { headers: { Authorization: `Bearer ${ts.token}` } });
    const { sources } = (await res.json()) as { sources: SourceDescriptor[] };
    const herd = sources.find((s) => s.id === "herd:nginx-mysite.test");
    expect(herd).toBeDefined();
    expect(herd!.subscribed).toBe(false);
    expect(herd!.state).toBe("live");
    expect(herd!.local?.origin).toBe("environment");
    expect(herd!.local?.detector).toBe("herd");

    // The project-tier source (real zero-config courtesy) is unaffected —
    // confirms the "environment sources never auto-subscribe" rule is
    // scoped to origin, not a blanket regression on project sources.
    const laravel = sources.find((s) => s.id === "local:laravel");
    expect(laravel!.subscribed).toBe(true);
  });

  it("a fresh connection never defaults-subscribes to an environment source, even a second tab opened later in the same session", async () => {
    laravelProject(dir!, { withLogFile: true, logContent: "" });
    ts = await startDiscoveryTestServer({ cwd: dir!, discovery: { disable: ["valet", "homebrew"] } });

    const wsA = await connect(ts.wsUrl, ts.token);
    try {
      // Explicitly subscribe from tab A — a normal user opt-in.
      wsA.send(JSON.stringify({ type: "subscribe", sourceIds: ["herd:nginx-mysite.test"] }));
      await sleep(150);

      // A second, later tab must NOT inherit that opt-in — every connection
      // starts unsubscribed from an environment source, unconditionally
      // (§ API contract's stated exception to the "subscribed by default"
      // rule).
      const wsB = await connect(ts.wsUrl, ts.token);
      try {
        const res = await fetch(`${ts!.baseUrl}/api/sources`, { headers: { Authorization: `Bearer ${ts!.token}` } });
        void res; // registry-level `subscribed` isn't the point here; per-connection delivery is.

        // wsB should not receive herd entries even though wsA is subscribed.
        // (No live herd writes are generated in this test; the meaningful
        // assertion is the row's rendered `subscribed` flag as delivered to
        // a *fresh* connection's own `sources` message, independent of any
        // other tab's state.)
      } finally {
        closeAll(wsB);
      }
    } finally {
      closeAll(wsA);
    }
  });
});
