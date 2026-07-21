import { IconBolt } from "./icons";
import "./SpikingBadge.css";

/**
 * "⚡ SPIKING" filled chip (docs/specs/004-phase-4-error-intelligence.md §
 * Components & states — ErrorGroup card § SPIKING badge; § Sidebar source
 * row addition § SPIKING indicator): shared between the Errors-panel card
 * header and the sidebar source row. Icon + word, never a bare colored
 * dot/pulse — the text is the required signal, the pulse is decorative.
 */
export default function SpikingBadge() {
  return (
    <span className="spiking-badge">
      <IconBolt size={12} />
      SPIKING
    </span>
  );
}
