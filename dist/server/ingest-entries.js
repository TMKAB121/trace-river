import { computeFingerprint } from "../errors/fingerprint.js";
/**
 * @param parserName The ingest adapter's own pipeline's currently-locked
 *   format-parser name (`SourcePipeline.getLockedParserName()`), or null
 *   while detection is still open. Recorded server-side only, for the AI
 *   prompt's "Log format" line — never part of the wire contract.
 */
export function ingestParsedEntries(state, sourceId, entries, parserName) {
    if (parserName)
        state.parserNames.set(sourceId, parserName);
    for (const input of entries) {
        const fp = computeFingerprint(input);
        const withFingerprint = fp ? { ...input, fingerprint: fp.fingerprint } : input;
        const inserted = state.ringBuffer.push(withFingerprint);
        state.sources.incrementCount(sourceId, 1);
        if (fp)
            state.errorGroups.recordOccurrence(inserted, fp.title);
        state.broadcaster.enqueueEntry(inserted);
    }
}
//# sourceMappingURL=ingest-entries.js.map