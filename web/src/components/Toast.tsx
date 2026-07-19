import { useAppStore } from "../store/store";
import "./Toast.css";

export default function Toast() {
  const { state } = useAppStore();
  if (!state.toast) return null;
  return (
    <div className="toast" role="status">
      {state.toast.message}
    </div>
  );
}
