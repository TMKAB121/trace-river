import { useCallback, useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAppStore, useEvicted, useVisibleEntries } from "../store/store";
import Row from "./Row";
import JumpToLiveButton from "./JumpToLiveButton";
import EmptyState from "./EmptyState";
import FilteredEmptyState from "./FilteredEmptyState";
import ConnectionBanner from "./ConnectionBanner";
import EvictionNotice from "./EvictionNotice";
import "./StreamPanel.css";

const ROW_HEIGHT_COLLAPSED = 40; // --row-height-collapsed
const BOTTOM_THRESHOLD_PX = 24;

export default function StreamPanel() {
  const { state, actions } = useAppStore();
  const visibleEntries = useVisibleEntries();
  const evicted = useEvicted();

  const hasSources = state.sourceOrder.length > 0;
  const hasAnyEntries = state.entries.length > 0;
  const isFilteredEmpty = hasSources && hasAnyEntries && visibleEntries.length === 0;

  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: visibleEntries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT_COLLAPSED,
    getItemKey: (index) => visibleEntries[index].id,
    overscan: 8,
  });

  // Auto-follow: while pinned (and not frozen), scroll to the newest row
  // whenever the rendered list grows. Also covers "unfreezing ... jumps to
  // the live tail" since unfreeze sets pinned=true and the list regrows.
  const prevCountRef = useRef(visibleEntries.length);
  useEffect(() => {
    const grew = visibleEntries.length > prevCountRef.current;
    prevCountRef.current = visibleEntries.length;
    if (grew && state.pinned && !state.frozen && visibleEntries.length > 0) {
      virtualizer.scrollToIndex(visibleEntries.length - 1, { align: "end" });
    }
  }, [visibleEntries.length, state.pinned, state.frozen, virtualizer]);

  const handleScroll = useCallback(() => {
    const el = parentRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom <= BOTTOM_THRESHOLD_PX;
    if (atBottom !== state.pinned) {
      actions.setPinned(atBottom);
    }
  }, [actions, state.pinned]);

  const jumpToLive = useCallback(() => {
    if (visibleEntries.length > 0) {
      virtualizer.scrollToIndex(visibleEntries.length - 1, { align: "end" });
    }
    actions.setPinned(true);
  }, [virtualizer, visibleEntries.length, actions]);

  // "Jump to latest error" (spec 004 § Interaction specs): the store sets
  // scrollToEntryId + bumps scrollNonce; re-fires on every jump (even to the
  // same id) since scrollNonce, not scrollToEntryId, is the effect's dep.
  useEffect(() => {
    if (state.scrollToEntryId === null) return;
    const idx = visibleEntries.findIndex((e) => e.id === state.scrollToEntryId);
    if (idx !== -1) {
      virtualizer.scrollToIndex(idx, { align: "center" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.scrollNonce]);

  if (!hasSources) {
    return (
      <>
        <ConnectionBanner />
        <EmptyState />
      </>
    );
  }

  return (
    <div className="stream-panel">
      <ConnectionBanner />
      {evicted && <EvictionNotice />}
      {isFilteredEmpty ? (
        <FilteredEmptyState />
      ) : (
        <div ref={parentRef} className="stream-scroll" onScroll={handleScroll}>
          <div
            role="feed"
            aria-label="Log entries"
            style={{ height: virtualizer.getTotalSize(), position: "relative" }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const entry = visibleEntries[virtualRow.index];
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <Row entry={entry} posinset={virtualRow.index + 1} setsize={visibleEntries.length} />
                </div>
              );
            })}
          </div>
        </div>
      )}
      {!state.pinned && hasAnyEntries && <JumpToLiveButton onClick={jumpToLive} />}
    </div>
  );
}
