import { useEffect, useRef, useState } from "react";

function dragHasFiles(e: DragEvent): boolean {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
}

/**
 * Detects drag-over globally (`dragenter` on the window) so the whole
 * viewport is a drop target, not just the sidebar drop box — spec 001 §
 * Layout § Wireframe — drag-over. Dragging out or pressing Escape cancels
 * with no state change.
 */
export function useGlobalDragAndDrop(onDropFiles: (files: FileList) => void): boolean {
  const [isDragging, setIsDragging] = useState(false);
  const counterRef = useRef(0);
  const onDropFilesRef = useRef(onDropFiles);
  onDropFilesRef.current = onDropFiles;

  useEffect(() => {
    function onDragEnter(e: DragEvent) {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      counterRef.current += 1;
      setIsDragging(true);
    }
    function onDragOver(e: DragEvent) {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
    }
    function onDragLeave(e: DragEvent) {
      if (!dragHasFiles(e)) return;
      counterRef.current = Math.max(0, counterRef.current - 1);
      if (counterRef.current === 0) setIsDragging(false);
    }
    function onDrop(e: DragEvent) {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      counterRef.current = 0;
      setIsDragging(false);
      if (e.dataTransfer?.files?.length) {
        onDropFilesRef.current(e.dataTransfer.files);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        counterRef.current = 0;
        setIsDragging(false);
      }
    }

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return isDragging;
}
