import { IconCloudUpload } from "./icons";
import "./DragOverlay.css";

export default function DragOverlay() {
  return (
    <div className="drag-overlay" role="presentation">
      <div className="drag-overlay__box">
        <IconCloudUpload size={28} />
        <span>Drop to add source</span>
      </div>
    </div>
  );
}
