import { useCallback } from "react";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import StreamPanel from "./components/StreamPanel";
import DragOverlay from "./components/DragOverlay";
import Toast from "./components/Toast";
import { useAppStore } from "./store/store";
import { useGlobalDragAndDrop } from "./hooks/useGlobalDragAndDrop";
import "./App.css";

export default function App() {
  const { state, actions } = useAppStore();

  const handleDropFiles = useCallback(
    (files: FileList) => {
      Array.from(files).forEach((file) => {
        void actions.startUpload(file);
      });
    },
    [actions],
  );

  const isDragging = useGlobalDragAndDrop(handleDropFiles);

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main-panel">
        <TopBar />
        <main aria-label="Unified log stream" className="main-panel__stream">
          <StreamPanel />
        </main>
      </div>
      {isDragging && <DragOverlay />}
      <Toast />
      {/* Discrete state-change announcements only (not per-entry) — spec 001
          § Accessibility § Live region strategy. */}
      <div className="sr-only" role="status" aria-live="polite">
        {state.announcement}
      </div>
    </div>
  );
}
