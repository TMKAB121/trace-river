import { useAppStore } from "../store/store";
import "./EmptyState.css";

export default function FilteredEmptyState() {
  const { actions } = useAppStore();
  return (
    <div className="stream-empty-state">
      <p>No log entries match your filters.</p>
      <button type="button" className="stream-empty-state__clear" onClick={() => actions.resetFilters()}>
        Clear filters
      </button>
    </div>
  );
}
