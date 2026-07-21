import { useEffect } from "react";
import { useAppStore } from "../store/store";

/**
 * Global `e` keydown → jump to the most recent visible error entry (docs/
 * specs/004-phase-4-error-intelligence.md § Interaction specs — Jump to
 * latest error § Keyboard): fires only on a bare `e` (no modifier keys) and
 * only when focus is not inside an `<input>`, `<textarea>`, any
 * `contenteditable`, or while the AI Prompt Preview modal is open (its own
 * focus trap owns the keyboard while open). The action itself is a no-op
 * when there's no eligible target, mirroring the Latest Error button's own
 * disabled gating.
 */
export function useLatestErrorShortcut(): void {
  const { state, actions } = useAppStore();
  const modalOpen = state.promptFingerprint !== null;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "e" || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (modalOpen) return;

      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      }

      e.preventDefault();
      actions.jumpToLatestError();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [modalOpen, actions]);
}
