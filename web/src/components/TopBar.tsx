import { useAppStore } from "../store/store";
import FreezeButton from "./FreezeButton";
import ClearButton from "./ClearButton";
import SearchInput from "./SearchInput";
import LevelChips from "./LevelChips";
import "./TopBar.css";

export default function TopBar() {
  const { state } = useAppStore();
  const hasSources = state.sourceOrder.length > 0;
  const disabled = !hasSources;

  return (
    <div className="topbar-wrap">
      <div role="toolbar" aria-label="Stream controls" className="topbar">
        <FreezeButton disabled={disabled} />
        <ClearButton disabled={disabled} />
        <SearchInput disabled={disabled} />
      </div>
      <div className="filter-row">
        <LevelChips disabled={disabled} />
      </div>
    </div>
  );
}
