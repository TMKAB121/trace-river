import { useAppStore, useHasJumpableError } from "../store/store";
import { IconWarning } from "./icons";

/**
 * "Latest Error" top-bar button (docs/specs/004-phase-4-error-intelligence.md
 * § Components & states — Stream-view toolbar additions): disabled when
 * `!hasSources` (same gate as Freeze/Clear/Search) *or* when there is no
 * currently-eligible target entry.
 */
export default function LatestErrorButton({ disabled }: { disabled: boolean }) {
  const { actions } = useAppStore();
  const hasTarget = useHasJumpableError();

  return (
    <button
      type="button"
      className="topbar-btn"
      disabled={disabled || !hasTarget}
      aria-label="Jump to the most recent error entry (press E)"
      onClick={() => actions.jumpToLatestError()}
    >
      <IconWarning size={16} />
      <span>Latest Error</span>
    </button>
  );
}
