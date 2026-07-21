/**
 * Shared "just-parsed entries -> ring buffer + error grouping + broadcast"
 * step used by every ingest adapter (upload/tail/docker) so error
 * fingerprinting happens exactly once, in exactly one place, at ingestion
 * time and strictly before broadcast (docs/specs/004-phase-4-error-
 * intelligence.md § Interaction specs — Fingerprinting & grouping: "same
 * tick as ingestion — never a later, separate update to an already-
 * broadcast entry").
 */
import type { AppState } from "./app-state.js";
import type { TraceRiverLogInput } from "../shared/types.js";
import { computeFingerprint } from "../errors/fingerprint.js";

/**
 * @param parserName The ingest adapter's own pipeline's currently-locked
 *   format-parser name (`SourcePipeline.getLockedParserName()`), or null
 *   while detection is still open. Recorded server-side only, for the AI
 *   prompt's "Log format" line — never part of the wire contract.
 */
export function ingestParsedEntries(
  state: AppState,
  sourceId: string,
  entries: TraceRiverLogInput[],
  parserName: string | null,
): void {
  if (parserName) state.parserNames.set(sourceId, parserName);

  for (const input of entries) {
    const fp = computeFingerprint(input);
    const withFingerprint: TraceRiverLogInput = fp ? { ...input, fingerprint: fp.fingerprint } : input;

    const inserted = state.ringBuffer.push(withFingerprint);
    state.sources.incrementCount(sourceId, 1);
    if (fp) state.errorGroups.recordOccurrence(inserted, fp.title);
    state.broadcaster.enqueueEntry(inserted);
  }
}
