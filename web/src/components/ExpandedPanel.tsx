import { useState } from "react";
import type { TraceRiverLog } from "../types";
import { highlightBody, highlightJson } from "../utils/highlight";
import { copyText } from "../utils/clipboard";
import "./ExpandedPanel.css";

export default function ExpandedPanel({ entry }: { entry: TraceRiverLog }) {
  const [copied, setCopied] = useState(false);
  const bodyText = entry.body ?? entry.message;
  const { html: bodyHtml, isJson: bodyIsJson } = highlightBody(bodyText);
  const contextHtml = entry.context !== null ? highlightJson(entry.context) : null;

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
    </div>
  );
}
