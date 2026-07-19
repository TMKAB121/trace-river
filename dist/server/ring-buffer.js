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