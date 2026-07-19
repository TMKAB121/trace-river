import { IconArrowDown } from "./icons";
import "./JumpToLiveButton.css";

export default function JumpToLiveButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="jump-to-live" onClick={onClick}>
      <IconArrowDown size={14} />
      <span>Live</span>
    </button>
  );
}
