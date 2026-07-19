import type { KeyboardEvent } from "react";
import { useRef } from "react";
import type { TraceRiverLog } from "../types";
import { useAppStore } from "../store/store";
import { formatTimestamp } from "../utils/format";
import { IconChevronDown } from "./icons";
import ExpandedPanel from "./ExpandedPanel";
import "./Row.css";

const LEVEL_COLUMN_WIDTH = 7; // "UNKNOWN" is the longest level word

interface RowProps {
  entry: TraceRiverLog;
  posinset: number;
  setsize: number;
}

export default function Row({ entry, posinset, setsize }: RowProps) {
  const { state, actions } = useAppStore();
  const expandable = entry.multiline || entry.context !== null;
  const expanded = expandable && state.expandedIds.has(entry.id);
  const rowButtonRef = useRef<HTMLButtonElement>(null);
  const levelKey = entry.level.toLowerCase();

  function toggle() {
    actions.toggleExpanded(entry.id);
  }

  function handleWrapKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape" && expanded) {
      e.stopPropagation();
      actions.toggleExpanded(entry.id);
      rowButtonRef.current?.focus();
    }
  }

  const rowContent = (
    <>
      <span className="row__timestamp">{formatTimestamp(entry.timestamp)}</span>
      <span className="row__source">[{entry.source}]</span>
      <span className={`row__level row__level--${levelKey}`}>
        | {entry.level.padEnd(LEVEL_COLUMN_WIDTH)} |
      </span>
      <span className="row__message">{entry.message}</span>
      {expandable && (
        <span className="row__chevron" aria-hidden="true">
          <IconChevronDown size={14} className={expanded ? "row__chevron-icon--expanded" : undefined} />
        </span>
      )}
    </>
  );

  return (
    <div
      className="row-wrap"
      role="article"
      aria-posinset={posinset}
      aria-setsize={setsize}
      onKeyDown={handleWrapKeyDown}
    >
      {expandable ? (
        <button
          ref={rowButtonRef}
          type="button"
          className={`row row--${levelKey} row--expandable${expanded ? " row--expanded" : ""}`}
          aria-expanded={expanded}
          onClick={toggle}
        >
          {rowContent}
        </button>
      ) : (
        <div className={`row row--${levelKey}`}>{rowContent}</div>
      )}
      {expanded && <ExpandedPanel entry={entry} />}
    </div>
  );
}
