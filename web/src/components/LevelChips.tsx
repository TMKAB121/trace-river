import { LOG_LEVELS } from "../types";
import { useAppStore } from "../store/store";

export default function LevelChips({ disabled }: { disabled: boolean }) {
  const { state, actions } = useAppStore();

  return (
    <div className="level-chips">
      {LOG_LEVELS.map((level) => {
        const active = state.activeLevels.has(level);
        return (
          <button
            key={level}
            type="button"
            className={`level-chip level-chip--${level.toLowerCase()}${active ? " level-chip--active" : ""}`}
            aria-pressed={active}
            disabled={disabled}
            onClick={() => actions.toggleLevel(level)}
          >
            {level}
          </button>
        );
      })}
    </div>
  );
}
