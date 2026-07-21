import { useSortedErrorGroups } from "../store/store";
import ErrorGroupCard from "./ErrorGroupCard";
import ErrorsEmptyState from "./ErrorsEmptyState";
import "./ErrorsPanel.css";

/**
 * Errors panel (docs/specs/004-phase-4-error-intelligence.md § Layout —
 * Errors view): the complete, current, server-side group list (§ Errors
 * panel scope — not filtered by sidebar visibility/subscription state),
 * sorted per the active filter-row sort axis.
 */
export default function ErrorsPanel() {
  const groups = useSortedErrorGroups();

  if (groups.length === 0) {
    return <ErrorsEmptyState />;
  }

  return (
    <div className="errors-panel">
      <ul className="errors-panel__list">
        {groups.map((group) => (
          <ErrorGroupCard key={group.fingerprint} group={group} />
        ))}
      </ul>
    </div>
  );
}
