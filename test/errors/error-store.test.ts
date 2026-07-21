/**
 * ErrorGroupStore — docs/specs/004-phase-4-error-intelligence.md
 * § Interaction specs (Group storage/cap/eviction survival, Spike
 * detection) and acceptance criteria 1, 4, 6, 9. Unit-level: a fake
 * `SampleResolver` stands in for the ring buffer so eviction can be
 * simulated deterministically without a real 50k-entry buffer.
 */
import { describe, it, expect } from "vitest";
import { ErrorGroupStore, computeSpiking, type SampleResolver } from "../../src/errors/error-store.js";
import { computeFingerprint } from "../../src/errors/fingerprint.js";
import type { TraceRiverLog } from "../../src/shared/types.js";

/** Simple resolver: every id in `held` resolves; anything else is "evicted". */
class FakeRingBuffer implements SampleResolver {
  held = new Set<number>();
  hasId(id: number): boolean {
    return this.held.has(id);
  }
}

let nextId = 1;
function makeEntry(overrides: Partial<TraceRiverLog> & { source: string; message: string }): TraceRiverLog {
  const level = overrides.level ?? "ERROR";
  const fp = computeFingerprint({ source: overrides.source, level, message: overrides.message, body: overrides.body ?? null });
  return {
    id: overrides.id ?? nextId++,
    timestamp: overrides.timestamp ?? Date.now(),
    rawTimestamp: null,
    source: overrides.source,
    level,
    message: overrides.message,
    body: overrides.body ?? null,
    context: null,
    raw: overrides.message,
    multiline: false,
    fingerprint: fp ? fp.fingerprint : null,
    ...overrides,
  };
}

describe("ErrorGroupStore — grouping (criterion 1)", () => {
  it("400 occurrences of the same fingerprint collapse into one group with count 400", () => {
    const ring = new FakeRingBuffer();
    const store = new ErrorGroupStore(ring);
    let fingerprint = "";
    for (let i = 0; i < 400; i++) {
      const entry = makeEntry({ source: "docker:app", message: "Undefined array key in UserController" });
      ring.held.add(entry.id);
      const fp = computeFingerprint({ source: entry.source, level: entry.level, message: entry.message, body: null })!;
      fingerprint = fp.fingerprint;
      store.recordOccurrence(entry, fp.title);
    }
    const groups = store.list();
    expect(groups).toHaveLength(1);
    expect(groups[0].fingerprint).toBe(fingerprint);
    expect(groups[0].count).toBe(400);
  });

  it("two distinct fingerprints produce two distinct groups, each with its own count", () => {
    const ring = new FakeRingBuffer();
    const store = new ErrorGroupStore(ring);
    for (let i = 0; i < 3; i++) {
      const entry = makeEntry({ source: "docker:app", message: "Bug A" });
      ring.held.add(entry.id);
      const fp = computeFingerprint({ source: entry.source, level: entry.level, message: entry.message, body: null })!;
      store.recordOccurrence(entry, fp.title);
    }
    for (let i = 0; i < 5; i++) {
      const entry = makeEntry({ source: "docker:app", message: "Bug B" });
      ring.held.add(entry.id);
      const fp = computeFingerprint({ source: entry.source, level: entry.level, message: entry.message, body: null })!;
      store.recordOccurrence(entry, fp.title);
    }
    const groups = store.list();
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.count).sort()).toEqual([3, 5]);
  });

  it("firstSeen/lastSeen track the min/max timestamp across occurrences; sources accumulates every distinct source", () => {
    const ring = new FakeRingBuffer();
    const store = new ErrorGroupStore(ring);
    const base = 1_700_000_000_000;
    const e1 = makeEntry({ source: "docker:app", message: "Boom", timestamp: base });
    const e2 = makeEntry({ source: "docker:app", message: "Boom", timestamp: base + 60_000 });
    ring.held.add(e1.id).add(e2.id);
    const fp = computeFingerprint({ source: "docker:app", level: "ERROR", message: "Boom", body: null })!;
    store.recordOccurrence(e1, fp.title);
    store.recordOccurrence(e2, fp.title);
    const [group] = store.list();
    expect(group.firstSeen).toBe(base);
    expect(group.lastSeen).toBe(base + 60_000);
    expect(group.sources).toEqual(["docker:app"]);
  });

  it("recordOccurrence is a no-op for a non-ERROR/FATAL entry or a null fingerprint (defensive invariant)", () => {
    const ring = new FakeRingBuffer();
    const store = new ErrorGroupStore(ring);
    const infoEntry = makeEntry({ source: "docker:app", message: "all good", level: "INFO" });
    store.recordOccurrence(infoEntry, "all good");
    expect(store.list()).toHaveLength(0);
  });
});

describe("ErrorGroupStore — cap and LRU eviction", () => {
  it("evicts the group with the oldest lastSeen once a genuinely new fingerprint would exceed the 500 cap", () => {
    const ring = new FakeRingBuffer();
    const store = new ErrorGroupStore(ring);
    const base = 1_700_000_000_000;

    // 500 distinct groups, each with a strictly increasing lastSeen so
    // group #0 is unambiguously the oldest.
    const fingerprints: string[] = [];
    for (let i = 0; i < 500; i++) {
      const entry = makeEntry({ source: "docker:app", message: `Bug number ${i}`, timestamp: base + i * 1000 });
      ring.held.add(entry.id);
      const fp = computeFingerprint({ source: entry.source, level: entry.level, message: entry.message, body: null })!;
      fingerprints.push(fp.fingerprint);
      store.recordOccurrence(entry, fp.title);
    }
    expect(store.list()).toHaveLength(500);

    // One more, genuinely new fingerprint -> group #0 (oldest lastSeen) is evicted outright.
    const newest = makeEntry({ source: "docker:app", message: "Bug number 500", timestamp: base + 500_000 });
    ring.held.add(newest.id);
    const newFp = computeFingerprint({ source: newest.source, level: newest.level, message: newest.message, body: null })!;
    store.recordOccurrence(newest, newFp.title);

    const groups = store.list();
    expect(groups).toHaveLength(500);
    expect(groups.some((g) => g.fingerprint === fingerprints[0])).toBe(false);
    expect(groups.some((g) => g.fingerprint === newFp.fingerprint)).toBe(true);

    // The evicted fingerprint recurring starts a fresh group from count: 1.
    const recur = makeEntry({ source: "docker:app", message: "Bug number 0", timestamp: base + 999_000 });
    ring.held.add(recur.id);
    const recurFp = computeFingerprint({ source: recur.source, level: recur.level, message: recur.message, body: null })!;
    expect(recurFp.fingerprint).toBe(fingerprints[0]);
    store.recordOccurrence(recur, recurFp.title);
    const revived = store.list().find((g) => g.fingerprint === fingerprints[0]);
    expect(revived?.count).toBe(1);
  });
});

describe("ErrorGroupStore — sample resolution + eviction survival (criterion 6)", () => {
  function fpFor(source: string, message: string) {
    return computeFingerprint({ source, level: "ERROR", message, body: null })!;
  }

  it("sampleEntryIds is the pinned-oldest id plus up to 9 most-recent ids (Decision 2)", () => {
    const ring = new FakeRingBuffer();
    const store = new ErrorGroupStore(ring);
    const fp = fpFor("docker:app", "Recurring bug");
    const ids: number[] = [];
    for (let i = 0; i < 15; i++) {
      const entry = makeEntry({ source: "docker:app", message: "Recurring bug" });
      ring.held.add(entry.id);
      ids.push(entry.id);
      store.recordOccurrence(entry, fp.title);
    }
    const [group] = store.list();
    expect(group.sampleEntryIds).toHaveLength(10);
    // Oldest occurrence is always pinned first...
    expect(group.sampleEntryIds[0]).toBe(ids[0]);
    // ...plus the 9 most recent, in ascending order.
    expect(group.sampleEntryIds.slice(1)).toEqual(ids.slice(-9));
  });

  it("group metadata (count/firstSeen/lastSeen) survives every raw entry aging out of the ring buffer", () => {
    const ring = new FakeRingBuffer();
    const store = new ErrorGroupStore(ring);
    const fp = fpFor("docker:app", "Old low-frequency bug");
    const base = 1_700_000_000_000;
    const entries: TraceRiverLog[] = [];
    for (let i = 0; i < 3; i++) {
      const entry = makeEntry({ source: "docker:app", message: "Old low-frequency bug", timestamp: base + i * 1000 });
      ring.held.add(entry.id);
      entries.push(entry);
      store.recordOccurrence(entry, fp.title);
    }
    expect(store.get(fp.fingerprint)?.rawEntriesEvicted).toBe(false);

    // All raw entries age out of the ring buffer.
    for (const e of entries) ring.held.delete(e.id);

    const group = store.get(fp.fingerprint);
    expect(group).toBeDefined();
    expect(group!.count).toBe(3);
    expect(group!.firstSeen).toBe(base);
    expect(group!.lastSeen).toBe(base + 2000);
    expect(group!.rawEntriesEvicted).toBe(true);
    // No id is resolvable any longer -> sampleEntryIds is pruned to empty.
    expect(group!.sampleEntryIds).toEqual([]);
  });

  it("rawEntriesEvicted is sticky — stays true even if a later occurrence is still resolvable", () => {
    const ring = new FakeRingBuffer();
    const store = new ErrorGroupStore(ring);
    const fp = fpFor("docker:app", "Sticky eviction bug");
    const first = makeEntry({ source: "docker:app", message: "Sticky eviction bug" });
    ring.held.add(first.id);
    store.recordOccurrence(first, fp.title);
    ring.held.delete(first.id); // oldestKnownId ages out
    expect(store.get(fp.fingerprint)?.rawEntriesEvicted).toBe(true);

    const second = makeEntry({ source: "docker:app", message: "Sticky eviction bug" });
    ring.held.add(second.id);
    store.recordOccurrence(second, fp.title);
    // A fresh, still-resolvable occurrence exists, but the sticky flag must not clear.
    expect(store.get(fp.fingerprint)?.rawEntriesEvicted).toBe(true);
  });

  it("when the pinned-oldest id is pruned, the next-oldest still-resolvable id is re-pinned", () => {
    const ring = new FakeRingBuffer();
    const store = new ErrorGroupStore(ring);
    const fp = fpFor("docker:app", "Repin bug");
    const ids: number[] = [];
    for (let i = 0; i < 4; i++) {
      const entry = makeEntry({ source: "docker:app", message: "Repin bug" });
      ring.held.add(entry.id);
      ids.push(entry.id);
      store.recordOccurrence(entry, fp.title);
    }
    ring.held.delete(ids[0]); // the pinned-oldest ages out
    const group = store.get(fp.fingerprint)!;
    expect(group.rawEntriesEvicted).toBe(true);
    expect(group.sampleEntryIds[0]).toBe(ids[1]); // next-oldest survivor re-pinned
    expect(group.sampleEntryIds).toContain(ids[2]);
    expect(group.sampleEntryIds).toContain(ids[3]);
  });

  it("getContextAnchor resolves to the true oldest occurrence when still resolvable, with usedFallback: false", () => {
    const ring = new FakeRingBuffer();
    const store = new ErrorGroupStore(ring);
    const fp = fpFor("docker:app", "Anchor bug");
    const first = makeEntry({ source: "docker:app", message: "Anchor bug" });
    ring.held.add(first.id);
    store.recordOccurrence(first, fp.title);
    expect(store.getContextAnchor(fp.fingerprint)).toEqual({ anchorId: first.id, usedFallback: false });
  });

  it("getContextAnchor falls back to the oldest still-resolvable survivor, with usedFallback: true, once the true first occurrence is evicted", () => {
    const ring = new FakeRingBuffer();
    const store = new ErrorGroupStore(ring);
    const fp = fpFor("docker:app", "Fallback anchor bug");
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      const entry = makeEntry({ source: "docker:app", message: "Fallback anchor bug" });
      ring.held.add(entry.id);
      ids.push(entry.id);
      store.recordOccurrence(entry, fp.title);
    }
    ring.held.delete(ids[0]);
    expect(store.getContextAnchor(fp.fingerprint)).toEqual({ anchorId: ids[1], usedFallback: true });
  });

  it("getContextAnchor returns undefined once every tracked id for the group has aged out", () => {
    const ring = new FakeRingBuffer();
    const store = new ErrorGroupStore(ring);
    const fp = fpFor("docker:app", "Fully evicted bug");
    const entry = makeEntry({ source: "docker:app", message: "Fully evicted bug" });
    ring.held.add(entry.id);
    store.recordOccurrence(entry, fp.title);
    ring.held.delete(entry.id);
    expect(store.getContextAnchor(fp.fingerprint)).toBeUndefined();
  });

  it("get()/getContextAnchor() return undefined for a fingerprint that was never tracked", () => {
    const ring = new FakeRingBuffer();
    const store = new ErrorGroupStore(ring);
    expect(store.get("does-not-exist")).toBeUndefined();
    expect(store.getContextAnchor("does-not-exist")).toBeUndefined();
  });
});

describe("computeSpiking (criterion 4)", () => {
  it("triggers when current >= 5x trailing average AND current >= 10/min absolute", () => {
    // trailing average of the preceding 5 buckets = 1; current = 40 (>=5*1, >=10).
    const perMinute = [1, 1, 1, 1, 1, 40];
    expect(computeSpiking(perMinute)).toBe(true);
  });

  it("does not trigger when the multiplier threshold is met but the absolute floor is not (e.g. 1/min baseline -> 6/min current)", () => {
    const perMinute = [1, 1, 1, 6]; // 6 >= 5*1 but 6 < 10 absolute floor
    expect(computeSpiking(perMinute)).toBe(false);
  });

  it("does not trigger when the absolute floor is met but the multiplier is not (steady ~10/min)", () => {
    const perMinute = [10, 10, 10, 12]; // 12 < 5*10
    expect(computeSpiking(perMinute)).toBe(false);
  });

  it("clears automatically once the rate subsides back under threshold, no cooldown (Decision 5)", () => {
    const spiking = [1, 1, 1, 1, 1, 40];
    const subsided = [1, 1, 1, 1, 40, 2]; // current bucket back down, no sticky memory of the prior spike
    expect(computeSpiking(spiking)).toBe(true);
    expect(computeSpiking(subsided)).toBe(false);
  });

  it("a flat all-zero window never spikes (0 >= 10 is false)", () => {
    expect(computeSpiking(new Array(30).fill(0))).toBe(false);
  });

  it("an empty perMinute array is treated as not spiking", () => {
    expect(computeSpiking([])).toBe(false);
  });
});

describe("ErrorGroupStore — spiking on the wire + live clearing via tick()", () => {
  it("a burst of >=10/min at >=5x the trailing average sets group.spiking true", () => {
    const ring = new FakeRingBuffer();
    const store = new ErrorGroupStore(ring);
    const fp = computeFingerprint({ source: "docker:mysql", level: "FATAL", message: "Connection refused: mysql:3306", body: null })!;
    const now = Date.now();
    const currentMinute = Math.floor(now / 60_000) * 60_000;

    // Trailing baseline: 1/min for the preceding 5 minutes.
    for (let m = 5; m >= 1; m--) {
      const entry = makeEntry({ source: "docker:mysql", message: "Connection refused: mysql:3306", timestamp: currentMinute - m * 60_000 });
      ring.held.add(entry.id);
      store.recordOccurrence(entry, fp.title);
    }
    // Burst: 40 occurrences in the current minute.
    for (let i = 0; i < 40; i++) {
      const entry = makeEntry({ source: "docker:mysql", message: "Connection refused: mysql:3306", timestamp: currentMinute + 1 });
      ring.held.add(entry.id);
      store.recordOccurrence(entry, fp.title);
    }

    const group = store.get(fp.fingerprint, currentMinute + 1);
    expect(group?.spiking).toBe(true);

    // The burst subsides (no further occurrences); minutes later, spiking clears
    // on its own with no acknowledgment/user action (spec § Interaction specs).
    const tenMinutesLater = currentMinute + 10 * 60_000;
    const cleared = store.get(fp.fingerprint, tenMinutesLater);
    expect(cleared?.spiking).toBe(false);
  });

  it("tick() returns null (no broadcast-worthy change) when nothing changed since the last call", () => {
    const ring = new FakeRingBuffer();
    const store = new ErrorGroupStore(ring);
    const now = Date.now();
    expect(store.tick(now)).toBeNull(); // no groups at all yet
  });

  it("tick() returns the full group list when a new occurrence was recorded", () => {
    const ring = new FakeRingBuffer();
    const store = new ErrorGroupStore(ring);
    const fp = computeFingerprint({ source: "docker:app", level: "ERROR", message: "boom", body: null })!;
    const entry = makeEntry({ source: "docker:app", message: "boom" });
    ring.held.add(entry.id);
    store.recordOccurrence(entry, fp.title);
    const groups = store.tick(Date.now());
    expect(groups).not.toBeNull();
    expect(groups).toHaveLength(1);
  });

  it("tick() detects a purely time-driven change (a spike clearing with no new occurrence) at the next tick", () => {
    const ring = new FakeRingBuffer();
    const store = new ErrorGroupStore(ring);
    const fp = computeFingerprint({ source: "docker:mysql", level: "FATAL", message: "Connection refused: mysql:3306", body: null })!;
    const now = Date.now();
    const currentMinute = Math.floor(now / 60_000) * 60_000;
    for (let m = 5; m >= 1; m--) {
      const entry = makeEntry({ source: "docker:mysql", message: "Connection refused: mysql:3306", timestamp: currentMinute - m * 60_000 });
      ring.held.add(entry.id);
      store.recordOccurrence(entry, fp.title);
    }
    for (let i = 0; i < 40; i++) {
      const entry = makeEntry({ source: "docker:mysql", message: "Connection refused: mysql:3306", timestamp: currentMinute + 1 });
      ring.held.add(entry.id);
      store.recordOccurrence(entry, fp.title);
    }
    const firstTick = store.tick(currentMinute + 1);
    expect(firstTick?.[0].spiking).toBe(true);

    // No new occurrences; 10 minutes pass -> the spike clears purely from
    // the histogram window rolling forward, and tick() must still report
    // this as a broadcast-worthy change (spec: "recomputed... at minimum
    // once per broadcast tick").
    const tenMinutesLater = currentMinute + 10 * 60_000;
    const secondTick = store.tick(tenMinutesLater);
    expect(secondTick).not.toBeNull();
    expect(secondTick?.[0].spiking).toBe(false);
  });
});
