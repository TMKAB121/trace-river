export class RingBuffer {
    capacity;
    buffer = [];
    nextId = 1;
    evicted = false;
    constructor(capacity) {
        if (capacity <= 0)
            throw new Error("Ring buffer capacity must be > 0");
        this.capacity = capacity;
    }
    /** Assigns the next monotonic id, appends, evicting the oldest if over capacity. */
    push(input) {
        const entry = { ...input, id: this.nextId++ };
        this.buffer.push(entry);
        if (this.buffer.length > this.capacity) {
            this.buffer.shift();
            this.evicted = true;
        }
        return entry;
    }
    /** All entries currently held, oldest first. */
    all() {
        return this.buffer;
    }
    /** Entries with id > after, bounded by what's still in the buffer. */
    after(after) {
        // Ids are strictly increasing and the buffer is insertion-ordered, so a
        // simple filter is fine at ring-buffer scale (default cap 50k).
        return this.buffer.filter((e) => e.id > after);
    }
    /** Up to `limit` entries with id < beforeId, oldest-first, drawn from the
     *  full buffer regardless of source (docs/specs/004-phase-4-error-
     *  intelligence.md § API contract — prompt assembly's cross-source
     *  context). Ids are contiguous within the buffer (every push consumes
     *  exactly the next monotonic id and eviction only ever removes from the
     *  front), so `beforeId`'s position can be computed by simple offset
     *  arithmetic rather than a search. */
    before(beforeId, limit) {
        if (this.buffer.length === 0 || limit <= 0)
            return [];
        const first = this.buffer[0].id;
        const end = Math.max(0, Math.min(beforeId - first, this.buffer.length));
        const start = Math.max(0, end - limit);
        return this.buffer.slice(start, end);
    }
    /** True when `id` currently resolves to a still-buffered entry (i.e. has
     *  not aged out via eviction) — docs/specs/004-phase-4-error-
     *  intelligence.md § Interaction specs, "raw entries evicted" tracking. */
    hasId(id) {
        if (this.buffer.length === 0)
            return false;
        const first = this.buffer[0].id;
        const last = this.buffer[this.buffer.length - 1].id;
        return id >= first && id <= last;
    }
    /** Resolves one entry by id, or undefined if it never existed or has
     *  since been evicted. O(1) via the same contiguous-id offset trick as
     *  `hasId`/`before`. */
    get(id) {
        if (this.buffer.length === 0)
            return undefined;
        const first = this.buffer[0].id;
        const idx = id - first;
        if (idx < 0 || idx >= this.buffer.length)
            return undefined;
        const entry = this.buffer[idx];
        return entry.id === id ? entry : undefined;
    }
    size() {
        return this.buffer.length;
    }
    getCapacity() {
        return this.capacity;
    }
    hasEvicted() {
        return this.evicted;
    }
    /** Empties the buffer. Does not reset the id counter (ids stay monotonic/unique for the run). */
    clear() {
        this.buffer = [];
        this.evicted = false;
    }
}
//# sourceMappingURL=ring-buffer.js.map