import { useState } from "react";
import { useEntriesById } from "../store/store";
import { formatTimestamp } from "../utils/format";
import { IconChevronDown } from "./icons";
import ExpandedPanel from "./ExpandedPanel";
import "./SampleRow.css";

/**
 * One ErrorGroup card sample occurrence row (docs/specs/
 * 004-phase-4-error-intelligence.md § Components & states — ErrorGroup card
 * § Expanded state / § Unresolvable sample fallback): reuses the exact
 * syntax-highlighted expanded-panel treatment spec 001 already defines for a
 * stream row, and falls back to muted, non-focusable text when the id can't
 * be resolved against the client's local entry store.
 */
export default function SampleRow({ entryId }: { entryId: number }) {
  const entriesById = useEntriesById();
  const entry = entriesById.get(entryId);
  const [expanded, setExpanded] = useState(false);

  if (!entry) {
    return (
      <li className="sample-row sample-row--unresolvable">
        This occurrence is no longer available (evicted from the buffer).
      </li>
    );
  }

  return (
    <li className="sample-row">
      <button
        type="button"
        className="sample-row__header"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="sample-row__timestamp">{formatTimestamp(entry.timestamp)}</span>
        <span className="sample-row__source">[{entry.source}]</span>
        <span className="sample-row__message">{entry.message}</span>
        <span className="sample-row__chevron" aria-hidden="true">
          <IconChevronDown size={14} className={expanded ? "sample-row__chevron-icon--expanded" : undefined} />
        </span>
      </button>
      {expanded && <ExpandedPanel entry={entry} />}
    </li>
  );
}
