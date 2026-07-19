import { useAppStore } from "../store/store";
import { IconSearch, IconX } from "./icons";

export default function SearchInput({ disabled }: { disabled: boolean }) {
  const { state, actions } = useAppStore();

  return (
    <div className="search-input" role="search">
      <IconSearch size={16} />
      <input
        type="text"
        value={state.searchInput}
        disabled={disabled}
        placeholder="Search logs (e.g., '500 ERROR')."
        aria-label="Search logs"
        onChange={(e) => actions.setSearchInput(e.target.value)}
      />
      {state.searchInput.length > 0 && (
        <button type="button" className="search-input__clear" aria-label="Clear search" onClick={() => actions.clearSearch()}>
          <IconX size={12} />
        </button>
      )}
    </div>
  );
}
