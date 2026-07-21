import { useCallback } from "react";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import StreamPanel from "./components/StreamPanel";
import ErrorsPanel from "./components/ErrorsPanel";
import DragOverlay from "./components/DragOverlay";
import Toast from "./components/Toast";
import AIPromptModal from "./components/AIPromptModal";
import { useAppStore } from "./store/store";
import { useGlobalDragAndDrop } from "./hooks/useGlobalDragAndDrop";
import { useLatestErrorShortcut } from "./hooks/useLatestErrorShortcut";
import "./App.css";

export default function App() {
  const { state, actions } = useAppStore();
  useLatestErrorShortcut();

  const handleDropFiles = useCallback(
    (files: FileList) => {
      Array.from(files).forEach((file) => {
        void actions.startUpload(file);
      });
    },
    [actions],
  );

  const isDragging = useGlobalDragAndDrop(handleDropFiles);
  const modalOpen = state.promptFingerprint !== null;

  return (
    <>
      {/* Background content is inert/aria-hidden while the AI Prompt
          Preview modal is open — not reachable by Tab or announced by a
          screen reader (spec 004 § Accessibility — Focus management). */}
      <div className="app-shell" inert={modalOpen} aria-hidden={modalOpen || undefined}>
        <Sidebar />
        <div className="main-panel">
          <TopBar />
          {state.view === "stream" ? (
            <main
              id="view-panel-stream"
              role="tabpanel"
              aria-labelledby="view-tab-stream"
              aria-label="Unified log stream"
              className="main-panel__stream"
            >
              <StreamPanel />
            </main>
          ) : (
            <main
              id="view-panel-errors"
              role="tabpanel"
              aria-labelledby="view-tab-errors"
              aria-label="Errors"
              className="main-panel__stream"
            >
              <ErrorsPanel />
            </main>
          )}
        </div>
        {isDragging && <DragOverlay />}
        <Toast />
        {/* Discrete state-change announcements only (not per-entry) — spec 001
            § Accessibility § Live region strategy. */}
        <div className="sr-only" role="status" aria-live="polite">
          {state.announcement}
        </div>
      </div>
      {modalOpen && <AIPromptModal fingerprint={state.promptFingerprint as string} onClose={actions.closePrompt} />}
    </>
  );
}
