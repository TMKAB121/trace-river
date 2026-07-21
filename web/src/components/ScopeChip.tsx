import { useAppStore } from "../store/store";
import { IconX } from "./icons";

/**
 * Dismissible "<source id> errors ×" filter-row chip (docs/specs/
 * 004-phase-4-error-intelligence.md § Components & states — Stream-view
 * toolbar additions § Source-scope filter chip): renders only while a
 * per-source error badge's click-to-filter is active. Clearing removes only
 * the source restriction — Errors Only stays on.
 */
export default function ScopeChip({ sourceId }: { sourceId: string }) {
  const { actions } = useAppStore();

  return (
    <span className="filter-pill filter-pill--error-active">
      {sourceId} errors
      <button
        type="button"
        className="filter-pill__close"
        aria-label={`Clear ${sourceId} errors filter`}
        onClick={() => actions.clearScopeSource()}
      >
        <IconX size={12} />
      </button>
    </span>
  );
}
