import { IconCloudUpload } from "./icons";
import "./EmptyState.css";

export default function EmptyState() {
  return (
    <div className="stream-empty-state">
      <IconCloudUpload size={36} />
      <p>
        No logs yet — drag a file in, or
        <br />
        click Browse in the sidebar.
      </p>
    </div>
  );
}
