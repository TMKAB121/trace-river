import { describe, it, expect } from "vitest";
import { RingBuffer } from "../../src/server/ring-buffer.js";
import type { TraceRiverLogInput } from "../../src/shared/types.js";

function makeInput(message: string): TraceRiverLogInput {
  return {
    timestamp: Date.now(),
    rawTimestamp: null,
    source: "file:test.log",
    level: "INFO",
    message,
    body: null,
    context: null,
    raw: message,
    multiline: false,
  };
}

describe("RingBuffer", () => {
  it("throws for a non-positive capacity", () => {
    expect(() => new RingBuffer(0)).toThrow();
    expect(() => new RingBuffer(-1)).toThrow();
  });

  it("assigns strictly increasing monotonic ids starting at 1", () => {
    const rb = new RingBuffer(10);
    const a = rb.push(makeInput("a"));
    const b = rb.push(makeInput("b"));
    const c = rb.push(makeInput("c"));
    expect([a.id, b.id, c.id]).toEqual([1, 2, 3]);
  });

  it("all() returns entries oldest-first and size() tracks count", () => {
    const rb = new RingBuffer(10);
    rb.push(makeInput("a"));
    rb.push(makeInput("b"));
    expect(rb.size()).toBe(2);
    expect(rb.all().map((e) => e.message)).toEqual(["a", "b"]);
  });

  it("evicts the oldest entry once capacity is exceeded, and flags hasEvicted()", () => {
    const rb = new RingBuffer(3);
    expect(rb.hasEvicted()).toBe(false);
    rb.push(makeInput("1"));
    rb.push(makeInput("2"));
    rb.push(makeInput("3"));
    expect(rb.hasEvicted()).toBe(false);
    rb.push(makeInput("4"));
    expect(rb.hasEvicted()).toBe(true);
    expect(rb.size()).toBe(3);
    expect(rb.all().map((e) => e.message)).toEqual(["2", "3", "4"]);
  });

  it("ids remain unique/monotonic even across eviction", () => {
    const rb = new RingBuffer(2);
    rb.push(makeInput("1"));
    rb.push(makeInput("2"));
    rb.push(makeInput("3")); // evicts "1"
    const ids = rb.all().map((e) => e.id);
    expect(ids).toEqual([2, 3]);
  });

  it("after(id) returns only entries with id > the cursor, bounded by what's still buffered", () => {
    const rb = new RingBuffer(10);
    for (let i = 1; i <= 5; i++) rb.push(makeInput(`m${i}`));
    expect(rb.after(3).map((e) => e.message)).toEqual(["m4", "m5"]);
    expect(rb.after(0).length).toBe(5);
    expect(rb.after(999).length).toBe(0);
  });

  it("after(id) respects eviction: an id evicted out of the buffer is simply absent, not an error", () => {
    const rb = new RingBuffer(3);
    for (let i = 1; i <= 5; i++) rb.push(makeInput(`m${i}`)); // buffer now holds ids 3,4,5
    expect(rb.after(1).map((e) => e.message)).toEqual(["m3", "m4", "m5"]);
  });

  it("clear() empties the buffer and resets the eviction flag, but keeps the id counter monotonic", () => {
    const rb = new RingBuffer(2);
    rb.push(makeInput("1"));
    rb.push(makeInput("2"));
    rb.push(makeInput("3")); // evicts -> hasEvicted() true
    rb.clear();
    expect(rb.size()).toBe(0);
    expect(rb.all()).toEqual([]);
    expect(rb.hasEvicted()).toBe(false);

    const next = rb.push(makeInput("4"));
    expect(next.id).toBe(4); // not reset to 1 — ids stay unique for the life of the process
  });

  it("getCapacity() reports the configured capacity", () => {
    const rb = new RingBuffer(42);
    expect(rb.getCapacity()).toBe(42);
  });
});
