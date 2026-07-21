import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ApiError, getErrorPrompt } from "../api/rest";
import { useAppStore } from "../store/store";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { copyText } from "../utils/clipboard";
import { IconX } from "./icons";
import "./AIPromptModal.css";

type Status = "loading" | "loaded" | "error";

const COPY_CONFIRM_MS = 1500;

/**
 * AI Prompt Preview modal (docs/specs/004-phase-4-error-intelligence.md §
 * Interaction specs — AI Prompt Preview modal): fetches the server-assembled,
 * redacted prompt for `fingerprint`, shows it in an editable textarea, traps
 * focus while open, and returns focus to the opener on close (handled by the
 * caller via `onClose`, which is `store`'s `closePrompt`).
 */
export default function AIPromptModal({ fingerprint, onClose }: { fingerprint: string; onClose: () => void }) {
  const { actions } = useAppStore();
  const [status, setStatus] = useState<Status>("loading");
  const [promptText, setPromptText] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [copied, setCopied] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasFocusedTextareaRef = useRef(false);
  const titleId = "ai-prompt-modal-title";

  useFocusTrap(dialogRef, true);

  useEffect(() => {
    // "opening the modal moves focus to its first focusable element (the ×,
    // or the textarea once loaded)" — the × always exists at mount, before
    // the fetch below resolves.
    closeButtonRef.current?.focus();

    let cancelled = false;
    getErrorPrompt(fingerprint)
      .then(({ prompt }) => {
        if (cancelled) return;
        setPromptText(prompt);
        setStatus("loaded");
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setErrorMessage("This error group is no longer tracked and the prompt can't be regenerated.");
        } else {
          setErrorMessage("Couldn't load the prompt — try again.");
        }
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [fingerprint]);

  useEffect(() => {
    if (status === "loaded" && !hasFocusedTextareaRef.current) {
      hasFocusedTextareaRef.current = true;
      textareaRef.current?.focus();
    }
  }, [status]);

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  }

  async function handleCopy() {
    await copyText(promptText);
    setCopied(true);
    actions.announce("Prompt copied to clipboard.");
    setTimeout(() => setCopied(false), COPY_CONFIRM_MS);
  }

  return (
    <div className="modal-overlay" role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="modal"
        onKeyDown={handleKeyDown}
      >
        <div className="modal__header">
          <h2 id={titleId} className="modal__title">
            AI Debugging Prompt Preview
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            className="modal__close"
            aria-label="Close prompt preview"
            onClick={onClose}
          >
            <IconX size={16} />
          </button>
        </div>

        {status === "loaded" && (
          <p className="modal__hint">
            Redacted values are already replaced with &lt;redacted&gt; below. Edit freely, then copy.
          </p>
        )}

        <div className="modal__body">
          {status === "loading" && <p className="modal__status-text">Assembling prompt…</p>}
          {status === "error" && <p className="modal__status-text">{errorMessage}</p>}
          {status === "loaded" && (
            <textarea
              ref={textareaRef}
              className="modal__textarea"
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              aria-label="AI debugging prompt"
              spellCheck={false}
            />
          )}
        </div>

        <div className="modal__footer">
          <button type="button" className="topbar-btn" onClick={onClose}>
            {status === "error" ? "Close" : "Cancel"}
          </button>
          {status === "loaded" && (
            <button type="button" className="modal__copy-btn" onClick={handleCopy}>
              {copied ? "Copied" : "Copy"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
