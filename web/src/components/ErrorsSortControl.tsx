import { useAppStore } from "../store/store";

/**
 * Errors-view filter row's sort control (docs/specs/
 * 004-phase-4-error-intelligence.md § Components & states — Errors-view
 * toolbar/filter-row): "Sort:" label + a two-button `role="radiogroup"`
 * (`role="radio"` each, exactly one `aria-checked="true"`) — Recency
 * (default, `lastSeen` descending) and Count (`count` descending).
 */
export default function ErrorsSortControl() {
  const { state, actions } = useAppStore();

  return (
    <div className="errors-sort" role="radiogroup" aria-label="Sort errors by">
      <span className="errors-sort__label">Sort:</span>
      <button
        type="button"
        role="radio"
        aria-checked={state.errorsSort === "recency"}
        className={`filter-pill${state.errorsSort === "recency" ? " filter-pill--neutral-active" : ""}`}
        onClick={() => actions.setErrorsSort("recency")}
      >
        Recency
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={state.errorsSort === "count"}
        className={`filter-pill${state.errorsSort === "count" ? " filter-pill--neutral-active" : ""}`}
        onClick={() => actions.setErrorsSort("count")}
      >
        Count
      </button>
    </div>
  );
}
