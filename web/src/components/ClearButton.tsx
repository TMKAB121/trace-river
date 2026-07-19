import { useAppStore } from "../store/store";
import { IconTrash } from "./icons";

export default function ClearButton({ disabled }: { disabled: boolean }) {
  const { actions } = useAppStore();

  return (
    <button type="button" className="topbar-btn" disabled={disabled} onClick={() => actions.clearLogs()}>
      <IconTrash size={16} />
      <span>Clear Logs</span>
    </button>
  );
}
