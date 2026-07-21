import { useState } from "react";
import type { TraceRiverLog } from "../types";
import { useAppStore } from "../store/store";
import { highlightBody, highlightJson } from "../utils/highlight";
import { copyText } from "../utils/clipboard";
import { IconSparkle } from "./icons";
import "./ExpandedPanel.css";

export default function ExpandedPanel({ entry }: { entry: TraceRiverLog }) {
  const { actions } = useAppStore();
  const [copied, setCopied] = useState(false);
  const bodyText = entry.body ?? entry.message;
  const { html: bodyHtml, isJson: bodyIsJson } = highlightBody(bodyText);
  const contextHtml = entry.context !== null ? highlightJson(entry.context) : null;
  // Renders only when entry.level is ERROR/FATAL AND entry.fingerprint is
  // non-null (spec 004 § Layout — stream row's expanded panel, with the
  // AI-prompt affordance) — strictly additive; every other row is otherwise
  // pixel-identical to spec 001.
  const promptFingerprint =
    entry.level === "ERROR" || entry.level === "FATAL" ? entry.fingerprint : null;

  async function handleCopy() {
    await copyText(entry.raw);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="expanded-panel">
      <button type="button" className="expanded-panel__copy" onClick={handleCopy}>
        {copied ? "Copied" : "Copy Raw"}
      </button>
      <div className="expanded-panel__scroll">
        <pre className={`expanded-panel__code${bodyIsJson ? " expanded-panel__code--json" : " expanded-panel__code--plain"}`}>
          {/* eslint-disable-next-line react/no-danger -- highlight.js output, generated locally from entry.body */}
          <code dangerouslySetInnerHTML={{ __html: bodyHtml }} />
        </pre>
        {contextHtml !== null && (
          <div className="expanded-panel__context">
            <div className="expanded-panel__context-label">Context</div>
            <pre className="expanded-panel__code expanded-panel__code--json">
              <code dangerouslySetInnerHTML={{ __html: contextHtml }} />
            </pre>
          </div>
        )}
      </div>
      {promptFingerprint && (
        <button
          type="button"
          className="expanded-panel__sparkle"
          aria-label="Generate AI debugging prompt for this error"
          onClick={() => actions.openPrompt(promptFingerprint)}
        >
          <IconSparkle size={16} />
        </button>
      )}
    </div>
  );
}
