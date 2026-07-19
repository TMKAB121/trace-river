/**
 * Server-side ring buffer — fixed-capacity circular buffer of TraceRiverLog
 * entries. Oldest entries are evicted silently once capacity is exceeded;
 * the UI shows "showing last N" once eviction has occurred.
 * See docs/architecture.md § "Memory model".
 */
import type { TraceRiverLog, TraceRiverLogInput } from "../shared/types.js";

export class RingBuffer {
  private readonly capacity: number;
  private buffer: TraceRiverLog[] = [];
  private nextId = 1;
  private evicted = false;

  constructor(capacity: number) {
    if (capacity <= 0) throw new Error("Ring buffer capacity must be > 0");
    this.capacity = capacity;
  }

  /** Assigns the next monotonic id, appends, evicting the oldest if over capacity. */
  push(input: TraceRiverLogInput): TraceRiverLog {
    const entry: TraceRiverLog = { ...input, id: this.nextId++ };
    this.buffer.push(entry);
    if (this.buffer.length > this.capacity) {
      this.buffer.shift();
      this.evicted = true;
    }
    return entry;
  }

  /** All entries currently held, oldest first. */
  all(): TraceRiverLog[] {
    return this.buffer;
  }

  /** Entries with id > after, bounded by what's still in the buffer. */
  after(after: number): TraceRiverLog[] {
    // Ids are strictly increasing and the buffer is insertion-ordered, so a
    // simple filter is fine at ring-buffer scale (default cap 50k).
    return this.buffer.filter((e) => e.id > after);
  }

  size(): number {
    return this.buffer.length;
  }

  getCapacity(): number {
    return this.capacity;
  }

  hasEvicted(): boolean {
    return this.evicted;
  }

  /** Empties the buffer. Does not reset the id counter (ids stay monotonic/unique for the run). */
  clear(): void {
    this.buffer = [];
    this.evicted = false;
  }
}
