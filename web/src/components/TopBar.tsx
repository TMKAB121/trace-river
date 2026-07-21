import { useAppStore } from "../store/store";
import ViewSwitcher from "./ViewSwitcher";
import FreezeButton from "./FreezeButton";
import ClearButton from "./ClearButton";
import LatestErrorButton from "./LatestErrorButton";
import SearchInput from "./SearchInput";
import LevelChips from "./LevelChips";
import ErrorsOnlyToggle from "./ErrorsOnlyToggle";
import ScopeChip from "./ScopeChip";
import ErrorsSortControl from "./ErrorsSortControl";
import "./TopBar.css";

export default function TopBar() {
  const { state } = useAppStore();
  const hasSources = state.sourceOrder.length > 0;
  const disabled = !hasSources;
  const isStream = state.view === "stream";

  return (
    <div className="topbar-wrap">
      <div role="toolbar" aria-label="Stream controls" className="topbar">
        <ViewSwitcher disabled={disabled} />
        {/* Freeze/Clear/Latest-Error/Search apply only to the stream, not
            the group list — hidden (not disabled-and-shown) on the Errors
            tab, since they have nothing to act on there (spec 004 §
            Components & states — Errors-view toolbar/filter-row). */}
        {isStream && (
          <>
            <FreezeButton disabled={disabled} />
            <ClearButton disabled={disabled} />
            <LatestErrorButton disabled={disabled} />
            <SearchInput disabled={disabled} />
          </>
        )}
      </div>
      <div className="filter-row">
        {isStream ? (
          <>
            <LevelChips disabled={disabled} />
            <ErrorsOnlyToggle disabled={disabled} />
            {state.scopeSourceId && <ScopeChip sourceId={state.scopeSourceId} />}
          </>
        ) : (
          <ErrorsSortControl />
        )}
      </div>
    </div>
  );
}
