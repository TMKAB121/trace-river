import { useState, type ReactNode } from "react";
import type { ErrorGroup } from "../types";
import { useAppStore } from "../store/store";
import { formatRelativeShort, formatShortTimestamp } from "../utils/format";
import { IconChevronDown, IconSparkle } from "./icons";
import SpikingBadge from "./SpikingBadge";
import Sparkline from "./Sparkline";
import SampleRow from "./SampleRow";
import "./ErrorGroupCard.css";

/** Splits `title` on its `⟨…⟩` placeholder segments, rendering those in
 *  `--color-text-muted` and the rest in `--color-text-primary` (spec 004 §
 *  Components & states — ErrorGroup card § Header row). */
function TitleParts({ title }: { title: string }): ReactNode {
  const parts = title.split(/(⟨[^⟩]*⟩)/g).filter((p) => p.length > 0);
  return parts.map((part, i) =>
    part.startsWith("⟨") && part.endsWith("⟩") ? (
      <span key={i} className="error-card__title-placeholder">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export default function ErrorGroupCard({ group }: { group: ErrorGroup }) {
  const { actions } = useAppStore();
  const [expanded, setExpanded] = useState(false);
  const levelKey = group.level.toLowerCase();
  // Displayed newest-first — ids are monotonic, so this holds regardless of
  // the pinned-oldest-plus-rolling-recent composition of sampleEntryIds.
  const orderedSampleIds = [...group.sampleEntryIds].sort((a, b) => b - a);

  return (
    <li className="error-card">
      <button
        type="button"
        className="error-card__button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="error-card__header">
          <span className={`error-card__level error-card__level--${levelKey}`}>{group.level}</span>
          <span className="error-card__title">
            <TitleParts title={group.title} />
          </span>
          {group.spiking && <SpikingBadge />}
          <span className="error-card__chevron" aria-hidden="true">
            <IconChevronDown size={16} className={expanded ? "error-card__chevron-icon--expanded" : undefined} />
          </span>
        </div>
        <div className="error-card__meta-row">
          <span className="error-card__count">
            × {group.count} occurrence{group.count === 1 ? "" : "s"}
          </span>
          <Sparkline perMinute={group.perMinute} level={group.level} />
        </div>
        <div className="error-card__sources">{group.sources.join(", ")}</div>
        <div className="error-card__seen">
          First {formatShortTimestamp(group.firstSeen)} · Last {formatShortTimestamp(group.lastSeen)} (
          {formatRelativeShort(group.lastSeen)} ago)
        </div>
      </button>
      {expanded && (
        <div className="error-card__expanded">
          <div className="error-card__samples-label">
            Sample occurrences ({group.sampleEntryIds.length} of {group.count}
            {group.rawEntriesEvicted ? " — some samples evicted" : ""})
          </div>
          <ul className="error-card__samples">
            {orderedSampleIds.map((id) => (
              <SampleRow key={id} entryId={id} />
            ))}
          </ul>
          <button
            type="button"
            className="error-card__generate-btn"
            onClick={() => actions.openPrompt(group.fingerprint)}
          >
            <IconSparkle size={16} />
            Generate AI Prompt
          </button>
        </div>
      )}
    </li>
  );
}
