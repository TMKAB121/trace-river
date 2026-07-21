import { IconWarning } from "./icons";
import "./EmptyState.css";

/**
 * Errors panel empty state (docs/specs/004-phase-4-error-intelligence.md §
 * Layout — Errors panel, empty): same centered, muted-copy treatment as
 * spec 001's stream EmptyState, IconWarning in place of the cloud-upload icon.
 */
export default function ErrorsEmptyState() {
  return (
    <div className="stream-empty-state">
      <IconWarning size={36} />
      <p>
        No errors yet — grouped error/fatal entries
        <br />
        will appear here as they occur.
      </p>
    </div>
  );
}
