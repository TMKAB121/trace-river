import { useAppStore } from "../store/store";
import { IconWarning } from "./icons";

/**
 * "Errors Only" filter-row toggle (docs/specs/004-phase-4-error-intelligence.md
 * § Components & states — Stream-view toolbar additions): grouped with the
 * level chips (it's a filter, not an action). Active-state visual reuses the
 * existing 18%-tint-over-transparent pattern already implemented for active
 * level chips.
 */
export default function ErrorsOnlyToggle({ disabled }: { disabled: boolean }) {
  const { state, actions } = useAppStore();

  return (
    <button
      type="button"
      className={`filter-pill${state.errorsOnly ? " filter-pill--error-active" : ""}`}
      aria-pressed={state.errorsOnly}
      disabled={disabled}
      onClick={() => actions.toggleErrorsOnly()}
    >
      <IconWarning size={14} />
      Errors Only
    </button>
  );
}
