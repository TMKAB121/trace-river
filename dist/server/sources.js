export class SourceRegistry {
    sources = new Map();
    create(id, kind, label, opts = {}) {
        const descriptor = {
            id,
            kind,
            label,
            subscribed: opts.subscribed ?? true,
            visible: true,
            entryCount: 0,
            state: opts.state ?? "live",
            detail: opts.detail ?? null,
            createdAt: Date.now(),
            docker: opts.docker,
        };
        this.sources.set(id, descriptor);
        return descriptor;
    }
    /** Removes a source entirely — only ever used to settle a phantom entry;
     *  phase 2 never actually calls this (renamed/removed docker sources
     *  settle to `stopped` and stay visible, per spec 002 Decision 4). Kept
     *  for completeness/tests. */
    delete(id) {
        this.sources.delete(id);
    }
    /** Server-global docker subscription flip (spec 002 § Interaction specs —
     *  "Docker subscription is global, not per-connection", Decision 5). */
    setSubscribed(id, subscribed) {
        const source = this.sources.get(id);
        if (!source)
            return undefined;
        source.subscribed = subscribed;
        return source;
    }
    /** Merges freshly-discovered docker metadata onto an existing source
     *  (image/compose labels rarely change, but keep it current). */
    updateDockerMeta(id, docker) {
        const source = this.sources.get(id);
        if (!source)
            return undefined;
        source.docker = docker;
        return source;
    }
    get(id) {
        return this.sources.get(id);
    }
    has(id) {
        return this.sources.has(id);
    }
    list() {
        return [...this.sources.values()].sort((a, b) => a.createdAt - b.createdAt);
    }
    incrementCount(id, by) {
        const source = this.sources.get(id);
        if (!source)
            return undefined;
        source.entryCount += by;
        return source;
    }
    setState(id, state, detail = null) {
        const source = this.sources.get(id);
        if (!source)
            return undefined;
        source.state = state;
        source.detail = detail;
        return source;
    }
}
//# sourceMappingURL=sources.js.map