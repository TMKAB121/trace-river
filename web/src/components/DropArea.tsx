import { useRef } from "react";
import { useAppStore } from "../store/store";
import { IconCloudUpload } from "./icons";
import "./DropArea.css";

export default function DropArea() {
  const { state, actions } = useAppStore();
  const inputRef = useRef<HTMLInputElement>(null);

  const uploads = Object.values(state.uploads);
  const totalLoaded = uploads.reduce((sum, u) => sum + u.loadedBytes, 0);
  const totalBytes = uploads.reduce((sum, u) => sum + u.totalBytes, 0);
  const progressPct = totalBytes > 0 ? (totalLoaded / totalBytes) * 100 : 0;
  const isUploading = uploads.length > 0;

  function handleFiles(files: FileList | null) {
    if (!files) return;
    Array.from(files).forEach((file) => {
      void actions.startUpload(file);
    });
  }

  return (
    <div className="drop-area">
      <div className="drop-area__icon">
        <IconCloudUpload size={28} />
      </div>
      <p className="drop-area__title">Drag &amp; Drop Log File</p>
      <p className="drop-area__hint">(.log .txt .json .jsonl)</p>
      <p className="drop-area__browse-line">
        or{" "}
        <button type="button" className="drop-area__browse" onClick={() => inputRef.current?.click()}>
          Browse
        </button>
      </p>
      <input
        ref={inputRef}
        type="file"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        accept=".log,.txt,.json,.jsonl"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {isUploading && (
        <div className="drop-area__progress-track" aria-hidden="true">
          <div className="drop-area__progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
      )}
    </div>
  );
}
