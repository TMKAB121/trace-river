import { useAppStore, useErrorGroups } from "../store/store";

/**
 * Top-bar view switcher (docs/specs/004-phase-4-error-intelligence.md §
 * Components & states — View switcher): two tabs, Stream (default) and
 * "Errors · <n>" where <n> is the current tracked error *group* count, not
 * raw occurrences. Both tabs disabled together, matching Freeze/Clear/
 * Search's existing !hasSources gating.
 */
export default function ViewSwitcher({ disabled }: { disabled: boolean }) {
  const { state, actions } = useAppStore();
  const groupCount = useErrorGroups().length;

  return (
    <div role="tablist" aria-label="Console view" className="view-switcher">
      <button
        type="button"
        role="tab"
        id="view-tab-stream"
        aria-selected={state.view === "stream"}
        aria-controls="view-panel-stream"
        className="topbar-btn"
        disabled={disabled}
        onClick={() => actions.setView("stream")}
      >
        Stream
      </button>
      <button
        type="button"
        role="tab"
        id="view-tab-errors"
        aria-selected={state.view === "errors"}
        aria-controls="view-panel-errors"
        className="topbar-btn"
        disabled={disabled}
        onClick={() => actions.setView("errors")}
      >
        Errors · {groupCount}
      </button>
    </div>
  );
}
