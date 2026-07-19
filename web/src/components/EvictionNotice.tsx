import { useAppStore } from "../store/store";
import "./EvictionNotice.css";

export default function EvictionNotice() {
  const { state } = useAppStore();
  return <div className="eviction-notice">Showing last {state.bufferCapacity.toLocaleString()} entries</div>;
}
