import { useAppStore } from "../store/store";
import { IconPause, IconPlay } from "./icons";

export default function FreezeButton({ disabled }: { disabled: boolean }) {
  const { state, actions } = useAppStore();
  const newCount = state.frozen ? state.entries.length - (state.frozenAt ?? state.entries.length) : 0;

  return (
    <button
      type="button"
      className="topbar-btn"
      disabled={disabled}
      aria-pressed={state.frozen}
      onClick={() => (state.frozen ? actions.unfreeze() : actions.freeze())}
    >
      {state.frozen ? <IconPlay size={16} /> : <IconPause size={16} />}
      <span>{state.frozen ? "Resume" : "Freeze Stream"}</span>
      {state.frozen && newCount > 0 && <span className="topbar-btn__badge">· {newCount} new</span>}
    </button>
  );
}
