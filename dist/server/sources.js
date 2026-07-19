export class SourceRegistry {
    sources = new Map();
    create(id, kind, label) {
        const descriptor = {
            id,
            kind,
            label,
            subscribed: true,
            visible: true,
            entryCount: 0,
            state: "live",
            detail: null,
            createdAt: Date.now(),
        };
        this.sources.set(id, descriptor);
        return descriptor;
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