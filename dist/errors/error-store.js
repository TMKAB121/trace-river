import { ERROR_INTELLIGENCE_CONFIG as CFG } from "./config.js";
export class ErrorGroupStore {
    ringBuffer;
    groups = new Map();
    dirty = false;
    constructor(ringBuffer) {
        this.ringBuffer = ringBuffer;
    }
    /** Records one fingerprinted ERROR/FATAL occurrence. No-op for any other
     *  level or a null fingerprint (should never happen — callers only invoke
     *  this after `computeFingerprint` returned non-null, but staying
     *  defensive here keeps the store's own invariant self-contained). */
    recordOccurrence(entry, title) {
        if (entry.fingerprint === null)
            return;
        if (entry.level !== "ERROR" && entry.level !== "FATAL")
            return;
        const fp = entry.fingerprint;
        let group = this.groups.get(fp);
        if (!group) {
            if (this.groups.size >= CFG.groupCap)
                this.evictOldest();
            group = {
                fingerprint: fp,
                title,
                level: entry.level,
                sources: new Set(),
                count: 0,
                firstSeen: entry.timestamp,
                lastSeen: entry.timestamp,
                oldestKnownId: entry.id,
                recentIds: [],
                minuteBuckets: new Map(),
                rawEntriesEvicted: false,
                cachedSpiking: false,
            };
            this.groups.set(fp, group);
        }
        group.title = title;
        group.level = entry.level;
        group.sources.add(entry.source);
        group.count += 1;
        if (entry.timestamp < group.firstSeen)
            group.firstSeen = entry.timestamp;
        if (entry.timestamp > group.lastSeen)
            group.lastSeen = entry.timestamp;
        group.recentIds.push(entry.id);
        if (group.recentIds.length > CFG.sampleCap - 1)
            group.recentIds.shift();
        const minute = Math.floor(entry.timestamp / 60_000);
        group.minuteBuckets.set(minute, (group.minuteBuckets.get(minute) ?? 0) + 1);
        this.dirty = true;
    }
    /** LRU eviction by lastSeen (spec: "the group with the oldest lastSeen is
     *  evicted outright... the next time that exact error recurs, if ever, it
     *  starts a fresh group from count: 1"). Linear scan is fine at the
     *  500-group cap. */
    evictOldest() {
        let oldestKey = null;
        let oldestLastSeen = Infinity;
        for (const [key, g] of this.groups) {
            if (g.lastSeen < oldestLastSeen) {
                oldestLastSeen = g.lastSeen;
                oldestKey = key;
            }
        }
        if (oldestKey !== null)
            this.groups.delete(oldestKey);
    }
    /** Time-dependent bookkeeping for exactly one group, shared by every read
     *  path (`tick`/`list`/`get`/`getContextAnchor`) so none of them need a
     *  separate full-collection pass just to keep one group's sticky flag and
     *  minute-bucket GC current: flips the sticky eviction flag as soon as
     *  it's true, garbage-collects minute buckets that have rolled out of the
     *  histogram window, and returns whether anything broadcast-relevant
     *  changed. */
    refreshOne(g, now) {
        let changed = false;
        if (!g.rawEntriesEvicted && !this.ringBuffer.hasId(g.oldestKnownId)) {
            g.rawEntriesEvicted = true;
            changed = true;
        }
        const currentMinute = Math.floor(now / 60_000);
        for (const key of g.minuteBuckets.keys()) {
            if (key < currentMinute - CFG.histogramWindowMinutes)
                g.minuteBuckets.delete(key);
        }
        return changed;
    }
    /** Called every ~75ms by the broadcaster's flush loop (same cadence as
     *  `entries`). Returns the full current group list only when something
     *  actually changed since the last call — a new/updated occurrence, or a
     *  purely time-driven change such as a spike clearing on its own once the
     *  rate subsides (docs/specs/004-phase-4-error-intelligence.md
     *  § Interaction specs — Spike detection: "recomputed... at minimum once
     *  per broadcast tick"). Never a no-op frame. Builds each group's wire
     *  shape exactly once per tick (not twice — once for spike-flip detection
     *  and again for the response), unlike a naive "detect changes, then call
     *  list()" split would. */
    tick(now = Date.now()) {
        let changed = this.dirty;
        const groups = [];
        for (const g of this.groups.values()) {
            if (this.refreshOne(g, now))
                changed = true;
            const perMinute = buildPerMinuteArray(g, now);
            const spiking = computeSpiking(perMinute);
            if (spiking !== g.cachedSpiking) {
                g.cachedSpiking = spiking;
                changed = true;
            }
            groups.push(this.toWire(g, perMinute, spiking));
        }
        if (!changed)
            return null;
        this.dirty = false;
        groups.sort((a, b) => b.lastSeen - a.lastSeen);
        return groups;
    }
    /** Full current group list (≤500), most-recently-seen first. Used by
     *  `GET /api/errors` and the WS connect-time replay. */
    list(now = Date.now()) {
        const groups = [];
        for (const g of this.groups.values()) {
            this.refreshOne(g, now);
            const perMinute = buildPerMinuteArray(g, now);
            const spiking = computeSpiking(perMinute);
            g.cachedSpiking = spiking;
            groups.push(this.toWire(g, perMinute, spiking));
        }
        return groups.sort((a, b) => b.lastSeen - a.lastSeen);
    }
    /** One group by fingerprint, or undefined if it's never existed or has
     *  since been evicted from the 500-cap. */
    get(fingerprint, now = Date.now()) {
        const g = this.groups.get(fingerprint);
        if (!g)
            return undefined;
        this.refreshOne(g, now);
        const perMinute = buildPerMinuteArray(g, now);
        const spiking = computeSpiking(perMinute);
        g.cachedSpiking = spiking;
        return this.toWire(g, perMinute, spiking);
    }
    /** For prompt assembly's "context before the first occurrence" section:
     *  the ring-buffer id to anchor the query on, plus whether that anchor is
     *  a fallback (the true first occurrence itself has aged out, per spec's
     *  documented fallback text) rather than the real first occurrence.
     *  Returns undefined only when nothing about this group is resolvable at
     *  all (fingerprint unknown, or every tracked id has been evicted). */
    getContextAnchor(fingerprint, now = Date.now()) {
        const g = this.groups.get(fingerprint);
        if (!g)
            return undefined;
        this.refreshOne(g, now);
        if (this.ringBuffer.hasId(g.oldestKnownId)) {
            return { anchorId: g.oldestKnownId, usedFallback: false };
        }
        const survivors = g.recentIds.filter((id) => this.ringBuffer.hasId(id));
        if (survivors.length === 0)
            return undefined;
        return { anchorId: Math.min(...survivors), usedFallback: true };
    }
    toWire(g, perMinute, spiking) {
        return {
            fingerprint: g.fingerprint,
            title: g.title,
            level: g.level,
            sources: [...g.sources],
            count: g.count,
            firstSeen: g.firstSeen,
            lastSeen: g.lastSeen,
            sampleEntryIds: computeSampleEntryIds(g, this.ringBuffer),
            perMinute,
            spiking,
            rawEntriesEvicted: g.rawEntriesEvicted,
        };
    }
}
/** Pinned-oldest-still-resolvable + up to `sampleCap - 1` most-recent
 *  still-resolvable ids (spec Decision 2), pruning anything the ring buffer
 *  no longer holds. Ids come back in ascending order, so the last element is
 *  always the most-recent resolvable sample. */
function computeSampleEntryIds(g, ringBuffer) {
    let pinned = null;
    if (ringBuffer.hasId(g.oldestKnownId)) {
        pinned = g.oldestKnownId;
    }
    else {
        const survivors = g.recentIds.filter((id) => ringBuffer.hasId(id));
        if (survivors.length > 0)
            pinned = Math.min(...survivors);
    }
    const result = [];
    if (pinned !== null)
        result.push(pinned);
    for (const id of g.recentIds) {
        if (id === pinned)
            continue;
        if (!ringBuffer.hasId(id))
            continue;
        result.push(id);
        if (result.length >= CFG.sampleCap)
            break;
    }
    return result;
}
/** 30-length (histogramWindowMinutes) array, oldest -> newest, last element
 *  = the current minute as of `now`. Zero-filled for minutes with no
 *  recorded occurrences (including minutes before the process itself
 *  started) — "a flat/empty group... renders a flat baseline rather than an
 *  empty box" (spec § Components & states — Sparkline). */
function buildPerMinuteArray(g, now) {
    const currentMinute = Math.floor(now / 60_000);
    const windowSize = CFG.histogramWindowMinutes;
    const result = new Array(windowSize);
    for (let i = 0; i < windowSize; i++) {
        const minute = currentMinute - (windowSize - 1 - i);
        result[i] = g.minuteBuckets.get(minute) ?? 0;
    }
    return result;
}
/** `spiking = current > multiplierThreshold * trailingAverage AND current >=
 *  minAbsoluteRatePerMin` (docs/specs/004-phase-4-error-intelligence.md
 *  § Interaction specs — Spike detection). No hysteresis/cooldown (Decision
 *  5) — a direct, honest function of the current histogram state. */
export function computeSpiking(perMinute) {
    if (perMinute.length === 0)
        return false;
    const current = perMinute[perMinute.length - 1];
    const preceding = perMinute.slice(0, -1);
    const trailingAverage = preceding.length > 0 ? preceding.reduce((sum, n) => sum + n, 0) / preceding.length : 0;
    return current > CFG.spike.multiplierThreshold * trailingAverage && current >= CFG.spike.minAbsoluteRatePerMin;
}
//# sourceMappingURL=error-store.js.map