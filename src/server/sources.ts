/**
 * In-memory source registry — one SourceDescriptor per ingest source for
 * the life of the process. Phase 1 only ever created `kind: "file"` sources
 * (uploads); phase 2 adds `kind: "docker"` (docs/specs/002-phase-2-docker.md).
 */
import type { SourceDescriptor, SourceKind, SourceState } from "../shared/types.js";

export interface CreateSourceOptions {
  /** Default true (matches phase 1's file-upload behavior: subscribed on
   *  creation). Docker sources are created with `subscribed: false` —
   *  "discovered-but-unsubscribed containers cost nothing" (spec 002). */
  subscribed?: boolean;
  state?: SourceState;
  detail?: string | null;
  docker?: SourceDescriptor["docker"];
  /** Present only for `kind: "local"` sources (docs/specs/003-phase-3-
   *  auto-discovery.md § API contract). */
  local?: SourceDescriptor["local"];
}

export class SourceRegistry {
  private sources = new Map<string, SourceDescriptor>();

  create(id: string, kind: SourceKind, label: string, opts: CreateSourceOptions = {}): SourceDescriptor {
    const descriptor: SourceDescriptor = {
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
      local: opts.local,
    };
    this.sources.set(id, descriptor);
    return descriptor;
  }

  /** Removes a source entirely — only ever used to settle a phantom entry;
   *  phase 2 never actually calls this (renamed/removed docker sources
   *  settle to `stopped` and stay visible, per spec 002 Decision 4). Kept
   *  for completeness/tests. */
  delete(id: string): void {
    this.sources.delete(id);
  }

  /** Server-global docker subscription flip (spec 002 § Interaction specs —
   *  "Docker subscription is global, not per-connection", Decision 5). */
  setSubscribed(id: string, subscribed: boolean): SourceDescriptor | undefined {
    const source = this.sources.get(id);
    if (!source) return undefined;
    source.subscribed = subscribed;
    return source;
  }

  /** Merges freshly-discovered docker metadata onto an existing source
   *  (image/compose labels rarely change, but keep it current). */
  updateDockerMeta(id: string, docker: NonNullable<SourceDescriptor["docker"]>): SourceDescriptor | undefined {
    const source = this.sources.get(id);
    if (!source) return undefined;
    source.docker = docker;
    return source;
  }

  /** Updates a local source's tooltip/section metadata (e.g. the "winning"
   *  file's path after a glob-target rotation) — docs/specs/003-phase-3-
   *  auto-discovery.md § API contract. */
  updateLocalMeta(id: string, local: NonNullable<SourceDescriptor["local"]>): SourceDescriptor | undefined {
    const source = this.sources.get(id);
    if (!source) return undefined;
    source.local = local;
    return source;
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
