/**
 * In-memory source registry — one SourceDescriptor per ingest source for
 * the life of the process. Phase 1 only ever creates `kind: "file"` sources
 * (uploads), but the shape and registry are kind-generic per architecture.md.
 */
import type { SourceDescriptor, SourceKind, SourceState } from "../shared/types.js";

export class SourceRegistry {
  private sources = new Map<string, SourceDescriptor>();

  create(id: string, kind: SourceKind, label: string): SourceDescriptor {
    const descriptor: SourceDescriptor = {
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

  get(id: string): SourceDescriptor | undefined {
    return this.sources.get(id);
  }

  has(id: string): boolean {
    return this.sources.has(id);
  }

  list(): SourceDescriptor[] {
    return [...this.sources.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  incrementCount(id: string, by: number): SourceDescriptor | undefined {
    const source = this.sources.get(id);
    if (!source) return undefined;
    source.entryCount += by;
    return source;
  }

  setState(id: string, state: SourceState, detail: string | null = null): SourceDescriptor | undefined {
    const source = this.sources.get(id);
    if (!source) return undefined;
    source.state = state;
    source.detail = detail;
    return source;
  }
}
